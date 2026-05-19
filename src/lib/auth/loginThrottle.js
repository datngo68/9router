// Per-IP login throttle.
//
// 5 failed attempts within FAIL_WINDOW_MS lock the key for LOCK_MS.
// Successful login clears the counter for the key. State is persisted in
// the `loginThrottle` table so locks survive restarts and are shared across
// processes. If the DB is unavailable (early boot, unit tests), we fall
// back to an in-memory Map so the call sites never crash.
//
// Public API stays sync to keep all existing call sites working without
// `await` — the SQLite adapter is sync.

import * as repo from "@/lib/db/repos/loginThrottleRepo";

const FAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_MS = 15 * 60 * 1000;        // 15 minutes
const MAX_FAILS = 5;

// In-memory fallback. Survives Next.js dev hot-reload via globalThis.
if (!global._loginThrottleMem) global._loginThrottleMem = new Map();
const memBuckets = global._loginThrottleMem;

function nowMs() { return Date.now(); }

function memGet(key) {
  return memBuckets.get(key) || null;
}
function memSet(key, entry) {
  memBuckets.set(key, entry);
}
function memDelete(key) {
  memBuckets.delete(key);
}

// Wrap repo calls in try/catch so a missing/unready adapter falls back to
// the in-memory map. We intentionally swallow errors — login throttling is
// best-effort hardening, not a hard correctness requirement.
function safeGetEntry(key) {
  try {
    const row = repo.getEntry(key);
    if (row) return { fails: row.fails || [], lockedUntil: row.lockedUntil ?? null };
    return null;
  } catch {
    return memGet(key);
  }
}
function safeRecordFail(key, now) {
  try {
    return repo.recordFail(key, now, FAIL_WINDOW_MS);
  } catch {
    const cutoff = now - FAIL_WINDOW_MS;
    const existing = memGet(key) || { fails: [], lockedUntil: null };
    const fails = existing.fails.filter((t) => t >= cutoff);
    fails.push(now);
    const updated = { fails, lockedUntil: existing.lockedUntil ?? null };
    memSet(key, updated);
    return updated;
  }
}
function safeSetLock(key, lockedUntil, now) {
  try {
    repo.setLock(key, lockedUntil, now);
    return;
  } catch {
    const existing = memGet(key) || { fails: [], lockedUntil: null };
    memSet(key, { ...existing, lockedUntil });
  }
}
function safeClear(key) {
  try {
    repo.clear(key);
  } catch {
    memDelete(key);
  }
}

/**
 * Extract a best-effort client IP behind N trusted reverse proxies.
 *
 * `TRUSTED_PROXY_HOPS` (default 1) tells us how many proxies are in front
 * of us that we control. The leftmost XFF entry is attacker-controlled
 * (any client can prepend a fake header), so picking element[0] gives the
 * attacker a way to evade per-IP throttling. Instead we count from the
 * right: element[length - hops] is the IP the closest trusted proxy saw.
 *
 * Falls back to x-real-ip → request.ip → "unknown".
 */
export function getClientIp(request) {
  const headers = request?.headers;
  const get = (name) => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  };

  const fwd = get("x-forwarded-for");
  if (fwd) {
    const parts = String(fwd)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const hopsRaw = Number.parseInt(process.env.TRUSTED_PROXY_HOPS || "1", 10);
      const hops = Number.isFinite(hopsRaw) && hopsRaw > 0 ? hopsRaw : 1;
      const idx = Math.max(0, parts.length - hops);
      return parts[idx];
    }
  }

  const real = get("x-real-ip");
  if (real) return String(real);
  if (request?.ip) return String(request.ip);
  return "unknown";
}

/**
 * Check whether the given key is currently locked. Returns
 * { locked: boolean, retryAfterMs?: number }.
 */
export function checkLogin(key) {
  if (!key) return { locked: false };
  const entry = safeGetEntry(key);
  if (!entry) return { locked: false };
  const now = nowMs();
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    // Lock expired → reset to give the user a clean slate.
    safeClear(key);
    return { locked: false };
  }
  return { locked: false };
}

/**
 * Record a failed login. Returns { locked, retryAfterMs?, fails }.
 */
export function recordFailure(key) {
  if (!key) return { locked: false, fails: 0 };
  const now = nowMs();
  const updated = safeRecordFail(key, now);
  if (updated.fails.length >= MAX_FAILS) {
    const lockedUntil = now + LOCK_MS;
    safeSetLock(key, lockedUntil, now);
    return { locked: true, retryAfterMs: LOCK_MS, fails: updated.fails.length };
  }
  return { locked: false, fails: updated.fails.length };
}

/**
 * Successful login → clear counter for the key.
 */
export function clearFailures(key) {
  if (!key) return;
  safeClear(key);
}

// Test helper — wipe both backends.
export function _resetLoginThrottle() {
  memBuckets.clear();
  try { repo._wipeAll(); } catch { /* ignore */ }
}
