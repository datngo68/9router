import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { requireRole } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

// Server-side cache (30s TTL)
if (!global._customerUsageCache) global._customerUsageCache = { data: null, ts: 0, key: "" };
const _cache = global._customerUsageCache;
const CACHE_TTL = 30_000;

function getLocalDayBounds(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start, end };
}

function getLocalMonthBounds(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { start, end };
}

// GET /api/admin/customers/usage
//   Query: period (7d|30d|90d), q, sort, order, limit, offset, nearLimit
export async function GET(request) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;

  const sp = new URL(request.url).searchParams;
  const period = ["7d", "30d", "90d"].includes(sp.get("period")) ? sp.get("period") : "30d";
  const q = (sp.get("q") || "").trim().toLowerCase();
  const sortCol = ["cost", "tokens", "requests", "lastActive", "spike"].includes(sp.get("sort")) ? sp.get("sort") : "cost";
  const order = sp.get("order") === "asc" ? "asc" : "desc";
  const limit = Math.max(1, Math.min(200, Number(sp.get("limit")) || 50));
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const nearLimitOnly = sp.get("nearLimit") === "true";

  const periodDays = { "7d": 7, "30d": 30, "90d": 90 };
  const days = periodDays[period];
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  // Check cache
  const cacheKey = `${period}`;
  if (_cache.key === cacheKey && Date.now() - _cache.ts < CACHE_TTL && _cache.data) {
    return buildResponse(_cache.data, { q, sortCol, order, limit, offset, nearLimitOnly });
  }

  const db = await getAdapter();

  // 1. Aggregate usage per customer in period
  const usageRows = db.all(
    `SELECT k.customerId,
            COUNT(*) AS requests,
            COALESCE(SUM(u.promptTokens + u.completionTokens), 0) AS totalTokens,
            COALESCE(SUM(u.cost), 0) AS costUsd,
            MAX(u.timestamp) AS lastActiveAt
     FROM usageHistory u
     INNER JOIN apiKeys k ON k.id = u.apiKeyId
     WHERE k.customerId IS NOT NULL AND u.timestamp >= ?
     GROUP BY k.customerId`,
    [cutoffIso]
  );

  // 2. Top provider per customer (single query with window)
  const topProvRows = db.all(
    `SELECT customerId, provider, costUsd FROM (
       SELECT k.customerId, u.provider,
              SUM(u.cost) AS costUsd,
              ROW_NUMBER() OVER (PARTITION BY k.customerId ORDER BY SUM(u.cost) DESC) AS rn
       FROM usageHistory u
       INNER JOIN apiKeys k ON k.id = u.apiKeyId
       WHERE k.customerId IS NOT NULL AND u.timestamp >= ?
       GROUP BY k.customerId, u.provider
     ) WHERE rn = 1`,
    [cutoffIso]
  );
  const topProvMap = {};
  for (const r of topProvRows) {
    topProvMap[r.customerId] = { name: r.provider, costUsd: Number(r.costUsd) || 0 };
  }

  // 3. Customer info
  const customers = db.all(`SELECT id, email, displayName FROM customers`);
  const custMap = {};
  for (const c of customers) custMap[c.id] = c;

  // 4. Key counts per customer
  const keyCounts = db.all(
    `SELECT customerId, COUNT(*) AS total, SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) AS active FROM apiKeys WHERE customerId IS NOT NULL GROUP BY customerId`
  );
  const keyCountMap = {};
  for (const r of keyCounts) keyCountMap[r.customerId] = { total: r.total, active: Number(r.active) || 0 };

  // 5. Compute maxKeyUsagePct per customer (batch query)
  const { start: dayStart, end: dayEnd } = getLocalDayBounds(now);
  const { start: monthStart, end: monthEnd } = getLocalMonthBounds(now);

  const dailyUsageRows = db.all(
    `SELECT apiKeyId, COALESCE(SUM(promptTokens + completionTokens), 0) AS used
     FROM usageHistory WHERE apiKeyId IS NOT NULL AND timestamp >= ? AND timestamp < ?
     GROUP BY apiKeyId`,
    [dayStart.toISOString(), dayEnd.toISOString()]
  );
  const dailyUsageMap = {};
  for (const r of dailyUsageRows) dailyUsageMap[r.apiKeyId] = Number(r.used) || 0;

  const monthlyUsageRows = db.all(
    `SELECT apiKeyId, COALESCE(SUM(promptTokens + completionTokens), 0) AS used
     FROM usageHistory WHERE apiKeyId IS NOT NULL AND timestamp >= ? AND timestamp < ?
     GROUP BY apiKeyId`,
    [monthStart.toISOString(), monthEnd.toISOString()]
  );
  const monthlyUsageMap = {};
  for (const r of monthlyUsageRows) monthlyUsageMap[r.apiKeyId] = Number(r.used) || 0;

  const lifetimeUsageRows = db.all(
    `SELECT apiKeyId, COALESCE(SUM(promptTokens + completionTokens), 0) AS used
     FROM usageHistory WHERE apiKeyId IS NOT NULL
     GROUP BY apiKeyId`
  );
  const lifetimeUsageMap = {};
  for (const r of lifetimeUsageRows) lifetimeUsageMap[r.apiKeyId] = Number(r.used) || 0;

  const allKeys = db.all(`SELECT id, customerId, dailyTokenLimit, monthlyTokenLimit, lifetimeTokenLimit FROM apiKeys WHERE customerId IS NOT NULL`);
  const customerMaxPct = {};
  for (const k of allKeys) {
    const pcts = [];
    const dLimit = Number(k.dailyTokenLimit) || 0;
    if (dLimit > 0) pcts.push(Math.min(100, Math.round(((dailyUsageMap[k.id] || 0) / dLimit) * 100)));
    const mLimit = Number(k.monthlyTokenLimit) || 0;
    if (mLimit > 0) pcts.push(Math.min(100, Math.round(((monthlyUsageMap[k.id] || 0) / mLimit) * 100)));
    const lLimit = Number(k.lifetimeTokenLimit) || 0;
    if (lLimit > 0) pcts.push(Math.min(100, Math.round(((lifetimeUsageMap[k.id] || 0) / lLimit) * 100)));
    const maxPct = pcts.length > 0 ? Math.max(...pcts) : 0;
    if (!customerMaxPct[k.customerId] || maxPct > customerMaxPct[k.customerId]) {
      customerMaxPct[k.customerId] = maxPct;
    }
  }

  // 6. Spike detection: today cost vs avg of previous 7 days
  const todayCostRows = db.all(
    `SELECT k.customerId, COALESCE(SUM(u.cost), 0) AS costToday
     FROM usageHistory u INNER JOIN apiKeys k ON k.id = u.apiKeyId
     WHERE k.customerId IS NOT NULL AND u.timestamp >= ?
     GROUP BY k.customerId`,
    [dayStart.toISOString()]
  );
  const todayCostMap = {};
  for (const r of todayCostRows) todayCostMap[r.customerId] = Number(r.costToday) || 0;

  const prev7Start = new Date(dayStart.getTime() - 7 * 86400000);
  const prev7CostRows = db.all(
    `SELECT k.customerId, COALESCE(SUM(u.cost), 0) AS costPrev7
     FROM usageHistory u INNER JOIN apiKeys k ON k.id = u.apiKeyId
     WHERE k.customerId IS NOT NULL AND u.timestamp >= ? AND u.timestamp < ?
     GROUP BY k.customerId`,
    [prev7Start.toISOString(), dayStart.toISOString()]
  );
  const prev7CostMap = {};
  for (const r of prev7CostRows) prev7CostMap[r.customerId] = Number(r.costPrev7) || 0;

  // 7. Build result array
  const results = usageRows.map((r) => {
    const cust = custMap[r.customerId] || {};
    const maxPct = customerMaxPct[r.customerId] || 0;
    const costToday = todayCostMap[r.customerId] || 0;
    const costPrev7Avg = (prev7CostMap[r.customerId] || 0) / 7;
    const spikeRatio = costPrev7Avg > 0.001 ? Math.round((costToday / costPrev7Avg) * 10) / 10 : 0;

    let status = "ok";
    if (maxPct >= 95) status = "critical";
    else if (maxPct >= 80) status = "warn";
    if (spikeRatio >= 2 && status === "ok") status = "spike";

    return {
      customerId: r.customerId,
      email: cust.email || null,
      displayName: cust.displayName || null,
      costUsd: Number(r.costUsd) || 0,
      totalTokens: Number(r.totalTokens) || 0,
      requests: Number(r.requests) || 0,
      lastActiveAt: r.lastActiveAt || null,
      topProvider: topProvMap[r.customerId] || null,
      keysActive: keyCountMap[r.customerId]?.active || 0,
      keysTotal: keyCountMap[r.customerId]?.total || 0,
      maxKeyUsagePct: maxPct,
      spikeRatio,
      status,
    };
  });

  _cache.data = results;
  _cache.ts = Date.now();
  _cache.key = cacheKey;

  return buildResponse(results, { q, sortCol, order, limit, offset, nearLimitOnly });
}

function buildResponse(allResults, { q, sortCol, order, limit, offset, nearLimitOnly }) {
  let filtered = allResults;

  if (q) {
    filtered = filtered.filter((r) =>
      (r.email || "").toLowerCase().includes(q) ||
      (r.displayName || "").toLowerCase().includes(q)
    );
  }

  if (nearLimitOnly) {
    filtered = filtered.filter((r) => r.maxKeyUsagePct >= 80);
  }

  // Sort
  const sortFns = {
    cost: (a, b) => a.costUsd - b.costUsd,
    tokens: (a, b) => a.totalTokens - b.totalTokens,
    requests: (a, b) => a.requests - b.requests,
    lastActive: (a, b) => new Date(a.lastActiveAt || 0) - new Date(b.lastActiveAt || 0),
    spike: (a, b) => a.spikeRatio - b.spikeRatio,
  };
  const sortFn = sortFns[sortCol] || sortFns.cost;
  filtered.sort((a, b) => order === "asc" ? sortFn(a, b) : sortFn(b, a));

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);

  return NextResponse.json({ items, total, limit, offset });
}
