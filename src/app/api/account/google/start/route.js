import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { sanitizeNextPath } from "@/shared/utils/safeNext";

export const dynamic = "force-dynamic";

function publicBaseUrl(request, settings) {
  if (settings.storeUrl) return String(settings.storeUrl).replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host && !host.startsWith("0.0.0.0")) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

function callbackUrl(request, settings) {
  if (settings.customerGoogleRedirectUri) return settings.customerGoogleRedirectUri;
  return new URL("/api/account/google/callback", publicBaseUrl(request, settings)).toString();
}

export async function GET(request) {
  const settings = await getSettings();
  if (!settings.customerGoogleOAuthEnabled || !settings.customerGoogleClientId || !settings.customerGoogleClientSecret) {
    return NextResponse.json({ error: "Google login is not configured" }, { status: 400 });
  }

  const url = new URL(request.url);
  const next = sanitizeNextPath(url.searchParams.get("next"));
  const state = crypto.randomBytes(24).toString("hex");
  const nonce = crypto.randomBytes(32).toString("hex");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", settings.customerGoogleClientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl(request, settings));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(authUrl);
  const secure = request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
  const cookieOpts = { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 600 };
  res.cookies.set("customer_google_oauth_state", state, cookieOpts);
  res.cookies.set("customer_google_oauth_nonce", nonce, cookieOpts);
  res.cookies.set("customer_google_oauth_next", next, cookieOpts);
  return res;
}
