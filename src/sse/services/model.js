// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections, getCustomModels } from "@/lib/localDb";
import {
  parseModel as parseModelCore,
  resolveModelAliasFromMap,
  getModelInfoCore,
  buildBareModelIndex,
  resolveBareModelId,
} from "open-sse/services/model.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

// Cache the reverse "bare-id -> aliases" index. Connections + custom models
// are read fresh once per TTL window so toggling a provider doesn't require a
// process restart, but we don't pay the DB cost on every chat request.
const BARE_INDEX_TTL_MS = 30_000;
let bareIndexCache = { value: null, expiresAt: 0, building: null };

async function getBareModelIndex() {
  const now = Date.now();
  if (bareIndexCache.value && bareIndexCache.expiresAt > now) {
    return bareIndexCache.value;
  }
  if (bareIndexCache.building) return bareIndexCache.building;

  bareIndexCache.building = (async () => {
    let connections = [];
    let customModels = [];
    try { connections = await getProviderConnections({ isActive: true }); } catch { /* db unavailable */ }
    try { customModels = await getCustomModels(); } catch { /* db unavailable */ }

    const availableAliases = new Set();
    for (const conn of connections || []) {
      if (!conn || conn.isActive === false) continue;
      // Active connection contributes both the canonical alias (cx, cc, …)
      // and a custom prefix the user might have set on providerSpecificData.
      const staticAlias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      if (staticAlias) availableAliases.add(staticAlias);
      const overridePrefix = conn?.providerSpecificData?.prefix;
      if (typeof overridePrefix === "string" && overridePrefix.trim()) {
        availableAliases.add(overridePrefix.trim());
      }
    }

    const index = buildBareModelIndex(
      PROVIDER_MODELS,
      Array.from(availableAliases),
      customModels || []
    );
    bareIndexCache = { value: index, expiresAt: Date.now() + BARE_INDEX_TTL_MS, building: null };
    return index;
  })();

  return bareIndexCache.building;
}

/** Test hook — drop the cached reverse index. */
export function _resetBareModelIndexCache() {
  bareIndexCache = { value: null, expiresAt: 0, building: null };
}

/**
 * Resolve a bare (no `/`) model id against the reverse catalog index.
 * Skips combo / user-alias lookups — caller decides ordering.
 *
 * @returns {Promise<null | { provider, providerAlias, model } | { ambiguous: true, candidates, model }>}
 */
export async function resolveBareModel(modelStr) {
  if (!modelStr || typeof modelStr !== "string" || modelStr.includes("/")) return null;
  const index = await getBareModelIndex();
  return resolveBareModelId(modelStr, index);
}

/**
 * Get full model info (parse or resolve)
 *
 * Return shape:
 *   { provider, model }                        — resolved
 *   { provider: null, model }                  — combo name (handled upstream)
 *   { provider: null, ambiguous: { candidates, model } } — bare id matches
 *     multiple active providers, caller should surface a 400 with the prefix
 *     hint instead of routing.
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Always check provider-node prefix matching using original input first
    const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
    const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
    if (matchedOpenAI) {
      return { provider: matchedOpenAI.id, model: parsed.model };
    }

    const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
    const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
    if (matchedAnthropic) {
      return { provider: matchedAnthropic.id, model: parsed.model };
    }

    const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
    const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
    if (matchedEmbedding) {
      return { provider: matchedEmbedding.id, model: parsed.model };
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  // User-defined model alias takes priority over the catalog reverse lookup
  // so existing behavior is preserved.
  const aliases = await getModelAliases();
  const resolvedAlias = resolveModelAliasFromMap(parsed.model, aliases);
  if (resolvedAlias) return resolvedAlias;

  // Bare model id (e.g. "gpt-5.5") — try to route to the unique active
  // provider that owns this id. Multiple owners → ambiguous, caller should
  // ask user to prefix explicitly.
  const index = await getBareModelIndex();
  const bare = resolveBareModelId(parsed.model, index);
  if (bare) {
    if (bare.ambiguous) {
      return { provider: null, model: parsed.model, ambiguous: { candidates: bare.candidates } };
    }
    return { provider: bare.provider, model: bare.model };
  }

  // Fallback: heuristic provider inference based on model name prefix. Only
  // honor it when the inferred provider has an active connection — otherwise
  // we'd happily forward `gpt-4` to OpenAI even though the user has no OpenAI
  // key configured, and the upstream auth error masks the real problem.
  const heuristic = await getModelInfoCore(modelStr, getModelAliases);
  if (heuristic?.provider) {
    let activeConnections = [];
    try { activeConnections = await getProviderConnections({ isActive: true }); } catch { /* db unavailable */ }
    const hasActive = (activeConnections || []).some(
      (c) => c?.provider === heuristic.provider && c.isActive !== false
    );
    if (hasActive) return heuristic;
  }

  // No resolved provider AND no active connection to fall back on. Surface a
  // structured "unresolved" so handlers can return a clear 400 instead of
  // routing to an upstream that will respond with a misleading auth error.
  return { provider: null, model: parsed.model, unresolved: true };
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
