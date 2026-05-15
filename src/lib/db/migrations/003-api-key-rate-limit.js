export default {
  version: 3,
  name: "api-key-rate-limit",
  up(db) {
    const existing = db.all(`PRAGMA table_info(apiKeys)`);
    const columns = new Set(existing.map((row) => row.name));

    if (!columns.has("requestsPerMinute")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN requestsPerMinute INTEGER DEFAULT 0`);
    }
    if (!columns.has("maxTokensPerRequest")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN maxTokensPerRequest INTEGER DEFAULT 0`);
    }
  },
};
