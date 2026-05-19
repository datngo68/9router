import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { listForCustomer, countUnreadForCustomer } from "@/lib/db/repos/notificationsRepo";

export const dynamic = "force-dynamic";

// GET /api/account/notifications?unread=1&limit=50&offset=0
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const [items, unreadCount] = await Promise.all([
    listForCustomer(session.customer.id, { unreadOnly, limit, offset }),
    countUnreadForCustomer(session.customer.id),
  ]);
  return NextResponse.json({ items, unreadCount });
}
