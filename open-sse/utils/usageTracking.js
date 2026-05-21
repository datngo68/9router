/**
 * Token Usage Tracking - Extract, normalize, estimate and log token usage
 */

import { saveRequestUsage, appendRequestLog } from "@/lib/usageDb.js";
import { FORMATS } from "../translator/formats.js";

// ANSI color codes
export const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

// Buffer tokens to prevent context errors
const BUFFER_TOKENS = 2000;

// ─── Token multiplier cache ────────────────────────────────────────────
// Settings are admin-configured and rarely change. Cache them for 5s and
// refresh in the background so the streaming hot path stays sync.
const MULTIPLIER_CACHE_TTL_MS = 5000;
let _multiplierCache = { inMul: 1, outMul: 1, expiresAt: 0 };
let _refreshingMultipliers = false;

function refreshMultipliersAsync() {
  if (_refreshingMultipliers) return;
  _refreshingMultipliers = true;
  import("@/lib/db/repos/settingsRepo.js")
    .then(({ getSettings }) => getSettings())
    .then((s) => {
      const inMul = Number(s?.tokenInputMultiplier);
      const outMul = Number(s?.tokenOutputMultiplier);
      _multiplierCache = {
        inMul: Number.isFinite(inMul) && inMul >= 0 ? inMul : 1,
        outMul: Number.isFinite(outMul) && outMul >= 0 ? outMul : 1,
        expiresAt: Date.now() + MULTIPLIER_CACHE_TTL_MS,
      };
    })
    .catch(() => {})
    .finally(() => { _refreshingMultipliers = false; });
}

/**
 * Sync getter — returns last cached multipliers and triggers background
 * refresh when stale. First call (before refresh resolves) returns 1.0/1.0.
 */
export function getTokenMultipliersSync() {
  if (Date.now() > _multiplierCache.expiresAt) {
    refreshMultipliersAsync();
  }
  return { inMul: _multiplierCache.inMul, outMul: _multiplierCache.outMul };
}

/**
 * Scale a usage object by admin-configured input/output multipliers so the
 * client sees the same scaled numbers we persist to DB. Handles all known
 * shapes (Claude / OpenAI / Gemini / Responses) and nested details.
 *
 * Recomputes total_tokens from scaled prompt+completion when present so the
 * sum stays consistent.
 */
export function applyTokenMultipliersToUsage(usage) {
  if (!usage || typeof usage !== "object") return usage;
  const { inMul, outMul } = getTokenMultipliersSync();
  if (inMul === 1 && outMul === 1) return usage;

  const scale = (val, mul) => {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return val;
    return Math.round(n * mul);
  };

  const out = { ...usage };

  // OpenAI shape
  if (out.prompt_tokens !== undefined) out.prompt_tokens = scale(out.prompt_tokens, inMul);
  if (out.completion_tokens !== undefined) out.completion_tokens = scale(out.completion_tokens, outMul);
  if (out.cached_tokens !== undefined) out.cached_tokens = scale(out.cached_tokens, inMul);
  if (out.reasoning_tokens !== undefined) out.reasoning_tokens = scale(out.reasoning_tokens, outMul);

  // Claude shape
  if (out.input_tokens !== undefined) out.input_tokens = scale(out.input_tokens, inMul);
  if (out.output_tokens !== undefined) out.output_tokens = scale(out.output_tokens, outMul);
  if (out.cache_read_input_tokens !== undefined) out.cache_read_input_tokens = scale(out.cache_read_input_tokens, inMul);
  if (out.cache_creation_input_tokens !== undefined) out.cache_creation_input_tokens = scale(out.cache_creation_input_tokens, inMul);

  // Nested details (OpenAI)
  if (out.prompt_tokens_details && typeof out.prompt_tokens_details === "object") {
    const d = { ...out.prompt_tokens_details };
    if (d.cached_tokens !== undefined) d.cached_tokens = scale(d.cached_tokens, inMul);
    out.prompt_tokens_details = d;
  }
  if (out.completion_tokens_details && typeof out.completion_tokens_details === "object") {
    const d = { ...out.completion_tokens_details };
    if (d.reasoning_tokens !== undefined) d.reasoning_tokens = scale(d.reasoning_tokens, outMul);
    out.completion_tokens_details = d;
  }
  if (out.input_tokens_details && typeof out.input_tokens_details === "object") {
    const d = { ...out.input_tokens_details };
    if (d.cached_tokens !== undefined) d.cached_tokens = scale(d.cached_tokens, inMul);
    out.input_tokens_details = d;
  }
  if (out.output_tokens_details && typeof out.output_tokens_details === "object") {
    const d = { ...out.output_tokens_details };
    if (d.reasoning_tokens !== undefined) d.reasoning_tokens = scale(d.reasoning_tokens, outMul);
    out.output_tokens_details = d;
  }

  // Re-derive total_tokens from scaled prompt+completion when present
  if (out.total_tokens !== undefined) {
    const inT = Number(out.prompt_tokens ?? out.input_tokens ?? 0) || 0;
    const outT = Number(out.completion_tokens ?? out.output_tokens ?? 0) || 0;
    if (inT || outT) out.total_tokens = inT + outT;
  }

  return out;
}

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Add buffer tokens to usage to prevent context errors
 * @param {object} usage - Usage object (any format)
 * @returns {object} Usage with buffer added
 */
export function addBufferToUsage(usage) {
  if (!usage || typeof usage !== "object") return usage;

  const result = { ...usage };

  // Claude format
  if (result.input_tokens !== undefined) {
    result.input_tokens += BUFFER_TOKENS;
  }

  // OpenAI format
  if (result.prompt_tokens !== undefined) {
    result.prompt_tokens += BUFFER_TOKENS;
  }

  // Calculate or update total_tokens
  if (result.total_tokens !== undefined) {
    result.total_tokens += BUFFER_TOKENS;
  } else if (result.prompt_tokens !== undefined && result.completion_tokens !== undefined) {
    // Calculate total_tokens if not exists
    result.total_tokens = result.prompt_tokens + result.completion_tokens;
  }

  return result;
}

export function filterUsageForFormat(usage, targetFormat) {
  if (!usage || typeof usage !== "object") return usage;

  // Helper to pick only defined fields from usage
  const pickFields = (fields) => {
    const filtered = {};
    for (const field of fields) {
      if (usage[field] !== undefined) {
        filtered[field] = usage[field];
      }
    }
    return filtered;
  };

  // Define allowed fields for each format
  const formatFields = {
    [FORMATS.CLAUDE]: [
      'input_tokens', 'output_tokens', 
      'cache_read_input_tokens', 'cache_creation_input_tokens',
      'estimated'
    ],
    [FORMATS.GEMINI]: [
      'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount',
      'cachedContentTokenCount', 'thoughtsTokenCount',
      'estimated'
    ],
    [FORMATS.OPENAI_RESPONSES]: [
      'input_tokens', 'output_tokens',
      'input_tokens_details', 'output_tokens_details',
      'estimated'
    ],
    // OpenAI format (default for OPENAI, CODEX, KIRO, etc.)
    default: [
      'prompt_tokens', 'completion_tokens', 'total_tokens',
      'cached_tokens', 'reasoning_tokens',
      'prompt_tokens_details', 'completion_tokens_details',
      'estimated'
    ]
  };

  // Get fields for target format
  let fields = formatFields[targetFormat];
  
  // Use same fields for similar formats
  if (targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.ANTIGRAVITY) {
    fields = formatFields[FORMATS.GEMINI];
  } else if (targetFormat === FORMATS.OPENAI_RESPONSE) {
    fields = formatFields[FORMATS.OPENAI_RESPONSES];
  } else if (!fields) {
    fields = formatFields.default;
  }

  return pickFields(fields);
}

/**
 * Normalize usage object - ensure all values are valid numbers
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const normalized = {};
  const assignNumber = (key, value) => {
    if (value === undefined || value === null) return;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) normalized[key] = numeric;
  };

  assignNumber("prompt_tokens", usage?.prompt_tokens);
  assignNumber("completion_tokens", usage?.completion_tokens);
  assignNumber("total_tokens", usage?.total_tokens);
  assignNumber("cache_read_input_tokens", usage?.cache_read_input_tokens);
  assignNumber("cache_creation_input_tokens", usage?.cache_creation_input_tokens);
  assignNumber("cached_tokens", usage?.cached_tokens);
  assignNumber("reasoning_tokens", usage?.reasoning_tokens);

  // Preserve nested details objects for OpenAI format forwarding
  if (usage?.prompt_tokens_details && typeof usage.prompt_tokens_details === "object") {
    normalized.prompt_tokens_details = usage.prompt_tokens_details;
  }
  if (usage?.completion_tokens_details && typeof usage.completion_tokens_details === "object") {
    normalized.completion_tokens_details = usage.completion_tokens_details;
  }

  if (Object.keys(normalized).length === 0) return null;
  return normalized;
}

/**
 * Check if usage has valid token data
 * Valid = has at least one token field with value > 0
 * Invalid = empty object {}, null, undefined, no token fields, or all zeros
 */
export function hasValidUsage(usage) {
  if (!usage || typeof usage !== "object") return false;

  // Check for any known token field with value > 0
  const tokenFields = [
    "prompt_tokens", "completion_tokens", "total_tokens",  // OpenAI
    "input_tokens", "output_tokens",                        // Claude
    "promptTokenCount", "candidatesTokenCount"              // Gemini
  ];

  for (const field of tokenFields) {
    if (typeof usage[field] === "number" && usage[field] > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Extract usage from any format (Claude, OpenAI, Gemini, Responses API)
 */
export function extractUsage(chunk) {
  if (!chunk || typeof chunk !== "object") return null;

  // Claude format (message_delta event)
  if (chunk.type === "message_delta" && chunk.usage && typeof chunk.usage === "object") {
    return normalizeUsage({
      prompt_tokens: chunk.usage.input_tokens || 0,
      completion_tokens: chunk.usage.output_tokens || 0,
      cache_read_input_tokens: chunk.usage.cache_read_input_tokens,
      cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens
    });
  }

  // OpenAI Responses API format (response.completed or response.done)
  if ((chunk.type === "response.completed" || chunk.type === "response.done") && chunk.response?.usage && typeof chunk.response.usage === "object") {
    const usage = chunk.response.usage;
    const cachedTokens = usage.input_tokens_details?.cached_tokens;
    return normalizeUsage({
      prompt_tokens: usage.input_tokens || usage.prompt_tokens || 0,
      completion_tokens: usage.output_tokens || usage.completion_tokens || 0,
      cached_tokens: cachedTokens,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens,
      prompt_tokens_details: cachedTokens ? { cached_tokens: cachedTokens } : undefined
    });
  }

  // OpenAI format (also covers DeepSeek which uses prompt_cache_hit_tokens)
  if (chunk.usage && typeof chunk.usage === "object" && chunk.usage.prompt_tokens !== undefined) {
    return normalizeUsage({
      prompt_tokens: chunk.usage.prompt_tokens,
      completion_tokens: chunk.usage.completion_tokens || 0,
      cached_tokens: chunk.usage.prompt_tokens_details?.cached_tokens || chunk.usage.prompt_cache_hit_tokens,
      reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
      prompt_tokens_details: chunk.usage.prompt_tokens_details,
      completion_tokens_details: chunk.usage.completion_tokens_details
    });
  }

  // Gemini format (Antigravity)
  // Antigravity wraps usageMetadata inside response: { response: { usageMetadata: {...} } }
  const usageMeta = chunk.usageMetadata || chunk.response?.usageMetadata;
  if (usageMeta && typeof usageMeta === "object") {
    return normalizeUsage({
      prompt_tokens: usageMeta.promptTokenCount || 0,
      completion_tokens: usageMeta.candidatesTokenCount || 0,
      total_tokens: usageMeta.totalTokenCount,
      cached_tokens: usageMeta.cachedContentTokenCount,
      reasoning_tokens: usageMeta.thoughtsTokenCount
    });
  }

  // Ollama NDJSON format (raw from provider, before translation)
  // Ollama sends: {"model":"...","done":true,"prompt_eval_count":N,"eval_count":M}
  if (chunk.done === true && typeof chunk.prompt_eval_count === "number") {
    return normalizeUsage({
      prompt_tokens: chunk.prompt_eval_count || 0,
      completion_tokens: chunk.eval_count || 0,
      total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
    });
  }

  return null;
}

/**
 * Estimate input tokens from request body
 * Calculate total body size for more accurate estimation
 */
export function estimateInputTokens(body) {
  if (!body || typeof body !== "object") return 0;

  try {
    // Calculate total body size (includes messages, tools, system, thinking config, etc.)
    const bodyStr = JSON.stringify(body);
    const totalChars = bodyStr.length;

    // Estimate: ~4 chars per token (rough average across all tokenizers)
    return Math.ceil(totalChars / 4);
  } catch (err) {
    // Fallback if stringify fails
    return 0;
  }
}

/**
 * Estimate output tokens from content length
 */
export function estimateOutputTokens(contentLength) {
  if (!contentLength || contentLength <= 0) return 0;
  return Math.max(1, Math.floor(contentLength / 4));
}

/**
 * Format usage object based on target format
 * @param {number} inputTokens - Input/prompt tokens
 * @param {number} outputTokens - Output/completion tokens
 * @param {string} targetFormat - Target format from FORMATS
 */
export function formatUsage(inputTokens, outputTokens, targetFormat) {
  // Claude format uses input_tokens/output_tokens
  if (targetFormat === FORMATS.CLAUDE) {
    return addBufferToUsage({ 
      input_tokens: inputTokens, 
      output_tokens: outputTokens, 
      estimated: true 
    });
  }

  // Default: OpenAI format (works for openai, gemini, responses, etc.)
  return addBufferToUsage({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated: true
  });
}

/**
 * Estimate full usage when provider doesn't return it
 * @param {object} body - Request body for input token estimation
 * @param {number} contentLength - Content length for output token estimation
 * @param {string} targetFormat - Target format from FORMATS constant
 */
export function estimateUsage(body, contentLength, targetFormat = FORMATS.OPENAI) {
  return formatUsage(
    estimateInputTokens(body),
    estimateOutputTokens(contentLength),
    targetFormat
  );
}

/**
 * Log usage with cache info (green color)
 */
export function logUsage(provider, usage, model = null, connectionId = null, apiKeyId = null) {
  if (!usage || typeof usage !== "object") return;

  const p = provider?.toUpperCase() || "UNKNOWN";

  // Support both formats:
  // - OpenAI: prompt_tokens, completion_tokens
  // - Claude: input_tokens, output_tokens
  const inTokens = usage?.prompt_tokens || usage?.input_tokens || 0;
  const outTokens = usage?.completion_tokens || usage?.output_tokens || 0;
  const accountPrefix = connectionId ? connectionId.slice(0, 8) + "..." : "unknown";

  let msg = `[${getTimeString()}] 📊 ${COLORS.green}[USAGE] ${p} | in=${inTokens} | out=${outTokens} | account=${accountPrefix}${COLORS.reset}`;

  // Add estimated flag if present
  if (usage.estimated) {
    msg += ` ${COLORS.yellow}(estimated)${COLORS.reset}`;
  }

  // Add cache info if present (unified from different formats)
  const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || usage.prompt_tokens_details?.cached_tokens;
  if (cacheRead) msg += ` | cache_read=${cacheRead}`;

  const cacheCreation = usage.cache_creation_input_tokens;
  if (cacheCreation) msg += ` | cache_create=${cacheCreation}`;

  const reasoning = usage.reasoning_tokens;
  if (reasoning) msg += ` | reasoning=${reasoning}`;

  console.log(msg);

  // Save to usage DB
  const tokens = {
    prompt_tokens: inTokens,
    completion_tokens: outTokens,
    cache_read_input_tokens: cacheRead || 0,
    cache_creation_input_tokens: cacheCreation || 0,
    reasoning_tokens: reasoning || 0
  };
  saveRequestUsage({ model, provider, connectionId, tokens, apiKeyId: apiKeyId || undefined }).catch(() => { });
  appendRequestLog({ model, provider, connectionId, tokens, status: "200 OK" }).catch(() => { });
}
