import { NextResponse } from "next/server";
import { getPricingPlanById, updatePricingPlan, deletePricingPlan } from "@/lib/localDb";
import { requireRole } from "@/lib/auth/rbac";
import { parseJsonBody, AdminPricingPlanPatchSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireRole(request, "operator");
  if (auth.response) return auth.response;
  const { id } = await params;
  const plan = await getPricingPlanById(id);
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ plan });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const auth = await requireRole(request, "admin", { action: "pricing_plan.update", targetType: "pricingPlan", targetId: id });
  if (auth.response) return auth.response;
  const parsed = await parseJsonBody(request, AdminPricingPlanPatchSchema);
  if (parsed.response) return parsed.response;
  try {
    const plan = await updatePricingPlan(id, parsed.value);
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ plan });
  } catch (e) {
    console.error("[admin/pricing-plans/:id] update failed:", e?.message || e);
    return NextResponse.json({ error: "Update failed" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const auth = await requireRole(request, "admin", { action: "pricing_plan.delete", targetType: "pricingPlan", targetId: id });
  if (auth.response) return auth.response;
  const ok = await deletePricingPlan(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
