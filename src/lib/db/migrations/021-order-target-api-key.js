// Migration 021: Per-key renewal — order can re-policy an existing apiKey
// instead of provisioning a new one.
//
// Until now every paid plan order minted a fresh apiKey via planToApiKeyPolicy.
// Customers asked for two related things:
//   1. Renew an existing PAYG/plan key with fresh quota + new expiry without
//      losing keyHash (and therefore breaking integrations that already
//      hard-coded the key).
//   2. Switch a key to a different plan without rotating credentials.
//
// Adds:
//   orders.targetApiKeyId  TEXT — when set, confirmOrderAtomic re-applies the
//                                plan's policy to the existing key (replace
//                                semantics: quota/expiry/allowedModels become
//                                exactly the plan values; identity fields
//                                stay). Nullable for back-compat with all
//                                existing rows.
//
// Index keeps admin lookups by key fast (rare, but useful for support flows).

export default {
  version: 21,
  name: "order-target-api-key",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(orders)`).map((r) => r.name));
    if (!cols.has("targetApiKeyId")) {
      db.exec(`ALTER TABLE orders ADD COLUMN targetApiKeyId TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ord_target_apikey ON orders(targetApiKeyId)`);
  },
};
