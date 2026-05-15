import { getApiKeyByKey } from "@/lib/localDb";
import { getApiKeyDailyTokenUsage, getApiKeyMonthlyTokenUsage, getApiKeyLifetimeTokenUsage } from "@/lib/usageDb";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { getReservedTokens } from "./apiKeyReservation.js";

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

export async function loadApiKeyPolicy(apiKey) {
  if (!apiKey) return null;
  return getApiKeyByKey(apiKey);
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

  const usage = await getApiKeyDailyTokenUsage(apiKeyRecord.id, date);
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

  const usage = await getApiKeyMonthlyTokenUsage(apiKeyRecord.id, date);
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

  const usage = await getApiKeyLifetimeTokenUsage(apiKeyRecord.id);
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
