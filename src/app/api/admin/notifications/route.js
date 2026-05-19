import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireRole } from "@/lib/auth/rbac";
import { apiError } from "@/shared/utils/apiError";
import {
  createNotification,
  listAllNotifications,
} from "@/lib/db/repos/notificationsRepo";
import { getCustomers, getCustomerById } from "@/lib/localDb";
import { sendCustomNotificationEmail } from "@/lib/notify/email";
import { notifyCustomerCustom } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(["info", "success", "warning", "alert"]);
const VALID_CHANNELS = new Set(["inapp", "email", "telegram"]);

// GET /api/admin/notifications?q=&type=&scope=
export async function GET(request) {
  const auth = await requireRole(request, "operator");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const type = url.searchParams.get("type") || "";
  const scope = url.searchParams.get("scope") || "";
  const items = await listAllNotifications({ q, type, scope });
  return NextResponse.json({ items });
}

// POST /api/admin/notifications
//   body: {
//     target: "all" | "customer",
//     customerId?, customerIds?,  (customerIds when target=customer + nhiều)
//     title, body, type?, link?,
//     channels: ["inapp","email","telegram"]
//   }
export async function POST(request) {
  const auth = await requireRole(request, "admin", { action: "notification.create" });
  if (auth.response) return auth.response;

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const title = String(body?.title || "").trim();
  const text = String(body?.body || "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "body is required" }, { status: 400 });

  const type = VALID_TYPES.has(body?.type) ? body.type : "info";
  const link = body?.link ? String(body.link).trim() : null;
  const target = body?.target === "customer" ? "customer" : "all";

  const channels = Array.isArray(body?.channels)
    ? body.channels.filter((c) => VALID_CHANNELS.has(c))
    : ["inapp"];
  if (channels.length === 0) channels.push("inapp");

  const sessionRole = auth.session?.role || "admin";

  try {
    if (target === "all") {
      // Broadcast: 1 row with customerId=NULL (inapp). For email/telegram we
      // still iterate over all customers to dispatch per-channel.
      const created = channels.includes("inapp")
        ? await createNotification({ customerId: null, title, body: text, type, link, channels, createdBy: sessionRole })
        : { id: uuidv4(), broadcast: true };

      // Fire-and-forget email + telegram dispatch.
      if (channels.includes("email") || channels.includes("telegram")) {
        const customers = await getCustomers();
        dispatchExternal({ customers, channels, title, body: text, link }).catch((e) =>
          console.log("[admin/notifications] dispatch failed:", e.message)
        );
      }
      return NextResponse.json({ ok: true, notification: created, recipientCount: "all" });
    }

    // target === "customer": single or array of ids
    const ids = Array.isArray(body?.customerIds) && body.customerIds.length > 0
      ? body.customerIds.map(String)
      : (body?.customerId ? [String(body.customerId)] : []);
    if (ids.length === 0) {
      return NextResponse.json({ error: "customerId or customerIds required" }, { status: 400 });
    }

    const customers = [];
    for (const id of ids) {
      const c = await getCustomerById(id);
      if (c) customers.push(c);
    }
    if (customers.length === 0) {
      return NextResponse.json({ error: "No matching customer" }, { status: 404 });
    }

    const created = [];
    if (channels.includes("inapp")) {
      for (const c of customers) {
        const n = await createNotification({
          customerId: c.id, title, body: text, type, link, channels, createdBy: sessionRole,
        });
        created.push(n);
      }
    }

    if (channels.includes("email") || channels.includes("telegram")) {
      dispatchExternal({ customers, channels, title, body: text, link }).catch((e) =>
        console.log("[admin/notifications] dispatch failed:", e.message)
      );
    }

    return NextResponse.json({ ok: true, recipientCount: customers.length, created });
  } catch (e) {
    return apiError(e, "Failed to create notification", 500, "admin/notifications");
  }
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
        console.log("[admin/notifications] email failed:", e.message);
      }
    }
    if (channels.includes("telegram") && c.telegramChatId) {
      try {
        await notifyCustomerCustom({ customer: c, title, body, link });
      } catch (e) {
        console.log("[admin/notifications] telegram failed:", e.message);
      }
    }
  }
}
