export default {
  version: 7,
  name: "api-key-ip-allowlist",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!cols.has("allowedIps")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN allowedIps TEXT DEFAULT '[]'`);
    }
  },
};
