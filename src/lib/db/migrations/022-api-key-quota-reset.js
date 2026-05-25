// Migration 022: per-apiKey quota reset timestamp.
//
// When an order tops up / renews an existing apiKey (orders.targetApiKeyId
// set), we replace the policy fields. Without resetting usage counters,
// the daily/monthly/lifetime totals still include consumption from BEFORE
// the renewal — so a customer who topped up a 100k/day plan after burning
// 80k today would only get 20k of headroom from the new plan.
//
// quotaResetAt = ISO timestamp of the most recent renewal. Usage queries
// (getApiKeyDailyTokenUsage / Monthly / Lifetime) use it as a lower bound
// when present. NULL = never renewed → falls back to the legacy windows.
export default {
  version: 22,
  name: "api-key-quota-reset",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!cols.has("quotaResetAt")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN quotaResetAt TEXT`);
    }
  },
};
