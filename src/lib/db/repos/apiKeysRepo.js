import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function normalizeNonNegativeInt(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

const normalizeDailyTokenLimit = normalizeNonNegativeInt;

function normalizeExpiresAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeAllowedModels(value) {
  const list = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(list)) return [];
  return Array.from(
    new Set(
      list
        .map((model) => (typeof model === "string" ? model.trim() : ""))
        .filter(Boolean)
    )
  );
}

function normalizeAllowedIps(value) {
  const list = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(list)) return [];
  return Array.from(
    new Set(
      list
        .map((ip) => (typeof ip === "string" ? ip.trim() : ""))
        .filter(Boolean)
    )
  );
}

export function normalizeApiKeyPolicy(data = {}) {
  return {
    dailyTokenLimit: normalizeDailyTokenLimit(data.dailyTokenLimit),
    monthlyTokenLimit: normalizeNonNegativeInt(data.monthlyTokenLimit),
    lifetimeTokenLimit: normalizeNonNegativeInt(data.lifetimeTokenLimit),
    requestsPerMinute: normalizeNonNegativeInt(data.requestsPerMinute),
    maxTokensPerRequest: normalizeNonNegativeInt(data.maxTokensPerRequest),
    expiresAt: normalizeExpiresAt(data.expiresAt),
    allowedModels: normalizeAllowedModels(data.allowedModels),
    allowedIps: normalizeAllowedIps(data.allowedIps),
  };
}

function isExpired(expiresAt) {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

// Public: hash a raw API key. Used by everything that needs to look the key
// up by hash, including the chat handler before it touches the DB.
export function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(String(rawKey)).digest("hex");
}

function maskedKeyDisplay(prefix, last4) {
  const p = prefix || "";
  const l = last4 || "";
  return l ? `${p}...${l}` : p;
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    // No raw key in returned objects after migration. `keyHash` and prefix/last4
    // are the only persistent identifiers post-create.
    keyHash: row.keyHash || null,
    keyPrefix: row.keyPrefix || null,
    keyLast4: row.keyLast4 || null,
    keyDisplay: maskedKeyDisplay(row.keyPrefix, row.keyLast4),
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    dailyTokenLimit: normalizeDailyTokenLimit(row.dailyTokenLimit),
    monthlyTokenLimit: normalizeNonNegativeInt(row.monthlyTokenLimit),
    lifetimeTokenLimit: normalizeNonNegativeInt(row.lifetimeTokenLimit),
    requestsPerMinute: normalizeNonNegativeInt(row.requestsPerMinute),
    maxTokensPerRequest: normalizeNonNegativeInt(row.maxTokensPerRequest),
    expiresAt: normalizeExpiresAt(row.expiresAt),
    allowedModels: normalizeAllowedModels(row.allowedModels),
    allowedIps: normalizeAllowedIps(row.allowedIps),
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

/**
 * Look up an API key record by its raw plaintext key. Hashes the input
 * (timing-safe at the SHA-256 level) and queries by keyHash.
 */
export async function getApiKeyByKey(rawKey) {
  if (!rawKey) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE keyHash = ?`, [hashApiKey(rawKey)]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const policy = normalizeApiKeyPolicy(options);
  const keyHash = hashApiKey(result.key);
  const keyPrefix = result.key.slice(0, Math.min(7, result.key.length));
  const keyLast4 = result.key.length >= 4 ? result.key.slice(-4) : result.key;

  const apiKey = {
    id: uuidv4(),
    name,
    machineId,
    isActive: true,
    keyHash,
    keyPrefix,
    keyLast4,
    keyDisplay: maskedKeyDisplay(keyPrefix, keyLast4),
    ...policy,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, keyHash, keyPrefix, keyLast4, name, machineId, isActive, dailyTokenLimit, monthlyTokenLimit, lifetimeTokenLimit, requestsPerMinute, maxTokensPerRequest, expiresAt, allowedModels, allowedIps, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      null, // never persist plaintext
      apiKey.keyHash,
      apiKey.keyPrefix,
      apiKey.keyLast4,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.dailyTokenLimit,
      apiKey.monthlyTokenLimit,
      apiKey.lifetimeTokenLimit,
      apiKey.requestsPerMinute,
      apiKey.maxTokensPerRequest,
      apiKey.expiresAt,
      stringifyJson(apiKey.allowedModels),
      stringifyJson(apiKey.allowedIps),
      apiKey.createdAt,
    ]
  );
  // Returned object includes the raw key ONCE for the create-key UI. Caller
  // must not persist it further.
  return { ...apiKey, key: result.key };
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToKey(row);
    const policyPatch = {};
    if (Object.prototype.hasOwnProperty.call(data, "dailyTokenLimit")) {
      policyPatch.dailyTokenLimit = normalizeDailyTokenLimit(data.dailyTokenLimit);
    }
    if (Object.prototype.hasOwnProperty.call(data, "requestsPerMinute")) {
      policyPatch.requestsPerMinute = normalizeNonNegativeInt(data.requestsPerMinute);
    }
    if (Object.prototype.hasOwnProperty.call(data, "maxTokensPerRequest")) {
      policyPatch.maxTokensPerRequest = normalizeNonNegativeInt(data.maxTokensPerRequest);
    }
    if (Object.prototype.hasOwnProperty.call(data, "expiresAt")) {
      policyPatch.expiresAt = normalizeExpiresAt(data.expiresAt);
    }
    if (Object.prototype.hasOwnProperty.call(data, "allowedModels")) {
      policyPatch.allowedModels = normalizeAllowedModels(data.allowedModels);
    }
    if (Object.prototype.hasOwnProperty.call(data, "allowedIps")) {
      policyPatch.allowedIps = normalizeAllowedIps(data.allowedIps);
    }
    const merged = { ...existing, ...data, ...policyPatch };
    db.run(
      `UPDATE apiKeys SET name = ?, machineId = ?, isActive = ?, dailyTokenLimit = ?, monthlyTokenLimit = ?, lifetimeTokenLimit = ?, requestsPerMinute = ?, maxTokensPerRequest = ?, expiresAt = ?, allowedModels = ?, allowedIps = ? WHERE id = ?`,
      [
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        merged.dailyTokenLimit,
        merged.monthlyTokenLimit,
        merged.lifetimeTokenLimit,
        merged.requestsPerMinute,
        merged.maxTokensPerRequest,
        merged.expiresAt,
        stringifyJson(merged.allowedModels),
        stringifyJson(merged.allowedIps),
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(rawKey) {
  const row = await getApiKeyByKey(rawKey);
  if (!row) return false;
  return row.isActive && !isExpired(row.expiresAt);
}
