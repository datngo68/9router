import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { VN_BANKS, buildVietQrUrl } from "@/lib/payments/vietqr";

export const dynamic = "force-dynamic";

// GET /api/store/payment — public payment instructions for the storefront.
// Returns the bank account info admin configured, plus the static bank list
// so the UI can render the bank logo/name.
export async function GET() {
  const settings = await getSettings();
  const bank = VN_BANKS.find((b) => b.code === settings.bankCode || b.bin === settings.bankCode) || null;
  return NextResponse.json({
    bankCode: settings.bankCode || null,
    bankName: bank?.name || null,
    bankFullName: bank?.fullName || null,
    accountNo: settings.bankAccountNo || null,
    accountName: settings.bankAccountName || null,
    paymentInstructions: settings.paymentInstructions || null,
    momoPhone: settings.momoPhone || null,
    momoName: settings.momoName || null,
    banks: VN_BANKS,
  });
}
