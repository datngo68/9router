// Migration 023: relax orders.planId NOT NULL constraint.
//
// orders table was originally created with `planId TEXT NOT NULL` (migration
// 009) because every order back then was tied to a pricing plan. Migration
// 018 introduced `kind = 'walletTopup'` orders that have no plan — but
// `createTopupOrder` was attempting to INSERT planId = NULL into that NOT
// NULL column, throwing a constraint error that surfaced as the generic
// "Tạo đơn nạp ví thất bại" 400 in the UI.
//
// SQLite can't drop NOT NULL via ALTER COLUMN, so we follow the standard
// recipe: create a new table with the relaxed schema, copy rows, drop the
// old, rename the new. Indexes are recreated by syncSchemaFromTables() that
// runs right after the migrator.
//
// Idempotent guard: only rebuild if planId is still NOT NULL.
export default {
  version: 23,
  name: "orders-planid-nullable",
  up(db) {
    const cols = db.all(`PRAGMA table_info(orders)`);
    const planIdCol = cols.find((c) => c.name === "planId");
    if (!planIdCol || planIdCol.notnull === 0) return;

    db.exec(`
      CREATE TABLE orders_new (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        planId TEXT,
        kind TEXT NOT NULL DEFAULT 'plan',
        status TEXT NOT NULL DEFAULT 'pending',
        priceVnd INTEGER NOT NULL DEFAULT 0,
        originalPriceVnd INTEGER,
        discountVnd INTEGER NOT NULL DEFAULT 0,
        voucherId TEXT,
        voucherCode TEXT,
        paymentMethod TEXT,
        paymentRef TEXT,
        apiKeyId TEXT,
        targetApiKeyId TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        paidAt TEXT,
        deliveredAt TEXT,
        cancelledAt TEXT,
        refundedAt TEXT,
        apibankOrderId TEXT,
        apibankCode TEXT,
        apibankExpiredAt TEXT
      )
    `);

    // Copy whatever columns exist on the legacy table. Columns absent on the
    // old table will simply default to NULL on the new one.
    const have = (n) => cols.some((c) => c.name === n);
    const colList = [
      "id", "customerId", "planId",
      have("kind") ? "kind" : "'plan'",
      "status", "priceVnd",
      have("originalPriceVnd") ? "originalPriceVnd" : "priceVnd",
      have("discountVnd") ? "discountVnd" : "0",
      have("voucherId") ? "voucherId" : "NULL",
      have("voucherCode") ? "voucherCode" : "NULL",
      "paymentMethod", "paymentRef", "apiKeyId",
      have("targetApiKeyId") ? "targetApiKeyId" : "NULL",
      "notes", "createdAt", "paidAt", "deliveredAt", "cancelledAt", "refundedAt",
      have("apibankOrderId") ? "apibankOrderId" : "NULL",
      have("apibankCode") ? "apibankCode" : "NULL",
      have("apibankExpiredAt") ? "apibankExpiredAt" : "NULL",
    ];
    db.exec(
      `INSERT INTO orders_new(
        id, customerId, planId, kind, status, priceVnd, originalPriceVnd,
        discountVnd, voucherId, voucherCode, paymentMethod, paymentRef,
        apiKeyId, targetApiKeyId, notes, createdAt, paidAt, deliveredAt,
        cancelledAt, refundedAt, apibankOrderId, apibankCode, apibankExpiredAt
      ) SELECT ${colList.join(", ")} FROM orders`
    );
    db.exec(`DROP TABLE orders`);
    db.exec(`ALTER TABLE orders_new RENAME TO orders`);
    // Indexes get recreated by syncSchemaFromTables() right after migrations.
  },
};
