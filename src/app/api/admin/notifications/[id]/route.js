import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { deleteNotification, cancelScheduled, getNotificationById } from "@/lib/db/repos/notificationsRepo";

export const dynamic = "force-dynamic";

// DELETE /api/admin/notifications/[id]
//   ?cancel=1 → keep the row but mark scheduled→cancelled (audit-friendly).
//   default   → hard delete (and clear notificationReads).
export async function DELETE(request, { params }) {
  const { id } = await params;
  const url = new URL(request.url);
  const cancelOnly = url.searchParams.get("cancel") === "1";
  const auth = await requireRole(request, "admin", {
    action: cancelOnly ? "notification.cancel" : "notification.delete",
    targetType: "notification",
    targetId: id,
  });
  if (auth.response) return auth.response;
  if (cancelOnly) {
    const existing = await getNotificationById(id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "scheduled") {
      return NextResponse.json({ error: "Only scheduled notifications can be cancelled" }, { status: 400 });
    }
    const ok = await cancelScheduled(id);
    if (!ok) return NextResponse.json({ error: "Cancel failed" }, { status: 500 });
    return NextResponse.json({ ok: true, cancelled: true });
  }
  const ok = await deleteNotification(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
