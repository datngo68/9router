import { NextResponse } from "next/server";
import { getPricingPlanById, updatePricingPlan, deletePricingPlan } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const plan = await getPricingPlanById(id);
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ plan });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  try {
    const plan = await updatePricingPlan(id, body || {});
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ plan });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const ok = await deletePricingPlan(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
