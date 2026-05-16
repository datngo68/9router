import { NextResponse } from "next/server";
import { setCustomerPassword } from "@/lib/localDb";
import { verifyCustomerToken } from "@/lib/auth/customerToken";
import { revokeAllCustomerSessions } from "@/lib/auth/customerSession";

export const dynamic = "force-dynamic";

// POST /api/account/reset
//   body: { token, newPassword }
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { token, newPassword } = body || {};
  if (!token || !newPassword) {
    return NextResponse.json({ error: "token and newPassword are required" }, { status: 400 });
  }
  if (String(newPassword).length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const verified = verifyCustomerToken(token, "password-reset");
  if (!verified) return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });

  await setCustomerPassword(verified.customerId, newPassword);
  await revokeAllCustomerSessions(verified.customerId);
  return NextResponse.json({ ok: true });
}
