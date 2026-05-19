import { NextResponse } from "next/server";
import { getCurrentCustomer, revokeAllCustomerSessions } from "@/lib/auth/customerSession";
import { verifyCustomerPassword, setCustomerPassword } from "@/lib/localDb";
import { parseJsonBody, CustomerPasswordChangeSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

// POST /api/account/password
//   body: { currentPassword, newPassword }
//   on success, revokes all other sessions for the customer.
export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseJsonBody(request, CustomerPasswordChangeSchema);
  if (parsed.response) return parsed.response;
  const { currentPassword, newPassword } = parsed.value;

  const ok = await verifyCustomerPassword(session.customer.email, currentPassword);
  if (!ok) return NextResponse.json({ error: "Invalid current password" }, { status: 401 });

  await setCustomerPassword(session.customer.id, newPassword);
  await revokeAllCustomerSessions(session.customer.id);
  return NextResponse.json({ ok: true });
}
