import { NextResponse } from "next/server";
import { getCustomerById, getOrders, getApiKeysByCustomer, updateCustomer } from "@/lib/localDb";
import { getAdapter } from "@/lib/db/driver.js";
import {
  getApiKeyDailyTokenUsage,
  getApiKeyMonthlyTokenUsage,
  getApiKeyLifetimeTokenUsage,
} from "@/lib/db/repos/usageRepo.js";

export const dynamic = "force-dynamic";

// GET /api/admin/customers/[id]
//   Trả về:
//     customer, orders, keys (như cũ)
//     summary: totalSpentVnd, ordersCount, firstOrderAt, lastOrderAt, lastActiveAt
//     usageDaily[]: 30d gần nhất {day, requests, totalTokens, costUsd}
//     usageByModel[]: top 10 model theo costUsd 30d
//     keyLimitsUsage[]: với mỗi key, used vs limit (daily/monthly/lifetime + %)
//     voucherRedemptions[]: lịch sử voucher đã redeem
export async function GET(_request, { params }) {
  const { id } = await params;
  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [orders, keys] = await Promise.all([
    getOrders({ customerId: id, limit: 500 }),
    getApiKeysByCustomer(id),
  ]);

  const db = await getAdapter();
  const now = new Date();
  const cutoff30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const cutoff30Iso = cutoff30.toISOString();

  // ── summary ──────────────────────────────────────────────────────────
  const delivered = orders.filter((o) => o.status === "delivered");
  const totalSpentVnd = delivered.reduce((s, o) => s + (Number(o.priceVnd) || 0), 0);
  const orderTimes = orders.map((o) => o.createdAt).filter(Boolean).sort();
  const firstOrderAt = orderTimes[0] || null;
  const lastOrderAt = orderTimes[orderTimes.length - 1] || null;

  const lastActiveRow = db.get(
    `SELECT MAX(u.timestamp) AS lastActiveAt
     FROM usageHistory u INNER JOIN apiKeys k ON k.id = u.apiKeyId
     WHERE k.customerId = ?`,
    [id]
  );
  const lastActiveAt = lastActiveRow?.lastActiveAt || null;

  // ── usageDaily 30d ───────────────────────────────────────────────────
  const usageDailyRows = db.all(
    `SELECT substr(u.timestamp, 1, 10) AS day,
            COUNT(*) AS requests,
            COALESCE(SUM(u.promptTokens + u.completionTokens), 0) AS totalTokens,
            COALESCE(SUM(u.cost), 0) AS costUsd
     FROM usageHistory u INNER JOIN apiKeys k ON k.id = u.apiKeyId
     WHERE k.customerId = ? AND u.timestamp >= ?
     GROUP BY day ORDER BY day ASC`,
    [id, cutoff30Iso]
  );
  const dailyMap = new Map(usageDailyRows.map((r) => [r.day, r]));
  const usageDaily = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(cutoff30.getFullYear(), cutoff30.getMonth(), cutoff30.getDate() + i);
    const k = d.toISOString().slice(0, 10);
    const r = dailyMap.get(k);
    usageDaily.push({
      day: k,
      requests: Number(r?.requests || 0),
      totalTokens: Number(r?.totalTokens || 0),
      costUsd: Number(r?.costUsd || 0),
    });
  }

  // ── usageByModel 30d top 10 ──────────────────────────────────────────
  const usageByModel = db.all(
    `SELECT u.provider, u.model,
            COUNT(*) AS requests,
            COALESCE(SUM(u.promptTokens + u.completionTokens), 0) AS totalTokens,
            COALESCE(SUM(u.cost), 0) AS costUsd
     FROM usageHistory u INNER JOIN apiKeys k ON k.id = u.apiKeyId
     WHERE k.customerId = ? AND u.timestamp >= ?
     GROUP BY u.provider, u.model
     ORDER BY costUsd DESC LIMIT 10`,
    [id, cutoff30Iso]
  ).map((r) => ({
    provider: r.provider,
    model: r.model,
    requests: Number(r.requests) || 0,
    totalTokens: Number(r.totalTokens) || 0,
    costUsd: Number(r.costUsd) || 0,
  }));

  // ── keyLimitsUsage (per-key utilization %) ───────────────────────────
  const keyLimitsUsage = await Promise.all(
    keys.map(async (k) => {
      const [daily, monthly, lifetime] = await Promise.all([
        getApiKeyDailyTokenUsage(k.id),
        getApiKeyMonthlyTokenUsage(k.id),
        getApiKeyLifetimeTokenUsage(k.id),
      ]);
      const pct = (used, limit) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null);
      return {
        keyId: k.id,
        name: k.name,
        keyDisplay: k.keyDisplay,
        isActive: k.isActive,
        expiresAt: k.expiresAt || null,
        daily: { used: daily.totalTokens, limit: k.dailyTokenLimit || 0, pct: pct(daily.totalTokens, k.dailyTokenLimit) },
        monthly: { used: monthly.totalTokens, limit: k.monthlyTokenLimit || 0, pct: pct(monthly.totalTokens, k.monthlyTokenLimit) },
        lifetime: { used: lifetime.totalTokens, limit: k.lifetimeTokenLimit || 0, pct: pct(lifetime.totalTokens, k.lifetimeTokenLimit) },
      };
    })
  );

  // ── voucherRedemptions (JOIN vouchers cho code/kind/value) ───────────
  const voucherRedemptions = db.all(
    `SELECT r.id, r.voucherId, r.orderId, r.discountVnd, r.redeemedAt,
            v.code, v.kind, v.value
     FROM voucherRedemptions r
     LEFT JOIN vouchers v ON v.id = r.voucherId
     WHERE r.customerId = ?
     ORDER BY r.redeemedAt DESC LIMIT 100`,
    [id]
  ).map((r) => ({
    id: r.id,
    voucherId: r.voucherId,
    orderId: r.orderId,
    discountVnd: Number(r.discountVnd) || 0,
    redeemedAt: r.redeemedAt,
    code: r.code || null,
    kind: r.kind || null,
    value: r.value != null ? Number(r.value) : null,
  }));

  return NextResponse.json({
    customer,
    orders,
    keys,
    summary: {
      totalSpentVnd,
      ordersCount: orders.length,
      deliveredCount: delivered.length,
      firstOrderAt,
      lastOrderAt,
      lastActiveAt,
    },
    usageDaily,
    usageByModel,
    keyLimitsUsage,
    voucherRedemptions,
  });
}

// PATCH /api/admin/customers/[id]
//   body: { displayName?, phone?, telegramChatId?, notes? }
export async function PATCH(request, { params }) {
  const { id } = await params;
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const updated = await updateCustomer(id, body || {});
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ customer: updated });
}
