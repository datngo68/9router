import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getOrderById, getSettings, attachApibankOrder, getPricingPlanById } from "@/lib/localDb";
import { buildVietQrUrl, VN_BANKS } from "@/lib/payments/vietqr";
import { buildPayLandingUrl, createApibankOrder } from "@/lib/payments/apibank";

export const dynamic = "force-dynamic";

// GET /api/orders/[id]/qr — return QR + bank info for a pending order.
// Customer-only (must own the order).
//
// Luôn dùng VietQR để render QR (tự chủ, không phụ thuộc APIBank phải host
// ảnh QR). Khi APIBank được bật, ta vẫn tạo APIBank order (để webhook tự
// match khi tiền vào) nhưng QR hiển thị là VietQR với `addInfo = apibankCode`
// — chính là mã APIBank đang theo dõi.
export async function GET(request, { params }) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let order = await getOrderById(id);
  if (!order || order.customerId !== session.customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (order.status !== "pending") {
    return NextResponse.json({ error: "Order is not pending" }, { status: 400 });
  }

  const settings = await getSettings();

  // Lazy-attach APIBank: nếu admin đã bật APIBank sau khi order được tạo
  // (hoặc create-time gọi APIBank fail), tạo APIBank order ngay bây giờ để
  // đơn pending được hệ thống tự động match.
  if (
    !order.apibankCode &&
    settings?.apibankEnabled &&
    settings?.apibankBaseUrl &&
    settings?.apibankApiKey &&
    settings?.apibankBankAccountId
  ) {
    try {
      const plan = order.kind === "walletTopup" ? null : await getPricingPlanById(order.planId);
      const description = order.kind === "walletTopup"
        ? `Wallet topup · ${order.id}`
        : `${plan?.name || "Order"} · ${order.id}`;
      const ab = await createApibankOrder({
        routerOrderId: order.id,
        amountVnd: order.priceVnd,
        description,
        ttlSeconds: 900,
      });
      if (ab?.id && ab?.code) {
        order = await attachApibankOrder(order.id, {
          apibankOrderId: ab.id,
          apibankCode: ab.code,
          apibankExpiredAt: ab.expired_at || null,
        });
      }
    } catch (e) {
      console.log(`[qr] APIBank lazy-attach failed for ${order.id}:`, e.message);
    }
  }

  // Nội dung CK: nếu có apibankCode, dùng nó (APIBank đang theo dõi để match
  // tự động). Không có → fallback `order.id` cho luồng VietQR thủ công.
  const addInfo = order.apibankCode || order.id;

  const bank = VN_BANKS.find((b) => b.code === settings.bankCode || b.bin === settings.bankCode);
  const url = buildVietQrUrl({
    bank: settings.bankCode,
    accountNo: settings.bankAccountNo,
    accountName: settings.bankAccountName,
    amount: order.priceVnd,
    addInfo,
  });

  return NextResponse.json({
    provider: order.apibankCode ? "apibank-vietqr" : "vietqr",
    url,
    landingUrl: order.apibankCode && settings?.apibankBaseUrl
      ? buildPayLandingUrl(settings.apibankBaseUrl, order.apibankCode)
      : null,
    bankCode: settings.bankCode,
    bankName: bank?.name,
    accountNo: settings.bankAccountNo,
    accountName: settings.bankAccountName,
    amount: order.priceVnd,
    addInfo,
    apibankCode: order.apibankCode || null,
    apibankExpiredAt: order.apibankExpiredAt || null,
  });
}
