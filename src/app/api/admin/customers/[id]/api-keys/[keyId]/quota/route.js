import { NextResponse } from "next/server";
import { getCustomerById, getApiKeyById, updateApiKey } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/admin/customers/[id]/api-keys/[keyId]/quota
//   Cộng quota hoặc gia hạn key.
//   Body (mỗi field optional, mode "add" cộng vào limit hiện tại, mode "set"
//   ghi đè):
//     {
//       mode: "add" | "set",     // default "add"
//       dailyTokenLimit?: number,
//       monthlyTokenLimit?: number,
//       lifetimeTokenLimit?: number,
//       extendDays?: number,     // gia hạn expiresAt thêm N ngày
//       expiresAt?: string|null  // hoặc set tường minh ISO timestamp
//     }
export async function POST(request, { params }) {
  const { id, keyId } = await params;
  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const key = await getApiKeyById(keyId);
  if (!key || key.customerId !== id) {
    return NextResponse.json({ error: "Key not found for this customer" }, { status: 404 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const mode = body?.mode === "set" ? "set" : "add";
  const patch = {};

  function applyLimit(field, value) {
    if (value === undefined || value === null || value === "") return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    if (mode === "set") {
      patch[field] = Math.floor(n);
    } else {
      patch[field] = Math.floor((Number(key[field]) || 0) + n);
    }
  }

  applyLimit("dailyTokenLimit", body?.dailyTokenLimit);
  applyLimit("monthlyTokenLimit", body?.monthlyTokenLimit);
  applyLimit("lifetimeTokenLimit", body?.lifetimeTokenLimit);

  // Expiry handling: extendDays adds onto current expiresAt (or now if null);
  // explicit expiresAt overrides.
  if (Object.prototype.hasOwnProperty.call(body || {}, "expiresAt")) {
    patch.expiresAt = body.expiresAt || null;
  } else if (body?.extendDays != null && Number(body.extendDays) > 0) {
    const days = Math.floor(Number(body.extendDays));
    const base = key.expiresAt ? new Date(key.expiresAt) : new Date();
    const next = new Date(base.getTime() + days * 86400000);
    patch.expiresAt = next.toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  const updated = await updateApiKey(keyId, patch);
  return NextResponse.json({ key: updated, applied: { mode, ...patch } });
}
