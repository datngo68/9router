// In-memory token reservation per API key.
//
// Why: daily quota is enforced by reading usageHistory at request start.
// Usage is written only AFTER the upstream response completes, so N parallel
// requests with the same key all see the same "old" usage and pass the check
// even when their combined cost would exceed the limit. This module bridges
// the gap by tracking *in-flight* tokens in RAM and adding them to the read
// usage when checking the limit.
//
// Reservations are keyed by apiKeyId (UUID) — never the raw plaintext key.
//
// Lifecycle:
//   reserveTokens(apiKeyId, estimate) → returns reservationId
//   commitTokens(reservationId, actualTokens) — call when real usage is known
//   releaseTokens(reservationId) — call on error/cancel without consuming
//
// Safety net: any reservation older than RESERVATION_TTL_MS is auto-released
// on next read so a crashed/leaked request can't permanently inflate quota.
//
// PAYG variant: when a request bills the wallet, we also reserve an
// estimated micro-VND cost so concurrent wallet-billed requests don't all
// pass the balance check on stale data. Wallet reservations live in the
// same map alongside token reservations and share the same TTL/lifecycle.

const RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

// Shared across Next.js module reloads (dev) and SSE/worker imports.
if (!global._apiKeyReservations) {
  global._apiKeyReservations = new Map(); // reservationId → { apiKeyId, tokens, walletMicroVnd, createdAt }
}
const reservations = global._apiKeyReservations;

function pruneExpired(now = Date.now()) {
  for (const [id, r] of reservations) {
    if (now - r.createdAt > RESERVATION_TTL_MS) reservations.delete(id);
  }
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Estimate tokens a request will consume based on body shape.
 * Cheap & conservative: prompt chars/4 + capped max_tokens.
 */
export function estimateRequestTokens(body) {
  if (!body || typeof body !== "object") return DEFAULT_MAX_OUTPUT_TOKENS;

  let promptChars = 0;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const m of messages) {
    if (typeof m?.content === "string") {
      promptChars += m.content.length;
    } else if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (typeof part === "string") promptChars += part.length;
        else if (typeof part?.text === "string") promptChars += part.text.length;
      }
    }
  }

  // Gemini-style contents
  if (Array.isArray(body.contents)) {
    for (const c of body.contents) {
      if (Array.isArray(c?.parts)) {
        for (const p of c.parts) {
          if (typeof p?.text === "string") promptChars += p.text.length;
        }
      }
    }
  }

  // Responses API input
  if (Array.isArray(body.input)) {
    for (const i of body.input) {
      if (typeof i?.content === "string") promptChars += i.content.length;
    }
  }

  const promptTokens = Math.ceil(promptChars / 4);

  const requestedMax = Number(
    body.max_tokens ??
    body.max_completion_tokens ??
    body.maxOutputTokens ??
    body.generationConfig?.maxOutputTokens ??
    0
  );
  const maxOutput = Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.min(requestedMax, DEFAULT_MAX_OUTPUT_TOKENS * 4) // hard ceiling 32k
    : DEFAULT_MAX_OUTPUT_TOKENS;

  return promptTokens + maxOutput;
}

/**
 * Sum of currently reserved tokens for an apiKeyId.
 */
export function getReservedTokens(apiKeyId) {
  if (!apiKeyId) return 0;
  pruneExpired();
  let sum = 0;
  for (const r of reservations.values()) {
    if (r.apiKeyId === apiKeyId) sum += r.tokens || 0;
  }
  return sum;
}

/**
 * Sum of currently reserved wallet micro-VND for an apiKeyId. Used by the
 * PAYG balance pre-check so concurrent wallet-billed requests don't all see
 * the same pre-debit balance and overdraft together.
 */
export function getReservedWalletMicroVnd(apiKeyId) {
  if (!apiKeyId) return 0;
  pruneExpired();
  let sum = 0;
  for (const r of reservations.values()) {
    if (r.apiKeyId === apiKeyId) sum += r.walletMicroVnd || 0;
  }
  return sum;
}

/**
 * Reserve `tokens` for `apiKeyId`. Returns reservationId.
 * Optional walletMicroVnd estimate is held alongside the token reservation
 * so a single reservationId covers both quota and wallet checks.
 */
export function reserveTokens(apiKeyId, tokens, walletMicroVnd = 0) {
  if (!apiKeyId) return null;
  const tokensNum = Number.isFinite(tokens) && tokens > 0 ? Math.ceil(tokens) : 0;
  const walletNum = Number.isFinite(walletMicroVnd) && walletMicroVnd > 0 ? Math.ceil(walletMicroVnd) : 0;
  if (tokensNum <= 0 && walletNum <= 0) return null;
  const id = newId();
  reservations.set(id, { apiKeyId, tokens: tokensNum, walletMicroVnd: walletNum, createdAt: Date.now() });
  return id;
}

/**
 * Add a wallet micro-VND estimate to an existing reservation. Used when the
 * decision to charge from wallet is taken AFTER the initial reservation
 * (e.g. quota fallback).
 */
export function attachWalletEstimate(reservationId, walletMicroVnd) {
  if (!reservationId) return;
  const r = reservations.get(reservationId);
  if (!r) return;
  const add = Number.isFinite(walletMicroVnd) && walletMicroVnd > 0 ? Math.ceil(walletMicroVnd) : 0;
  r.walletMicroVnd = (r.walletMicroVnd || 0) + add;
}

/**
 * Release reservation without committing (e.g. error before any tokens used).
 */
export function releaseTokens(reservationId) {
  if (!reservationId) return;
  reservations.delete(reservationId);
}

/**
 * Commit a reservation: drop it (real usage will be persisted via saveRequestUsage).
 * Equivalent to release for now — kept as a separate name for call-site clarity
 * and future hooks (metrics, etc.).
 */
export function commitTokens(reservationId) {
  if (!reservationId) return;
  reservations.delete(reservationId);
}

// Test helper.
export function _resetReservations() {
  reservations.clear();
}

/**
 * Wrap a Response so the given reservation is released when the body stream
 * finishes (success, error, or client disconnect). Falls back to a one-shot
 * timer release if the response has no body to attach to.
 */
export function attachReservationLifecycle(response, reservationId) {
  if (!reservationId) return response;
  if (!response || typeof response !== "object") {
    releaseTokens(reservationId);
    return response;
  }

  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    releaseTokens(reservationId);
  };

  // No body or unsupported runtime → release immediately.
  const body = response.body;
  if (!body || typeof body.pipeThrough !== "function") {
    releaseOnce();
    return response;
  }

  try {
    const transform = new TransformStream({
      flush() { releaseOnce(); },
      cancel() { releaseOnce(); },
    });
    const wrapped = body.pipeThrough(transform);
    // Belt-and-suspenders: release on safety net even if neither flush nor
    // cancel fire (rare, but possible if runtime drops the stream silently).
    setTimeout(releaseOnce, RESERVATION_TTL_MS);
    return new Response(wrapped, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    releaseOnce();
    return response;
  }
}
