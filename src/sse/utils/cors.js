// CORS helper for /v1/* endpoints. Defaults to no browser access; only
// origins listed in `settings.corsAllowedOrigins` get CORS headers back.
//
// Server-to-server requests (no Origin header) are unaffected — CORS is a
// browser-only mechanism, so omitting headers does not block curl, server
// fetch, or CLI tools.

import { getSettings } from "@/lib/localDb";

const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "Authorization, Content-Type, x-api-key, anthropic-version, x-stainless-os, x-stainless-package-version, x-stainless-runtime, x-stainless-runtime-version, x-stainless-arch, x-stainless-lang, x-stainless-helper-method";

let cached = { ts: 0, list: [] };
const CACHE_MS = 5000;

async function loadAllowedOrigins() {
  const now = Date.now();
  if (now - cached.ts < CACHE_MS) return cached.list;
  try {
    const s = await getSettings();
    const raw = s?.corsAllowedOrigins;
    const list = Array.isArray(raw) ? raw : (typeof raw === "string" ? raw.split(",") : []);
    cached = {
      ts: now,
      list: list.map((o) => String(o).trim().toLowerCase()).filter(Boolean),
    };
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
