// Run pending migrations 4-8 against the production DB to bring schema from 3
// to 8. Safe to re-run: each migration is idempotent (skips columns/rows that
// already exist or are already in the target shape).
//
// Usage: node scripts/run-migrations.cjs

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");

const APP_NAME = "9router";

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

const DATA_DIR = resolveDataDir();
const dbPath = path.join(DATA_DIR, "db", "data.sqlite");
console.log("DB:", dbPath);
console.log("DATA_DIR:", DATA_DIR);

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

function getSchemaVersion() {
  const row = db.prepare("SELECT value FROM _meta WHERE key = 'schemaVersion'").get();
  return parseInt(row?.value || "0", 10) || 0;
}
function setSchemaVersion(v) {
  db.prepare("INSERT INTO _meta(key, value) VALUES('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(v));
}

const startVersion = getSchemaVersion();
console.log("Current schemaVersion:", startVersion);

// ─── Migration 4: api-key-hash ───────────────────────────────────────────
function migration4() {
  const cols = new Set(db.prepare("PRAGMA table_info(apiKeys)").all().map((r) => r.name));
  if (!cols.has("keyHash")) db.exec("ALTER TABLE apiKeys ADD COLUMN keyHash TEXT");
  if (!cols.has("keyPrefix")) db.exec("ALTER TABLE apiKeys ADD COLUMN keyPrefix TEXT");
  if (!cols.has("keyLast4")) db.exec("ALTER TABLE apiKeys ADD COLUMN keyLast4 TEXT");

  const usageCols = new Set(db.prepare("PRAGMA table_info(usageHistory)").all().map((r) => r.name));
  if (!usageCols.has("apiKeyId")) db.exec("ALTER TABLE usageHistory ADD COLUMN apiKeyId TEXT");

  // Old schema declared `key TEXT UNIQUE NOT NULL`. SQLite doesn't allow
  // dropping NOT NULL via ALTER COLUMN, so we rebuild the table when needed.
  const apiKeyColInfo = db.prepare("PRAGMA table_info(apiKeys)").all();
  const keyCol = apiKeyColInfo.find((c) => c.name === "key");
  if (keyCol && keyCol.notnull === 1) {
    console.log("  rebuilding apiKeys to drop NOT NULL on `key`");
    // Build the new column list dynamically so we preserve every column the
    // current DB has (post Phase 1.1 sync may have added requestsPerMinute etc.).
    const colNames = apiKeyColInfo.map((c) => c.name);
    const colDefs = apiKeyColInfo.map((c) => {
      let def = `${c.name} ${c.type}`;
      if (c.name === "id") def += " PRIMARY KEY";
      if (c.name === "key") {
        // drop NOT NULL, keep TEXT; UNIQUE will be re-added below if it existed
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
    // Re-create indexes
    db.exec("CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)");
  }

  const rows = db.prepare("SELECT id, key FROM apiKeys WHERE key IS NOT NULL AND key != ''").all();
  console.log(`  scanning ${rows.length} apiKeys for hash backfill`);
  for (const r of rows) {
    const hash = crypto.createHash("sha256").update(String(r.key)).digest("hex");
    const prefix = r.key.slice(0, Math.min(7, r.key.length));
    const last4 = r.key.length >= 4 ? r.key.slice(-4) : r.key;
    db.prepare("UPDATE apiKeys SET keyHash = ?, keyPrefix = ?, keyLast4 = ?, key = NULL WHERE id = ?").run(hash, prefix, last4, r.id);
    db.prepare("UPDATE usageHistory SET apiKeyId = ? WHERE apiKey = ?").run(r.id, r.key);
  }
  // Wipe stray plaintext apiKey columns in usageHistory regardless of match.
  db.prepare("UPDATE usageHistory SET apiKey = NULL WHERE apiKey IS NOT NULL").run();

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_ak_keyhash ON apiKeys(keyHash)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_uh_apikeyid ON usageHistory(apiKeyId)");
}

// ─── Migration 5: encrypt-credentials ────────────────────────────────────
function loadEncryptionKey() {
  if (process.env.SECRET_KEY) {
    const buf = process.env.SECRET_KEY.length === 64
      ? Buffer.from(process.env.SECRET_KEY, "hex")
      : Buffer.from(process.env.SECRET_KEY, "base64url");
    if (buf.length === 32) return buf;
  }
  const file = path.join(DATA_DIR, "secret-key");
  try {
    const hex = fs.readFileSync(file, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length === 32) return buf;
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(file, generated.toString("hex"), { mode: 0o600 });
  console.log("  generated new secret-key at", file);
  return generated;
}

function encryptString(plaintext, key) {
  if (!plaintext || typeof plaintext !== "string") return plaintext;
  if (plaintext.startsWith("enc:v1:")) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["enc:v1:", iv.toString("base64url"), ":", enc.toString("base64url"), ":", tag.toString("base64url")].join("");
}

function migration5() {
  const key = loadEncryptionKey();
  const ENC_TOP = ["apiKey", "accessToken", "refreshToken"];
  const ENC_SUB = ["copilotToken", "cookieValue", "azureKey", "cloudflareApiKey"];
  const rows = db.prepare("SELECT id, data FROM providerConnections").all();
  console.log(`  scanning ${rows.length} providerConnections for encryption`);
  for (const r of rows) {
    let parsed;
    try { parsed = JSON.parse(r.data || "{}"); } catch { continue; }
    let dirty = false;
    for (const f of ENC_TOP) {
      if (typeof parsed[f] === "string" && parsed[f] && !parsed[f].startsWith("enc:v1:")) {
        parsed[f] = encryptString(parsed[f], key);
        dirty = true;
      }
    }
    if (parsed.providerSpecificData && typeof parsed.providerSpecificData === "object") {
      for (const f of ENC_SUB) {
        const v = parsed.providerSpecificData[f];
        if (typeof v === "string" && v && !v.startsWith("enc:v1:")) {
          parsed.providerSpecificData[f] = encryptString(v, key);
          dirty = true;
        }
      }
    }
    if (dirty) {
      db.prepare("UPDATE providerConnections SET data = ? WHERE id = ?").run(JSON.stringify(parsed), r.id);
    }
  }
}

// ─── Migration 6: monthly + lifetime caps ────────────────────────────────
function migration6() {
  const cols = new Set(db.prepare("PRAGMA table_info(apiKeys)").all().map((r) => r.name));
  if (!cols.has("monthlyTokenLimit")) db.exec("ALTER TABLE apiKeys ADD COLUMN monthlyTokenLimit INTEGER DEFAULT 0");
  if (!cols.has("lifetimeTokenLimit")) db.exec("ALTER TABLE apiKeys ADD COLUMN lifetimeTokenLimit INTEGER DEFAULT 0");
}

// ─── Migration 7: ip allowlist ───────────────────────────────────────────
function migration7() {
  const cols = new Set(db.prepare("PRAGMA table_info(apiKeys)").all().map((r) => r.name));
  if (!cols.has("allowedIps")) db.exec("ALTER TABLE apiKeys ADD COLUMN allowedIps TEXT DEFAULT '[]'");
}

// ─── Migration 8: keyAuditLog ────────────────────────────────────────────
function migration8() {
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_kal_keyid ON keyAuditLog(keyId)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_kal_ts ON keyAuditLog(timestamp DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_kal_action ON keyAuditLog(action)");
}

const migrations = [
  { v: 4, name: "api-key-hash", fn: migration4 },
  { v: 5, name: "encrypt-credentials", fn: migration5 },
  { v: 6, name: "api-key-monthly-lifetime", fn: migration6 },
  { v: 7, name: "api-key-ip-allowlist", fn: migration7 },
  { v: 8, name: "key-audit-log", fn: migration8 },
];

const runOne = db.transaction((m) => {
  m.fn();
  setSchemaVersion(m.v);
});

for (const m of migrations) {
  if (m.v <= startVersion) continue;
  console.log(`Applying #${m.v} ${m.name}…`);
  runOne(m);
  console.log(`  → schemaVersion = ${m.v}`);
}

console.log("\nDone. New schemaVersion:", getSchemaVersion());
db.close();
