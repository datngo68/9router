import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings, upsertGoogleCustomer } from "@/lib/localDb";
import { setCustomerSessionCookie } from "@/lib/auth/customerSession";
import { sendWelcomeEmail } from "@/lib/notify/email";

export const dynamic = "force-dynamic";

function publicBaseUrl(request, settings) {
  if (settings.storeUrl) return String(settings.storeUrl).replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host && !host.startsWith("0.0.0.0")) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

function publicUrl(path, request, settings) {
  return new URL(path, publicBaseUrl(request, settings));
}

function callbackUrl(request, settings) {
  if (settings.customerGoogleRedirectUri) return settings.customerGoogleRedirectUri;
  return publicUrl("/api/account/google/callback", request, settings).toString();
}

async function exchangeCode({ code, request, settings }) {
  const body = new URLSearchParams({
    code,
    client_id: settings.customerGoogleClientId,
    client_secret: settings.customerGoogleClientSecret,
    redirect_uri: callbackUrl(request, settings),
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!res.ok) throw new Error("Google token exchange failed");
  return res.json();
}

async function fetchProfile(accessToken) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Google profile fetch failed");
  return res.json();
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("customer_google_oauth_state")?.value;
  const next = cookieStore.get("customer_google_oauth_next")?.value || "/store/account";
  const settings = await getSettings();
  const fail = publicUrl(`/store/login?error=${encodeURIComponent("Google login failed")}`, request, settings);

  if (!code || !state || !expectedState || state !== expectedState) return NextResponse.redirect(fail);

  try {
    if (!settings.customerGoogleOAuthEnabled || !settings.customerGoogleClientId || !settings.customerGoogleClientSecret) {
      return NextResponse.redirect(fail);
    }
    const token = await exchangeCode({ code, request, settings });
    const profile = await fetchProfile(token.access_token);
    if (!profile?.email || !profile?.sub) return NextResponse.redirect(fail);
    const { customer, created } = await upsertGoogleCustomer({ email: profile.email, googleSub: profile.sub, displayName: profile.name });
    if (created) await sendWelcomeEmail({ email: customer.email, displayName: customer.displayName });
    const res = customer.totpEnabled
      ? NextResponse.redirect(publicUrl(`/store/login?error=${encodeURIComponent("Tài khoản này đã bật 2FA. Vui lòng đăng nhập bằng email và mã 2FA.")}`, request, settings))
      : NextResponse.redirect(publicUrl(next, request, settings));
    res.cookies.delete("customer_google_oauth_state");
    res.cookies.delete("customer_google_oauth_next");
    if (customer.totpEnabled) return res;
    await setCustomerSessionCookie(res.cookies, request, customer.id);
    return res;
  } catch {
    return NextResponse.redirect(fail);
  }
}
