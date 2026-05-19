import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getSettings } from "@/lib/localDb";
import { buildTotpUri, generateTotpSecret } from "@/lib/auth/customerTotp";
import { setPendingTotp } from "@/lib/auth/totpPending";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getCurrentCustomer();
  if (!session?.customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getSettings();
  const secret = generateTotpSecret();
  // Hold the secret in memory until verify succeeds. Avoids persisting an
  // unverified secret if the user abandons setup.
  setPendingTotp(session.customer.id, secret);
  return NextResponse.json({
    secret,
    otpauthUrl: buildTotpUri({ secret, email: session.customer.email, issuer: settings.storeName || "9Router" }),
  });
}
