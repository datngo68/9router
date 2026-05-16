// Reset/verify tokens for customer email flows. Stateless HMAC tokens that
// embed customerId + purpose + expiry; no DB table needed.

import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import fs from "node:fs";
import path from "node:path";

let cachedSecret = null;

function loadSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.JWT_SECRET) {
    cachedSecret = process.env.JWT_SECRET;
    return cachedSecret;
  }
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
    return cachedSecret;
  } catch {}
  // Fallback: generate (matches dashboardSession behaviour)
  fs.mkdirSync(DATA_DIR, { recursive: true });
  cachedSecret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  return cachedSecret;
}

function sign(payload) {
  return crypto.createHmac("sha256", loadSecret()).update(payload).digest("base64url");
}

/**
 * Create a token for a one-shot purpose (e.g. password-reset, email-verify).
 * Format: <base64url(payload)>.<base64url(hmac)>
 *
 * payload = JSON {cid, purpose, exp}
 */
export function createCustomerToken(customerId, purpose, ttlMs = 3600 * 1000) {
  if (!customerId || !purpose) throw new Error("customerId and purpose are required");
  const payload = {
    cid: customerId,
    purpose,
    exp: Date.now() + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(body);
  return `${body}.${sig}`;
}

/**
 * Verify and parse a token. Returns { customerId, purpose } on success or
 * null if invalid / expired.
 */
export function verifyCustomerToken(token, expectedPurpose) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = sign(body);
  // Constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.cid || payload.purpose !== expectedPurpose) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return { customerId: payload.cid, purpose: payload.purpose };
}
