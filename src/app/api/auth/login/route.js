import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { hasDefaultPassword, isAnyRemoteAccessEnabled } from "@/lib/security/tunnelGuard";
import { checkLogin, recordFailure, clearFailures, getClientIp } from "@/lib/auth/loginThrottle";

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLogin(ip);
    if (lock.locked) {
      const retrySec = Math.max(1, Math.ceil(lock.retryAfterMs / 1000));
      return NextResponse.json(
        { error: "Too many failed login attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(retrySec) } }
      );
    }

    const { password } = await request.json();
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

    // Default password is '123456' if not set
    const storedHash = settings.password;

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
    }

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      // Use env var or default
      const initialPassword = process.env.INITIAL_PASSWORD || "123456";
      isValid = password === initialPassword;
    }

    if (isValid) {
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);
      clearFailures(ip);
      return NextResponse.json({ success: true });
    }

    const failResult = recordFailure(ip);
    if (failResult.locked) {
      const retrySec = Math.max(1, Math.ceil(failResult.retryAfterMs / 1000));
      return NextResponse.json(
        { error: "Too many failed login attempts. Locked out for 15 minutes." },
        { status: 429, headers: { "Retry-After": String(retrySec) } }
      );
    }
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
