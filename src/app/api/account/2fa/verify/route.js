import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getCustomerById, setCustomerTotp } from "@/lib/localDb";
import { verifyTotpCode } from "@/lib/auth/customerTotp";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = await getCurrentCustomer();
  if (!session?.customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const customer = await getCustomerById(session.customer.id, { withPassword: true });
  if (!customer?.totpSecret) return NextResponse.json({ error: "2FA setup required" }, { status: 400 });
  if (!verifyTotpCode(customer.totpSecret, body?.code)) {
    return NextResponse.json({ error: "Invalid 2FA code" }, { status: 400 });
  }
  const updated = await setCustomerTotp(customer.id, { secret: customer.totpSecret, enabled: true, verifiedAt: new Date().toISOString() });
  return NextResponse.json({ customer: updated });
}
