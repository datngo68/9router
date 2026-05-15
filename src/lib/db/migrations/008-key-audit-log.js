export default {
  version: 8,
  name: "key-audit-log",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS keyAuditLog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        keyId TEXT,
        action TEXT NOT NULL,
        actorIp TEXT,
        metadata TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kal_keyid ON keyAuditLog(keyId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kal_ts ON keyAuditLog(timestamp DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kal_action ON keyAuditLog(action)`);
  },
};
