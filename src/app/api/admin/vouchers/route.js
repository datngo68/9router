import { NextResponse } from "next/server";
import { getVouchers, createVoucher } from "@/lib/localDb";
import { apiError } from "@/shared/utils/apiError";

export const dynamic = "force-dynamic";

export async function GET() {
  const vouchers = await getVouchers();
  return NextResponse.json({ vouchers });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  try {
    const voucher = await createVoucher(body || {});
    return NextResponse.json({ voucher }, { status: 201 });
  } catch (e) {
    return apiError(e, "Create failed", 400, "admin/vouchers");
  }
}
