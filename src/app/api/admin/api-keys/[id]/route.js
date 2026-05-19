import { NextResponse } from "next/server";
import { getApiKeyById, updateApiKey, deleteApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { requireRole } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

// PATCH /api/admin/api-keys/[id]
//   Body: any subset of { name, isActive, dailyTokenLimit, monthlyTokenLimit,
//   lifetimeTokenLimit, requestsPerMinute, maxTokensPerRequest, expiresAt,
//   allowedModels, allowedIps, rtkMode, cavemanMode }
export async function PATCH(request, { params }) {
  const { id } = await params;
  const auth = await requireRole(request, "admin", {
    action: "apikey.update",
    targetType: "apiKey",
    targetId: id,
  });
  if (auth.response) return auth.response;

  const existing = await getApiKeyById(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updated = await updateApiKey(id, body || {});
  return NextResponse.json({ key: updated });
}

// DELETE /api/admin/api-keys/[id]
export async function DELETE(request, { params }) {
  const { id } = await params;
  const auth = await requireRole(request, "admin", {
    action: "apikey.delete",
    targetType: "apiKey",
    targetId: id,
  });
  if (auth.response) return auth.response;

  const existing = await getApiKeyById(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ok = await deleteApiKey(id);
  return NextResponse.json({ deleted: ok });
}
