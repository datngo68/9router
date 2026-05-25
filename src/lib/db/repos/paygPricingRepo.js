// PAYG (pay-as-you-go) pricing — VND-denominated, admin-configured.
//
// Storage: KV scope 'paygPricing'. Keyed by `${provider}|${model}` (or just
// `${model}` for provider-agnostic). Values:
//   { inputVnd, outputVnd, cachedVnd?, reasoningVnd?, cacheCreationVnd? }
// All rates are VND per 1M tokens.
//
// Resolver chain (first match wins):
//   1. exact `${provider}|${model}` lookup
//   2. exact `${model}` lookup (provider-agnostic)
//   3. exact baseModel lookup (strip "vendor/" prefix)
//   4. pattern match — admin can configure entries with key starting with
//      "pattern:" (e.g. "pattern:claude-opus-*") that match via simple glob.
//
// All public reads go through a 5s in-memory cache to keep the hot path
// allocation-free under load.

import { makeKv } from "../helpers/kvStore.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const paygKv = makeKv("paygPricing");
const CACHE_TTL_MS = 5000;
const PATTERN_PREFIX = "pattern:";

let cache = { value: null, expiresAt: 0 };

function invalidate() {
  cache = { value: null, expiresAt: 0 };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePattern(pattern) {
  // UX nicety: when admin enters a pattern without any `*`, treat it as a
  // prefix match (auto-append `*`). Matches user intuition — "pattern:cx/"
  // should hit every cx/* model, not just literal "cx/". Patterns that do
  // contain `*` keep their existing glob semantics.
  const p = pattern.includes("*") ? pattern : `${pattern}*`;
  return new RegExp("^" + p.split("*").map(escapeRegex).join(".*") + "$");
}

function normalizePricing(value) {
  const v = value && typeof value === "object" ? value : {};
  const num = (x) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    inputVnd: num(v.inputVnd),
    outputVnd: num(v.outputVnd),
    cachedVnd: v.cachedVnd != null ? num(v.cachedVnd) : null,
    reasoningVnd: v.reasoningVnd != null ? num(v.reasoningVnd) : null,
    cacheCreationVnd: v.cacheCreationVnd != null ? num(v.cacheCreationVnd) : null,
  };
}

async function loadAll() {
  const now = Date.now();
  if (cache.value && cache.expiresAt > now) return cache.value;
  const all = await paygKv.getAll();
  cache = { value: all, expiresAt: now + CACHE_TTL_MS };
  return all;
}

/**
 * Get all configured PAYG pricing entries. Returned as a flat map keyed by
 * raw KV key (provider|model, model, or "pattern:..." entries).
 */
export async function getAllPaygPricing() {
  const all = await loadAll();
  const out = {};
  for (const [k, v] of Object.entries(all || {})) {
    out[k] = normalizePricing(v);
  }
  return out;
}

/**
 * Resolve PAYG pricing for a (provider, model) pair. Returns null when no
 * entry matches — caller MUST treat this as "PAYG not configured" and
 * reject the request rather than charge zero.
 */
export async function getPaygPricingForModel(provider, model) {
  if (!model) return null;
  const all = await loadAll();
  const baseModel = model.includes("/") ? model.split("/").pop() : model;

  // 1. exact provider|model
  if (provider) {
    const exact = all[`${provider}|${model}`] ?? all[`${provider}|${baseModel}`];
    if (exact) return normalizePricing(exact);
  }

  // 2. exact model (with vendor prefix)
  if (all[model]) return normalizePricing(all[model]);

  // 3. exact baseModel
  if (all[baseModel]) return normalizePricing(all[baseModel]);

  // 4. patterns
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(PATTERN_PREFIX)) continue;
    const pattern = k.slice(PATTERN_PREFIX.length);
    const re = compilePattern(pattern);
    // Match candidates the admin most likely had in mind:
    //   - bare model id (e.g. "gpt-5.4")
    //   - vendor-prefixed id (e.g. "cx/gpt-5.4")  ← what users see in UI
    //   - vendor|model legacy form (kept for backwards-compat)
    const slashed = provider ? `${provider}/${model}` : model;
    const piped = provider ? `${provider}|${model}` : model;
    if (re.test(baseModel) || re.test(model) || re.test(slashed) || re.test(piped)) {
      return normalizePricing(v);
    }
  }

  return null;
}

/**
 * Bulk replace pricing entries. `entries` is an object keyed by KV key.
 * Setting a value to null removes that entry.
 */
export async function updatePaygPricing(entries) {
  if (!entries || typeof entries !== "object") return getAllPaygPricing();
  const db = await getAdapter();
  db.transaction(() => {
    for (const [k, v] of Object.entries(entries)) {
      if (v === null || v === undefined) {
        db.run(`DELETE FROM kv WHERE scope = 'paygPricing' AND key = ?`, [k]);
      } else {
        db.run(
          `INSERT INTO kv(scope, key, value) VALUES('paygPricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
          [k, stringifyJson(normalizePricing(v))]
        );
      }
    }
  });
  invalidate();
  return getAllPaygPricing();
}

export async function setPaygPricing(key, pricing) {
  if (!key) throw new Error("key is required");
  await paygKv.set(key, normalizePricing(pricing));
  invalidate();
  return getAllPaygPricing();
}

export async function removePaygPricing(key) {
  if (!key) return getAllPaygPricing();
  await paygKv.remove(key);
  invalidate();
  return getAllPaygPricing();
}

export async function resetAllPaygPricing() {
  await paygKv.clear();
  invalidate();
  return {};
}

/**
 * Calculate cost in micro-VND for a usage record. Returns null when no
 * pricing matches (caller must reject the request). All math is integer
 * to avoid float drift.
 *
 * micro-VND per token = (vndPer1M * 1e6) / 1e6 = vndPer1M (so we treat
 * vndPer1M as the rate per 1M tokens, multiply by tokens, then BigInt
 * divide by 1M while staying in micro-VND).
 *
 * cost_vnd = sum(tokens_i * rate_i) / 1_000_000
 * cost_microVnd = cost_vnd * 1_000_000 = sum(tokens_i * rate_i)
 */
export async function calculatePaygCostMicroVnd({ provider, model, tokens, minChargeVnd = 1 }) {
  if (!tokens) return { microVnd: 0, pricing: null };
  const pricing = await getPaygPricingForModel(provider, model);
  if (!pricing) return { microVnd: null, pricing: null };

  const inputTokens = Number(tokens.prompt_tokens || tokens.input_tokens || 0);
  const cachedTokens = Number(tokens.cached_tokens || tokens.cache_read_input_tokens || 0);
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
  const outputTokens = Number(tokens.completion_tokens || tokens.output_tokens || 0);
  const reasoningTokens = Number(tokens.reasoning_tokens || 0);
  const cacheCreationTokens = Number(tokens.cache_creation_input_tokens || 0);

  const inputRate = pricing.inputVnd;
  const cachedRate = pricing.cachedVnd != null ? pricing.cachedVnd : pricing.inputVnd;
  const outputRate = pricing.outputVnd;
  const reasoningRate = pricing.reasoningVnd != null ? pricing.reasoningVnd : pricing.outputVnd;
  const cacheCreationRate = pricing.cacheCreationVnd != null ? pricing.cacheCreationVnd : pricing.inputVnd;

  // microVnd = tokens * rateVndPer1M (because micro-VND = VND * 1e6, and
  // rate is per 1e6 tokens, the 1e6 cancels out perfectly).
  let microVnd = 0;
  microVnd += nonCachedInput * inputRate;
  microVnd += cachedTokens * cachedRate;
  microVnd += outputTokens * outputRate;
  microVnd += reasoningTokens * reasoningRate;
  microVnd += cacheCreationTokens * cacheCreationRate;
  microVnd = Math.round(microVnd);

  // Floor to minChargeVnd (in micro) when there was actual usage. Stops
  // tiny request floods from costing "0 VND" each.
  const minMicro = Math.max(0, Math.round(Number(minChargeVnd || 0) * 1_000_000));
  if (microVnd > 0 && microVnd < minMicro) microVnd = minMicro;

  return { microVnd, pricing };
}

// Test/admin reset hook.
export function _invalidatePaygPricingCache() {
  invalidate();
}
