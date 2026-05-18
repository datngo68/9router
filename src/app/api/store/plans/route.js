import { NextResponse } from "next/server";
import { getPricingPlans, countCustomerPlanPurchases } from "@/lib/localDb";
import { getCurrentCustomer } from "@/lib/auth/customerSession";

export const dynamic = "force-dynamic";

// GET /api/store/plans — public list of active pricing plans (sorted).
// When called by a logged-in customer, augments each plan with how many
// times the customer has already purchased it (purchasedCount) so the
// storefront can disable the buy button when maxPurchasesPerCustomer is hit.
export async function GET(request) {
  let plans = [];
  try {
    plans = await getPricingPlans({ activeOnly: true });
  } catch (e) {
    console.log("[/api/store/plans] getPricingPlans failed:", e?.message);
    return NextResponse.json({ plans: [] });
  }

  // Best-effort enrichment for logged-in customer. Any failure here MUST NOT
  // hide the plan list — fall back to purchasedCount=0 instead of returning
  // an empty array (that confuses the storefront into "Chưa có gói").
  let customerId = null;
  try {
    const session = await getCurrentCustomer(request);
    customerId = session?.customer?.id || null;
  } catch (e) {
    console.log("[/api/store/plans] session lookup failed:", e?.message);
  }

  if (!customerId) {
    return NextResponse.json({ plans });
  }

  const enriched = await Promise.all(
    plans.map(async (p) => {
      try {
        const purchasedCount = await countCustomerPlanPurchases({ customerId, planId: p.id });
        return { ...p, purchasedCount };
      } catch (e) {
        console.log(`[/api/store/plans] count failed plan=${p.id}:`, e?.message);
        return { ...p, purchasedCount: 0 };
      }
    })
  );
  return NextResponse.json({ plans: enriched });
}
