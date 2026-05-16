import { NextResponse } from "next/server";
import { getCustomerById, getOrders, getApiKeysByCustomer, updateCustomer } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [orders, keys] = await Promise.all([
    getOrders({ customerId: id, limit: 200 }),
    getApiKeysByCustomer(id),
  ]);
  return NextResponse.json({ customer, orders, keys });
}

// PATCH /api/admin/customers/[id]
//   body: { displayName?, phone?, telegramChatId?, notes? }
export async function PATCH(request, { params }) {
  const { id } = await params;
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const updated = await updateCustomer(id, body || {});
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ customer: updated });
}
