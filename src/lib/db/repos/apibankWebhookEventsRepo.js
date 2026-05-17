// Webhook event dedup table for APIBank. APIBank may resend a webhook on
// timeout — we MUST process each event id at most once so the same payment
// can never confirm an order twice.
//
// `claimWebhookEvent` is the atomic ticket: returns true on first call for
// a given eventId, false on subsequent calls.

import { getAdapter } from "../driver.js";

/**
 * Atomically claim a webhook event id. Returns true if this caller is the
 * first to record the id (i.e. should process it), false if it was already
 * claimed previously.
 *
 * Uses INSERT OR IGNORE — relies on PRIMARY KEY uniqueness.
 */
export async function claimWebhookEvent({ eventId, orderId = null, type = null }) {
  if (!eventId) throw new Error("eventId is required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const info = db.run(
    `INSERT OR IGNORE INTO apibankWebhookEvents(eventId, orderId, type, receivedAt) VALUES(?, ?, ?, ?)`,
    [String(eventId), orderId, type, now]
  );
  // better-sqlite3 returns { changes }. If 0 rows changed, the id existed.
  return Number(info?.changes || 0) > 0;
}

export async function markWebhookEventProcessed(eventId) {
  if (!eventId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(`UPDATE apibankWebhookEvents SET processedAt = ? WHERE eventId = ?`, [now, String(eventId)]);
}

export async function getWebhookEvent(eventId) {
  if (!eventId) return null;
  const db = await getAdapter();
  return db.get(`SELECT * FROM apibankWebhookEvents WHERE eventId = ?`, [String(eventId)]);
}
