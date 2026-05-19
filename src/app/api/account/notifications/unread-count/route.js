import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { countUnreadForCustomer } from "@/lib/db/repos/notificationsRepo";

export const dynamic = "force-dynamic";

// GET /api/account/notifications/unread-count
// Lightweight endpoint for the bell badge — polled every 60s by NotificationBell.
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const count = await countUnreadForCustomer(session.customer.id);
  return NextResponse.json({ count });
}
