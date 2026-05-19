// CORS helper for /v1/* endpoints. Defaults to no browser access; only
// origins listed in `settings.corsAllowedOrigins` get CORS headers back.
//
// Server-to-server requests (no Origin header) are unaffected — CORS is a
// browser-only mechanism, so omitting headers does not block curl, server
// fetch, or CLI tools.
//
// Hardening notes:
//   • The list is sourced from admin settings, so we validate each item
//     matches `https?://hostname(:port)?` and silently drop malformed entries.
//   • Wildcard `*` echoes the request origin instead of returning literal `*`.
//     This keeps the door open even if a future caller pairs the response
//     with `Access-Control-Allow-Credentials: true` (browsers reject `*` +
//     credentials), and it's also safer when admin pastes `*` "to test"
//     without realising it disables the allowlist entirely. We log a one-shot
//     warning so the operator can fix the config.

import { getSettings } from "@/lib/localDb";

const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "Authorization, Content-Type, x-api-key, anthropic-version, x-stainless-os, x-stainless-package-version, x-stainless-runtime, x-stainless-runtime-version, x-stainless-arch, x-stainless-lang, x-stainless-helper-method";

// Accept "https://host" or "https://host:port"; allow `*` as a sentinel.
// Matches scheme+host(+optional port) only — paths/query/fragments are
// invalid because Origin headers don't include them.
const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

let cached = { ts: 0, list: [] };
const CACHE_MS = 5000;
let warnedWildcard = false;

/**
 * Validate that a raw origin string is well-formed enough to compare with
 * the browser-supplied `Origin` header. Returns the lowercased origin or
 * null if the entry is malformed.
 *
 * Exported for unit tests; callers shouldn't need it.
 */
export function normalizeAllowedOrigin(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s === "*") return "*";
  if (!ORIGIN_PATTERN.test(s)) return null;
  return s.toLowerCase();
}

async function loadAllowedOrigins() {
  const now = Date.now();
  if (now - cached.ts < CACHE_MS) return cached.list;
  try {
    const s = await getSettings();
    const raw = s?.corsAllowedOrigins;
    const items = Array.isArray(raw) ? raw : (typeof raw === "string" ? raw.split(",") : []);
    const validated = [];
    for (const item of items) {
      const norm = normalizeAllowedOrigin(item);
      if (norm) {
        validated.push(norm);
      } else if (String(item || "").trim()) {
        console.log(`[cors] ignoring invalid origin: ${String(item).slice(0, 80)}`);
      }
    }
    if (validated.includes("*") && !warnedWildcard) {
      console.log("[cors] WARNING: wildcard '*' in corsAllowedOrigins — echoing the request origin to keep credentialed requests safe. Replace with explicit origins.");
      warnedWildcard = true;
    }
    cached = { ts: now, list: validated };
  } catch {
    cached = { ts: now, list: [] };
  }
  return cached.list;
}

function originAllowed(origin, allowList) {
  if (!origin) return false;
  const o = origin.toLowerCase();
  if (allowList.includes("*")) return true;
  return allowList.includes(o);
}

/**
 * Build CORS headers for a request. If the request has no Origin header,
 * returns an empty object (server-to-server, no CORS needed). Otherwise
 * returns headers reflecting the requested origin only when allowlisted.
 *
 * We intentionally never return `Access-Control-Allow-Origin: *` — even when
 * the admin has configured wildcard. Echoing the origin is equivalent for
 * non-credentialed requests and stays compatible with future credentialed
 * use without a config change.
 */
export async function buildCorsHeaders(request) {
  const origin = request.headers?.get?.("origin") || null;
  if (!origin) return {};
  const list = await loadAllowedOrigins();
  if (!originAllowed(origin, list)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Vary": "Origin",
  };
}

/**
 * Handle a preflight OPTIONS request. Returns a Response or null if not a
 * preflight (caller should fall through to normal handling).
 */
export async function handleCorsPreflight(request) {
  if (request.method !== "OPTIONS") return null;
  const headers = await buildCorsHeaders(request);
  return new Response(null, { status: 204, headers });
}
