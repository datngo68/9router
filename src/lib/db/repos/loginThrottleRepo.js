// Login throttle persistence. Schema: loginThrottle(key, fails, lockedUntil, updatedAt).
//
// `fails` is a JSON array of epoch-ms timestamps; we prune entries outside
// the current window when recording a new failure. `lockedUntil` is null
// while the key is below the lockout threshold and gets stamped by the
// caller (loginThrottle.js) once MAX_FAILS is reached.

import { getAdapterSync } from "../driver.js";

function parseFails(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

export function getEntry(key) {
  if (!key) return null;
  const db = getAdapterSync();
  const row = db.get(
    `SELECT key, fails, lockedUntil, updatedAt FROM loginThrottle WHERE key = ?`,
    [key]
  );
  if (!row) return null;
  return {
    key: row.key,
    fails: parseFails(row.fails),
    lockedUntil: row.lockedUntil ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * Record a failure: prune fails outside the window, append `now`, write back.
 * Preserves any existing lockedUntil. Returns the post-write { fails, lockedUntil }.
 */
export function recordFail(key, now, windowMs) {
  const db = getAdapterSync();
  const cutoff = now - windowMs;
  const existing = getEntry(key);
  const pruned = (existing?.fails || []).filter((t) => t >= cutoff);
  pruned.push(now);
  const lockedUntil = existing?.lockedUntil ?? null;
  db.run(
    `INSERT INTO loginThrottle(key, fails, lockedUntil, updatedAt)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       fails = excluded.fails,
       lockedUntil = excluded.lockedUntil,
       updatedAt = excluded.updatedAt`,
    [key, JSON.stringify(pruned), lockedUntil, now]
  );
  return { fails: pruned, lockedUntil };
}

export function setLock(key, lockedUntil, now) {
  const db = getAdapterSync();
  db.run(
    `INSERT INTO loginThrottle(key, fails, lockedUntil, updatedAt)
     VALUES(?, '[]', ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       lockedUntil = excluded.lockedUntil,
       updatedAt = excluded.updatedAt`,
    [key, lockedUntil, now]
  );
}

export function clear(key) {
  if (!key) return;
  const db = getAdapterSync();
  db.run(`DELETE FROM loginThrottle WHERE key = ?`, [key]);
}

/**
 * Drop rows whose lock expired more than 24h ago. Window-only entries
 * (no lockedUntil) are left to age out via the recordFail prune.
 */
export function pruneExpired(now) {
  const db = getAdapterSync();
  const cutoff = now - 24 * 60 * 60 * 1000;
  db.run(
    `DELETE FROM loginThrottle WHERE lockedUntil IS NOT NULL AND lockedUntil < ?`,
    [cutoff]
  );
}

// Test helper — wipe all rows.
export function _wipeAll() {
  try {
    const db = getAdapterSync();
    db.run(`DELETE FROM loginThrottle`);
  } catch {
    // ignore — DB may not be initialised in unit tests
  }
}
