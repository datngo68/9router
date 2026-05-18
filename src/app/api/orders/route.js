import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { createOrder, getOrders, getPricingPlanById, getCustomerById, attachApibankOrder } from "@/lib/localDb";
import { recordFailure, checkLogin, getClientIp } from "@/lib/auth/loginThrottle";
import { notifyAdminOrderCreated } from "@/lib/notify/telegram";
import { sendOrderCreatedEmail } from "@/lib/notify/email";
import { getSettings } from "@/lib/localDb";
import { createApibankOrder } from "@/lib/payments/apibank";

export const dynamic = "force-dynamic";

// POST /api/orders — create a pending order for the logged-in customer.
//   body: { planId, paymentMethod?, notes? }
export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = getClientIp(request);
  const lock = checkLogin(`orderCreate:${ip}`);
  if (lock.locked) {
    const retrySec = Math.max(1, Math.ceil(lock.retryAfterMs / 1000));
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu, thử lại sau." },
      { status: 429, headers: { "Retry-After": String(retrySec) } }
    );
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const planId = body?.planId;
  const paymentMethod = body?.paymentMethod || "bank";
  const notes = body?.notes || null;
  const voucherCode = body?.voucherCode ? String(body.voucherCode).trim() : null;
  if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

  const plan = await getPricingPlanById(planId);
  if (!plan || !plan.isActive) {
    recordFailure(`orderCreate:${ip}`);
    return NextResponse.json({ error: "Gói không tồn tại hoặc đã ngừng bán" }, { status: 400 });
  }

  let order;
  try {
    order = await createOrder({ customerId: session.customer.id, planId, paymentMethod, notes, voucherCode });
  } catch (e) {
    recordFailure(`orderCreate:${ip}`);
    return NextResponse.json({ error: e.message || "Tạo đơn thất bại" }, { status: 400 });
  }

  // If APIBank automation is enabled, create a parallel APIBank order so the
  // QR/landing comes back tied to a real bank tx. Best-effort: failure is
  // logged but does NOT block the customer — admin can still confirm
  // manually via Telegram (existing flow).
  try {
    const settings = await getSettings();
    if (settings?.apibankEnabled && settings?.apibankBaseUrl && settings?.apibankApiKey && settings?.apibankBankAccountId) {
      const ab = await createApibankOrder({
        routerOrderId: order.id,
        amountVnd: order.priceVnd,
        description: `${plan.name} · ${order.id}`,
        ttlSeconds: 900,
      });
      if (ab?.id && ab?.code) {
        order = await attachApibankOrder(order.id, {
          apibankOrderId: ab.id,
          apibankCode: ab.code,
          apibankExpiredAt: ab.expired_at || null,
        });
      }
    }
  } catch (e) {
    console.log(`[orders] APIBank create failed for ${order.id}:`, e.message);
  }

  // Fire-and-forget notifications. Customer chỉ cần thấy order ID + chuyển
  // sang trang tracking ngay, không đợi SMTP/Telegram round-trip (có thể tốn
  // 2-5s nếu network chậm).
  (async () => {
    try {
      const settings = await getSettings();
      const paymentInfo = settings?.paymentInstructions || "";
      await sendOrderCreatedEmail({
        email: session.customer.email,
        displayName: session.customer.displayName,
        order,
        planName: plan.name,
        paymentInfo,
      });
    } catch (e) { console.log("[orders] email noti failed:", e.message); }
  })();

  notifyAdminOrderCreated({ order, customer: session.customer, planName: plan.name })
    .catch((e) => console.log("[orders] telegram noti failed:", e.message));

  return NextResponse.json({ order, plan }, { status: 201 });
}

// GET /api/orders — list orders for the logged-in customer
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orders = await getOrders({ customerId: session.customer.id });
  return NextResponse.json({ orders });
}
