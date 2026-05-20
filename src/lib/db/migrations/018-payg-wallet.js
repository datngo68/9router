// Migration 018: Pay-as-you-go (PAYG) wallet.
//
// Adds VND-denominated wallet balance to customers as a fallback billing
// mechanism when plan-based token quotas are exhausted. Balance is stored as
// micro-VND (1 VND = 1_000_000 micro) to keep everything integer-only and
// avoid floating-point drift across the hot path.
//
// New columns:
//   customers.balance           micro-VND credit (default 0).
//   customers.balanceMinLimit   micro-VND floor (default 0; can be negative
//                               to allow overdraft to a configured limit).
//   apiKeys.paygEnabled         per-key opt-in for falling back to wallet
//                               when quota runs out (default 0 = disabled).
//   orders.kind                 'plan' | 'walletTopup' (default 'plan').
//                               When 'walletTopup', planId is null and the
//                               webhook flow credits the wallet instead of
//                               creating an apiKey.
//
// New table:
//   walletTransactions  append-only ledger. delta is signed micro-VND
//                       (positive = credit, negative = debit). balanceAfter
//                       is captured atomically inside the same transaction
//                       that updates customers.balance, so an admin can
//                       eyeball ordering without a CTE.

export default {
  version: 18,
  name: "payg-wallet",
  up(db) {
    // ── customers ────────────────────────────────────────────────────────
    const customerCols = new Set(db.all(`PRAGMA table_info(customers)`).map((r) => r.name));
    if (!customerCols.has("balance")) {
      db.exec(`ALTER TABLE customers ADD COLUMN balance INTEGER NOT NULL DEFAULT 0`);
    }
    if (!customerCols.has("balanceMinLimit")) {
      db.exec(`ALTER TABLE customers ADD COLUMN balanceMinLimit INTEGER NOT NULL DEFAULT 0`);
    }

    // ── apiKeys ──────────────────────────────────────────────────────────
    const apiKeyCols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!apiKeyCols.has("paygEnabled")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN paygEnabled INTEGER NOT NULL DEFAULT 0`);
    }

    // ── orders.kind ──────────────────────────────────────────────────────
    const orderCols = new Set(db.all(`PRAGMA table_info(orders)`).map((r) => r.name));
    if (!orderCols.has("kind")) {
      db.exec(`ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'plan'`);
    }
    db.exec(`UPDATE orders SET kind = 'plan' WHERE kind IS NULL OR kind = ''`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ord_kind ON orders(kind)`);

    // ── walletTransactions (append-only ledger) ──────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS walletTransactions (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        apiKeyId TEXT,
        delta INTEGER NOT NULL,
        balanceAfter INTEGER NOT NULL,
        type TEXT NOT NULL,
        refType TEXT,
        refId TEXT,
        provider TEXT,
        model TEXT,
        promptTokens INTEGER DEFAULT 0,
        completionTokens INTEGER DEFAULT 0,
        meta TEXT,
        createdAt TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wt_customer ON walletTransactions(customerId, createdAt DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wt_apikey ON walletTransactions(apiKeyId, createdAt DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wt_type ON walletTransactions(type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wt_ref ON walletTransactions(refType, refId)`);

    // Partial index for the low-balance cron tick. Only indexes rows whose
    // balance is below 100k VND (= 1e11 micro), keeping the index tiny while
    // covering every customer that could possibly trigger a notification at
    // realistic threshold settings.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cust_low_balance ON customers(balance) WHERE balance < 100000000000`);
  },
};
