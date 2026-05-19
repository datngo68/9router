import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { logAdminAction } from "@/lib/db/repos/adminAuditRepo";
import { getClientIp } from "@/lib/auth/loginThrottle";

/**
 * Return the dashboard JWT payload for the current request, or null.
 * Supports both Request (route handlers) and headers-only callers.
 */
export async function getDashboardSession(request) {
  let token;
  try {
    if (request?.cookies?.get) {
      token = request.cookies.get("auth_token")?.value;
    }
  } catch {}
  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get("auth_token")?.value;
    } catch {}
  }
  if (!token) return null;
  return await getDashboardAuthSession(token);
}

/**
 * Wrap a route handler so it only runs for callers whose dashboard JWT carries
 * the required role. Returns either the handler's response or 401/403.
 *
 * Usage:
 *   export const POST = withRole("admin", async (request, ctx) => { ... });
 *
 * Roles supported today: "admin", "operator". Defaults to "admin" if absent.
 */
export function withRole(role, handler) {
  return async function rbacWrapper(request, ctx) {
    const session = await getDashboardSession(request);
    if (!session?.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sessionRole = String(session.role || "admin");
    if (!hasRole(sessionRole, role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(request, ctx, session);
  };
}

/**
 * Plain helper for handlers that prefer manual control flow.
 * Returns { session } on success or { response } pre-built on failure.
 *
 * Pass `audit: { action, targetType?, targetId? }` to record the call into
 * adminAuditLog. The wrapper logs on entry (so failed mutations are still
 * traceable). Audit logging is best-effort and never blocks the request.
 */
export async function requireRole(request, role, audit = null) {
  const session = await getDashboardSession(request);
  if (!session?.authenticated) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const sessionRole = String(session.role || "admin");
  if (!hasRole(sessionRole, role)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (audit && audit.action) {
    try {
      logAdminAction({
        actorRole: sessionRole,
        action: audit.action,
        targetType: audit.targetType || null,
        targetId: audit.targetId || null,
        ip: safeClientIp(request),
        userAgent: request?.headers?.get?.("user-agent") || null,
        meta: audit.meta || null,
      });
    } catch {}
  }
  return { session };
}

function safeClientIp(request) {
  try { return getClientIp(request); } catch { return null; }
}

// Role hierarchy: admin > operator. Caller asks for the minimum role required.
const ROLE_RANK = { admin: 100, operator: 50 };

export function hasRole(actual, required) {
  return (ROLE_RANK[actual] ?? 0) >= (ROLE_RANK[required] ?? 0);
}
