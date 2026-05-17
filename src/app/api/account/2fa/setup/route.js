import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getSettings, setCustomerTotp } from "@/lib/localDb";
import { buildTotpUri, generateTotpSecret } from "@/lib/auth/customerTotp";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getCurrentCustomer();
  if (!session?.customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getSettings();
  const secret = generateTotpSecret();
  await setCustomerTotp(session.customer.id, { secret, enabled: false, verifiedAt: null });
  return NextResponse.json({
    secret,
    otpauthUrl: buildTotpUri({ secret, email: session.customer.email, issuer: settings.storeName || "9Router" }),
  });
}
