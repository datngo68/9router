import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getApiKeyById, updateApiKey } from "@/lib/localDb";
import { logKeyAudit } from "@/lib/db/repos/keyAuditRepo.js";
import { getClientIp } from "@/lib/auth/loginThrottle";

export const dynamic = "force-dynamic";

async function loadOwnKey(request, id) {
  const session = await getCurrentCustomer(request);
  if (!session) return { error: "Unauthorized", status: 401 };
  const key = await getApiKeyById(id);
  if (!key || key.customerId !== session.customer.id) {
    return { error: "Not found", status: 404 };
  }
  return { session, key };
}

// PATCH /api/account/keys/[id] — only `name` and `isActive` (pause/resume)
//   are mutable from the customer side. Limits are admin-only.
export async function PATCH(request, { params }) {
  const { id } = await params;
  const got = await loadOwnKey(request, id);
  if (got.error) return NextResponse.json({ error: got.error }, { status: got.status });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body || {}, "name")) {
    if (typeof body.name !== "string" || body.name.length > 200) {
      return NextResponse.json({ error: "name must be a string up to 200 chars" }, { status: 400 });
    }
    patch.name = body.name.trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, "isActive")) {
    patch.isActive = !!body.isActive;
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, "paygEnabled")) {
    patch.paygEnabled = !!body.paygEnabled;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ key: got.key });
  }

  const updated = await updateApiKey(id, patch);
  await logKeyAudit({
    keyId: id,
    action: "customer-update",
    actorIp: getClientIp(request),
    metadata: { fields: Object.keys(patch), customerId: got.session.customer.id },
  }).catch(() => {});
  return NextResponse.json({ key: updated });
}
