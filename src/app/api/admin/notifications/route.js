import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { apiError } from "@/shared/utils/apiError";
import { listAllNotifications } from "@/lib/db/repos/notificationsRepo";
import {
  sendOrScheduleNotification,
  VALID_TYPES,
  VALID_CHANNELS,
} from "@/lib/notifications/dispatch";

export const dynamic = "force-dynamic";

// GET /api/admin/notifications?q=&type=&scope=&status=
//   status: 'sent' (default), 'scheduled', 'cancelled', 'failed', 'all'
export async function GET(request) {
  const auth = await requireRole(request, "operator");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const type = url.searchParams.get("type") || "";
  const scope = url.searchParams.get("scope") || "";
  const status = url.searchParams.get("status") || "";
  const items = await listAllNotifications({ q, type, scope, status });
  return NextResponse.json({ items });
}

// POST /api/admin/notifications
//   body: {
//     target: "all" | "customers" | "filter",
//     // target=customers
//     customerIds?: string[],
//     customerId?:  string,            // legacy single-id, kept for backcompat
//     // target=filter
//     filter?: { planIds?: string[], hasTelegram?: bool,
//                hasVerifiedEmail?: bool, q?: string },
//     title, body, type?, link?,
//     channels: ["inapp","email","telegram"],
//     scheduleAt?: ISO 8601 string  -> send later
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

  const rawTarget = body?.target;
  // Accept legacy "customer" alias for "customers".
  const target = rawTarget === "customer" || rawTarget === "customers"
    ? "customers"
    : rawTarget === "filter" ? "filter" : "all";

  const channels = Array.isArray(body?.channels)
    ? body.channels.filter((c) => VALID_CHANNELS.has(c))
    : ["inapp"];
  if (channels.length === 0) channels.push("inapp");

  const sessionRole = auth.session?.role || "admin";

  let spec;
  if (target === "customers") {
    const ids = Array.isArray(body?.customerIds) && body.customerIds.length > 0
      ? body.customerIds.map(String)
      : (body?.customerId ? [String(body.customerId)] : []);
    if (ids.length === 0) {
      return NextResponse.json({ error: "customerIds required" }, { status: 400 });
    }
    spec = { target: "customers", ids };
  } else if (target === "filter") {
    const f = body?.filter || {};
    spec = {
      target: "filter",
      planIds: Array.isArray(f.planIds) ? f.planIds.map(String) : [],
      hasTelegram: !!f.hasTelegram,
      hasVerifiedEmail: !!f.hasVerifiedEmail,
      q: f.q ? String(f.q) : "",
    };
  } else {
    spec = { target: "all" };
  }

  const scheduleAt = body?.scheduleAt ? String(body.scheduleAt) : null;

  try {
    const result = await sendOrScheduleNotification({
      spec,
      title,
      body: text,
      type,
      link,
      channels,
      createdBy: sessionRole,
      scheduleAt,
    });

    if (result.scheduled) {
      return NextResponse.json({
        ok: true,
        scheduled: true,
        notification: result.notification,
      });
    }

    if (target === "customers" && result.recipientCount === 0) {
      return NextResponse.json({ error: "No matching customer" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      scheduled: false,
      recipientCount: result.recipientCount,
      created: result.created,
    });
  } catch (e) {
    return apiError(e, "Failed to create notification", 500, "admin/notifications");
  }
}
