import { NextResponse } from "next/server";
import { getOrders } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/admin/orders?status=pending&customerId=...
export async function GET(request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const customerId = url.searchParams.get("customerId");
  const limit = Number(url.searchParams.get("limit")) || 200;
  const orders = await getOrders({ status, customerId, limit });
  return NextResponse.json({ orders });
}
