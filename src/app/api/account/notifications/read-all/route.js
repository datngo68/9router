import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { markAllRead } from "@/lib/db/repos/notificationsRepo";

export const dynamic = "force-dynamic";

// POST /api/account/notifications/read-all
export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const count = await markAllRead(session.customer.id);
  return NextResponse.json({ ok: true, count });
}
