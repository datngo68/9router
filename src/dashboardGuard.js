import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSettings } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

// Public API paths — no auth required (LLM API has its own key auth inside handler).
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc",
  "/api/version",
  "/api/settings/require-login",
  // Storefront public
  "/api/store",
  // Customer auth (login/register/forgot/reset). Logged-in account routes
  // verify session inside the handler.
  "/api/account/login",
  "/api/account/register",
  "/api/account/forgot",
  "/api/account/reset",
  // Telegram webhook — verifies its own secret in the handler.
  "/api/telegram/webhook",
  // APIBank webhook — verifies HMAC signature in the handler.
  "/api/webhooks/apibank",
];

// Public top-level prefixes (LLM API endpoints with their own API key auth,
// plus the storefront site for unauthenticated browsing).
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/store"];

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
];

// Routes that spawn child processes or read host secrets — restrict to localhost.
const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/cli-tools/antigravity-mitm",
  "/api/mcp/",
  "/api/tunnel/tailscale-install",
  "/api/tunnel/tailscale-enable",
  "/api/tunnel/tailscale-disable",
  "/api/tunnel/tailscale-login",
  "/api/tunnel/tailscale-start-daemon",
  "/api/tunnel/tailscale-check",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(h) {
  if (!h) return false;
  const name = h.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTS.has(name);
}

function isLocalRequest(request) {
  if (!isLoopbackHostname(request.headers.get("host"))) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return request.headers.get("x-api-key");
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return true;
  if (await hasValidCliToken(request)) return true;
  return await hasValidApiKey(request);
}

async function canAccessLocalOnlyRoute(request) {
  if (await hasValidCliToken(request)) return true;
  // Browser on host: loopback Host + Origin (blocks tunnel/CSRF) + JWT cookie (blocks unauth raw clients)
  if (isLocalRequest(request) && await hasValidToken(request)) return true;
  return false;
}

async function hasValidToken(request) {
  const token = request.cookies.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  const settings = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const ADMIN_ENDPOINTS = ["/dashboard", "/login", "/api/admin"];

/**
 * Decide whether the current request hostname is allowed to serve admin
 * endpoints. When `settings.adminHosts` is set, only those exact hostnames
 * (case-insensitive) get admin surface. Loopback is always allowed so the
 * operator can reach the dashboard locally for emergencies.
 *
 * `settings.adminHosts` example: "admin.example.com,internal.example.com"
 */
function normalizeHostInput(raw) {
  if (!raw) return "";
  let s = String(raw).trim().toLowerCase();
  // Strip scheme (http://, https://) the operator may have pasted.
  s = s.replace(/^https?:\/\//, "");
  // Drop path/query and trailing slashes.
  s = s.replace(/[/?#].*$/, "");
  // Drop port.
  s = s.split(":")[0];
  return s;
}

function isAdminHostAllowed(request, settings) {
  if (!settings) return true;
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  if (isLoopbackHostname(host)) return true;
  const raw = settings.adminHosts;
  if (!raw || !String(raw).trim()) return true; // not configured → no restriction
  const allowed = String(raw)
    .split(/[,\s]+/)
    .map(normalizeHostInput)
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(host);
}

function isAdminPath(pathname) {
  return ADMIN_ENDPOINTS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * If `settings.adminPathPrefix` is set (e.g. "x9k2"), the operator must visit
 * `/<prefix>` first. Middleware then issues a redirect to /login AND sets a
 * short-lived gate cookie. Subsequent visits to /login require either:
 *   - admin_gate cookie (just came from /<prefix>) — bot scanners don't have this
 *   - auth_token cookie (already logged in)
 * Without either, /login returns 404. Bots scanning /login on a public host
 * never see the actual login form.
 *
 * Cookie value = sha256(prefix) so server can verify in O(1) without storing
 * state. Lifetime 10 minutes — enough for a human to type credentials.
 */
const ADMIN_GATE_COOKIE = "admin_gate";
const GATE_TTL_SEC = 600;

function normalizePrefix(prefix) {
  const v = String(prefix || "").trim().replace(/^\/+|\/+$/g, "");
  if (!v) return "";
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return "";
  return v;
}

function gateCookieValue(prefix) {
  return crypto.createHash("sha256").update(`9r-admin-gate:${prefix}`).digest("base64url");
}

function hasValidGateCookie(request, prefix) {
  if (!prefix) return false;
  const cookie = request.cookies.get(ADMIN_GATE_COOKIE)?.value;
  return cookie && cookie === gateCookieValue(prefix);
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Local-only gate for spawn-capable / host-secret routes.
  if (LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  const settings = await loadSettings();
  const adminPrefix = normalizePrefix(settings?.adminPathPrefix);

  // One-time per-request diagnostic. Helpful when the operator can't figure
  // out why a path is/isn't matching. Kept short to avoid log spam.
  if (pathname !== "/api/health" && (pathname.startsWith("/login") || pathname.startsWith("/x") || pathname.startsWith("/dashboard"))) {
    console.log(`[guard] ${pathname} host=${request.headers.get("host")} prefix=${adminPrefix || "(empty)"} adminHosts=${settings?.adminHosts || "(empty)"}`);
  }

  // Hostname gate: hide admin surface from public storefront hostname.
  // If adminHosts is configured and current host doesn't match, deny dashboard,
  // login and /api/admin/*. Returns 404 to avoid leaking that an admin lives here.
  if (isAdminPath(pathname) && !isAdminHostAllowed(request, settings)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Admin path prefix gate. Loopback bypasses entirely so the operator can
  // always recover from the local machine. Logic:
  //   - Visit /<prefix>    → set gate cookie, redirect to /login
  //   - Visit /login       → 404 unless gate cookie OR auth_token present
  // Result: bots scanning /login from outside hit 404 unless they know the
  // prefix; humans typing /<prefix> get redirected and can sign in normally.
  if (adminPrefix && !isLoopbackHostname((request.headers.get("host") || "").split(":")[0])) {
    const root = `/${adminPrefix}`;
    if (pathname === root || pathname === `${root}/` || pathname === `${root}/login`) {
      const res = NextResponse.redirect(new URL("/login", request.url));
      res.cookies.set(ADMIN_GATE_COOKIE, gateCookieValue(adminPrefix), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: GATE_TTL_SEC,
        secure: (request.headers.get("x-forwarded-proto") || "").toLowerCase() === "https",
      });
      return res;
    }
    if (pathname === "/login" || pathname.startsWith("/login/")) {
      const okGate = hasValidGateCookie(request, adminPrefix);
      const okAuth = await hasValidToken(request);
      if (!okGate && !okAuth) {
        return new NextResponse("Not found", { status: 404 });
      }
    }
  }

  // Always protected - require valid JWT or local CLI token (machineId-based)
  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    return NextResponse.json({ error: "API key required for remote API access" }, { status: 401 });
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    // Customer routes verify session in-handler — bypass admin auth.
    if (pathname.startsWith("/api/account/") || pathname === "/api/account") return NextResponse.next();
    if (pathname.startsWith("/api/orders/") || pathname === "/api/orders") return NextResponse.next();
    if (pathname.startsWith("/api/vouchers/") || pathname === "/api/vouchers") return NextResponse.next();
    if (await hasValidCliToken(request) || await isAuthenticated(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;
    let tunnelDashboardAccess = true;

    try {
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        // Block tunnel/tailscale access if disabled (redirect to login)
        if (!tunnelDashboardAccess) {
          const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
          const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
          if ((tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost)) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        }
      }
    } catch {
      // On error, keep defaults (require login, block tunnel)
    }

    // If login not required, allow through
    if (!requireLogin) return NextResponse.next();

    // Verify JWT token
    const token = request.cookies.get("auth_token")?.value;
    if (token) {
      if (await verifyDashboardAuthToken(token)) {
        return NextResponse.next();
      } else {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / based on hostname intent:
  //   - adminHosts unconfigured (empty) → assume the deployment serves both
  //     storefront and admin on one domain. Customers hitting `/` should land
  //     on /store (admins know the prefix and type it directly).
  //   - adminHosts set + current host NOT in list → storefront → /store.
  //   - adminHosts set + current host IS in list → admin landing:
  //       a) authenticated → /dashboard
  //       b) prefix configured → redirect /<prefix> (which sets gate cookie)
  //       c) otherwise → /login
  if (pathname === "/") {
    const adminHostsConfigured = settings?.adminHosts && String(settings.adminHosts).trim();
    const onAdminHost = isAdminHostAllowed(request, settings) && (
      adminHostsConfigured || isLoopbackHostname((request.headers.get("host") || "").split(":")[0])
    );

    if (!onAdminHost) {
      return NextResponse.redirect(new URL("/store", request.url));
    }
    if (await hasValidToken(request)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    if (adminPrefix) {
      return NextResponse.redirect(new URL(`/${adminPrefix}`, request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}
