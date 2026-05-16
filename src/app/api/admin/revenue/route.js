import { NextResponse } from "next/server";
import { getOrders, getCustomers } from "@/lib/localDb";
import { getAdapter } from "@/lib/db/driver.js";

export const dynamic = "force-dynamic";

// GET /api/admin/revenue?period=today|7d|30d
//   Aggregates delivered orders + cost from usageHistory.
export async function GET(request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30d";
  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const cutoffIso = cutoff.toISOString();

  const orders = await getOrders({ limit: 1000 });
  const customers = await getCustomers();
  const customerById = Object.fromEntries(customers.map((c) => [c.id, c]));

  const inWindow = orders.filter((o) => o.deliveredAt && o.deliveredAt >= cutoffIso);
  const pending = orders.filter((o) => o.status === "pending");

  // Daily revenue
  const byDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() + i);
    const k = d.toISOString().slice(0, 10);
    byDay.set(k, { day: k, revenueVnd: 0, orders: 0 });
  }
  for (const o of inWindow) {
    const k = o.deliveredAt.slice(0, 10);
    const e = byDay.get(k);
    if (e) { e.revenueVnd += o.priceVnd || 0; e.orders += 1; }
  }

  const totalRevenue = inWindow.reduce((s, o) => s + (o.priceVnd || 0), 0);

  // Top customers
  const customerSpend = new Map();
  for (const o of inWindow) {
    const c = customerById[o.customerId];
    const cur = customerSpend.get(o.customerId) || { customerId: o.customerId, email: c?.email || o.customerId, displayName: c?.displayName, total: 0, orders: 0 };
    cur.total += o.priceVnd || 0;
    cur.orders += 1;
    customerSpend.set(o.customerId, cur);
  }
  const topCustomers = [...customerSpend.values()].sort((a, b) => b.total - a.total).slice(0, 10);

  // Top providers/models by token (cost USD) within window
  const db = await getAdapter();
  const usage = db.all(
    `SELECT provider, model, SUM(promptTokens) AS p, SUM(completionTokens) AS c, SUM(cost) AS cost, COUNT(*) AS n
     FROM usageHistory WHERE timestamp >= ? GROUP BY provider, model ORDER BY cost DESC LIMIT 20`,
    [cutoffIso]
  );

  return NextResponse.json({
    period,
    totalRevenueVnd: totalRevenue,
    deliveredCount: inWindow.length,
    pendingCount: pending.length,
    byDay: [...byDay.values()],
    topCustomers,
    topModels: usage.map((r) => ({ provider: r.provider, model: r.model, promptTokens: r.p, completionTokens: r.c, cost: r.cost, requests: r.n })),
  });
}
