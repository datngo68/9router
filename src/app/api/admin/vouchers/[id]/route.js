import { NextResponse } from "next/server";
import { getVoucherById, updateVoucher, deleteVoucher, getRedemptionsForVoucher } from "@/lib/localDb";
import { apiError } from "@/shared/utils/apiError";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const voucher = await getVoucherById(id);
  if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const redemptions = await getRedemptionsForVoucher(id, { limit: 200 });
  return NextResponse.json({ voucher, redemptions });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  try {
    const voucher = await updateVoucher(id, body || {});
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ voucher });
  } catch (e) {
    return apiError(e, "Update failed", 400, "admin/vouchers/:id");
  }
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const ok = await deleteVoucher(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
