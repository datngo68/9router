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
  if (customer?.totpEnabled && !verifyTotpCode(customer.totpSecret, body?.code)) {
    return NextResponse.json({ error: "Invalid 2FA code" }, { status: 400 });
  }
  const updated = await setCustomerTotp(customer.id, { secret: null, enabled: false, verifiedAt: null });
  return NextResponse.json({ customer: updated });
}
