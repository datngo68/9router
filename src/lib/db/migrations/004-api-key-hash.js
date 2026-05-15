import crypto from "node:crypto";

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

// Rebuild apiKeys table to drop the legacy NOT NULL on `key`. Older DBs were
// created with `key TEXT UNIQUE NOT NULL` and SQLite cannot drop NOT NULL via
// ALTER COLUMN, so we reconstruct the table preserving every existing column
// and its data.
function ensureKeyColumnNullable(db) {
  const colInfo = db.all(`PRAGMA table_info(apiKeys)`);
  const keyCol = colInfo.find((c) => c.name === "key");
  if (!keyCol || keyCol.notnull !== 1) return; // already nullable

  const colNames = colInfo.map((c) => c.name);
  const colDefs = colInfo.map((c) => {
    let def = `${c.name} ${c.type}`;
    if (c.name === "id") def += " PRIMARY KEY";
    if (c.name === "key") {
      // intentionally drop NOT NULL and any UNIQUE — UNIQUE moves to keyHash
    } else if (c.notnull === 1) {
      def += " NOT NULL";
    }
    if (c.dflt_value !== null && c.dflt_value !== undefined && c.name !== "id") {
      def += ` DEFAULT ${c.dflt_value}`;
    }
    return def;
  });

  db.exec(`CREATE TABLE apiKeys_new (${colDefs.join(", ")})`);
  db.exec(`INSERT INTO apiKeys_new(${colNames.join(", ")}) SELECT ${colNames.join(", ")} FROM apiKeys`);
  db.exec(`DROP TABLE apiKeys`);
  db.exec(`ALTER TABLE apiKeys_new RENAME TO apiKeys`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)`);
}

export default {
  version: 4,
  name: "api-key-hash",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!cols.has("keyHash")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN keyHash TEXT`);
    }
    if (!cols.has("keyPrefix")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN keyPrefix TEXT`);
    }
    if (!cols.has("keyLast4")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN keyLast4 TEXT`);
    }

    const usageCols = new Set(db.all(`PRAGMA table_info(usageHistory)`).map((r) => r.name));
    if (!usageCols.has("apiKeyId")) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN apiKeyId TEXT`);
    }

    ensureKeyColumnNullable(db);

    // Backfill: for every apiKey row that still has plaintext `key`, compute
    // hash + prefix/last4. Then nullify the plaintext `key`. usageHistory rows
    // that referenced raw key get their apiKeyId resolved at the same time.
    const rows = db.all(`SELECT id, key FROM apiKeys WHERE key IS NOT NULL AND key != ''`);
    for (const r of rows) {
      const raw = r.key;
      const hash = sha256Hex(raw);
      const prefix = raw.slice(0, Math.min(7, raw.length));
      const last4 = raw.length >= 4 ? raw.slice(-4) : raw;

      db.run(`UPDATE apiKeys SET keyHash = ?, keyPrefix = ?, keyLast4 = ?, key = NULL WHERE id = ?`,
        [hash, prefix, last4, r.id]);

      // Backfill usageHistory.apiKeyId from raw key, then drop the plaintext.
      db.run(`UPDATE usageHistory SET apiKeyId = ? WHERE apiKey = ?`, [r.id, raw]);
    }

    // Wipe stray plaintext apiKey columns in usageHistory regardless of match.
    // Pre-launch: there shouldn't be real keys, but be safe.
    db.run(`UPDATE usageHistory SET apiKey = NULL WHERE apiKey IS NOT NULL`);

    // Indexes
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ak_keyhash ON apiKeys(keyHash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_apikeyid ON usageHistory(apiKeyId)`);
  },
};
