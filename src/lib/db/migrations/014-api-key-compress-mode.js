export default {
  version: 14,
  name: "api-key-compress-mode",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!cols.has("rtkMode")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN rtkMode TEXT DEFAULT 'inherit'`);
    }
    if (!cols.has("cavemanMode")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN cavemanMode TEXT DEFAULT 'inherit'`);
    }
  },
};
