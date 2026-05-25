import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getApiKeysByCustomer, createApiKey, getSettings } from "@/lib/localDb";
import { getApiKeyDailyUsageSummary, getApiKeyMonthlyTokenUsage, getApiKeyLifetimeTokenUsage } from "@/lib/usageDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { logKeyAudit } from "@/lib/db/repos/keyAuditRepo.js";
import { getClientIp } from "@/lib/auth/loginThrottle";
import { apiError } from "@/shared/utils/apiError";

export const dynamic = "force-dynamic";

// GET /api/account/keys — list api keys owned by the logged-in customer.
// Each key carries usage summaries (daily/monthly/lifetime) so the portal
// can render progress bars without further round-trips.
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await getApiKeysByCustomer(session.customer.id);
  const enriched = await Promise.all(keys.map(async (k) => {
    const [daily, monthly, lifetime] = await Promise.all([
      getApiKeyDailyUsageSummary(k),
      getApiKeyMonthlyTokenUsage(k.id),
      getApiKeyLifetimeTokenUsage(k.id),
    ]);
    return {
      ...k,
      usage: {
        daily,
        monthly: {
          totalTokens: monthly.totalTokens,
          limit: k.monthlyTokenLimit,
          remaining: k.monthlyTokenLimit > 0 ? Math.max(0, k.monthlyTokenLimit - monthly.totalTokens) : null,
          percent: k.monthlyTokenLimit > 0 ? Math.min(100, Math.round(monthly.totalTokens / k.monthlyTokenLimit * 100)) : 0,
        },
        lifetime: {
          totalTokens: lifetime.totalTokens,
          limit: k.lifetimeTokenLimit,
          remaining: k.lifetimeTokenLimit > 0 ? Math.max(0, k.lifetimeTokenLimit - lifetime.totalTokens) : null,
          percent: k.lifetimeTokenLimit > 0 ? Math.min(100, Math.round(lifetime.totalTokens / k.lifetimeTokenLimit * 100)) : 0,
        },
      },
    };
  }));
  return NextResponse.json({ keys: enriched });
}

// POST /api/account/keys — let a customer self-create a Pay-As-You-Go key.
// Body: { name?: string }
// Limits: feature must be enabled in settings, customer can hold at most
// `walletPaygMaxKeysPerCustomer` PAYG keys (default 5). The key has no token
// quotas — usage drains from the wallet via the existing paygEnabled path.
export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getSettings();
  if (!settings.walletEnabled) {
    return NextResponse.json({ error: "Tính năng ví/PAYG chưa được bật" }, { status: 403 });
  }
  if (settings.walletPaygSelfServeKeys === false) {
    return NextResponse.json({ error: "Admin chưa mở chức năng tự tạo key PAYG" }, { status: 403 });
  }

  let body = {};
  try { body = await request.json(); } catch {}
  const rawName = typeof body?.name === "string" ? body.name.trim() : "";
  if (rawName.length > 200) {
    return NextResponse.json({ error: "Tên không được vượt quá 200 ký tự" }, { status: 400 });
  }

  // Cap PAYG keys per customer to keep one user from spawning unbounded keys.
  const existing = await getApiKeysByCustomer(session.customer.id);
  const existingPayg = existing.filter((k) => k.paygEnabled).length;
  const maxPerCustomer = Math.max(1, Number(settings.walletPaygMaxKeysPerCustomer || 5));
  if (existingPayg >= maxPerCustomer) {
    return NextResponse.json(
      { error: `Bạn đã đạt giới hạn ${maxPerCustomer} key PAYG. Tắt bớt key cũ trước khi tạo mới.` },
      { status: 400 }
    );
  }

  const name = rawName || `PAYG ${new Date().toISOString().slice(0, 10)}`;
  let created;
  try {
    const machineId = await getConsistentMachineId();
    created = await createApiKey(name, machineId, {
      paygEnabled: true,
      // No token quotas — billing happens entirely through the wallet ledger.
      dailyTokenLimit: 0,
      monthlyTokenLimit: 0,
      lifetimeTokenLimit: 0,
      requestsPerMinute: 0,
      maxTokensPerRequest: 0,
    });
  } catch (e) {
    return apiError(e, "Tạo key PAYG thất bại", 500, "account/keys/payg");
  }

  // Tag the new key with the customer id so it appears under their portal.
  // createApiKey() doesn't take customerId; patch directly via updateApiKey.
  try {
    const { updateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`UPDATE apiKeys SET customerId = ? WHERE id = ?`, [session.customer.id, created.id]);
    await updateApiKey(created.id, {}); // no-op normalisation
  } catch {}

  await logKeyAudit({
    keyId: created.id,
    action: "customer-create-payg",
    actorIp: getClientIp(request),
    metadata: { customerId: session.customer.id, name },
  }).catch(() => {});

  return NextResponse.json({
    apiKey: {
      id: created.id,
      key: created.key, // view-once raw
      keyDisplay: created.keyDisplay,
      name: created.name,
      paygEnabled: true,
    },
  }, { status: 201 });
}
