import { NextResponse } from "next/server";
import { getPricingPlans, createPricingPlan } from "@/lib/localDb";
import { requireRole } from "@/lib/auth/rbac";
import { parseJsonBody, AdminPricingPlanSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireRole(request, "operator");
  if (auth.response) return auth.response;
  const plans = await getPricingPlans();
  return NextResponse.json({ plans });
}

export async function POST(request) {
  const auth = await requireRole(request, "admin", { action: "pricing_plan.create", targetType: "pricingPlan" });
  if (auth.response) return auth.response;
  const parsed = await parseJsonBody(request, AdminPricingPlanSchema);
  if (parsed.response) return parsed.response;
  try {
    const plan = await createPricingPlan(parsed.value);
    return NextResponse.json({ plan }, { status: 201 });
  } catch (e) {
    console.error("[admin/pricing-plans] create failed:", e?.message || e);
    return NextResponse.json({ error: "Create failed" }, { status: 400 });
  }
}
