import { NextResponse } from "next/server";
import { getCustomers, getOrders } from "@/lib/localDb";
import { getAdapter } from "@/lib/db/driver.js";

export const dynamic = "force-dynamic";

// GET /api/admin/customers/analytics?period=7d|30d|90d
//   Tổng quan khách hàng + 3 leaderboard:
//     - topSpenders   : tổng VND đơn delivered theo customerId trong period
//     - topUsage      : tổng cost USD upstream theo customerId trong period (JOIN apiKeys)
//     - churnRisk     : khách có LTV > 0 nhưng không hoạt động trong `inactiveDays`
//
// Stats card: totalCustomers, activeLast30d, newLast30d, totalLtvVnd
//   - "active" = có ít nhất 1 usage row trong 30d gần nhất.
//   - "new"    = createdAt < now & >= now - 30d.
export async function GET(request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const inactiveDays = 30; // ngưỡng churn cố định để khỏi nhiễu

  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 86400000);
  const cutoffIso = cutoff.toISOString();
  const cutoff30 = new Date(now.getTime() - 30 * 86400000).toISOString();

  const [customers, orders] = await Promise.all([
    getCustomers(),
    getOrders({ limit: 5000 }),
  ]);
  const customerById = Object.fromEntries(customers.map((c) => [c.id, c]));

  // ── stat cards ─────────────────────────────────────────────────────────
  const totalCustomers = customers.length;
  const newLast30d = customers.filter((c) => c.createdAt >= cutoff30).length;
  const totalLtvVnd = orders
    .filter((o) => o.status === "delivered")
    .reduce((s, o) => s + (Number(o.priceVnd) || 0), 0);

  // ── leaderboards via SQL ──────────────────────────────────────────────
  const db = await getAdapter();

  const spendRows = db.all(
    `SELECT customerId,
            COALESCE(SUM(priceVnd), 0) AS totalVnd,
            COUNT(*) AS orders,
            MAX(deliveredAt) AS lastOrderAt
     FROM orders
     WHERE status = 'delivered' AND deliveredAt >= ?
     GROUP BY customerId
     ORDER BY totalVnd DESC
     LIMIT 10`,
    [cutoffIso]
  );

  const usageRows = db.all(
    `SELECT k.customerId AS customerId,
            COALESCE(SUM(u.cost), 0) AS costUsd,
            COALESCE(SUM(u.promptTokens + u.completionTokens), 0) AS totalTokens,
            COUNT(*) AS requests,
            MAX(u.timestamp) AS lastActiveAt
     FROM usageHistory u
     INNER JOIN apiKeys k ON k.id = u.apiKeyId
     WHERE u.timestamp >= ? AND k.customerId IS NOT NULL
     GROUP BY k.customerId
     ORDER BY costUsd DESC
     LIMIT 10`,
    [cutoffIso]
  );

  // Active set (last 30d) — for stat card + churn detection
  const activeRows = db.all(
    `SELECT k.customerId AS customerId, MAX(u.timestamp) AS lastActiveAt
     FROM usageHistory u
     INNER JOIN apiKeys k ON k.id = u.apiKeyId
     WHERE k.customerId IS NOT NULL
     GROUP BY k.customerId`
  );
  const lastActiveByCustomer = Object.fromEntries(
    activeRows.map((r) => [r.customerId, r.lastActiveAt])
  );
  const activeLast30d = activeRows.filter(
    (r) => r.lastActiveAt && r.lastActiveAt >= cutoff30
  ).length;

  // ── churn risk ────────────────────────────────────────────────────────
  // Khách có tổng LTV > 0 (đếm cả pending/paid/delivered, vì phía business
  // đã trả tiền là "khách đã chi") nhưng `lastActiveAt` < now - inactiveDays.
  const ltvByCustomer = new Map();
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "refunded") continue;
    ltvByCustomer.set(
      o.customerId,
      (ltvByCustomer.get(o.customerId) || 0) + (Number(o.priceVnd) || 0)
    );
  }
  const churnCutoff = new Date(now.getTime() - inactiveDays * 86400000).toISOString();
  const churnRisk = [];
  for (const [customerId, ltv] of ltvByCustomer.entries()) {
    if (ltv <= 0) continue;
    const lastActiveAt = lastActiveByCustomer[customerId] || null;
    if (lastActiveAt && lastActiveAt >= churnCutoff) continue; // còn hoạt động
    const c = customerById[customerId];
    churnRisk.push({
      customerId,
      email: c?.email || customerId,
      displayName: c?.displayName || null,
      ltvVnd: ltv,
      lastActiveAt,
    });
  }
  churnRisk.sort((a, b) => b.ltvVnd - a.ltvVnd);

  return NextResponse.json({
    period,
    inactiveDays,
    stats: {
      totalCustomers,
      activeLast30d,
      newLast30d,
      totalLtvVnd,
    },
    topSpenders: spendRows.map((r) => ({
      customerId: r.customerId,
      email: customerById[r.customerId]?.email || r.customerId,
      displayName: customerById[r.customerId]?.displayName || null,
      totalVnd: Number(r.totalVnd) || 0,
      orders: Number(r.orders) || 0,
      lastOrderAt: r.lastOrderAt,
    })),
    topUsage: usageRows.map((r) => ({
      customerId: r.customerId,
      email: customerById[r.customerId]?.email || r.customerId,
      displayName: customerById[r.customerId]?.displayName || null,
      costUsd: Number(r.costUsd) || 0,
      totalTokens: Number(r.totalTokens) || 0,
      requests: Number(r.requests) || 0,
      lastActiveAt: r.lastActiveAt,
    })),
    churnRisk: churnRisk.slice(0, 10),
  });
}
