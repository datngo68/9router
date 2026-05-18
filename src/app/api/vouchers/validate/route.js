import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { validateVoucherForOrder, getPricingPlanById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/vouchers/validate
//   body: { code, planId }
//   returns: { ok: true, code, discountVnd, finalPriceVnd, originalPriceVnd }
//          | { ok: false, reason }
//
// Used by the checkout page to preview the discount before the customer
// commits to creating the order. The actual redemption happens atomically
// inside POST /api/orders.
export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const code = String(body?.code || "").trim();
  const planId = body?.planId;
  if (!code) return NextResponse.json({ ok: false, reason: "Vui lòng nhập mã" });
  if (!planId) return NextResponse.json({ ok: false, reason: "Thiếu planId" });

  const plan = await getPricingPlanById(planId);
  if (!plan || !plan.isActive) {
    return NextResponse.json({ ok: false, reason: "Gói không tồn tại hoặc đã ngừng bán" });
  }

  const result = await validateVoucherForOrder({
    code,
    customerId: session.customer.id,
    plan,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason });
  }
  return NextResponse.json({
    ok: true,
    code: result.voucher.code,
    discountVnd: result.discountVnd,
    finalPriceVnd: result.finalPriceVnd,
    originalPriceVnd: plan.priceVnd,
  });
}
