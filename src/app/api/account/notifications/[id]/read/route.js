import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { markRead } from "@/lib/db/repos/notificationsRepo";

export const dynamic = "force-dynamic";

// POST /api/account/notifications/[id]/read
export async function POST(request, { params }) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await markRead(session.customer.id, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
