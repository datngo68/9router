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
const db = new Database(dbPath, { readonly: true });

console.log("=== _meta ===");
console.log(db.prepare("SELECT * FROM _meta").all());

console.log("\n=== counts ===");
console.log({
  providerConnections: db.prepare("SELECT COUNT(*) AS n FROM providerConnections").get().n,
  apiKeys: db.prepare("SELECT COUNT(*) AS n FROM apiKeys").get().n,
  combos: db.prepare("SELECT COUNT(*) AS n FROM combos").get().n,
  providerNodes: db.prepare("SELECT COUNT(*) AS n FROM providerNodes").get().n,
  keyAuditLog: db.prepare("SELECT COUNT(*) AS n FROM keyAuditLog").get().n,
  usageHistoryWithApiKeyId: db.prepare("SELECT COUNT(*) AS n FROM usageHistory WHERE apiKeyId IS NOT NULL").get().n,
});

console.log("\n=== sample apiKey row ===");
const ak = db.prepare("SELECT id, name, keyHash, keyPrefix, keyLast4, key FROM apiKeys LIMIT 1").get();
console.log(ak);

console.log("\n=== test decryption ===");
const keyFile = path.join(DATA_DIR, "secret-key");
const secretKey = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");
console.log("secret-key bytes:", secretKey.length);

function decrypt(value) {
  const parts = value.split(":");
  const iv = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const tag = Buffer.from(parts[4], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

const conns = db.prepare("SELECT id, provider, name, data FROM providerConnections LIMIT 3").all();
for (const c of conns) {
  const parsed = JSON.parse(c.data);
  console.log(`\n  ${c.provider}/${c.name}:`);
  for (const f of ["apiKey", "accessToken", "refreshToken"]) {
    if (parsed[f]) {
      const isEnc = String(parsed[f]).startsWith("enc:v1:");
      if (isEnc) {
        try {
          const dec = decrypt(parsed[f]);
          console.log(`    ${f}: ✓ decrypted ${dec.length} chars (${dec.slice(0, 8)}...${dec.slice(-4)})`);
        } catch (e) {
          console.log(`    ${f}: ✗ DECRYPT FAILED (${e.message})`);
        }
      } else {
        console.log(`    ${f}: ⚠ plaintext`);
      }
    }
  }
}

db.close();
