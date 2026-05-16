import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyCustomerPassword } from "@/lib/localDb";
import { setCustomerSessionCookie } from "@/lib/auth/customerSession";
import { recordFailure, clearFailures, checkLogin, getClientIp } from "@/lib/auth/loginThrottle";

export const dynamic = "force-dynamic";

// POST /api/account/login
//   body: { email, password }
export async function POST(request) {
  const ip = getClientIp(request);
  const lock = checkLogin(`customerLogin:${ip}`);
  if (lock.locked) {
    const retrySec = Math.max(1, Math.ceil(lock.retryAfterMs / 1000));
    return NextResponse.json(
      { error: "Too many failed login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retrySec) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    recordFailure(`customerLogin:${ip}`);
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const customer = await verifyCustomerPassword(email, password);
  if (!customer) {
    recordFailure(`customerLogin:${ip}`);
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const cookieStore = await cookies();
  await setCustomerSessionCookie(cookieStore, request, customer.id);
  clearFailures(`customerLogin:${ip}`);

  return NextResponse.json({ customer });
}
