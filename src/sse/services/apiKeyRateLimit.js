// Sliding-window per-API-key rate limiter (in-memory).
//
// Tracks request timestamps per apiKeyId within the configured window. Old
// entries are pruned on every check so memory stays small. Window length can
// be customised per call via `windowMs` (defaults to 60s for backward compat).
//
// Limitations: in-memory only — multiple Node processes won't share state.
// Acceptable for single-process deployments. For multi-process, swap to
// Redis or a SQLite-backed counter.

const DEFAULT_WINDOW_MS = 60 * 1000;

if (!global._apiKeyRateBuckets) {
  global._apiKeyRateBuckets = new Map(); // apiKeyId → number[] (timestamps)
}
const buckets = global._apiKeyRateBuckets;

function pruneBucket(bucket, windowMs, now = Date.now()) {
  // Mutates bucket in-place: remove timestamps older than the window.
  const cutoff = now - windowMs;
  let i = 0;
  while (i < bucket.length && bucket[i] < cutoff) i++;
  if (i > 0) bucket.splice(0, i);
}

/**
 * Try to consume one request slot for `apiKeyId`. Returns:
 *   { allowed: true } if under the limit (and records the request).
 *   { allowed: false, retryAfterMs, current, limit, windowMs } if over.
 *
 * Pass limit <= 0 to disable (always allowed, no recording).
 *
 * @param {string} apiKeyId
 * @param {number} limit       max requests within the window
 * @param {number} [windowMs]  window length in ms (default 60_000)
 */
export function consumeRequest(apiKeyId, limit, windowMs = DEFAULT_WINDOW_MS) {
  if (!apiKeyId || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true };
  }
  const window = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;

  const now = Date.now();
  let bucket = buckets.get(apiKeyId);
  if (!bucket) {
    bucket = [];
    buckets.set(apiKeyId, bucket);
  }
  pruneBucket(bucket, window, now);

  if (bucket.length >= limit) {
    // Oldest in window is the earliest one that will fall out.
    const oldest = bucket[0];
    const retryAfterMs = Math.max(0, oldest + window - now);
    return { allowed: false, retryAfterMs, current: bucket.length, limit, windowMs: window };
  }

  bucket.push(now);
  return { allowed: true, current: bucket.length, limit, windowMs: window };
}

/**
 * Read-only count of recent requests in the current window.
 */
export function getRecentRequestCount(apiKeyId, windowMs = DEFAULT_WINDOW_MS) {
  if (!apiKeyId) return 0;
  const bucket = buckets.get(apiKeyId);
  if (!bucket) return 0;
  pruneBucket(bucket, Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS);
  return bucket.length;
}

// Test helper.
export function _resetRateLimits() {
  buckets.clear();
}
