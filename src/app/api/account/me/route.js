import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ customer: null }, { status: 200 });
  return NextResponse.json({ customer: session.customer });
}
