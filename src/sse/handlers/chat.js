import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import {
  loadApiKeyPolicy,
  checkApiKeyExpiry,
  checkApiKeyDailyTokenLimit,
  checkApiKeyMonthlyTokenLimit,
  checkApiKeyLifetimeTokenLimit,
  checkApiKeyMaxTokensPerRequest,
  checkApiKeyModelAccess,
  checkApiKeyComboModelAccess,
} from "../services/apiKeyPolicy.js";
import {
  estimateRequestTokens,
  reserveTokens,
  releaseTokens,
  attachReservationLifecycle,
} from "../services/apiKeyReservation.js";
import { consumeRequest } from "../services/apiKeyRateLimit.js";
import { checkIpAllowlist } from "../services/ipAllowlist.js";
import { getClientIp } from "@/lib/auth/loginThrottle.js";
import { hasValidCliToken, isLoopbackRequest } from "@/lib/auth/cliToken.js";

const SENSITIVE_HEADER_PATTERNS = ["authorization", "x-api-key", "cookie", "set-cookie", "x-auth-token"];

function maskHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = { ...headers };
  for (const k of Object.keys(out)) {
    const lk = k.toLowerCase();
    if (SENSITIVE_HEADER_PATTERNS.some((s) => lk.includes(s))) {
      const v = out[k];
      if (typeof v === "string") {
        out[k] = v.length > 14 ? `${v.slice(0, 10)}...${v.slice(-4)}` : "***";
      } else if (v != null) {
        out[k] = "***";
      }
    }
  }
  return out;
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided). Sensitive headers
  // are masked here so anything persisted downstream (e.g. saveRequestDetail
  // → DB) cannot be replayed.
  if (!clientRawRequest) {
    const url = new URL(request.url);
    const rawHeaders = Object.fromEntries(request.headers.entries());
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: maskHeaders(rawHeaders),
    };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support both messages[] and input[] formats)
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`);

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  let apiKeyRecord = null;
  let reservationId = null;
  // Loopback CLI bypass: requests originating from this host (model test
  // endpoints, MCP bridge, etc.) carry x-9r-cli-token derived from the
  // machine ID. Skip requireApiKey for those — quota/policy checks below
  // are also skipped naturally because apiKeyRecord stays null.
  const cliBypass = isLoopbackRequest(request) && (await hasValidCliToken(request));
  if (settings.requireApiKey && !cliBypass) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
    apiKeyRecord = await loadApiKeyPolicy(apiKey);
    const expiryCheck = checkApiKeyExpiry(apiKeyRecord);
    if (!expiryCheck.allowed) {
      log.warn("AUTH", expiryCheck.message);
      return errorResponse(expiryCheck.status, expiryCheck.message);
    }

    // Per-key IP allowlist (CIDR). Empty list = unrestricted.
    if (Array.isArray(apiKeyRecord?.allowedIps) && apiKeyRecord.allowedIps.length > 0) {
      const clientIp = getClientIp(request);
      if (!checkIpAllowlist(clientIp, apiKeyRecord.allowedIps)) {
        log.warn("AUTH", `API key denied for IP ${clientIp}`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, "API key is not allowed from this IP address");
      }
    }
    const quotaCheck = await checkApiKeyDailyTokenLimit(apiKeyRecord);
    if (!quotaCheck.allowed) {
      log.warn("AUTH", quotaCheck.message);
      const response = errorResponse(quotaCheck.status, quotaCheck.message);
      response.headers.set("X-Api-Key-Token-Limit", String(quotaCheck.limit));
      response.headers.set("X-Api-Key-Token-Used", String(quotaCheck.usage.totalTokens));
      response.headers.set("X-Api-Key-Token-Remaining", String(quotaCheck.remaining));
      response.headers.set("X-Api-Key-Token-Reset", quotaCheck.resetAt);
      return response;
    }

    // Monthly cap (resets first day of next local month).
    const monthCheck = await checkApiKeyMonthlyTokenLimit(apiKeyRecord);
    if (!monthCheck.allowed) {
      log.warn("AUTH", monthCheck.message);
      const response = errorResponse(monthCheck.status, monthCheck.message);
      response.headers.set("X-Api-Key-Month-Limit", String(monthCheck.limit));
      response.headers.set("X-Api-Key-Month-Used", String(monthCheck.usage.totalTokens));
      response.headers.set("X-Api-Key-Month-Reset", monthCheck.resetAt);
      return response;
    }

    // Lifetime cap (never resets — for prepaid token packs).
    const lifeCheck = await checkApiKeyLifetimeTokenLimit(apiKeyRecord);
    if (!lifeCheck.allowed) {
      log.warn("AUTH", lifeCheck.message);
      const response = errorResponse(lifeCheck.status, lifeCheck.message);
      response.headers.set("X-Api-Key-Lifetime-Limit", String(lifeCheck.limit));
      response.headers.set("X-Api-Key-Lifetime-Used", String(lifeCheck.usage.totalTokens));
      return response;
    }

    // Per-key requests-per-minute throttle. Sliding 60s window in RAM.
    const rateLimit = Number(apiKeyRecord?.requestsPerMinute || 0);
    if (rateLimit > 0) {
      const consumed = consumeRequest(apiKeyRecord.id, rateLimit);
      if (!consumed.allowed) {
        const retrySec = Math.max(1, Math.ceil(consumed.retryAfterMs / 1000));
        log.warn("AUTH", `API key rate limit ${consumed.current}/${consumed.limit} req/min`);
        const response = errorResponse(
          HTTP_STATUS.RATE_LIMITED,
          `API key rate limit exceeded (${consumed.current}/${consumed.limit} req/min)`
        );
        response.headers.set("Retry-After", String(retrySec));
        response.headers.set("X-Api-Key-Rate-Limit", String(consumed.limit));
        response.headers.set("X-Api-Key-Rate-Remaining", "0");
        return response;
      }
    }

    // Per-key max_tokens cap. Reject explicit overshoot, otherwise inject cap.
    const maxCheck = checkApiKeyMaxTokensPerRequest(apiKeyRecord, body);
    if (!maxCheck.allowed) {
      log.warn("AUTH", maxCheck.message);
      return errorResponse(maxCheck.status, maxCheck.message);
    }
    if (maxCheck.enforce) {
      // Inject cap into the most common fields. Providers will pick what they support.
      body.max_tokens = body.max_tokens ?? maxCheck.enforce;
      body.max_completion_tokens = body.max_completion_tokens ?? maxCheck.enforce;
    }

    // Reserve estimated tokens so concurrent requests see in-flight usage
    // when checking the daily/monthly/lifetime limits. Released when the
    // response stream ends.
    const hasAnyLimit = (apiKeyRecord?.dailyTokenLimit || 0) > 0
      || (apiKeyRecord?.monthlyTokenLimit || 0) > 0
      || (apiKeyRecord?.lifetimeTokenLimit || 0) > 0;
    if (hasAnyLimit) {
      reservationId = reserveTokens(apiKeyRecord.id, estimateRequestTokens(body));
    }
  }

  // Wrap any response returned from this point with the reservation lifecycle
  // so the in-flight token estimate is released exactly when the body finishes.
  const finalize = (response) => attachReservationLifecycle(response, reservationId);

  try {
    return finalize(await dispatchChat({
      body, modelStr, request, clientRawRequest, settings,
      apiKeyId: apiKeyRecord?.id || null, apiKeyRecord,
    }));
  } catch (error) {
    releaseTokens(reservationId);
    throw error;
  }
}

async function dispatchChat({ body, modelStr, request, clientRawRequest, settings, apiKeyId, apiKeyRecord }) {

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const modelCheck = checkApiKeyComboModelAccess(apiKeyRecord, modelStr, comboModels);
    if (!modelCheck.allowed) {
      log.warn("AUTH", modelCheck.message);
      return errorResponse(modelCheck.status, modelCheck.message);
    }

    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKeyId, apiKeyRecord),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKeyId, apiKeyRecord);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKeyId = null, apiKeyRecord = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      
      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKeyId, apiKeyRecord),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;
  const modelCheck = checkApiKeyModelAccess(apiKeyRecord, {
    requestedModel: modelStr,
    resolvedModels: [`${provider}/${model}`],
  });
  if (!modelCheck.allowed) {
    log.warn("AUTH", modelCheck.message);
    return errorResponse(modelCheck.status, modelCheck.message);
  }

  // Log model routing (alias → actual model)
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Log account selection
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKeyId,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      providerThinking,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) return result.response;

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
