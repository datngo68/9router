// Migration 015: notifications + notificationReads tables.
// notifications.customerId is nullable -> NULL means broadcast (all customers).
// notificationReads tracks per-customer read state for both targeted and
// broadcast rows; PK (notificationId, customerId) keeps it idempotent.

export default {
  version: 15,
  name: "notifications",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        customerId TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        link TEXT,
        channels TEXT DEFAULT '[]',
        createdAt TEXT NOT NULL,
        createdBy TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notif_cust ON notifications(customerId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(createdAt DESC)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS notificationReads (
        notificationId TEXT NOT NULL,
        customerId TEXT NOT NULL,
        readAt TEXT NOT NULL,
        PRIMARY KEY (notificationId, customerId)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nread_cust ON notificationReads(customerId)`);
  },
};
