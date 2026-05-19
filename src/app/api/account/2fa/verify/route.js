import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getCustomerById, setCustomerTotp } from "@/lib/localDb";
import { verifyTotpCode } from "@/lib/auth/customerTotp";
import { getPendingTotp, clearPendingTotp } from "@/lib/auth/totpPending";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = await getCurrentCustomer();
  if (!session?.customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const customer = await getCustomerById(session.customer.id, { withPassword: true });

  // Prefer the pending secret from setup; fall back to the persisted one for
  // already-enrolled users re-confirming after disable/re-enable.
  const pending = getPendingTotp(customer.id);
  const secret = pending || customer?.totpSecret;
  if (!secret) return NextResponse.json({ error: "2FA setup required" }, { status: 400 });
  if (!verifyTotpCode(secret, body?.code)) {
    return NextResponse.json({ error: "Invalid 2FA code" }, { status: 400 });
  }
  const updated = await setCustomerTotp(customer.id, { secret, enabled: true, verifiedAt: new Date().toISOString() });
  clearPendingTotp(customer.id);
  return NextResponse.json({ customer: updated });
}
