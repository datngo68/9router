import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearCustomerSessionCookie } from "@/lib/auth/customerSession";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();
  await clearCustomerSessionCookie(cookieStore);
  return NextResponse.json({ ok: true });
}
