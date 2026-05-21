import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { hasDefaultPassword, isAnyRemoteAccessEnabled } from "@/lib/security/tunnelGuard";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 8;
const RESET_HINT = "Forgot password? Reset to default via 9Router CLI → Settings → Reset Password to Default.";

function isTunnelRequest(request, settings) {
  // Prefer x-forwarded-host because cloudflared/reverse proxies typically
  // rewrite Host to 127.0.0.1 before forwarding to the upstream.
  const fwd = request.headers.get("x-forwarded-host");
  const raw = fwd ? String(fwd).split(",")[0].trim() : (request.headers.get("host") || "");
  const host = raw.split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

// Constant-time string compare; returns false on length mismatch instead of throwing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    // Block tunnel-side login entirely while the dashboard still uses the
    // default password. Forces operator to set a real password first.
    if (isTunnelRequest(request, settings) && (await hasDefaultPassword(settings)) && isAnyRemoteAccessEnabled(settings)) {
      return NextResponse.json({ error: "Default password is not allowed for remote login. Set a password from the loopback dashboard first." }, { status: 403 });
    }

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
    }

    const storedHash = settings.password;
    let isValid = false;

    if (storedHash) {
      // Hashed password persisted: bcrypt.compare is timing-safe.
      isValid = password.length > 0 && (await bcrypt.compare(password, storedHash));
    } else {
      // No persisted hash. Fall back to INITIAL_PASSWORD only if it looks safe;
      // otherwise refuse to authenticate so we never accept "123456".
      const initial = process.env.INITIAL_PASSWORD;
      if (!initial || initial.length < MIN_PASSWORD_LENGTH || initial === "123456" || initial === "change-me") {
        return NextResponse.json(
          {
            error:
              "Dashboard password is not initialised. Set INITIAL_PASSWORD (>=8 chars, not '123456') in the environment, restart, then change it from the dashboard.",
          },
          { status: 503 }
        );
      }
      if (password.length >= MIN_PASSWORD_LENGTH && safeEqual(password, initial)) {
        // First successful login with INITIAL_PASSWORD: persist a bcrypt hash so
        // subsequent logins use the hashed path and the env value can be removed.
        try {
          const hash = await bcrypt.hash(initial, BCRYPT_COST);
          await updateSettings({ password: hash });
        } catch (e) {
          console.error("[auth/login] failed to persist initial password hash:", e?.message || e);
        }
        isValid = true;
      }
    }

    if (isValid) {
      recordSuccess(ip);
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);
      return NextResponse.json({ success: true });
    }

    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    console.error("[auth/login] error:", error?.message || error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
