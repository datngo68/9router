import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCustomerById, verifyCustomerPassword } from "@/lib/localDb";
import { verifyTotpCode } from "@/lib/auth/customerTotp";
import { setCustomerSessionCookie } from "@/lib/auth/customerSession";
import { recordFailure, clearFailures, checkLogin, getClientIp } from "@/lib/auth/loginThrottle";
import { parseJsonBody, CustomerLoginSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

// POST /api/account/login
//   body: { email, password, totpCode? }
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

  const parsed = await parseJsonBody(request, CustomerLoginSchema);
  if (parsed.response) return parsed.response;
  const { email, password, totpCode } = parsed.value;

  const customer = await verifyCustomerPassword(email, password);
  if (!customer) {
    recordFailure(`customerLogin:${ip}`);
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const fullCustomer = await getCustomerById(customer.id, { withPassword: true });
  if (fullCustomer?.totpEnabled) {
    if (!totpCode) return NextResponse.json({ error: "2FA code required", requires2fa: true }, { status: 401 });
    if (!verifyTotpCode(fullCustomer.totpSecret, totpCode)) {
      recordFailure(`customerLogin:${ip}`);
      return NextResponse.json({ error: "Invalid 2FA code", requires2fa: true }, { status: 401 });
    }
  }

  const cookieStore = await cookies();
  await setCustomerSessionCookie(cookieStore, request, customer.id);
  clearFailures(`customerLogin:${ip}`);

  return NextResponse.json({ customer });
}
