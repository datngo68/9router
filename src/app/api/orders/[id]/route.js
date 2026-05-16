import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getOrderById, getPricingPlanById, getApiKeyById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/orders/[id] — fetch order detail (only for the customer who owns it)
export async function GET(request, { params }) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const order = await getOrderById(id);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.customerId !== session.customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [plan, apiKey] = await Promise.all([
    getPricingPlanById(order.planId),
    order.apiKeyId ? getApiKeyById(order.apiKeyId) : null,
  ]);

  return NextResponse.json({ order, plan, apiKey });
}
