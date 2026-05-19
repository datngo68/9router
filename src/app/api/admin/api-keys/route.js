import { NextResponse } from "next/server";
import { listAllApiKeys } from "@/lib/db/repos/apiKeysRepo.js";
import { requireRole } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

// GET /api/admin/api-keys
//   Query: q, status (all|active|inactive|expired|expiringSoon), customerId,
//          sort, order, page, pageSize.
//   Returns { items, total, page, pageSize }.
export async function GET(request) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;

  const sp = new URL(request.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(200, Number(sp.get("pageSize")) || 50));

  const { items, total } = await listAllApiKeys({
    q: sp.get("q") || "",
    status: sp.get("status") || "all",
    customerId: sp.get("customerId") || "",
    sort: sp.get("sort") || "createdAt",
    order: sp.get("order") || "desc",
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return NextResponse.json({ items, total, page, pageSize });
}
