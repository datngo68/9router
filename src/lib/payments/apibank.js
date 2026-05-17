// APIBank (apibak.tudonghoa.me) client wrapper.
//
// Docs: docs/integration.md (in the APIBank repo). Public surface used by
// 9router:
//   - createApibankOrder({ amount, customerRef, ... }) → POST /v1/orders
//   - cancelApibankOrder(orderId)                      → POST /v1/orders/{id}:cancel
//   - getApibankOrder(orderId)                          → GET  /v1/orders/{id}
//   - pingApibank(baseUrl, apiKey)                      → list 1 order, used by
//                                                          dashboard "Test"
//   - verifyWebhookSignature(rawBody, header, secret)   → HMAC SHA-256 verify
//   - generateWebhookSecret()                           → 32-byte hex
//   - buildPayLandingUrl(baseUrl, code)                 → {base}/pay/{code}
//   - buildPayQrUrl(baseUrl, code)                      → {base}/qr/{code}.png
//
// All HTTP calls timeout at 10s and surface APIBank's error message verbatim
// for easier admin debugging.

import crypto from "node:crypto";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const SIGNATURE_TOLERANCE_SEC = 300;

function trimBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

async function readApibankSettings() {
  const s = await getSettings();
  return {
    enabled: !!s.apibankEnabled,
    baseUrl: trimBase(s.apibankBaseUrl),
    apiKey: String(s.apibankApiKey || ""),
    bankAccountId: String(s.apibankBankAccountId || ""),
    webhookSecret: String(s.apibankWebhookSecret || ""),
  };
}

async function apibankFetch(method, path, { baseUrl, apiKey, body, idempotencyKey } = {}) {
  if (!baseUrl) throw new Error("APIBank base URL chưa cấu hình");
  if (!apiKey) throw new Error("APIBank API key chưa cấu hình");
  const url = `${trimBase(baseUrl)}${path}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "manual",
    });
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === "AbortError") throw new Error("APIBank timeout (10s)");
    throw new Error(`APIBank network error: ${e.message}`);
  }
  clearTimeout(timer);

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep raw */ }

  if (!res.ok) {
    const msg = data?.detail || data?.error || data?.message || text || `HTTP ${res.status}`;
    const err = new Error(`APIBank ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * Create a parallel order on APIBank for a 9router order. Returns the APIBank
 * order payload (id, code, expired_at, ...).
 *
 * `routerOrderId` is sent in BOTH `customer_ref` AND `metadata.router_order_id`
 * so we have two cross-checks when handling the webhook.
 */
export async function createApibankOrder({
  routerOrderId,
  amountVnd,
  description,
  ttlSeconds = 900,
}) {
  if (!routerOrderId) throw new Error("routerOrderId is required");
  if (!Number.isFinite(amountVnd) || amountVnd <= 0) {
    throw new Error("amountVnd must be a positive number");
  }
  const cfg = await readApibankSettings();
  if (!cfg.enabled) throw new Error("APIBank chưa được bật");
  if (!cfg.bankAccountId) throw new Error("APIBank bank_account_id chưa cấu hình");

  return apibankFetch("POST", "/v1/orders", {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    idempotencyKey: `9router:${routerOrderId}`,
    body: {
      amount_vnd: Math.round(amountVnd),
      bank_account_id: cfg.bankAccountId,
      description: description || `9router ${routerOrderId}`,
      customer_ref: routerOrderId,
      metadata: { router_order_id: routerOrderId, source: "9router" },
      ttl_seconds: Math.max(60, Math.min(86400, Number(ttlSeconds) || 900)),
    },
  });
}

export async function cancelApibankOrder(apibankOrderId) {
  if (!apibankOrderId) return null;
  const cfg = await readApibankSettings();
  if (!cfg.baseUrl || !cfg.apiKey) return null;
  return apibankFetch("POST", `/v1/orders/${encodeURIComponent(apibankOrderId)}:cancel`, {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
  });
}

export async function getApibankOrder(apibankOrderId) {
  if (!apibankOrderId) return null;
  const cfg = await readApibankSettings();
  if (!cfg.baseUrl || !cfg.apiKey) return null;
  return apibankFetch("GET", `/v1/orders/${encodeURIComponent(apibankOrderId)}`, {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
  });
}

/**
 * Lightweight credentials check used by the dashboard "Test connection" button.
 * Calls a low-cost read endpoint (`GET /v1/orders?limit=1`); 200/204 → ok.
 */
export async function pingApibank({ baseUrl, apiKey }) {
  const data = await apibankFetch("GET", "/v1/orders?limit=1", {
    baseUrl,
    apiKey,
  });
  return { ok: true, sample: Array.isArray(data) ? data.slice(0, 1) : data };
}

/**
 * List bank accounts visible to the API key. Requires scope
 * `bank_accounts:read` (or `admin:*`) on the APIBank side. Returns an array
 * of `{ id, bank_code, account_no, account_holder, status, ... }`.
 *
 * Used by the dashboard to render a dropdown so admin doesn't have to paste
 * `ba_01HXXX...` UUIDs by hand.
 */
export async function listApibankBankAccounts({ baseUrl, apiKey } = {}) {
  let cfg = { baseUrl, apiKey };
  if (!cfg.baseUrl || !cfg.apiKey) {
    const s = await readApibankSettings();
    cfg = { baseUrl: cfg.baseUrl || s.baseUrl, apiKey: cfg.apiKey || s.apiKey };
  }
  const data = await apibankFetch("GET", "/v1/bank-accounts", {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
  });
  return Array.isArray(data) ? data : [];
}

/**
 * Build the customer-facing payment landing URL for a given APIBank order code.
 * Used by the storefront tracking page as a deep-link to the hosted QR view.
 */
export function buildPayLandingUrl(baseUrl, code) {
  if (!baseUrl || !code) return null;
  return `${trimBase(baseUrl)}/pay/${encodeURIComponent(code)}`;
}

/**
 * Direct QR PNG URL (for embedding in <img>). Same format as docs.
 */
export function buildPayQrUrl(baseUrl, code) {
  if (!baseUrl || !code) return null;
  return `${trimBase(baseUrl)}/qr/${encodeURIComponent(code)}.png`;
}

// ── Webhook signature verification ─────────────────────────────────────────
//
// Header format (per docs): `X-Signature: t=<unix>,v1=<hex>`
// HMAC payload:             f"{t}." + raw_body_bytes  (raw, NOT minified JSON)
// Algorithm:                HMAC-SHA256, hex digest
// Replay tolerance:         |now - t| ≤ 300s (default)

function parseSignatureHeader(header) {
  if (!header || typeof header !== "string") return null;
  const out = {};
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  if (!out.t || !out.v1) return null;
  return out;
}

/**
 * Verify an APIBank webhook payload. Returns `{ ok, error? }`.
 *
 * @param {Buffer} rawBody  Raw bytes from the request — DO NOT pass parsed JSON.
 * @param {string} header   Value of `X-Signature` header.
 * @param {string} secret   The secret stored in settings.apibankWebhookSecret.
 * @param {object} [opts]
 * @param {number} [opts.toleranceSec=300]  Max clock skew allowed.
 */
export function verifyWebhookSignature(rawBody, header, secret, opts = {}) {
  const tolerance = Math.max(0, Number(opts.toleranceSec ?? SIGNATURE_TOLERANCE_SEC));
  if (!secret) return { ok: false, error: "missing webhook secret" };
  if (!Buffer.isBuffer(rawBody)) return { ok: false, error: "rawBody must be a Buffer" };
  const parts = parseSignatureHeader(header);
  if (!parts) return { ok: false, error: "malformed X-Signature" };
  const t = Number(parts.t);
  if (!Number.isFinite(t) || t <= 0) return { ok: false, error: "invalid timestamp" };
  if (tolerance > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - t) > tolerance) {
      return { ok: false, error: `timestamp out of tolerance (${tolerance}s)` };
    }
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest("hex");
  // Both buffers must be the same length for timingSafeEqual.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(parts.v1 || ""), "utf8");
  if (a.length !== b.length) return { ok: false, error: "signature length mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, error: "signature mismatch" };
  return { ok: true, t };
}

/**
 * Generate a cryptographically strong webhook secret (32 bytes → 64 hex chars).
 * Frontend can also generate locally; this is the server-side helper.
 */
export function generateWebhookSecret() {
  return crypto.randomBytes(32).toString("hex");
}
