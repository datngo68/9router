import { getApiKeyByKey } from "@/lib/localDb";
import { getApiKeyDailyTokenUsage, getApiKeyMonthlyTokenUsage, getApiKeyLifetimeTokenUsage } from "@/lib/usageDb";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { getReservedTokens, getReservedWalletMicroVnd } from "./apiKeyReservation.js";
import { getAdapter } from "@/lib/db/driver.js";
import { hashApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

function normalizeModelId(model) {
  return typeof model === "string" ? model.trim().toLowerCase() : "";
}

function nextLocalMidnightIso(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return next.toISOString();
}

function nextMonthIso(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return next.toISOString();
}

/**
 * Single-query lookup for API key + customer wallet snapshot. Reuses the
 * idx_ak_keyhash index. Returns the apiKey record extended with:
 *   - walletBalance       (micro-VND, 0 when no customer)
 *   - walletMinLimit      (micro-VND, 0 default)
 *   - paygEnabled         (boolean)
 */
export async function loadApiKeyPolicy(apiKey) {
  if (!apiKey) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT k.*,
            c.balance AS _walletBalance,
            c.balanceMinLimit AS _walletMinLimit
       FROM apiKeys k
       LEFT JOIN customers c ON c.id = k.customerId
      WHERE k.keyHash = ?`,
    [hashApiKey(apiKey)]
  );
  if (!row) return null;
  return mapRow(row);
}

function mapRow(row) {
  return {
    id: row.id,
    keyHash: row.keyHash || null,
    keyPrefix: row.keyPrefix || null,
    keyLast4: row.keyLast4 || null,
    keyDisplay: row.keyPrefix ? `${row.keyPrefix}...${row.keyLast4 || ""}` : null,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    dailyTokenLimit: Number(row.dailyTokenLimit || 0),
    monthlyTokenLimit: Number(row.monthlyTokenLimit || 0),
    lifetimeTokenLimit: Number(row.lifetimeTokenLimit || 0),
    requestsPerMinute: Number(row.requestsPerMinute || 0),
    maxTokensPerRequest: Number(row.maxTokensPerRequest || 0),
    rateLimitWindowSec: Number(row.rateLimitWindowSec || 0),
    expiresAt: row.expiresAt || null,
    allowedModels: parseJson(row.allowedModels, []),
    allowedIps: parseJson(row.allowedIps, []),
    rtkMode: row.rtkMode || "inherit",
    cavemanMode: row.cavemanMode || "inherit",
    paygEnabled: row.paygEnabled === 1 || row.paygEnabled === true,
    allowedProviders: parseJson(row.allowedProviders, []),
    allowedConnectionIds: parseJson(row.allowedConnectionIds, []),
    customerId: row.customerId || null,
    orderId: row.orderId || null,
    quotaResetAt: row.quotaResetAt || null,
    createdAt: row.createdAt,
    walletBalance: Number(row._walletBalance || 0),
    walletMinLimit: Number(row._walletMinLimit || 0),
  };
}

/**
 * Returns true when this key has any quota cap configured (daily/monthly/lifetime).
 */
function hasAnyQuotaCap(apiKeyRecord) {
  return (
    Number(apiKeyRecord?.dailyTokenLimit || 0) > 0 ||
    Number(apiKeyRecord?.monthlyTokenLimit || 0) > 0 ||
    Number(apiKeyRecord?.lifetimeTokenLimit || 0) > 0
  );
}

/**
 * Returns true if the wallet has spendable balance after subtracting in-flight
 * micro-VND reservations.
 */
export function hasWalletHeadroom(apiKeyRecord) {
  if (!apiKeyRecord || !apiKeyRecord.paygEnabled) return false;
  const reserved = getReservedWalletMicroVnd(apiKeyRecord.id);
  return Number(apiKeyRecord.walletBalance || 0) - reserved > Number(apiKeyRecord.walletMinLimit || 0);
}

export function checkApiKeyExpiry(apiKeyRecord, now = new Date()) {
  if (!apiKeyRecord) {
    return { allowed: false, status: HTTP_STATUS.UNAUTHORIZED, message: "Invalid API key" };
  }
  if (!apiKeyRecord.isActive) {
    return { allowed: false, status: HTTP_STATUS.UNAUTHORIZED, message: "API key is inactive" };
  }
  if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt).getTime() <= now.getTime()) {
    return { allowed: false, status: HTTP_STATUS.UNAUTHORIZED, message: "API key has expired" };
  }
  return { allowed: true };
}

export function checkApiKeyModelAccess(apiKeyRecord, { requestedModel, resolvedModels = [] } = {}) {
  const allowedModels = Array.isArray(apiKeyRecord?.allowedModels) ? apiKeyRecord.allowedModels : [];
  const allowedSet = new Set(allowedModels.map(normalizeModelId).filter(Boolean));
  if (allowedSet.size === 0) return { allowed: true };

  const candidates = [requestedModel, ...resolvedModels].map(normalizeModelId).filter(Boolean);
  const allowed = candidates.length > 0 && candidates.some((model) => allowedSet.has(model));
  if (allowed) return { allowed: true };

  return {
    allowed: false,
    status: HTTP_STATUS.FORBIDDEN,
    message: `Model is not allowed for this API key: ${requestedModel || resolvedModels[0] || "unknown"}`,
  };
}

export function checkApiKeyComboModelAccess(apiKeyRecord, comboName, comboModels = []) {
  const allowedModels = Array.isArray(apiKeyRecord?.allowedModels) ? apiKeyRecord.allowedModels : [];
  const allowedSet = new Set(allowedModels.map(normalizeModelId).filter(Boolean));
  if (allowedSet.size === 0) return { allowed: true };
  if (allowedSet.has(normalizeModelId(comboName))) return { allowed: true };

  const normalizedModels = comboModels.map(normalizeModelId).filter(Boolean);
  const allComboModelsAllowed = normalizedModels.length > 0 && normalizedModels.every((model) => allowedSet.has(model));
  if (allComboModelsAllowed) return { allowed: true };

  return {
    allowed: false,
    status: HTTP_STATUS.FORBIDDEN,
    message: `Combo is not allowed for this API key: ${comboName || "unknown"}`,
  };
}

export async function checkApiKeyDailyTokenLimit(apiKeyRecord, date = new Date()) {
  const limit = Number(apiKeyRecord?.dailyTokenLimit || 0);
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true };

  const usage = await getApiKeyDailyTokenUsage(apiKeyRecord.id, date, { quotaResetAt: apiKeyRecord.quotaResetAt });
  // Add in-flight reservations so parallel requests don't all see the same
  // pre-write usage and collectively blow past the limit.
  const reserved = getReservedTokens(apiKeyRecord.id);
  const projected = usage.totalTokens + reserved;
  if (projected < limit) {
    return {
      allowed: true,
      limit,
      usage,
      remaining: Math.max(0, limit - projected),
      resetAt: nextLocalMidnightIso(date),
    };
  }

  return {
    allowed: false,
    status: HTTP_STATUS.RATE_LIMITED,
    message: `API key daily token limit exceeded (${projected}/${limit})`,
    limit,
    usage,
    remaining: 0,
    resetAt: nextLocalMidnightIso(date),
  };
}

/**
 * Reject requests that ask for more output tokens than the per-key cap.
 * Looks at common max_tokens fields across OpenAI / Anthropic / Gemini.
 */
export function checkApiKeyMaxTokensPerRequest(apiKeyRecord, body) {
  const cap = Number(apiKeyRecord?.maxTokensPerRequest || 0);
  if (!Number.isFinite(cap) || cap <= 0) return { allowed: true };

  const requested = Number(
    body?.max_tokens ??
    body?.max_completion_tokens ??
    body?.maxOutputTokens ??
    body?.generationConfig?.maxOutputTokens ??
    0
  );

  if (!Number.isFinite(requested) || requested <= 0) {
    // Client didn't ask for an explicit cap. Inject the policy cap into the
    // body so downstream providers honor it. The handler will apply this.
    return { allowed: true, enforce: cap };
  }

  if (requested > cap) {
    return {
      allowed: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: `Requested max_tokens=${requested} exceeds API key cap of ${cap}`,
      cap,
      requested,
    };
  }

  return { allowed: true };
}

/**
 * Monthly cap: enforced over usage in the current local-month window.
 */
export async function checkApiKeyMonthlyTokenLimit(apiKeyRecord, date = new Date()) {
  const limit = Number(apiKeyRecord?.monthlyTokenLimit || 0);
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true };

  const usage = await getApiKeyMonthlyTokenUsage(apiKeyRecord.id, date, { quotaResetAt: apiKeyRecord.quotaResetAt });
  const reserved = getReservedTokens(apiKeyRecord.id);
  const projected = usage.totalTokens + reserved;
  if (projected < limit) {
    return {
      allowed: true,
      limit,
      usage,
      remaining: Math.max(0, limit - projected),
      resetAt: nextMonthIso(date),
    };
  }
  return {
    allowed: false,
    status: HTTP_STATUS.RATE_LIMITED,
    message: `API key monthly token limit exceeded (${projected}/${limit})`,
    limit,
    usage,
    remaining: 0,
    resetAt: nextMonthIso(date),
  };
}

/**
 * Lifetime cap: enforced over total usage of the key. Never resets.
 */
export async function checkApiKeyLifetimeTokenLimit(apiKeyRecord) {
  const limit = Number(apiKeyRecord?.lifetimeTokenLimit || 0);
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true };

  const usage = await getApiKeyLifetimeTokenUsage(apiKeyRecord.id, { quotaResetAt: apiKeyRecord.quotaResetAt });
  const reserved = getReservedTokens(apiKeyRecord.id);
  const projected = usage.totalTokens + reserved;
  if (projected < limit) {
    return { allowed: true, limit, usage, remaining: Math.max(0, limit - projected) };
  }
  return {
    allowed: false,
    status: HTTP_STATUS.FORBIDDEN,
    message: `API key lifetime token limit exceeded (${projected}/${limit})`,
    limit,
    usage,
    remaining: 0,
  };
}

export function filterModelsByApiKeyPolicy(models, apiKeyRecord) {
  const allowedModels = Array.isArray(apiKeyRecord?.allowedModels) ? apiKeyRecord.allowedModels : [];
  const allowedSet = new Set(allowedModels.map(normalizeModelId).filter(Boolean));
  if (allowedSet.size === 0) return models;
  return models.filter((model) => allowedSet.has(normalizeModelId(model?.id)));
}

// ───────────────────────────────────────────────────────────────────────
// Provider/connection access checks (sync, no DB hit on hot path)

/**
 * Check if the API key is allowed to use a given provider.
 * Uses allowedConnectionIds (inferred providers) first, then allowedProviders.
 * Both empty = unrestricted (allowed).
 *
 * @param {object} apiKeyRecord - loaded via loadApiKeyPolicy
 * @param {string} provider - resolved provider id
 * @param {Set<string>|null} inferredProviders - providers inferred from allowedConnectionIds (pre-resolved by caller)
 * @returns {{ allowed: boolean, status?: number, message?: string }}
 */
export function checkApiKeyProviderAccess(apiKeyRecord, provider, inferredProviders = null) {
  if (!apiKeyRecord) return { allowed: true };

  const connIds = Array.isArray(apiKeyRecord.allowedConnectionIds) ? apiKeyRecord.allowedConnectionIds : [];
  const provs = Array.isArray(apiKeyRecord.allowedProviders) ? apiKeyRecord.allowedProviders : [];

  // Unrestricted
  if (connIds.length === 0 && provs.length === 0) return { allowed: true };

  const normalizedProvider = (provider || "").trim().toLowerCase();
  if (!normalizedProvider) return { allowed: true };

  // If connectionIds are set, use inferred providers from those connections
  if (connIds.length > 0 && inferredProviders) {
    if (inferredProviders.has(normalizedProvider)) return { allowed: true };
    return {
      allowed: false,
      status: HTTP_STATUS.FORBIDDEN,
      message: `API key is not allowed to use provider: ${provider}`,
    };
  }

  // Fall back to allowedProviders list
  if (provs.length > 0) {
    const provSet = new Set(provs.map((p) => p.trim().toLowerCase()));
    if (provSet.has(normalizedProvider)) return { allowed: true };
    return {
      allowed: false,
      status: HTTP_STATUS.FORBIDDEN,
      message: `API key is not allowed to use provider: ${provider}`,
    };
  }

  return { allowed: true };
}

/**
 * Filter connections list by API key's allowedConnectionIds.
 * If allowedConnectionIds is empty, returns all connections (unrestricted).
 *
 * @param {object} apiKeyRecord
 * @param {Array} connections - list of connection objects with .id
 * @returns {Array} filtered connections
 */
export function filterConnectionsByApiKey(apiKeyRecord, connections) {
  if (!apiKeyRecord) return connections;
  const connIds = Array.isArray(apiKeyRecord.allowedConnectionIds) ? apiKeyRecord.allowedConnectionIds : [];
  if (connIds.length === 0) return connections;
  const allowed = new Set(connIds);
  return connections.filter((c) => allowed.has(c.id));
}
