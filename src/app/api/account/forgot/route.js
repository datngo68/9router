import { NextResponse } from "next/server";
import { findCustomerByEmail } from "@/lib/localDb";
import { createCustomerToken } from "@/lib/auth/customerToken";
import { sendPasswordResetEmail } from "@/lib/notify/email";
import { recordFailure, checkLogin, getClientIp } from "@/lib/auth/loginThrottle";

export const dynamic = "force-dynamic";

// POST /api/account/forgot
//   body: { email }
//   ALWAYS returns 200 to avoid email enumeration. Sends reset email only if
//   the email actually exists.
export async function POST(request) {
  const ip = getClientIp(request);
  const lock = checkLogin(`forgot:${ip}`);
  if (lock.locked) {
    return NextResponse.json({ ok: true }); // silent throttle
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const email = body?.email;
  if (!email) return NextResponse.json({ ok: true });

  // Hit the limiter regardless to make brute discovery costly.
  recordFailure(`forgot:${ip}`);

  const customer = await findCustomerByEmail(email);
  if (customer) {
    const token = createCustomerToken(customer.id, "password-reset", 3600 * 1000);
    try {
      await sendPasswordResetEmail({ email: customer.email, displayName: customer.displayName, token });
    } catch (e) {
      console.log("[forgot] sendPasswordResetEmail failed:", e.message);
    }
  }
  return NextResponse.json({ ok: true });
}
