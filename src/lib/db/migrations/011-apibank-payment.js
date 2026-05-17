// APIBank automated payment integration.
//   - orders: track the parallel APIBank order so we can render the right QR
//     and reconcile webhook events back to a 9router order.
//   - apibankWebhookEvents: dedupe table — APIBank may resend a webhook on
//     timeout, we MUST process each evt.id at most once.

export default {
  version: 11,
  name: "apibank-payment",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(orders)`).map((r) => r.name));
    const add = (name, sql) => {
      if (!cols.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${sql}`);
    };

    add("apibankOrderId", "TEXT");
    add("apibankCode", "TEXT");
    add("apibankExpiredAt", "TEXT");

    db.exec(`CREATE INDEX IF NOT EXISTS idx_ord_apibank_code ON orders(apibankCode)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ord_apibank_id ON orders(apibankOrderId)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS apibankWebhookEvents (
        eventId TEXT PRIMARY KEY,
        orderId TEXT,
        type TEXT,
        receivedAt TEXT NOT NULL,
        processedAt TEXT
      )
    `);
  },
};
