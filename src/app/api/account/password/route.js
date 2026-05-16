import { NextResponse } from "next/server";
import { getCurrentCustomer, revokeAllCustomerSessions } from "@/lib/auth/customerSession";
import { verifyCustomerPassword, setCustomerPassword } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/account/password
//   body: { currentPassword, newPassword }
//   on success, revokes all other sessions for the customer.
export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { currentPassword, newPassword } = body || {};
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "currentPassword and newPassword are required" }, { status: 400 });
  }
  if (String(newPassword).length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const ok = await verifyCustomerPassword(session.customer.email, currentPassword);
  if (!ok) return NextResponse.json({ error: "Invalid current password" }, { status: 401 });

  await setCustomerPassword(session.customer.id, newPassword);
  await revokeAllCustomerSessions(session.customer.id);
  return NextResponse.json({ ok: true });
}
