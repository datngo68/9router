// Encrypts existing provider credentials at rest.
//
// Reads each row of providerConnections, parses the JSON `data` blob,
// encrypts known credential fields if they are still in plaintext, and
// writes the row back. Idempotent: encryptString() short-circuits if a
// value is already in `enc:v1:` form.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const APP_NAME = "9router";

// Mirror src/lib/dataDir.js exactly so migration and runtime always agree on
// where to read/write `secret-key`. Earlier versions of this migration used
// `process.cwd()/data` as the fallback, which on Windows runtime resolves to
// `%APPDATA%/9router` and on POSIX runtime to `~/.9router` — leading to a
// silently mismatched key after migration. We must be defensive here because
// `@/lib/dataDir` cannot be imported safely during cold migration.
function resolveDataDir() {
  const configured = process.env.DATA_DIR;
  if (configured) {
    try {
      fs.mkdirSync(configured, { recursive: true });
      return configured;
    } catch (e) {
      // Fall through to default.
      if (!(e?.code === "EACCES" || e?.code === "EPERM")) throw e;
    }
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function loadKey() {
  const envKey = process.env.SECRET_KEY;
  if (envKey) {
    const buf = envKey.length === 64
      ? Buffer.from(envKey, "hex")
      : Buffer.from(envKey, "base64url");
    if (buf.length === 32) return buf;
  }

  const dataDir = resolveDataDir();
  const file = path.join(dataDir, "secret-key");
  try {
    const hex = fs.readFileSync(file, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length === 32) return buf;
  } catch {}

  fs.mkdirSync(dataDir, { recursive: true });
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(file, generated.toString("hex"), { mode: 0o600 });
  console.warn(
    `\n[migration:005] secret-key auto-generated at ${file}.\n` +
    "  Back this file up alongside your DB — losing it makes encrypted credentials unrecoverable.\n" +
    "  For multi-host deploys, set SECRET_KEY env to a 32-byte hex/base64url value instead.\n"
  );
  return generated;
}

function encryptString(plaintext, key) {
  if (!plaintext || typeof plaintext !== "string") return plaintext;
  if (plaintext.startsWith("enc:v1:")) return plaintext; // already encrypted

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "enc:v1:",
    iv.toString("base64url"),
    ":",
    enc.toString("base64url"),
    ":",
    tag.toString("base64url"),
  ].join("");
}

const ENC_TOP = ["apiKey", "accessToken", "refreshToken"];
const ENC_SUB = ["copilotToken", "cookieValue", "azureKey", "cloudflareApiKey"];

export default {
  version: 5,
  name: "encrypt-credentials",
  up(db) {
    const key = loadKey();
    const rows = db.all(`SELECT id, data FROM providerConnections`);
    for (const r of rows) {
      let parsed;
      try { parsed = JSON.parse(r.data || "{}"); }
      catch { continue; }

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
        db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [JSON.stringify(parsed), r.id]);
      }
    }
  },
};
