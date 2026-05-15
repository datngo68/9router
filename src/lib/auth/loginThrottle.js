// Per-IP login throttle.
//
// 5 consecutive failed attempts within FAIL_WINDOW_MS lock the IP for
// LOCK_MS. Successful login clears the counter for that IP. State is in
// memory; for multi-process deployments swap for a shared store.

const FAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_MS = 15 * 60 * 1000;        // 15 minutes
const MAX_FAILS = 5;

if (!global._loginThrottleState) {
  global._loginThrottleState = new Map(); // ip → { fails: number[], lockedUntil?: number }
}
const buckets = global._loginThrottleState;

function nowMs() { return Date.now(); }

function pruneOldFails(entry, now) {
  const cutoff = now - FAIL_WINDOW_MS;
  entry.fails = entry.fails.filter((t) => t >= cutoff);
}

/**
 * Extract a best-effort client IP. Trusts x-forwarded-for only if the
 * request originated from a known proxy chain — but in our case we accept
 * the leftmost value because the dashboardGuard already restricts who can
 * reach this route. Falls back to "unknown" if nothing is available.
 */
export function getClientIp(request) {
  const fwd = request.headers.get?.("x-forwarded-for") || request.headers["x-forwarded-for"];
  if (fwd) {
    const first = String(fwd).split(",")[0].trim();
    if (first) return first;
  }
  const real = request.headers.get?.("x-real-ip") || request.headers["x-real-ip"];
  if (real) return String(real);
  return "unknown";
}

/**
 * Check whether the given IP is currently locked out. Returns
 * { locked: boolean, retryAfterMs?: number }.
 */
export function checkLogin(ip) {
  if (!ip) return { locked: false };
  const entry = buckets.get(ip);
  if (!entry) return { locked: false };
  const now = nowMs();
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    // Lock expired → reset.
    buckets.delete(ip);
    return { locked: false };
  }
  return { locked: false };
}

/**
 * Record a failed login. Returns { locked: boolean, retryAfterMs?, fails }.
 */
export function recordFailure(ip) {
  if (!ip) return { locked: false, fails: 0 };
  const now = nowMs();
  const entry = buckets.get(ip) || { fails: [] };
  pruneOldFails(entry, now);
  entry.fails.push(now);
  if (entry.fails.length >= MAX_FAILS) {
    entry.lockedUntil = now + LOCK_MS;
    buckets.set(ip, entry);
    return { locked: true, retryAfterMs: LOCK_MS, fails: entry.fails.length };
  }
  buckets.set(ip, entry);
  return { locked: false, fails: entry.fails.length };
}

/**
 * Successful login → clear counter for the IP.
 */
export function clearFailures(ip) {
  if (!ip) return;
  buckets.delete(ip);
}

// Test helper.
export function _resetLoginThrottle() {
  buckets.clear();
}
