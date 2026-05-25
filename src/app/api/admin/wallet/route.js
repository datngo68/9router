import { NextResponse } from "next/server";
import {
  getWalletDailyStats,
  getWalletTotals,
  getWalletBalanceSnapshot,
  getTopWalletCustomers,
  getTopWalletModels,
  microToVnd,
} from "@/lib/db/repos/walletRepo.js";
import { getAdapter } from "@/lib/db/driver.js";

export const dynamic = "force-dynamic";

// GET /api/admin/wallet?period=today|7d|30d
//
// Aggregates the wallet ledger for the admin overview page. Reuses the
// repo-level helpers so the SQL stays in one place. All amounts are
// returned in plain VND for the UI to render.
export async function GET(request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30d";
  const days = period === "today" ? 1 : period === "7d" ? 7 : period === "90d" ? 90 : 30;

  const [daily, totalsByType, snapshot, topCustomers, topPaygCustomers, topModels] = await Promise.all([
    getWalletDailyStats({ days }),
    getWalletTotals({ days }),
    getWalletBalanceSnapshot({ limit: 50 }),
    getTopWalletCustomers({ days, metric: "spend", limit: 10 }),
    getTopWalletCustomers({ days, metric: "charge", limit: 10 }),
    getTopWalletModels({ days, limit: 10 }),
  ]);

  // Backfill missing days so the chart renders consecutive bars even on
  // days with no activity.
  const byDay = [];
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const lookup = new Map(daily.map((d) => [d.dateKey, d]));
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const entry = lookup.get(key);
    byDay.push({
      day: key,
      creditVnd: entry ? microToVnd(entry.creditMicroVnd) : 0,
      debitVnd: entry ? microToVnd(entry.debitMicroVnd) : 0,
      count: entry ? entry.count : 0,
    });
  }

  // Per-type rollup for the "Tổng nạp / Tổng tiêu" cards.
  const totals = {
    topupVnd: 0,
    chargeVnd: 0,
    planPurchaseVnd: 0,
    refundVnd: 0,
    adjustmentCreditVnd: 0,
    adjustmentDebitVnd: 0,
    txCount: 0,
  };
  for (const t of totalsByType) {
    totals.txCount += t.count;
    if (t.type === "topup") totals.topupVnd += microToVnd(t.creditMicroVnd);
    else if (t.type === "charge") totals.chargeVnd += microToVnd(t.debitMicroVnd);
    else if (t.type === "planPurchase") totals.planPurchaseVnd += microToVnd(t.debitMicroVnd);
    else if (t.type === "refund") totals.refundVnd += microToVnd(t.creditMicroVnd);
    else if (t.type === "adjustment") {
      totals.adjustmentCreditVnd += microToVnd(t.creditMicroVnd);
      totals.adjustmentDebitVnd += microToVnd(t.debitMicroVnd);
    }
  }

  // PAYG-enabled keys snapshot — useful to gauge adoption.
  const db = await getAdapter();
  const paygKeysRow = db.get(
    `SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN isActive = 1 THEN 1 END) AS active
       FROM apiKeys WHERE paygEnabled = 1`
  );

  return NextResponse.json({
    period,
    days,
    totals,
    byDay,
    snapshot: {
      positiveVnd: microToVnd(snapshot.positiveMicroVnd),
      negativeVnd: microToVnd(snapshot.negativeMicroVnd),
      netVnd: microToVnd(snapshot.positiveMicroVnd - snapshot.negativeMicroVnd),
      positiveCount: snapshot.positiveCount,
      negativeCount: snapshot.negativeCount,
      totalCustomers: snapshot.totalCustomers,
      top: snapshot.top.map((c) => ({
        ...c,
        balanceVnd: microToVnd(c.balanceMicroVnd),
        balanceMinLimitVnd: microToVnd(c.balanceMinLimitMicroVnd),
      })),
    },
    topCustomers: topCustomers.map((c) => ({
      ...c,
      valueVnd: microToVnd(c.valueMicroVnd),
      balanceVnd: microToVnd(c.balanceMicroVnd),
    })),
    topPaygCustomers: topPaygCustomers.map((c) => ({
      ...c,
      valueVnd: microToVnd(c.valueMicroVnd),
      balanceVnd: microToVnd(c.balanceMicroVnd),
    })),
    topModels: topModels.map((m) => ({
      ...m,
      debitVnd: microToVnd(m.debitMicroVnd),
    })),
    paygKeys: {
      total: Number(paygKeysRow?.total || 0),
      active: Number(paygKeysRow?.active || 0),
    },
  });
}
