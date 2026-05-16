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

export const dynamic = "force-dynamic";

// GET /api/admin/orders/[id]
export async function GET(_request, { params }) {
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
//   body: { action: "confirm" | "cancel" | "refund", paymentRef?, notes? }
export async function PATCH(request, { params }) {
  const { id } = await params;
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const action = body?.action;
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
      return NextResponse.json({ order: updated });
    }
    if (action === "refund") {
      const updated = await markOrderRefunded(id, { notes: body?.notes });
      return NextResponse.json({ order: updated });
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Action failed" }, { status: 400 });
  }
}
