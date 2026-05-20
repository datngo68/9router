import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import {
  getAllPaygPricing,
  updatePaygPricing,
  removePaygPricing,
} from "@/lib/db/repos/paygPricingRepo.js";

export const dynamic = "force-dynamic";

// GET /api/admin/payg-pricing — list all configured PAYG pricing entries.
export async function GET(request) {
  const auth = await requireRole(request, "operator");
  if (auth.response) return auth.response;
  const pricing = await getAllPaygPricing();
  return NextResponse.json({ pricing });
}

// PUT /api/admin/payg-pricing — bulk replace entries.
//   body: { entries: { "[provider|]model": { inputVnd, outputVnd, ... } | null } }
export async function PUT(request) {
  const auth = await requireRole(request, "admin", { action: "payg.pricing.update" });
  if (auth.response) return auth.response;

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const entries = body?.entries;
  if (!entries || typeof entries !== "object") {
    return NextResponse.json({ error: "entries must be an object" }, { status: 400 });
  }

  try {
    const next = await updatePaygPricing(entries);
    return NextResponse.json({ pricing: next });
  } catch (e) {
    console.error("[admin/payg-pricing] update failed:", e?.message || e);
    return NextResponse.json({ error: "Update failed" }, { status: 400 });
  }
}

// DELETE /api/admin/payg-pricing?key=...
export async function DELETE(request) {
  const auth = await requireRole(request, "admin", { action: "payg.pricing.delete" });
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

  const next = await removePaygPricing(key);
  return NextResponse.json({ pricing: next });
}
