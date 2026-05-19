// CSRF helpers — double-submit cookie pattern.
//
// Pairs a non-httpOnly `csrf_token` cookie with an `X-CSRF-Token` request
// header. The cookie is readable from JS so dashboard/account clients can
// echo its value into the header. The proxy already enforces an Origin/Referer
// check for mutating routes, so this helper layers on top for sensitive
// endpoints where you want belt-and-suspenders defense.

import { cookies } from "next/headers";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { safeEqual } from "@/shared/utils/safeCompare";

export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

function shouldUseSecure(request) {
  const forced = process.env.AUTH_COOKIE_SECURE === "true";
  const proto = request?.headers?.get?.("x-forwarded-proto");
  return forced || proto === "https";
}

/**
 * Issue (or refresh) the CSRF cookie. Call from any successful auth handler
 * (admin login, customer login/register, OAuth callback, etc.).
 */
export async function setCsrfCookie(cookieStore, request) {
  const token = crypto.randomBytes(32).toString("hex");
  cookieStore.set(CSRF_COOKIE, token, {
    httpOnly: false, // intentional: client JS reads + echoes into header
    secure: shouldUseSecure(request),
    sameSite: "lax",
    path: "/",
  });
  return token;
}

export async function clearCsrfCookie(cookieStore) {
  try { cookieStore.delete(CSRF_COOKIE); } catch {}
}

/**
 * Verify an incoming request carries a matching CSRF token.
 * Returns { ok: true } on success or { response } pre-built on failure.
 *
 * Skips verification for safe HTTP methods (GET/HEAD/OPTIONS).
 */
export async function requireCsrf(request) {
  const method = String(request.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { ok: true };
  }
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE)?.value || "";
  const headerToken = request.headers.get?.(CSRF_HEADER) || "";
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return {
      response: NextResponse.json({ error: "CSRF token missing or invalid" }, { status: 403 }),
    };
  }
  return { ok: true };
}
