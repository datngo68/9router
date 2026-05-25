// Add custom rate-limit window + minute-grained plan expiry.
//
// - apiKeys.rateLimitWindowSec  : window size in seconds for requestsPerMinute
//                                  cap. NULL/0 → keep legacy 60s behavior.
// - pricingPlans.rateLimitWindowSec : same, copied into apiKey when an order
//                                  is fulfilled.
// - pricingPlans.expiresAfterMinutes : finer-grained expiry. When > 0, takes
//                                  precedence over expiresAfterDays at order
//                                  fulfillment time. Existing rows keep
//                                  expiresAfterDays semantics.
export default {
  version: 20,
  name: "rate-limit-window",
  up(db) {
    const apiKeysCols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!apiKeysCols.has("rateLimitWindowSec")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN rateLimitWindowSec INTEGER DEFAULT 0`);
    }

    const planCols = new Set(db.all(`PRAGMA table_info(pricingPlans)`).map((r) => r.name));
    if (!planCols.has("rateLimitWindowSec")) {
      db.exec(`ALTER TABLE pricingPlans ADD COLUMN rateLimitWindowSec INTEGER DEFAULT 0`);
    }
    if (!planCols.has("expiresAfterMinutes")) {
      db.exec(`ALTER TABLE pricingPlans ADD COLUMN expiresAfterMinutes INTEGER DEFAULT 0`);
    }
  },
};
