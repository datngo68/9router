// SSRF-hardened fetch wrapper.
//
// Why this exists:
//   Many routes call `fetch(url)` with a URL that originates from admin input
//   or DB-stored config (APIBank base URL, OIDC issuer URL, custom provider
//   `node.baseUrl`, etc). A compromised admin account or settings tamper could
//   point those URLs at internal addresses (169.254.169.254 metadata, 127.0.0.1
//   redis, 10.0.0.0/8 internal services) and read sensitive responses.
//
//   `safeFetch` enforces a deny-list against private/loopback/link-local/
//   metadata IP ranges *after* DNS resolution, so DNS rebinding attacks that
//   resolve a public name to a private IP are caught.
//
// Usage:
//   import { safeFetch, SsrfBlockedError, isPrivateIp, assertSafeUrl } from "@/shared/net/safeFetch";
//   await safeFetch("https://example.com/api", { method: "POST" });
//
// Bypass for local dev:
//   SAFE_FETCH_ALLOW_PRIVATE=1  → skip enforcement (still parses URL).

import dns from "node:dns/promises";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message, { url, reason } = {}) {
    super(message);
    this.name = "SsrfBlockedError";
    this.code = "SSRF_BLOCKED";
    this.url = url || null;
    this.reason = reason || null;
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

function bypassEnabled() {
  return process.env.SAFE_FETCH_ALLOW_PRIVATE === "1";
}

// ── IPv4 helpers ───────────────────────────────────────────────────────────

function ipv4ToInt(ip) {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
}

function inV4Cidr(ip, cidr) {
  const [base, bits] = cidr.split("/");
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const V4_BLOCKED = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "169.254.0.0/16",   // link-local + AWS/GCP metadata
  "100.64.0.0/10",    // CGNAT
  "0.0.0.0/8",        // "this network"
  "224.0.0.0/4",      // multicast
  "240.0.0.0/4",      // reserved (includes 255.255.255.255 broadcast)
];

function isPrivateV4(ip) {
  return V4_BLOCKED.some((cidr) => inV4Cidr(ip, cidr));
}

// ── IPv6 helpers ───────────────────────────────────────────────────────────

// Expand a (possibly compressed) IPv6 string to a 16-byte Uint8Array. Handles
// "::", embedded IPv4 in last 32 bits ("::ffff:1.2.3.4"), and zone IDs.
function ipv6ToBytes(ip) {
  if (typeof ip !== "string") return null;
  let s = ip.trim();
  // Strip zone id (fe80::1%eth0)
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  // Strip brackets
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (!s.includes(":")) return null;

  // Embedded IPv4: replace trailing "x.x.x.x" with two 16-bit hex groups.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    s = `${s.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const parts = s.split("::");
  if (parts.length > 2) return null;
  let head = parts[0] === "" ? [] : parts[0].split(":");
  let mid = parts.length === 2 ? (parts[1] === "" ? [] : parts[1].split(":")) : null;

  if (mid !== null) {
    const fillCount = 8 - head.length - mid.length;
    if (fillCount < 0) return null;
    const fill = new Array(fillCount).fill("0");
    head = head.concat(fill, mid);
  }
  if (head.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const grp = head[i];
    if (!/^[0-9a-fA-F]{1,4}$/.test(grp)) return null;
    const n = parseInt(grp, 16);
    bytes[i * 2] = (n >> 8) & 0xff;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return bytes;
}

function bytesEqualPrefix(bytes, target, bits) {
  const fullBytes = Math.floor(bits / 8);
  const remBits = bits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== target[i]) return false;
  }
  if (remBits === 0) return true;
  const mask = (0xff << (8 - remBits)) & 0xff;
  return (bytes[fullBytes] & mask) === (target[fullBytes] & mask);
}

function v6Prefix(hex, bits) {
  const target = ipv6ToBytes(hex);
  return { target, bits };
}

const V6_BLOCKED = [
  v6Prefix("::1", 128),         // loopback
  v6Prefix("::", 128),          // unspecified
  v6Prefix("fc00::", 7),        // ULA
  v6Prefix("fe80::", 10),       // link-local
  v6Prefix("ff00::", 8),        // multicast
  v6Prefix("2001:db8::", 32),   // documentation
];

function isPrivateV6(ip) {
  const bytes = ipv6ToBytes(ip);
  if (!bytes) return false;

  // ::ffff:0:0/96 — IPv4-mapped. Re-check the embedded IPv4 against v4 rules.
  const isMapped =
    bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 &&
    bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0 &&
    bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isMapped) {
    const v4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isPrivateV4(v4);
  }

  for (const { target, bits } of V6_BLOCKED) {
    if (target && bytesEqualPrefix(bytes, target, bits)) return true;
  }
  return false;
}

// ── Public IP check ────────────────────────────────────────────────────────

/**
 * Returns true if `ip` falls in any blocked range (private / loopback /
 * link-local / metadata / multicast / reserved / IPv6 special).
 *
 * Accepts IPv4 dotted-quad and IPv6 (compressed, mapped, zone-id stripped).
 * Returns false for malformed input — caller should validate parsing first.
 */
export function isPrivateIp(ip) {
  if (typeof ip !== "string" || !ip) return false;
  const family = net.isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return false;
}

// ── DNS resolution ─────────────────────────────────────────────────────────

async function resolveAllIps(hostname) {
  const out = [];
  await Promise.all([
    dns.resolve4(hostname).then((rs) => out.push(...rs)).catch(() => {}),
    dns.resolve6(hostname).then((rs) => out.push(...rs)).catch(() => {}),
  ]);
  return out;
}

// ── Policy enforcement ─────────────────────────────────────────────────────

async function checkUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`, { url: rawUrl, reason: "invalid_url" });
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfBlockedError(
      `Blocked protocol: ${parsed.protocol}`,
      { url: parsed.toString(), reason: "protocol" }
    );
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new SsrfBlockedError(`Missing hostname`, { url: rawUrl, reason: "no_host" });
  }

  if (bypassEnabled()) return { url: parsed, ips: [] };

  // If hostname is itself an IP literal, check directly. Strip brackets for v6.
  const literal = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  const literalFamily = net.isIP(literal);
  if (literalFamily) {
    if (isPrivateIp(literal)) {
      throw new SsrfBlockedError(
        `Blocked private IP literal: ${literal}`,
        { url: parsed.toString(), reason: "private_ip_literal" }
      );
    }
    return { url: parsed, ips: [literal] };
  }

  // DNS resolve. Reject if any resolved IP is private — covers DNS rebinding
  // where a name returns multiple records.
  const ips = await resolveAllIps(hostname);
  if (ips.length === 0) {
    throw new SsrfBlockedError(
      `DNS resolution returned no records for ${hostname}`,
      { url: parsed.toString(), reason: "dns_empty" }
    );
  }
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new SsrfBlockedError(
        `Blocked private IP ${ip} for host ${hostname}`,
        { url: parsed.toString(), reason: "private_ip_resolved" }
      );
    }
  }
  return { url: parsed, ips };
}

/**
 * Throw `SsrfBlockedError` if `url` violates the SSRF policy (protocol,
 * private IP literal, or DNS-resolved private IP). Does not perform a
 * network fetch. Useful when handing the URL off to a library that does
 * its own connection (e.g. WebSocket clients).
 */
export async function assertSafeUrl(url) {
  await checkUrl(url);
}

/**
 * SSRF-safe wrapper around global `fetch`. Validates the URL, then delegates
 * to `fetch(url, init)`.
 *
 * Note on TOCTOU: between DNS resolve and connect, a name *could* rebind to a
 * private IP. We do not pin the connection to the resolved IP today (would
 * break TLS SNI/Host validation in many cases). The window is small and the
 * typical attack vector — admin pasting a malicious URL — is fully covered.
 */
export async function safeFetch(url, init = {}) {
  const target = typeof url === "string" ? url : url?.url || String(url);
  await checkUrl(target);
  return fetch(target, init);
}
