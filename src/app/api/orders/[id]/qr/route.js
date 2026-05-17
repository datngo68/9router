import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getOrderById, getSettings } from "@/lib/localDb";
import { buildVietQrUrl, VN_BANKS } from "@/lib/payments/vietqr";
import { buildPayLandingUrl, buildPayQrUrl } from "@/lib/payments/apibank";

export const dynamic = "force-dynamic";

// GET /api/orders/[id]/qr — return the right QR + bank info for a pending
// order. Customer-only (must own the order).
//
// Two providers:
//   - APIBank automated:  if order has apibankCode, return APIBank-hosted QR
//                         (so the displayed QR points to the bank tx APIBank
//                         is watching for, with amount + memo baked in).
//   - VietQR fallback:    legacy manual flow — admin's saved bank account
//                         + addInfo = order.id.
export async function GET(request, { params }) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const order = await getOrderById(id);
  if (!order || order.customerId !== session.customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (order.status !== "pending") {
    return NextResponse.json({ error: "Order is not pending" }, { status: 400 });
  }

  const settings = await getSettings();

  // ── APIBank-managed QR ──────────────────────────────────────────────────
  if (order.apibankCode && settings?.apibankBaseUrl) {
    const bank = VN_BANKS.find((b) => b.code === settings.bankCode || b.bin === settings.bankCode);
    return NextResponse.json({
      provider: "apibank",
      url: buildPayQrUrl(settings.apibankBaseUrl, order.apibankCode),
      landingUrl: buildPayLandingUrl(settings.apibankBaseUrl, order.apibankCode),
      bankCode: settings.bankCode,
      bankName: bank?.name,
      accountNo: settings.bankAccountNo,
      accountName: settings.bankAccountName,
      amount: order.priceVnd,
      addInfo: order.apibankCode,
      apibankCode: order.apibankCode,
      apibankExpiredAt: order.apibankExpiredAt,
    });
  }

  // ── VietQR fallback ─────────────────────────────────────────────────────
  const bank = VN_BANKS.find((b) => b.code === settings.bankCode || b.bin === settings.bankCode);
  const url = buildVietQrUrl({
    bank: settings.bankCode,
    accountNo: settings.bankAccountNo,
    accountName: settings.bankAccountName,
    amount: order.priceVnd,
    addInfo: order.id,
  });
  return NextResponse.json({
    provider: "vietqr",
    url,
    bankCode: settings.bankCode,
    bankName: bank?.name,
    accountNo: settings.bankAccountNo,
    accountName: settings.bankAccountName,
    amount: order.priceVnd,
    addInfo: order.id,
  });
}
