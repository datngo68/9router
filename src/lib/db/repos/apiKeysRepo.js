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

const RTK_MODES = new Set(["inherit", "on", "off"]);
const CAVEMAN_MODES = new Set(["inherit", "off", "lite", "full", "ultra"]);

function normalizeRtkMode(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return RTK_MODES.has(v) ? v : "inherit";
}

function normalizeCavemanMode(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CAVEMAN_MODES.has(v) ? v : "inherit";
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
    rtkMode: normalizeRtkMode(data.rtkMode),
    cavemanMode: normalizeCavemanMode(data.cavemanMode),
    paygEnabled: !!data.paygEnabled,
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
    rtkMode: normalizeRtkMode(row.rtkMode),
    cavemanMode: normalizeCavemanMode(row.cavemanMode),
    paygEnabled: row.paygEnabled === 1 || row.paygEnabled === true,
    customerId: row.customerId || null,
    orderId: row.orderId || null,
    createdAt: row.createdAt,
  };
}

export async function getApiKeysByCustomer(customerId) {
  if (!customerId) return [];
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys WHERE customerId = ? ORDER BY createdAt DESC`, [customerId]);
  return rows.map(rowToKey);
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
    `INSERT INTO apiKeys(id, key, keyHash, keyPrefix, keyLast4, name, machineId, isActive, dailyTokenLimit, monthlyTokenLimit, lifetimeTokenLimit, requestsPerMinute, maxTokensPerRequest, expiresAt, allowedModels, allowedIps, rtkMode, cavemanMode, paygEnabled, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      apiKey.rtkMode,
      apiKey.cavemanMode,
      apiKey.paygEnabled ? 1 : 0,
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
    if (Object.prototype.hasOwnProperty.call(data, "rtkMode")) {
      policyPatch.rtkMode = normalizeRtkMode(data.rtkMode);
    }
    if (Object.prototype.hasOwnProperty.call(data, "cavemanMode")) {
      policyPatch.cavemanMode = normalizeCavemanMode(data.cavemanMode);
    }
    if (Object.prototype.hasOwnProperty.call(data, "paygEnabled")) {
      policyPatch.paygEnabled = !!data.paygEnabled;
    }
    const merged = { ...existing, ...data, ...policyPatch };
    db.run(
      `UPDATE apiKeys SET name = ?, machineId = ?, isActive = ?, dailyTokenLimit = ?, monthlyTokenLimit = ?, lifetimeTokenLimit = ?, requestsPerMinute = ?, maxTokensPerRequest = ?, expiresAt = ?, allowedModels = ?, allowedIps = ?, rtkMode = ?, cavemanMode = ?, paygEnabled = ? WHERE id = ?`,
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
        merged.rtkMode,
        merged.cavemanMode,
        merged.paygEnabled ? 1 : 0,
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

// ───────────────────────────────────────────────────────────────────────
// Admin-side helpers: list-all with filters, bulk update, bulk delete.

const SORT_COLUMNS = new Set([
  "createdAt",
  "name",
  "expiresAt",
  "dailyTokenLimit",
  "monthlyTokenLimit",
  "lifetimeTokenLimit",
  "isActive",
]);

/**
 * List API keys for admin with optional filters and pagination.
 * Joins customers so the page can show owner email/name without a 2nd round-trip.
 *
 * @param {object} opts
 * @param {string} [opts.q]            - Substring on name/keyDisplay/customerEmail
 * @param {string} [opts.status]       - all|active|inactive|expired|expiringSoon
 * @param {string} [opts.customerId]
 * @param {string} [opts.sort]         - column from SORT_COLUMNS
 * @param {string} [opts.order]        - asc|desc (default desc)
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 * @returns {Promise<{ items: Array, total: number }>}
 */
export async function listAllApiKeys(opts = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];

  if (opts.q && String(opts.q).trim()) {
    const needle = `%${String(opts.q).trim().toLowerCase()}%`;
    where.push(
      `(LOWER(k.name) LIKE ? OR LOWER(COALESCE(k.keyPrefix,'') || COALESCE(k.keyLast4,'')) LIKE ? OR LOWER(COALESCE(c.email,'')) LIKE ? OR LOWER(COALESCE(c.displayName,'')) LIKE ?)`
    );
    params.push(needle, needle, needle, needle);
  }

  const status = opts.status || "all";
  const nowIso = new Date().toISOString();
  if (status === "active") {
    where.push(`k.isActive = 1 AND (k.expiresAt IS NULL OR k.expiresAt > ?)`);
    params.push(nowIso);
  } else if (status === "inactive") {
    where.push(`k.isActive = 0`);
  } else if (status === "expired") {
    where.push(`k.expiresAt IS NOT NULL AND k.expiresAt <= ?`);
    params.push(nowIso);
  } else if (status === "expiringSoon") {
    const soon = new Date(Date.now() + 7 * 86400000).toISOString();
    where.push(`k.expiresAt IS NOT NULL AND k.expiresAt > ? AND k.expiresAt <= ?`);
    params.push(nowIso, soon);
  }

  if (opts.customerId) {
    where.push(`k.customerId = ?`);
    params.push(String(opts.customerId));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortCol = SORT_COLUMNS.has(opts.sort) ? opts.sort : "createdAt";
  const order = String(opts.order || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);

  const rows = db.all(
    `SELECT k.*, c.email AS customerEmail, c.displayName AS customerName
       FROM apiKeys k
       LEFT JOIN customers c ON c.id = k.customerId
       ${whereSql}
       ORDER BY k.${sortCol} ${order}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRow = db.get(
    `SELECT COUNT(*) AS c
       FROM apiKeys k
       LEFT JOIN customers c ON c.id = k.customerId
       ${whereSql}`,
    params
  );

  const items = rows.map((row) => ({
    ...rowToKey(row),
    customerEmail: row.customerEmail || null,
    customerName: row.customerName || null,
  }));

  return { items, total: Number(totalRow?.c || 0) };
}

/**
 * Apply the same patch to many keys atomically. Each key is updated via
 * updateApiKey() so per-row policy normalisation runs.
 *
 * @param {string[]} ids
 * @param {object} patch  - same shape as updateApiKey (no id)
 */
export async function bulkUpdateApiKeys(ids, patch) {
  if (!Array.isArray(ids) || ids.length === 0) return { updated: 0 };
  const db = await getAdapter();
  let updated = 0;
  db.transaction(() => {
    for (const id of ids) {
      const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
      if (!row) continue;
      const existing = rowToKey(row);
      const policyPatch = {};
      if (Object.prototype.hasOwnProperty.call(patch, "dailyTokenLimit")) {
        policyPatch.dailyTokenLimit = normalizeDailyTokenLimit(patch.dailyTokenLimit);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "monthlyTokenLimit")) {
        policyPatch.monthlyTokenLimit = normalizeNonNegativeInt(patch.monthlyTokenLimit);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "lifetimeTokenLimit")) {
        policyPatch.lifetimeTokenLimit = normalizeNonNegativeInt(patch.lifetimeTokenLimit);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "requestsPerMinute")) {
        policyPatch.requestsPerMinute = normalizeNonNegativeInt(patch.requestsPerMinute);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "maxTokensPerRequest")) {
        policyPatch.maxTokensPerRequest = normalizeNonNegativeInt(patch.maxTokensPerRequest);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "expiresAt")) {
        policyPatch.expiresAt = normalizeExpiresAt(patch.expiresAt);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "allowedModels")) {
        policyPatch.allowedModels = normalizeAllowedModels(patch.allowedModels);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "allowedIps")) {
        policyPatch.allowedIps = normalizeAllowedIps(patch.allowedIps);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "rtkMode")) {
        policyPatch.rtkMode = normalizeRtkMode(patch.rtkMode);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "cavemanMode")) {
        policyPatch.cavemanMode = normalizeCavemanMode(patch.cavemanMode);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "paygEnabled")) {
        policyPatch.paygEnabled = !!patch.paygEnabled;
      }
      const merged = { ...existing, ...patch, ...policyPatch };
      db.run(
        `UPDATE apiKeys SET name = ?, machineId = ?, isActive = ?, dailyTokenLimit = ?, monthlyTokenLimit = ?, lifetimeTokenLimit = ?, requestsPerMinute = ?, maxTokensPerRequest = ?, expiresAt = ?, allowedModels = ?, allowedIps = ?, rtkMode = ?, cavemanMode = ?, paygEnabled = ? WHERE id = ?`,
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
          merged.rtkMode,
          merged.cavemanMode,
          merged.paygEnabled ? 1 : 0,
          id,
        ]
      );
      updated += 1;
    }
  });
  return { updated };
}

/**
 * Apply per-row patches that depend on the existing row state (e.g. add to
 * current quota, extend current expiry). Caller passes a function that, given
 * the existing key, returns a flat patch object accepted by updateApiKey-style
 * normalisation.
 *
 * @param {string[]} ids
 * @param {(existing: object) => object} buildPatch
 */
export async function bulkUpdateApiKeysWith(ids, buildPatch) {
  if (!Array.isArray(ids) || ids.length === 0) return { updated: 0 };
  const db = await getAdapter();
  let updated = 0;
  db.transaction(() => {
    for (const id of ids) {
      const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
      if (!row) continue;
      const existing = rowToKey(row);
      const patch = buildPatch(existing) || {};
      const policyPatch = {};
      if (Object.prototype.hasOwnProperty.call(patch, "dailyTokenLimit")) {
        policyPatch.dailyTokenLimit = normalizeDailyTokenLimit(patch.dailyTokenLimit);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "monthlyTokenLimit")) {
        policyPatch.monthlyTokenLimit = normalizeNonNegativeInt(patch.monthlyTokenLimit);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "lifetimeTokenLimit")) {
        policyPatch.lifetimeTokenLimit = normalizeNonNegativeInt(patch.lifetimeTokenLimit);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "requestsPerMinute")) {
        policyPatch.requestsPerMinute = normalizeNonNegativeInt(patch.requestsPerMinute);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "maxTokensPerRequest")) {
        policyPatch.maxTokensPerRequest = normalizeNonNegativeInt(patch.maxTokensPerRequest);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "expiresAt")) {
        policyPatch.expiresAt = normalizeExpiresAt(patch.expiresAt);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "allowedModels")) {
        policyPatch.allowedModels = normalizeAllowedModels(patch.allowedModels);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "allowedIps")) {
        policyPatch.allowedIps = normalizeAllowedIps(patch.allowedIps);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "rtkMode")) {
        policyPatch.rtkMode = normalizeRtkMode(patch.rtkMode);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "cavemanMode")) {
        policyPatch.cavemanMode = normalizeCavemanMode(patch.cavemanMode);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "paygEnabled")) {
        policyPatch.paygEnabled = !!patch.paygEnabled;
      }
      const merged = { ...existing, ...patch, ...policyPatch };
      db.run(
        `UPDATE apiKeys SET name = ?, machineId = ?, isActive = ?, dailyTokenLimit = ?, monthlyTokenLimit = ?, lifetimeTokenLimit = ?, requestsPerMinute = ?, maxTokensPerRequest = ?, expiresAt = ?, allowedModels = ?, allowedIps = ?, rtkMode = ?, cavemanMode = ?, paygEnabled = ? WHERE id = ?`,
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
          merged.rtkMode,
          merged.cavemanMode,
          merged.paygEnabled ? 1 : 0,
          id,
        ]
      );
      updated += 1;
    }
  });
  return { updated };
}

export async function bulkDeleteApiKeys(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0 };
  const db = await getAdapter();
  let deleted = 0;
  db.transaction(() => {
    for (const id of ids) {
      const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
      if ((res?.changes ?? 0) > 0) deleted += 1;
    }
  });
  return { deleted };
}
