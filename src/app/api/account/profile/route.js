import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { updateCustomer } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// PATCH /api/account/profile
//   body: subset of { displayName, phone, telegramChatId }
export async function PATCH(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowed = {};
  for (const k of ["displayName", "phone", "telegramChatId"]) {
    if (Object.prototype.hasOwnProperty.call(body || {}, k)) {
      const v = body[k];
      if (v != null && typeof v !== "string") {
        return NextResponse.json({ error: `${k} must be a string` }, { status: 400 });
      }
      allowed[k] = v == null ? null : v.trim() || null;
    }
  }

  const updated = await updateCustomer(session.customer.id, allowed);
  return NextResponse.json({ customer: updated });
}
