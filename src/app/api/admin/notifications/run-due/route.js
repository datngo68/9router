import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { runDueScheduled } from "@/lib/notifications/scheduler";

export const dynamic = "force-dynamic";

// POST /api/admin/notifications/run-due
// Manually trigger the scheduler tick (also runs every 60s automatically).
// Useful for testing or to force-fire after fixing a misconfigured schedule.
export async function POST(request) {
  const auth = await requireRole(request, "admin", { action: "notification.run-due" });
  if (auth.response) return auth.response;
  const result = await runDueScheduled();
  return NextResponse.json({ ok: true, ...result });
}
