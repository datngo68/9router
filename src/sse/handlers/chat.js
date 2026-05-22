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
import { getModelInfo, getComboModels, resolveBareModel } from "../services/model.js";
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
  checkApiKeyProviderAccess,
  filterConnectionsByApiKey,
  hasWalletHeadroom,
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
import { resolveAllowedScope } from "@/lib/db/repos/apiKeysRepo.js";

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
 *
 * options.preloadedApiKeyRecord: when supplied (e.g. from internal store-chat
 * proxy where the raw key never leaves the DB), skip the extract/validate
 * step and run all policy/quota checks against the provided record.
 */
export async function handleChat(request, clientRawRequest = null, options = {}) {
  const { preloadedApiKeyRecord = null } = options;
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
  let chargeFromWallet = false;
  // Loopback CLI bypass: requests originating from this host (model test
  // endpoints, MCP bridge, etc.) carry x-9r-cli-token derived from the
  // machine ID. Skip requireApiKey for those — quota/policy checks below
  // are also skipped naturally because apiKeyRecord stays null.
  const cliBypass = isLoopbackRequest(request) && (await hasValidCliToken(request));
  // Internal preload: store-chat proxy already resolved the customer's key
  // from session+DB. The raw key isn't persisted, so we accept the preloaded
  // record and let the policy/quota block below run on it.
  if (preloadedApiKeyRecord) {
    apiKeyRecord = preloadedApiKeyRecord;
  } else if (settings.requireApiKey && !cliBypass) {
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
  }

  if (apiKeyRecord) {
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
    // Quota checks. Run all 3 (daily/monthly/lifetime) and remember the
    // first failure. If `paygEnabled` is on AND the wallet has headroom we
    // override the failure and bill from wallet instead.
    const quotaCheck = await checkApiKeyDailyTokenLimit(apiKeyRecord);
    const monthCheck = quotaCheck.allowed ? await checkApiKeyMonthlyTokenLimit(apiKeyRecord) : { allowed: true };
    const lifeCheck = quotaCheck.allowed && monthCheck.allowed ? await checkApiKeyLifetimeTokenLimit(apiKeyRecord) : { allowed: true };
    const failedCheck = !quotaCheck.allowed ? quotaCheck : !monthCheck.allowed ? monthCheck : !lifeCheck.allowed ? lifeCheck : null;

    if (failedCheck) {
      // PAYG fallback: only when the wallet has headroom AND a customer is
      // attached (key without customerId can't bill anywhere).
      const canFallback =
        settings.walletEnabled !== false &&
        apiKeyRecord.customerId &&
        hasWalletHeadroom(apiKeyRecord);
      if (canFallback) {
        chargeFromWallet = true;
      } else {
        // If wallet is opted-in but balance ran out, surface a one-shot
        // notification so the customer can refill quickly.
        if (apiKeyRecord.paygEnabled && apiKeyRecord.customerId && settings.walletEnabled !== false) {
          import("@/lib/notifications/walletEvents.js")
            .then((m) => m.notifyPaygChargeFailed(
              { id: apiKeyRecord.customerId },
              { reason: "Số dư ví không đủ", model: modelStr }
            ))
            .catch(() => {});
        }
        log.warn("AUTH", failedCheck.message);
        const response = errorResponse(failedCheck.status, failedCheck.message);
        if (failedCheck === quotaCheck) {
          response.headers.set("X-Api-Key-Token-Limit", String(quotaCheck.limit));
          response.headers.set("X-Api-Key-Token-Used", String(quotaCheck.usage.totalTokens));
          response.headers.set("X-Api-Key-Token-Remaining", String(quotaCheck.remaining));
          response.headers.set("X-Api-Key-Token-Reset", quotaCheck.resetAt);
        } else if (failedCheck === monthCheck) {
          response.headers.set("X-Api-Key-Month-Limit", String(monthCheck.limit));
          response.headers.set("X-Api-Key-Month-Used", String(monthCheck.usage.totalTokens));
          response.headers.set("X-Api-Key-Month-Reset", monthCheck.resetAt);
        } else {
          response.headers.set("X-Api-Key-Lifetime-Limit", String(lifeCheck.limit));
          response.headers.set("X-Api-Key-Lifetime-Used", String(lifeCheck.usage.totalTokens));
        }
        return response;
      }
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
    // response stream ends. When billing wallet we also reserve a rough
    // upper-bound micro-VND so concurrent wallet requests don't all see the
    // same pre-debit balance and collectively overdraft.
    const hasAnyLimit = (apiKeyRecord?.dailyTokenLimit || 0) > 0
      || (apiKeyRecord?.monthlyTokenLimit || 0) > 0
      || (apiKeyRecord?.lifetimeTokenLimit || 0) > 0;
    if (hasAnyLimit || chargeFromWallet) {
      const tokenEstimate = hasAnyLimit ? estimateRequestTokens(body) : 0;
      // Conservative upper bound: assume 100 VND/1k tokens (≈4 USD/1M tokens
      // at 25k VND/USD with markup). The exact rate is resolved post-response.
      const walletEstimateMicroVnd = chargeFromWallet
        ? Math.max(100_000_000, estimateRequestTokens(body) * 100_000) // 100 VND = 100M micro
        : 0;
      reservationId = reserveTokens(apiKeyRecord.id, tokenEstimate, walletEstimateMicroVnd);
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
      // Combo is denied for this key — but the same name may also exist as a
      // bare model id in the catalog (e.g. user named a combo "gpt-5.5" that
      // shadows cx/gpt-5.5). Fall through to the single-model path so the
      // model-level access check decides, instead of dead-ending the request.
      const bare = await resolveBareModel(modelStr);
      if (bare && !bare.ambiguous && bare.provider) {
        const rewritten = `${bare.providerAlias}/${bare.model}`;
        log.warn("AUTH", `${modelCheck.message} — falling back to ${rewritten}`);
        return handleSingleModelChat(body, rewritten, clientRawRequest, request, apiKeyId, apiKeyRecord);
      }
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

  // Bare id matched several active providers — surface a clear hint instead
  // of guessing.
  if (modelInfo.ambiguous) {
    const hint = modelInfo.ambiguous.candidates.map((a) => `${a}/${modelStr}`).join(", ");
    log.warn("CHAT", `Ambiguous model id "${modelStr}" — candidates: ${hint}`);
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Ambiguous model id "${modelStr}". Please prefix with one of: ${hint}`
    );
  }

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
    if (modelInfo.unresolved) {
      log.warn("CHAT", `Unresolved model "${modelStr}" — no active connection owns this id`);
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `Model "${modelStr}" is not available. Add a provider connection that exposes this model, or prefix the id (e.g. cx/${modelStr}).`
      );
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

  // Provider access check: allowedProviders / allowedConnectionIds
  let resolvedScope = null;
  if (apiKeyRecord) {
    resolvedScope = await resolveAllowedScope(apiKeyRecord);
    if (!resolvedScope.unrestricted) {
      const provCheck = checkApiKeyProviderAccess(apiKeyRecord, provider, resolvedScope.providers);
      if (!provCheck.allowed) {
        log.warn("AUTH", provCheck.message);
        return errorResponse(provCheck.status, provCheck.message);
      }
    }
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
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { apiKeyRecord });

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

    // Per-key compress overrides. "inherit" → use global setting; "on/off" or
    // explicit caveman level → override. Caveman "off" disables completely.
    const keyRtkMode = apiKeyRecord?.rtkMode || "inherit";
    const effectiveRtk = keyRtkMode === "inherit"
      ? !!chatSettings.rtkEnabled
      : keyRtkMode === "on";

    const keyCavemanMode = apiKeyRecord?.cavemanMode || "inherit";
    let effectiveCavemanEnabled;
    let effectiveCavemanLevel;
    if (keyCavemanMode === "inherit") {
      effectiveCavemanEnabled = !!chatSettings.cavemanEnabled;
      effectiveCavemanLevel = chatSettings.cavemanLevel || "full";
    } else if (keyCavemanMode === "off") {
      effectiveCavemanEnabled = false;
      effectiveCavemanLevel = "full";
    } else {
      effectiveCavemanEnabled = true;
      effectiveCavemanLevel = keyCavemanMode;
    }
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
      rtkEnabled: effectiveRtk,
      cavemanEnabled: effectiveCavemanEnabled,
      cavemanLevel: effectiveCavemanLevel,
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
