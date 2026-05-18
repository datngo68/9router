import { NextResponse } from "next/server";
import { getCustomerById } from "@/lib/localDb";
import { createCustomerToken } from "@/lib/auth/customerToken";
import { sendPasswordResetEmail } from "@/lib/notify/email";

export const dynamic = "force-dynamic";

// POST /api/admin/customers/[id]/reset-password
//   Admin trigger: gửi email đặt lại mật khẩu cho khách. Dùng cùng cơ chế
//   token + email với /api/account/forgot, nhưng không cần check throttle vì
//   chỉ admin gọi được.
export async function POST(_request, { params }) {
  const { id } = await params;
  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (!customer.email) return NextResponse.json({ error: "Customer has no email" }, { status: 400 });

  const token = createCustomerToken(customer.id, "password-reset", 3600 * 1000);
  const result = await sendPasswordResetEmail({
    email: customer.email,
    displayName: customer.displayName,
    token,
  });

  if (result?.skipped) {
    return NextResponse.json(
      { ok: false, skipped: true, error: "SMTP chưa cấu hình. Cấu hình SMTP trong Settings để gửi email." },
      { status: 200 }
    );
  }
  if (result?.ok === false) {
    return NextResponse.json({ ok: false, error: result.error || "Send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
