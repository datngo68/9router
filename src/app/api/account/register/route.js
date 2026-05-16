import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createCustomer } from "@/lib/localDb";
import { setCustomerSessionCookie } from "@/lib/auth/customerSession";
import { recordFailure, checkLogin, getClientIp } from "@/lib/auth/loginThrottle";

export const dynamic = "force-dynamic";

// POST /api/account/register
//   body: { email, password, displayName?, phone?, telegramChatId? }
//   sets customer_session cookie, returns customer (no password hash).
export async function POST(request) {
  const ip = getClientIp(request);
  const lock = checkLogin(`register:${ip}`);
  if (lock.locked) {
    const retrySec = Math.max(1, Math.ceil(lock.retryAfterMs / 1000));
    return NextResponse.json(
      { error: "Too many registration attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retrySec) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, password, displayName, phone, telegramChatId } = body || {};
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  if (String(password).length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  let customer;
  try {
    customer = await createCustomer({ email, password, displayName, phone, telegramChatId });
  } catch (e) {
    // Treat duplicate email as a generic conflict to avoid enumeration. Still
    // count it toward the throttle so a script cannot probe many emails.
    recordFailure(`register:${ip}`);
    if (String(e.message).includes("already registered")) {
      return NextResponse.json({ error: "Could not register with that email" }, { status: 409 });
    }
    return NextResponse.json({ error: e.message || "Registration failed" }, { status: 400 });
  }

  const cookieStore = await cookies();
  await setCustomerSessionCookie(cookieStore, request, customer.id);

  return NextResponse.json({ customer });
}
