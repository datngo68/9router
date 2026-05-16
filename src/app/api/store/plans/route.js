import { NextResponse } from "next/server";
import { getPricingPlans } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/store/plans — public list of active pricing plans (sorted)
export async function GET() {
  try {
    const plans = await getPricingPlans({ activeOnly: true });
    return NextResponse.json({ plans });
  } catch (e) {
    console.log("[/api/store/plans] error:", e.message);
    return NextResponse.json({ plans: [] });
  }
}
