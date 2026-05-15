export default {
  version: 6,
  name: "api-key-monthly-lifetime",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!cols.has("monthlyTokenLimit")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN monthlyTokenLimit INTEGER DEFAULT 0`);
    }
    if (!cols.has("lifetimeTokenLimit")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN lifetimeTokenLimit INTEGER DEFAULT 0`);
    }
  },
};
