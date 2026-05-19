// APIBank webhook receiver.
//
// Lifecycle:
//   1. APIBank polls bank → matches a tx with one of our orders by amount + code
//   2. POST /api/webhooks/apibank with `payment.succeeded` event
//   3. We verify HMAC, dedupe by evt.id, resolve to a 9router order
//   4. confirmOrderAtomic → cấp API key → fire-and-forget email/Telegram
//   5. 200 OK
//
// Security: the body is parsed AFTER signature verification using the raw
// bytes — modifying the parsed JSON would break the HMAC. We must not
// `request.json()` first.
//
// Idempotency: even though we dedupe, the inner confirmOrderAtomic is also
// idempotent — if the order is already delivered, returns the existing key.

import { NextResponse } from "next/server";
import {
  getSettings,
  findOrderByApibankRef,
  confirmOrderAtomic,
  getCustomerById,
  getPricingPlanById,
} from "@/lib/localDb";
import { claimWebhookEvent, markWebhookEventProcessed } from "@/lib/db/repos/apibankWebhookEventsRepo.js";
import { verifyWebhookSignature } from "@/lib/payments/apibank";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { sendKeyDeliveredEmail } from "@/lib/notify/email";
import { notifyCustomerKeyDelivered, notifyAdminOrderConfirmed, resolvePublicUrl } from "@/lib/notify/telegram";
import { getClientIp } from "@/lib/auth/loginThrottle";
import { apiError } from "@/shared/utils/apiError";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const settings = await getSettings();
  if (!settings?.apibankEnabled) {
    return NextResponse.json({ error: "APIBank chưa được bật" }, { status: 404 });
  }
  const secret = settings.apibankWebhookSecret;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret chưa cấu hình" }, { status: 500 });
  }

  // Read raw bytes — DO NOT call request.json(). HMAC is computed over the
  // exact bytes APIBank sent.
  const rawArrayBuffer = await request.arrayBuffer();
  const rawBody = Buffer.from(rawArrayBuffer);
  const sigHeader = request.headers.get("x-signature") || "";

  const verify = verifyWebhookSignature(rawBody, sigHeader, secret);
  if (!verify.ok) {
    console.log(`[apibank webhook] reject: ${verify.error}`);
    return NextResponse.json({ error: verify.error || "invalid signature" }, { status: 401 });
  }

  let evt;
  try {
    evt = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const evtId = evt?.id;
  const evtType = evt?.type;
  if (!evtId || !evtType) {
    return NextResponse.json({ error: "missing event id/type" }, { status: 400 });
  }

  // ── Test ping fast-path ───────────────────────────────────────────────
  if (evtType === "webhook.test") {
    return NextResponse.json({ ok: true, type: "webhook.test" });
  }

  if (evtType !== "payment.succeeded") {
    // Ack unknown types so APIBank stops retrying. We log for visibility.
    console.log(`[apibank webhook] ignoring unsupported type: ${evtType}`);
    return NextResponse.json({ ok: true, ignored: evtType });
  }

  const data = evt?.data || {};
  // APIBank payload có cả flat keys (preferred) lẫn nested order/transaction
  // (legacy alias). Đọc cả hai để robust với mọi version của APIBank.
  //   data.order_id          | data.order.id
  //   data.code              | data.order.code
  //   data.amount_vnd        | data.order.amount_vnd | data.order.amount
  //   data.customer_ref      | (router_order_id của 9router)
  //   data.metadata          | (chứa router_order_id nếu có)
  //   data.bank_ref_no       | data.transaction.bank_ref_no | data.transaction.ref
  //   data.transaction_id    | data.transaction.id
  const orderObj = data.order || {};
  const txObj = data.transaction || {};
  const apibankOrderId = data.order_id || orderObj.id || null;
  const apibankCode = data.code || orderObj.code || null;
  const amountVnd = Number(
    data.amount_vnd ?? orderObj.amount_vnd ?? orderObj.amount ?? 0,
  );
  const customerRef = data.customer_ref || null;
  const metadata = data.metadata || {};
  const routerOrderId = metadata?.router_order_id || customerRef || null;
  const paymentRef =
    data.bank_ref_no || txObj.bank_ref_no || txObj.ref || data.transaction_id || txObj.id || apibankOrderId || null;

  // Dedup: claim the event id atomically. If we lose the race (already
  // claimed), still return 200 so APIBank stops retrying.
  const claimed = await claimWebhookEvent({
    eventId: evtId,
    orderId: routerOrderId || null,
    type: evtType,
  });
  if (!claimed) {
    return NextResponse.json({ ok: true, dedup: true });
  }

  const order = await findOrderByApibankRef({
    routerOrderId,
    apibankOrderId,
    apibankCode,
  });

  if (!order) {
    console.log(`[apibank webhook] no matching order for evt ${evtId} (router=${routerOrderId} apibank=${apibankOrderId} code=${apibankCode})`);
    await markWebhookEventProcessed(evtId);
    // 200 + ignored — order may have been deleted on our side; no point
    // making APIBank retry forever.
    return NextResponse.json({ ok: true, ignored: "order not found" });
  }

  // Cross-check amount as defence-in-depth. APIBank already matched amount
  // exactly, but double-check before issuing a key.
  if (amountVnd !== Number(order.priceVnd || 0)) {
    console.log(`[apibank webhook] amount mismatch for ${order.id}: webhook=${amountVnd} order=${order.priceVnd}`);
    await markWebhookEventProcessed(evtId);
    return NextResponse.json({ error: "amount mismatch" }, { status: 409 });
  }

  // Already delivered → idempotent ack.
  if (order.status === "delivered") {
    await markWebhookEventProcessed(evtId);
    return NextResponse.json({ ok: true, alreadyDelivered: true });
  }

  if (order.status !== "pending") {
    console.log(`[apibank webhook] cannot confirm ${order.id} in status ${order.status}`);
    await markWebhookEventProcessed(evtId);
    return NextResponse.json({ error: `order in status ${order.status}` }, { status: 409 });
  }

  // ── Confirm order + provision key ─────────────────────────────────────
  let result;
  try {
    const machineId = await getConsistentMachineId();
    result = await confirmOrderAtomic({
      orderId: order.id,
      paymentRef,
      machineId,
      actorIp: getClientIp(request),
    });
  } catch (e) {
    // Don't mark processed — APIBank will retry, giving us a chance to
    // recover from transient failures (DB locked, etc.).
    return apiError(e, "confirm failed", 500, "webhooks/apibank");
  }

  await markWebhookEventProcessed(evtId);

  // Fire-and-forget post-confirm notifications (mirror admin/orders flow).
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
        await notifyCustomerKeyDelivered({
          customer,
          planName: plan?.name || "Plan",
          key: result.apiKey.key,
          keyDisplay: result.apiKey.keyDisplay,
          portalUrl,
        });
      }
      await notifyAdminOrderConfirmed({ order: result.order, customer, planName: plan?.name });
    } catch (e) {
      console.log("[apibank webhook] notify failed:", e.message);
    }
  })();

  return NextResponse.json({ ok: true, orderId: result.order.id });
}

// Lightweight health-check for ops — `curl` against the webhook URL to make
// sure routing works before wiring up APIBank.
export async function GET() {
  return NextResponse.json({ ok: true, info: "POST event payloads here. See docs/integration.md." });
}
