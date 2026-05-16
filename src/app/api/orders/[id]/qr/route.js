import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getOrderById, getPricingPlanById, getApiKeyById, getSettings } from "@/lib/localDb";
import { buildVietQrUrl, VN_BANKS } from "@/lib/payments/vietqr";

export const dynamic = "force-dynamic";

// GET /api/orders/[id]/qr — return VietQR image URL + bank info for the
// pending order. Customer-only (must own the order).
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
  const bank = VN_BANKS.find((b) => b.code === settings.bankCode || b.bin === settings.bankCode);
  const url = buildVietQrUrl({
    bank: settings.bankCode,
    accountNo: settings.bankAccountNo,
    accountName: settings.bankAccountName,
    amount: order.priceVnd,
    addInfo: order.id,
  });
  return NextResponse.json({
    url,
    bankCode: settings.bankCode,
    bankName: bank?.name,
    accountNo: settings.bankAccountNo,
    accountName: settings.bankAccountName,
    amount: order.priceVnd,
    addInfo: order.id,
  });
}
