import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getApiKeysByCustomer } from "@/lib/localDb";
import { getApiKeyDailyTokenUsage, getApiKeyMonthlyTokenUsage, getApiKeyLifetimeTokenUsage } from "@/lib/usageDb";
import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

export const dynamic = "force-dynamic";

function getLocalDayBounds(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start, end };
}

// GET /api/account/usage?period=today|7d|30d
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "7d";

  const keys = await getApiKeysByCustomer(session.customer.id);
  if (keys.length === 0) {
    return NextResponse.json({ totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, byDay: [], byKey: [], byModel: [] });
  }

  const keyIds = keys.map((k) => k.id);
  const placeholders = keyIds.map(() => "?").join(",");

  const periodDays = period === "today" ? 1 : period === "30d" ? 30 : 7;
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (periodDays - 1));

  const db = await getAdapter();
  const rows = db.all(
    `SELECT timestamp, provider, model, apiKeyId, promptTokens, completionTokens, cost FROM usageHistory
     WHERE apiKeyId IN (${placeholders}) AND timestamp >= ?`,
    [...keyIds, cutoff.toISOString()]
  );

  // Aggregate
  const byDay = new Map();
  const byKey = new Map();
  const byModel = new Map();
  let totalPrompt = 0; let totalCompletion = 0; let totalCost = 0;

  for (const r of rows) {
    const day = r.timestamp.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { day, promptTokens: 0, completionTokens: 0, cost: 0 });
    const dayEntry = byDay.get(day);
    dayEntry.promptTokens += r.promptTokens || 0;
    dayEntry.completionTokens += r.completionTokens || 0;
    dayEntry.cost += r.cost || 0;

    if (!byKey.has(r.apiKeyId)) byKey.set(r.apiKeyId, { apiKeyId: r.apiKeyId, promptTokens: 0, completionTokens: 0, cost: 0 });
    const ke = byKey.get(r.apiKeyId);
    ke.promptTokens += r.promptTokens || 0;
    ke.completionTokens += r.completionTokens || 0;
    ke.cost += r.cost || 0;

    const mk = `${r.provider || "?"}/${r.model || "?"}`;
    if (!byModel.has(mk)) byModel.set(mk, { provider: r.provider, model: r.model, fullId: mk, promptTokens: 0, completionTokens: 0, cost: 0, requests: 0 });
    const me = byModel.get(mk);
    me.promptTokens += r.promptTokens || 0;
    me.completionTokens += r.completionTokens || 0;
    me.cost += r.cost || 0;
    me.requests += 1;

    totalPrompt += r.promptTokens || 0;
    totalCompletion += r.completionTokens || 0;
    totalCost += r.cost || 0;
  }

  // Fill missing days with zeros so charts have continuous x-axis
  const dayArr = [];
  for (let i = 0; i < periodDays; i++) {
    const d = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dayArr.push(byDay.get(key) || { day: key, promptTokens: 0, completionTokens: 0, cost: 0 });
  }

  // Map apiKeyId → name + display for byKey rows
  const keyMeta = Object.fromEntries(keys.map((k) => [k.id, { name: k.name, keyDisplay: k.keyDisplay }]));
  const byKeyOut = [...byKey.values()].map((e) => ({ ...e, ...(keyMeta[e.apiKeyId] || {}) }));

  return NextResponse.json({
    period,
    totals: { promptTokens: totalPrompt, completionTokens: totalCompletion, totalTokens: totalPrompt + totalCompletion, cost: totalCost },
    byDay: dayArr,
    byKey: byKeyOut.sort((a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens)),
    byModel: [...byModel.values()].sort((a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens)),
  });
}
