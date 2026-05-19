import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { deleteNotification } from "@/lib/db/repos/notificationsRepo";

export const dynamic = "force-dynamic";

// DELETE /api/admin/notifications/[id]
export async function DELETE(request, { params }) {
  const { id } = await params;
  const auth = await requireRole(request, "admin", {
    action: "notification.delete",
    targetType: "notification",
    targetId: id,
  });
  if (auth.response) return auth.response;
  const ok = await deleteNotification(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
