// Helpers for Telegram deep-link account linking.
//
// Two purposes share the same storage:
//   - "customer": link a customer.telegramChatId. Token bound to customerId
//     at creation; webhook /start <token> reads chatId from update.from.id.
//   - "admin": link settings.telegramAdminChatId. After /start, bot prompts
//     for a 6-digit PIN displayed only in the dashboard. PIN is single-use,
//     3-attempts then token is consumed.
//
// Storage uses the existing kv table (scope = "telegramLinks") so no new
// migration is needed.

import crypto from "node:crypto";
import { getAdapter } from "@/lib/db/driver.js";

const SCOPE_TOKENS = "telegramLinks";
const SCOPE_PENDING = "telegramPinPending";

const TTL_CUSTOMER_MS = 30 * 60 * 1000;  // 30m
const TTL_ADMIN_MS = 5 * 60 * 1000;      // 5m
const PIN_PROMPT_TTL_MS = 2 * 60 * 1000;
const MAX_PIN_ATTEMPTS = 3;

function genToken() { return crypto.randomBytes(18).toString("base64url"); }
function genPin() { return String(crypto.randomInt(100000, 1000000)); }

async function kvUpsert(scope, key, value) {
  const db = await getAdapter();
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [scope, key, JSON.stringify(value)]
  );
}
async function kvGet(scope, key) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}
async function kvDel(scope, key) {
  const db = await getAdapter();
  db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
}

/**
 * Create a one-shot link token. For admin purpose, a 6-digit PIN is also
 * issued and returned to the caller. PIN is NOT stored in URL — UI displays
 * separately so URL leakage alone doesn't allow takeover.
 */
export async function createLinkToken({ purpose, customerId = null }) {
  if (purpose !== "customer" && purpose !== "admin") {
    throw new Error(`unknown purpose: ${purpose}`);
  }
  if (purpose === "customer" && !customerId) {
    throw new Error("customerId is required for customer link");
  }
  const token = genToken();
  const ttl = purpose === "admin" ? TTL_ADMIN_MS : TTL_CUSTOMER_MS;
  const value = {
    purpose,
    customerId,
    pin: purpose === "admin" ? genPin() : null,
    pinAttempts: 0,
    expiresAt: Date.now() + ttl,
    createdAt: Date.now(),
  };
  await kvUpsert(SCOPE_TOKENS, token, value);
  return { token, pin: value.pin, expiresAt: value.expiresAt };
}

export async function getLinkToken(token) {
  if (!token) return null;
  const v = await kvGet(SCOPE_TOKENS, token);
  if (!v) return null;
  if (Date.now() > v.expiresAt) {
    await kvDel(SCOPE_TOKENS, token);
    return null;
  }
  return { token, ...v };
}

export async function consumeLinkToken(token) {
  await kvDel(SCOPE_TOKENS, token);
}

export async function recordPinAttempt(token, attempts) {
  const v = await kvGet(SCOPE_TOKENS, token);
  if (!v) return;
  v.pinAttempts = attempts;
  await kvUpsert(SCOPE_TOKENS, token, v);
}

/**
 * Pending-PIN challenge keyed by Telegram chatId. After /start <token>, the
 * webhook saves the token in this scope so the next message from the same
 * chat is treated as a PIN reply.
 */
export async function setPendingPin(chatId, token) {
  await kvUpsert(SCOPE_PENDING, String(chatId), {
    token,
    expiresAt: Date.now() + PIN_PROMPT_TTL_MS,
  });
}
export async function getPendingPin(chatId) {
  const v = await kvGet(SCOPE_PENDING, String(chatId));
  if (!v) return null;
  if (Date.now() > v.expiresAt) {
    await kvDel(SCOPE_PENDING, String(chatId));
    return null;
  }
  return v;
}
export async function clearPendingPin(chatId) {
  await kvDel(SCOPE_PENDING, String(chatId));
}

export const MAX_ATTEMPTS = MAX_PIN_ATTEMPTS;
