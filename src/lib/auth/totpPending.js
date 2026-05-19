// In-memory pending TOTP secrets per customer.
//
// Setup flow used to write the secret to the customer row immediately. If the
// user navigated away mid-setup, an unverified secret stayed persisted in DB.
// This module holds the secret transiently (10 min TTL) and only the verify
// route promotes it to the customer record.

const TTL_MS = 10 * 60 * 1000;

if (!global._totpPendingState) global._totpPendingState = new Map();
const store = global._totpPendingState;

function pruneExpired(now) {
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

export function setPendingTotp(customerId, secret) {
  if (!customerId || !secret) return;
  pruneExpired(Date.now());
  store.set(String(customerId), { secret, expiresAt: Date.now() + TTL_MS });
}

export function getPendingTotp(customerId) {
  if (!customerId) return null;
  const entry = store.get(String(customerId));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(String(customerId));
    return null;
  }
  return entry.secret;
}

export function clearPendingTotp(customerId) {
  if (!customerId) return;
  store.delete(String(customerId));
}
