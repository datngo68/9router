// AES-256-GCM at-rest encryption for sensitive provider credentials.
//
// Keys are derived from a 32-byte secret persisted at `data/secret-key`. The
// file is created on first use with mode 0o600 (Unix; Windows ACL is the OS
// default — document this in README). If `SECRET_KEY` env var is set, that
// value is used instead and no file is written.
//
// Encrypted values are stored as the string:
//
//   enc:v1:<base64url(iv)>:<base64url(ciphertext)>:<base64url(authTag)>
//
// The "enc:v1:" prefix lets read paths detect already-encrypted vs legacy
// plaintext values during the migration window.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";
import { writeSecretFile, tightenFileMode } from "@/lib/security/filePerms";

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "enc:v1:";

let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  const envKey = process.env.SECRET_KEY;
  if (envKey) {
    const buf = envKey.length === 64
      ? Buffer.from(envKey, "hex")           // hex-encoded 32 bytes
      : Buffer.from(envKey, "base64url");     // base64url-encoded
    if (buf.length !== KEY_LEN) {
      throw new Error(`SECRET_KEY must decode to ${KEY_LEN} bytes (got ${buf.length})`);
    }
    cachedKey = buf;
    return cachedKey;
  }

  const file = path.join(DATA_DIR, "secret-key");
  try {
    const hex = fs.readFileSync(file, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length === KEY_LEN) {
      cachedKey = buf;
      tightenFileMode(file);
      return cachedKey;
    }
  } catch {}

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(KEY_LEN);
  writeSecretFile(file, generated.toString("hex"));
  cachedKey = generated;
  return cachedKey;
}

/**
 * True iff the value is in the recognized envelope format.
 */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Encrypt a string. Returns the envelope. Returns the input unchanged for
 * empty/null/undefined values (no point encrypting an empty secret) and for
 * non-strings (caller is expected to pass strings).
 */
export function encryptString(plaintext) {
  if (plaintext == null || plaintext === "") return plaintext;
  if (typeof plaintext !== "string") return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted, idempotent

  const key = loadKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
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

/**
 * Decrypt an envelope. Returns the input unchanged if it is not in the
 * envelope format (legacy plaintext).
 *
 * Throws on tag mismatch — that means the value was tampered with or the
 * key changed; we'd rather fail loud than silently return garbage.
 */
export function decryptString(value) {
  if (value == null || value === "") return value;
  if (typeof value !== "string") return value;
  if (!isEncrypted(value)) return value;

  const parts = value.split(":");
  // ["enc", "v1", iv, ct, tag]
  if (parts.length !== 5) {
    throw new Error("Malformed encrypted envelope");
  }
  const iv = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const tag = Buffer.from(parts[4], "base64url");
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error("Encrypted envelope has invalid IV or tag length");
  }
  const key = loadKey();
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}

// Test/CLI helper.
export function _resetKeyCache() {
  cachedKey = null;
}
