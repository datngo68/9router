// Per-API-key IP allowlist with CIDR support.
//
// Supports IPv4 (with /N) and IPv6 (with /N). Supports the special suffix
// "/0" to match any address (use sparingly). Empty list ⇒ no restriction.
//
// Errors during parsing return false (i.e. deny) rather than throwing, so a
// malformed entry never silently allows everything.

function parseIpv4(addr) {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8 | v) >>> 0;
  }
  return n;
}

function parseIpv6(addr) {
  const lower = addr.toLowerCase().replace(/%.*$/, "");
  // Bracketed [::1]
  const stripped = lower.replace(/^\[|\]$/g, "");
  if (!stripped.includes(":")) return null;

  // Handle ::ffff:1.2.3.4 (IPv4-mapped) by extending to full form.
  let s = stripped;
  const lastColon = s.lastIndexOf(":");
  if (lastColon !== -1 && s.slice(lastColon + 1).includes(".")) {
    const v4 = s.slice(lastColon + 1);
    const n = parseIpv4(v4);
    if (n === null) return null;
    const hi = (n >>> 16).toString(16);
    const lo = (n & 0xffff).toString(16);
    s = `${s.slice(0, lastColon)}:${hi}:${lo}`;
  }

  // Expand "::"
  let halves;
  if (s.includes("::")) {
    const [head, tail] = s.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const fillCount = 8 - (headParts.length + tailParts.length);
    if (fillCount < 0) return null;
    halves = [...headParts, ...Array(fillCount).fill("0"), ...tailParts];
  } else {
    halves = s.split(":");
  }
  if (halves.length !== 8) return null;
  const out = new Uint16Array(8);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(halves[i])) return null;
    out[i] = parseInt(halves[i], 16);
  }
  return out;
}

function ipv6Bits(arr) {
  let bits = "";
  for (const x of arr) bits += x.toString(2).padStart(16, "0");
  return bits;
}

/**
 * Returns true if `ip` matches the CIDR (or single address) `cidr`.
 * Behavior on errors: returns false.
 */
export function ipMatches(ip, cidr) {
  if (!ip || !cidr) return false;
  const cleanIp = String(ip).replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const [addr, maskRaw] = String(cidr).split("/");
  const mask = maskRaw === undefined ? null : Number(maskRaw);

  const ipv4 = parseIpv4(cleanIp);
  if (ipv4 !== null) {
    const cidrV4 = parseIpv4(addr);
    if (cidrV4 === null) return false;
    if (mask === null) return ipv4 === cidrV4;
    if (!Number.isInteger(mask) || mask < 0 || mask > 32) return false;
    if (mask === 0) return true;
    const m = mask === 32 ? 0xffffffff : ((0xffffffff << (32 - mask)) >>> 0);
    return (ipv4 & m) === (cidrV4 & m);
  }

  const ipv6 = parseIpv6(cleanIp);
  if (ipv6) {
    const cidrV6 = parseIpv6(addr);
    if (!cidrV6) return false;
    const m = mask === null ? 128 : mask;
    if (!Number.isInteger(m) || m < 0 || m > 128) return false;
    if (m === 0) return true;
    const ipBits = ipv6Bits(ipv6).slice(0, m);
    const cidrBits = ipv6Bits(cidrV6).slice(0, m);
    return ipBits === cidrBits;
  }
  return false;
}

/**
 * Check IP against an array of CIDR strings. Empty list = unrestricted.
 */
export function checkIpAllowlist(ip, list) {
  if (!Array.isArray(list) || list.length === 0) return true;
  for (const entry of list) {
    if (ipMatches(ip, String(entry).trim())) return true;
  }
  return false;
}
