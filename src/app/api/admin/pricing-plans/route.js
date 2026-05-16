import { NextResponse } from "next/server";
import { getPricingPlans, createPricingPlan } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET() {
  const plans = await getPricingPlans();
  return NextResponse.json({ plans });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  try {
    const plan = await createPricingPlan(body || {});
    return NextResponse.json({ plan }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Create failed" }, { status: 400 });
  }
}
