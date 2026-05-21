// Add allowedProviders and allowedConnectionIds columns to apiKeys table.
// Allows admin to restrict which providers/connections a key can use.
export default {
  version: 19,
  name: "api-key-provider-binding",
  up(db) {
    db.exec(`ALTER TABLE apiKeys ADD COLUMN allowedProviders TEXT DEFAULT '[]'`);
    db.exec(`ALTER TABLE apiKeys ADD COLUMN allowedConnectionIds TEXT DEFAULT '[]'`);
  },
};
