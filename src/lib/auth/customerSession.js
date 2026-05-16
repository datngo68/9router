// Customer session glue: read session token from cookie, verify against DB,
// return the customer record. Separate from admin's `auth_token` so a stolen
// admin cookie cannot be reused as customer and vice versa.

import { cookies } from "next/headers";
import {
  findCustomerSessionByToken,
  createCustomerSession,
  revokeCustomerSession,
  revokeAllSessionsForCustomer,
  getCustomerById,
} from "@/lib/localDb";

const COOKIE_NAME = "customer_session";

function shouldUseSecure(request) {
  if (process.env.AUTH_COOKIE_SECURE === "true") return true;
  const fwd = request?.headers?.get?.("x-forwarded-proto");
  return fwd === "https";
}

export async function setCustomerSessionCookie(cookieStore, request, customerId) {
  const ipAddress = request?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim()
    || request?.headers?.get?.("x-real-ip")
    || null;
  const userAgent = request?.headers?.get?.("user-agent") || null;
  const { token, expiresAt } = await createCustomerSession({ customerId, ipAddress, userAgent });
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecure(request),
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearCustomerSessionCookie(cookieStore) {
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    const session = await findCustomerSessionByToken(token);
    if (session) await revokeCustomerSession(session.id);
  }
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Retrieve the current customer from the request's cookie. Returns null when
 * no valid session exists.
 */
export async function getCurrentCustomer(request) {
  let token;
  if (request) {
    // App router request — cookies are on the request headers.
    const cookieHeader = request.headers.get("cookie") || "";
    const m = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
    token = m ? decodeURIComponent(m[1]) : null;
  } else {
    const store = await cookies();
    token = store.get(COOKIE_NAME)?.value;
  }
  if (!token) return null;
  const session = await findCustomerSessionByToken(token);
  if (!session) return null;
  const customer = await getCustomerById(session.customerId);
  if (!customer) return null;
  return { customer, sessionId: session.id };
}

export async function revokeAllCustomerSessions(customerId) {
  await revokeAllSessionsForCustomer(customerId);
}

export { COOKIE_NAME as CUSTOMER_SESSION_COOKIE };
