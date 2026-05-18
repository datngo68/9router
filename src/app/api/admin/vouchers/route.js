import { NextResponse } from "next/server";
import { getVouchers, createVoucher } from "@/lib/localDb";

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
    return NextResponse.json({ error: e.message || "Create failed" }, { status: 400 });
  }
}
