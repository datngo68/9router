import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getApiKeyById } from "@/lib/localDb";
import { hashApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { logKeyAudit } from "@/lib/db/repos/keyAuditRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { generateApiKeyWithMachine } from "@/shared/utils/apiKey";
import { getClientIp } from "@/lib/auth/loginThrottle";
import { sendKeyRegeneratedEmail } from "@/lib/notify/email";
import { notifyCustomerKeyRegenerated } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

// POST /api/account/keys/[id]/regenerate
//   Rotates the secret material in-place: keeps the same key id, policy fields,
//   order link, and usage history. Only `keyHash` / `keyPrefix` / `keyLast4`
//   change. The previous raw key stops working immediately.
export async function POST(request, { params }) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await getApiKeyById(id);
  if (!existing || existing.customerId !== session.customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { key: rawKey } = generateApiKeyWithMachine(existing.machineId);
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, Math.min(7, rawKey.length));
  const keyLast4 = rawKey.slice(-4);

  const db = await getAdapter();
  db.run(
    `UPDATE apiKeys SET keyHash = ?, keyPrefix = ?, keyLast4 = ? WHERE id = ?`,
    [keyHash, keyPrefix, keyLast4, existing.id]
  );

  await logKeyAudit({
    keyId: existing.id,
    action: "regenerate",
    actorIp: getClientIp(request),
    metadata: { customerId: session.customer.id },
  }).catch(() => {});

  // Best-effort email + Telegram delivery of the new raw key.
  sendKeyRegeneratedEmail({
    email: session.customer.email,
    displayName: session.customer.displayName,
    key: rawKey,
    keyDisplay: `${keyPrefix}...${keyLast4}`,
  }).catch(() => {});
  notifyCustomerKeyRegenerated({
    customer: session.customer,
    key: rawKey,
    keyDisplay: `${keyPrefix}...${keyLast4}`,
  }).catch(() => {});

  return NextResponse.json({
    apiKey: {
      id: existing.id,
      key: rawKey,
      keyDisplay: `${keyPrefix}...${keyLast4}`,
      name: existing.name,
    },
  });
}
