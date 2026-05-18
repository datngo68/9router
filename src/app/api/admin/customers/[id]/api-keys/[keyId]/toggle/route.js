import { NextResponse } from "next/server";
import { getCustomerById, getApiKeyById, updateApiKey } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/admin/customers/[id]/api-keys/[keyId]/toggle
//   Bật/tắt key. Body có thể truyền { isActive: bool } để set tường minh,
//   hoặc bỏ trống để toggle dựa trên trạng thái hiện tại.
export async function POST(request, { params }) {
  const { id, keyId } = await params;
  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const key = await getApiKeyById(keyId);
  if (!key || key.customerId !== id) {
    return NextResponse.json({ error: "Key not found for this customer" }, { status: 404 });
  }

  let body = {};
  try { body = await request.json(); } catch { /* allow empty */ }
  const next = typeof body?.isActive === "boolean" ? body.isActive : !key.isActive;

  const updated = await updateApiKey(keyId, { isActive: next });
  return NextResponse.json({ key: updated });
}
