import { NextResponse } from "next/server";
import {
  getOrderById,
  cancelOrder,
  markOrderRefunded,
  confirmOrderAtomic,
  getCustomerById,
  getPricingPlanById,
} from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { sendKeyDeliveredEmail } from "@/lib/notify/email";
import { notifyCustomerKeyDelivered, notifyAdminOrderConfirmed, resolvePublicUrl } from "@/lib/notify/telegram";
import { getClientIp } from "@/lib/auth/loginThrottle";
import { cancelApibankOrder, getApibankOrder } from "@/lib/payments/apibank";
import { requireRole } from "@/lib/auth/rbac";
import { apiError } from "@/shared/utils/apiError";
import { parseJsonBody, AdminOrderPatchSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

// GET /api/admin/orders/[id]
export async function GET(request, { params }) {
  const auth = await requireRole(request, "operator");
  if (auth.response) return auth.response;
  const { id } = await params;
  const order = await getOrderById(id);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [plan, customer] = await Promise.all([
    getPricingPlanById(order.planId),
    getCustomerById(order.customerId),
  ]);
  return NextResponse.json({ order, plan, customer });
}

// PATCH /api/admin/orders/[id] — admin actions
//   body: { action: "confirm" | "cancel" | "refund" | "apibank-reconcile", paymentRef?, notes? }
export async function PATCH(request, { params }) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, AdminOrderPatchSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.value;
  const action = body.action;
  const auth = await requireRole(request, "admin", {
    action: `order.${action}`,
    targetType: "order",
    targetId: id,
  });
  if (auth.response) return auth.response;
  const order = await getOrderById(id);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    if (action === "confirm") {
      const machineId = await getConsistentMachineId();
      const result = await confirmOrderAtomic({
        orderId: id,
        paymentRef: body.paymentRef || null,
        machineId,
        actorIp: getClientIp(request),
      });
      // Fire-and-forget post-confirm notifications. Admin sees the success
      // response immediately; customer email/telegram dispatch happens in
      // background.
      (async () => {
        try {
          const customer = await getCustomerById(result.order.customerId);
          const plan = await getPricingPlanById(result.order.planId);
          const portalUrl = await resolvePublicUrl("/store/account/keys");
          if (result.apiKey?.key) {
            await sendKeyDeliveredEmail({
              email: customer?.email,
              displayName: customer?.displayName,
              planName: plan?.name || "Plan",
              key: result.apiKey.key,
              keyDisplay: result.apiKey.keyDisplay,
              portalUrl,
            });
            await notifyCustomerKeyDelivered({ customer, planName: plan?.name || "Plan", key: result.apiKey.key, keyDisplay: result.apiKey.keyDisplay, portalUrl });
          }
          await notifyAdminOrderConfirmed({ order: result.order, customer, planName: plan?.name });
        } catch (e) { console.log("[admin/orders] notify failed:", e.message); }
      })();
      return NextResponse.json(result);
    }
    if (action === "cancel") {
      const updated = await cancelOrder(id);
      // Best-effort: also cancel the parallel APIBank order so the bank
      // matcher stops watching for tx with this code. Failure here doesn't
      // affect 9router state.
      if (order.apibankOrderId) {
        cancelApibankOrder(order.apibankOrderId)
          .catch((e) => console.log(`[admin/orders] APIBank cancel failed for ${order.id}:`, e.message));
      }
      return NextResponse.json({ order: updated });
    }
    if (action === "apibank-reconcile") {
      // Manual reconciliation: fetch the APIBank order and, if it is paid,
      // confirm this 9router order locally. Lets admin recover stuck orders
      // when a webhook delivery silently failed (signature mismatch, version
      // skew, dedupe race, etc.) — bypasses webhook event dedup intentionally.
      if (!order.apibankOrderId) {
        return NextResponse.json({ error: "Đơn này không liên kết với APIBank" }, { status: 400 });
      }
      const ab = await getApibankOrder(order.apibankOrderId).catch((e) => {
        throw new Error(`APIBank lookup failed: ${e.message}`);
      });
      if (!ab) {
        return NextResponse.json({ error: "Không tìm thấy đơn ở APIBank" }, { status: 404 });
      }
      if (ab.status !== "paid") {
        return NextResponse.json({ ok: false, apibankStatus: ab.status, message: `Đơn ở APIBank đang ${ab.status}, chưa thanh toán` });
      }
      if (order.status === "delivered") {
        return NextResponse.json({ ok: true, alreadyDelivered: true, order });
      }
      if (order.status !== "pending") {
        return NextResponse.json({ error: `Không thể confirm đơn ở status ${order.status}` }, { status: 400 });
      }
      const machineId = await getConsistentMachineId();
      const paymentRef = ab.paid_tx_id || ab.id || null;
      const result = await confirmOrderAtomic({
        orderId: id,
        paymentRef,
        machineId,
        actorIp: getClientIp(request),
      });
      // Same fire-and-forget noti chain as the confirm action.
      (async () => {
        try {
          const customer = await getCustomerById(result.order.customerId);
          const plan = await getPricingPlanById(result.order.planId);
          const portalUrl = await resolvePublicUrl("/store/account/keys");
          if (result.apiKey?.key) {
            await sendKeyDeliveredEmail({
              email: customer?.email,
              displayName: customer?.displayName,
              planName: plan?.name || "Plan",
              key: result.apiKey.key,
              keyDisplay: result.apiKey.keyDisplay,
              portalUrl,
            });
            await notifyCustomerKeyDelivered({ customer, planName: plan?.name || "Plan", key: result.apiKey.key, keyDisplay: result.apiKey.keyDisplay, portalUrl });
          }
          await notifyAdminOrderConfirmed({ order: result.order, customer, planName: plan?.name });
        } catch (e) { console.log("[admin/orders] reconcile notify failed:", e.message); }
      })();
      return NextResponse.json({ ok: true, ...result, apibankStatus: ab.status });
    }
    if (action === "refund") {
      const updated = await markOrderRefunded(id, { notes: body?.notes });
      return NextResponse.json({ order: updated });
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return apiError(e, "Action failed", 400, "admin/orders");
  }
}
