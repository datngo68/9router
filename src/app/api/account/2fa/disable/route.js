import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getCustomerById, setCustomerTotp } from "@/lib/localDb";
import { verifyTotpCode } from "@/lib/auth/customerTotp";
import { parseJsonBody, TotpDisableSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = await getCurrentCustomer();
  if (!session?.customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const customer = await getCustomerById(session.customer.id, { withPassword: true });
  if (customer?.totpEnabled) {
    const parsed = await parseJsonBody(request, TotpDisableSchema);
    if (parsed.response) return parsed.response;
    if (!verifyTotpCode(customer.totpSecret, parsed.value.code)) {
      return NextResponse.json({ error: "Invalid 2FA code" }, { status: 400 });
    }
  }
  const updated = await setCustomerTotp(customer.id, { secret: null, enabled: false, verifiedAt: null });
  return NextResponse.json({ customer: updated });
}
