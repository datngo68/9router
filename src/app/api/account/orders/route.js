import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getOrders, getPricingPlanById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/account/orders — list orders of the logged-in customer with plan name
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orders = await getOrders({ customerId: session.customer.id, limit: 100 });
  // Resolve plan names lazily; small N so no batching needed.
  const planCache = new Map();
  const enriched = await Promise.all(orders.map(async (o) => {
    if (!planCache.has(o.planId)) planCache.set(o.planId, await getPricingPlanById(o.planId));
    const plan = planCache.get(o.planId);
    return { ...o, planName: plan?.name || null };
  }));
  return NextResponse.json({ orders: enriched });
}
