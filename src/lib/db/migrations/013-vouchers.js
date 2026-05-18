// Voucher / discount system.
//
// vouchers: master table of discount codes the admin creates.
//   - kind = 'percent' (value = 0..100) or 'fixed' (value = VND amount).
//   - scopePlanIds: JSON array of pricingPlan IDs the voucher applies to.
//     [] (empty) is treated as "no plans" — admin must explicitly pick at
//     least one plan, matching the "by_plan" UX choice.
//   - maxUses / maxPerCustomer: 0 = unlimited.
//   - validFrom / validTo: nullable ISO timestamps.
//   - minOrderVnd: 0 = no minimum.
//   - firstOrderOnly: 1 = only customers with zero prior orders may redeem.
//   - usedCount: denormalized, kept in sync inside the redeem transaction so
//     the admin list can show usage without a separate COUNT() query.
//
// voucherRedemptions: append-only ledger. UNIQUE(voucherId, orderId) ensures
// idempotency — a single order can never consume the same voucher twice
// (defense in depth against retry/race scenarios).
//
// orders: keep the original price separate so we can audit discounts later
// without joining vouchers (it might be deleted by the admin one day).

export default {
  version: 13,
  name: "vouchers",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vouchers (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        description TEXT,
        kind TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        scopePlanIds TEXT NOT NULL DEFAULT '[]',
        maxUses INTEGER NOT NULL DEFAULT 0,
        maxPerCustomer INTEGER NOT NULL DEFAULT 0,
        usedCount INTEGER NOT NULL DEFAULT 0,
        validFrom TEXT,
        validTo TEXT,
        minOrderVnd INTEGER NOT NULL DEFAULT 0,
        firstOrderOnly INTEGER NOT NULL DEFAULT 0,
        isActive INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_voucher_active ON vouchers(isActive)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_voucher_code ON vouchers(code)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS voucherRedemptions (
        id TEXT PRIMARY KEY,
        voucherId TEXT NOT NULL,
        customerId TEXT NOT NULL,
        orderId TEXT NOT NULL,
        discountVnd INTEGER NOT NULL DEFAULT 0,
        redeemedAt TEXT NOT NULL,
        UNIQUE(voucherId, orderId)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vr_voucher ON voucherRedemptions(voucherId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vr_customer ON voucherRedemptions(customerId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vr_voucher_customer ON voucherRedemptions(voucherId, customerId)`);

    const cols = new Set(db.all(`PRAGMA table_info(orders)`).map((r) => r.name));
    const add = (name, sql) => {
      if (!cols.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${sql}`);
    };
    // originalPriceVnd preserves what the plan would have cost without the
    // voucher; priceVnd is what the customer actually owes. Backfill old rows
    // to keep priceVnd === originalPriceVnd so reports don't break.
    add("originalPriceVnd", "INTEGER");
    add("discountVnd", "INTEGER NOT NULL DEFAULT 0");
    add("voucherId", "TEXT");
    add("voucherCode", "TEXT");

    db.exec(`UPDATE orders SET originalPriceVnd = priceVnd WHERE originalPriceVnd IS NULL`);
  },
};
