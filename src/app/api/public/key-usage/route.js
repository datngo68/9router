import { NextResponse } from "next/server";
import { getApiKeyByKey } from "@/lib/localDb";
import {
  getApiKeyDailyUsageSummary,
  getApiKeyMonthlyTokenUsage,
  getApiKeyLifetimeTokenUsage,
} from "@/lib/usageDb";
import { getAdapter } from "@/lib/db/driver.js";
import { consumeRequest } from "@/sse/services/apiKeyRateLimit.js";

export const dynamic = "force-dynamic";

// Public, key-only endpoint for the standalone tracker app
// (`f:\Tool\9router-tracker`). Anyone holding a valid API key can fetch its
// own usage by sending `Authorization: Bearer sk_xxx`. We do NOT expose
// admin/customer/billing data here — only what the key itself owns.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonWithCors(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function extractBearer(request) {
  const auth = request.headers.get("Authorization") || request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const xKey = request.headers.get("x-api-key");
  if (xKey) return xKey.trim();
  return null;
}

export async function GET(request) {
  const rawKey = extractBearer(request);
  if (!rawKey) {
    return jsonWithCors({ error: "Missing Authorization Bearer key" }, { status: 401 });
  }

  const keyRecord = await getApiKeyByKey(rawKey);
  if (!keyRecord) {
    return jsonWithCors({ error: "Invalid API key" }, { status: 401 });
  }

  // Anti-abuse: 30 req/min/key. Reuses the in-memory sliding window already
  // used by the SSE layer, but with its own bucket prefix so it does not
  // touch the user's actual chat-traffic counter.
  const rl = consumeRequest(`tracker:${keyRecord.id}`, 30, 60_000);
  if (!rl.allowed) {
    return jsonWithCors(
      { error: "Too many requests", retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const [daily, monthly, lifetime] = await Promise.all([
    getApiKeyDailyUsageSummary(keyRecord),
    getApiKeyMonthlyTokenUsage(keyRecord.id),
    getApiKeyLifetimeTokenUsage(keyRecord.id),
  ]);

  // Last 7 days breakdown — single key filter on `usageHistory`.
  const today = new Date();
  const periodDays = 7;
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (periodDays - 1));

  const db = await getAdapter();
  const rows = db.all(
    `SELECT timestamp, provider, model, promptTokens, completionTokens, cost
     FROM usageHistory
     WHERE apiKeyId = ? AND timestamp >= ?`,
    [keyRecord.id, cutoff.toISOString()]
  );

  const byDay = new Map();
  const byModel = new Map();
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalCost = 0;

  for (const r of rows) {
    const day = (r.timestamp || "").slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { day, promptTokens: 0, completionTokens: 0, cost: 0 });
    const dayEntry = byDay.get(day);
    dayEntry.promptTokens += r.promptTokens || 0;
    dayEntry.completionTokens += r.completionTokens || 0;
    dayEntry.cost += r.cost || 0;

    const mk = `${r.provider || "?"}/${r.model || "?"}`;
    if (!byModel.has(mk)) {
      byModel.set(mk, { provider: r.provider, model: r.model, fullId: mk, promptTokens: 0, completionTokens: 0, cost: 0, requests: 0 });
    }
    const me = byModel.get(mk);
    me.promptTokens += r.promptTokens || 0;
    me.completionTokens += r.completionTokens || 0;
    me.cost += r.cost || 0;
    me.requests += 1;

    totalPrompt += r.promptTokens || 0;
    totalCompletion += r.completionTokens || 0;
    totalCost += r.cost || 0;
  }

  const dayArr = [];
  for (let i = 0; i < periodDays; i++) {
    const d = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dayArr.push(byDay.get(key) || { day: key, promptTokens: 0, completionTokens: 0, cost: 0 });
  }

  // 10 most recent calls for a live "tail" view in the tracker UI.
  const recentRows = db.all(
    `SELECT timestamp, provider, model, promptTokens, completionTokens, cost, status
     FROM usageHistory
     WHERE apiKeyId = ?
     ORDER BY id DESC
     LIMIT 10`,
    [keyRecord.id]
  );

  return jsonWithCors({
    fetchedAt: new Date().toISOString(),
    key: {
      keyDisplay: keyRecord.keyDisplay,
      name: keyRecord.name || null,
      isActive: keyRecord.isActive !== false,
      paygEnabled: !!keyRecord.paygEnabled,
      expiresAt: keyRecord.expiresAt || null,
    },
    limits: {
      dailyTokenLimit: keyRecord.dailyTokenLimit || 0,
      monthlyTokenLimit: keyRecord.monthlyTokenLimit || 0,
      lifetimeTokenLimit: keyRecord.lifetimeTokenLimit || 0,
      requestsPerMinute: keyRecord.requestsPerMinute || 0,
      maxTokensPerRequest: keyRecord.maxTokensPerRequest || 0,
    },
    usage: {
      daily,
      monthly: {
        promptTokens: monthly.promptTokens,
        completionTokens: monthly.completionTokens,
        totalTokens: monthly.totalTokens,
        limit: keyRecord.monthlyTokenLimit || 0,
      },
      lifetime: {
        promptTokens: lifetime.promptTokens,
        completionTokens: lifetime.completionTokens,
        totalTokens: lifetime.totalTokens,
        limit: keyRecord.lifetimeTokenLimit || 0,
      },
    },
    last7d: {
      totals: {
        promptTokens: totalPrompt,
        completionTokens: totalCompletion,
        totalTokens: totalPrompt + totalCompletion,
        cost: totalCost,
      },
      byDay: dayArr,
      byModel: [...byModel.values()].sort(
        (a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens)
      ),
    },
    recent: recentRows.map((r) => ({
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      promptTokens: r.promptTokens || 0,
      completionTokens: r.completionTokens || 0,
      totalTokens: (r.promptTokens || 0) + (r.completionTokens || 0),
      cost: r.cost || 0,
      status: r.status || null,
    })),
  });
}
