// Dispatcher used by both the immediate-send API route and the scheduler tick.
//
// Resolves a recipient spec to a concrete customer list, creates the in-app
// rows, and fires email/telegram fan-out. All external delivery is best-effort
// fire-and-forget — failures are logged but do not abort.

import { getCustomers, getCustomerById, getApiKeysByCustomer } from "@/lib/localDb";
import { createNotification } from "@/lib/db/repos/notificationsRepo";
import { sendCustomNotificationEmail } from "@/lib/notify/email";
import { notifyCustomerCustom } from "@/lib/notify/telegram";

export const VALID_TYPES = new Set(["info", "success", "warning", "alert"]);
export const VALID_CHANNELS = new Set(["inapp", "email", "telegram"]);

/**
 * Resolve a target spec into the actual list of customers it covers.
 *
 * Spec shapes:
 *   { target: "all" }
 *   { target: "customers", ids: [<customerId>, ...] }
 *   { target: "filter", planIds?: string[], hasTelegram?: bool,
 *                       hasVerifiedEmail?: bool, q?: string }
 */
export async function resolveRecipients(spec = {}) {
  const target = spec?.target || "all";
  if (target === "customers") {
    const ids = Array.isArray(spec?.ids) ? spec.ids.map(String).filter(Boolean) : [];
    if (ids.length === 0) return [];
    const out = [];
    for (const id of ids) {
      const c = await getCustomerById(id);
      if (c) out.push(c);
    }
    return out;
  }

  // For "all" and "filter" we start from the full set and filter down. The
  // customer table is small enough (admin-side, not request-path).
  let customers = await getCustomers();

  if (target === "filter") {
    const q = String(spec?.q || "").trim().toLowerCase();
    if (q) {
      customers = customers.filter((c) => `${c.email || ""} ${c.displayName || ""} ${c.phone || ""}`.toLowerCase().includes(q));
    }
    if (spec?.hasTelegram === true) {
      customers = customers.filter((c) => !!c.telegramChatId);
    }
    if (spec?.hasVerifiedEmail === true) {
      customers = customers.filter((c) => !!c.emailVerified);
    }
    const planIds = Array.isArray(spec?.planIds) ? spec.planIds.filter(Boolean) : [];
    if (planIds.length > 0) {
      const planSet = new Set(planIds);
      const filtered = [];
      for (const c of customers) {
        try {
          const keys = await getApiKeysByCustomer(c.id);
          const orderIds = new Set(keys.map((k) => k.orderId).filter(Boolean));
          if (orderIds.size === 0) continue;
          // Cheap test: any apiKey whose name encodes the plan? We instead
          // look up the customer's orders to find planId. Avoid an extra
          // import cycle by lazy-loading getOrders.
          const { getOrders } = await import("@/lib/db/repos/ordersRepo.js");
          const orders = await getOrders({ customerId: c.id, limit: 200 });
          const has = orders.some((o) => planSet.has(o.planId) && (o.status === "delivered" || o.status === "paid"));
          if (has) filtered.push(c);
        } catch {
          /* skip on error */
        }
      }
      customers = filtered;
    }
  }
  return customers;
}

/**
 * Send (or schedule) a notification.
 *
 * When `scheduleAt` is a future ISO string the call records a single
 * `status='scheduled'` row carrying the spec; the scheduler tick promotes it
 * later. Otherwise we materialize per-customer rows and fan out external
 * channels immediately.
 *
 * Returns { broadcast, scheduled, recipientCount, created }.
 */
export async function sendOrScheduleNotification({
  spec,
  title,
  body,
  type = "info",
  link = null,
  channels = ["inapp"],
  createdBy = null,
  scheduleAt = null,
}) {
  if (!title) throw new Error("title is required");
  if (!body) throw new Error("body is required");
  const validChannels = (Array.isArray(channels) ? channels : []).filter((c) => VALID_CHANNELS.has(c));
  if (validChannels.length === 0) validChannels.push("inapp");
  const safeType = VALID_TYPES.has(type) ? type : "info";

  // Schedule path: one row capturing intent, materialize at fire time.
  if (scheduleAt && new Date(scheduleAt).getTime() > Date.now() + 1000) {
    const row = await createNotification({
      customerId: null,
      title,
      body,
      type: safeType,
      link,
      channels: validChannels,
      createdBy,
      scheduledAt: new Date(scheduleAt).toISOString(),
      status: "scheduled",
      sentAt: null,
      targetSpec: spec,
    });
    return { scheduled: true, notification: row };
  }

  // Immediate path. Resolve recipients and dispatch.
  const recipients = await resolveRecipients(spec);
  const broadcast = spec?.target === "all";

  const created = [];
  if (validChannels.includes("inapp")) {
    if (broadcast) {
      const row = await createNotification({
        customerId: null,
        title,
        body,
        type: safeType,
        link,
        channels: validChannels,
        createdBy,
        status: "sent",
      });
      created.push(row);
    } else {
      for (const c of recipients) {
        const row = await createNotification({
          customerId: c.id,
          title,
          body,
          type: safeType,
          link,
          channels: validChannels,
          createdBy,
          status: "sent",
        });
        created.push(row);
      }
    }
  }

  if (validChannels.includes("email") || validChannels.includes("telegram")) {
    // Broadcast still needs per-customer fan-out for email/telegram. Use the
    // already-loaded list for non-broadcast; broadcast resolves all customers.
    const fanout = broadcast ? await getCustomers() : recipients;
    dispatchExternal({ customers: fanout, channels: validChannels, title, body, link })
      .catch((e) => console.log("[notifications/dispatch] failed:", e.message));
  }

  return {
    scheduled: false,
    broadcast,
    recipientCount: broadcast ? "all" : recipients.length,
    created,
  };
}

async function dispatchExternal({ customers, channels, title, body, link }) {
  for (const c of customers) {
    if (channels.includes("email") && c.email) {
      try {
        await sendCustomNotificationEmail({
          email: c.email,
          displayName: c.displayName,
          title,
          body,
          link,
        });
      } catch (e) {
        console.log("[notifications/dispatch] email failed:", e.message);
      }
    }
    if (channels.includes("telegram") && c.telegramChatId) {
      try {
        await notifyCustomerCustom({ customer: c, title, body, link });
      } catch (e) {
        console.log("[notifications/dispatch] telegram failed:", e.message);
      }
    }
  }
}

export { dispatchExternal };
