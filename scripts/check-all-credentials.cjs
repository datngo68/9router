// Verify ALL connections decrypt successfully and report any that don't.
// Read-only — does not modify DB.

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
const keyFile = path.join(DATA_DIR, "secret-key");
const secretKey = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");

function decrypt(value) {
  if (!value || !value.startsWith("enc:v1:")) return value;
  const parts = value.split(":");
  const iv = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const tag = Buffer.from(parts[4], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

const db = new Database(dbPath, { readonly: true });
const conns = db.prepare("SELECT id, provider, name, email, data, isActive FROM providerConnections ORDER BY provider, name").all();

const ENC_TOP = ["apiKey", "accessToken", "refreshToken"];
const ENC_SUB = ["copilotToken", "cookieValue", "azureKey", "cloudflareApiKey"];

let okCount = 0;
let failCount = 0;
const failures = [];

for (const c of conns) {
  let parsed;
  try { parsed = JSON.parse(c.data); } catch { continue; }
  const issues = [];

  for (const f of ENC_TOP) {
    if (typeof parsed[f] === "string" && parsed[f].startsWith("enc:v1:")) {
      try { decrypt(parsed[f]); } catch (e) { issues.push(`${f}: ${e.message}`); }
    }
  }
  if (parsed.providerSpecificData && typeof parsed.providerSpecificData === "object") {
    for (const f of ENC_SUB) {
      const v = parsed.providerSpecificData[f];
      if (typeof v === "string" && v.startsWith("enc:v1:")) {
        try { decrypt(v); } catch (e) { issues.push(`providerSpecificData.${f}: ${e.message}`); }
      }
    }
  }

  // Also report stale lock state — these will block use until cleared/refreshed
  const lockKeys = Object.keys(parsed).filter((k) => k.startsWith("modelLock_") && parsed[k]);
  const errorCode = parsed.errorCode;
  const testStatus = parsed.testStatus;

  if (issues.length > 0) {
    failCount++;
    failures.push({ id: c.id, provider: c.provider, name: c.name || c.email, issues });
  } else {
    okCount++;
  }

  console.log(`[${c.isActive ? "ON " : "OFF"}] ${c.provider.padEnd(15)} ${(c.name || c.email || c.id.slice(0, 8)).padEnd(35)} ${issues.length === 0 ? "✓" : "✗"} ${testStatus || "-"} err=${errorCode || "-"} locks=${lockKeys.length}`);
}

console.log(`\nTotal: ${okCount} OK, ${failCount} fail, ${conns.length} total`);
if (failures.length > 0) {
  console.log("\nFailures detail:");
  for (const f of failures) console.log(`  ${f.provider}/${f.name}:`, f.issues);
}

db.close();
