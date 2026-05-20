// Wallet repo — VND-denominated balance + ledger for PAYG billing.
//
// All amounts are micro-VND (1 VND = 1_000_000 micro-VND) integers. The
// micro unit makes per-token rounding lossless across the hot path while
// keeping every value a plain JS number well below MAX_SAFE_INTEGER for
// realistic balances (1_000_000_000 VND = 1e15 micro, still safe).
//
// The ledger (`walletTransactions`) is append-only. Every credit or debit
// records its `delta` and the `balanceAfter` snapshot, captured inside the
// same transaction that mutates `customers.balance`. That gives admins a
// strict ordering for audits without resorting to window functions.
//
// Hot-path callers should use `chargeWalletInTxn(db, ...)` from inside an
// existing transaction (e.g. saveRequestUsage) so the debit lands together
// with the usage row.

import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { stringifyJson, parseJson } from "../helpers/jsonCol.js";

export const VND_MICRO_FACTOR = 1_000_000;

export function vndToMicro(vnd) {
  const n = Number(vnd);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * VND_MICRO_FACTOR);
}

export function microToVnd(micro) {
  const n = Number(micro);
  if (!Number.isFinite(n)) return 0;
  return n / VND_MICRO_FACTOR;
}

function rowToTxn(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customerId,
    apiKeyId: row.apiKeyId || null,
    delta: Number(row.delta || 0),
    balanceAfter: Number(row.balanceAfter || 0),
    type: row.type,
    refType: row.refType || null,
    refId: row.refId || null,
    provider: row.provider || null,
    model: row.model || null,
    promptTokens: Number(row.promptTokens || 0),
    completionTokens: Number(row.completionTokens || 0),
    meta: row.meta ? parseJson(row.meta, {}) : {},
    createdAt: row.createdAt,
  };
}

/**
 * Read balance + minLimit for a customer. Returns micro-VND values.
 */
export async function getWalletBalance(customerId) {
  if (!customerId) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT balance, balanceMinLimit FROM customers WHERE id = ?`, [customerId]);
  if (!row) return null;
  return {
    balance: Number(row.balance || 0),
    balanceMinLimit: Number(row.balanceMinLimit || 0),
  };
}

/**
 * Apply a debit/credit inside an EXISTING transaction. Caller must already
 * hold an active `db.transaction(...)` context (better-sqlite3 sync). This
 * is the function `saveRequestUsage` calls so usage + ledger commit atomically.
 *
 * Returns { id, balanceAfter } on success.
 */
export function applyWalletDeltaInTxn(db, {
  customerId,
  delta,
  type,
  apiKeyId = null,
  refType = null,
  refId = null,
  provider = null,
  model = null,
  promptTokens = 0,
  completionTokens = 0,
  meta = null,
}) {
  if (!customerId) throw new Error("customerId is required");
  if (!Number.isFinite(delta) || delta === 0) throw new Error("delta must be non-zero finite");
  if (!type) throw new Error("type is required");

  const cur = db.get(`SELECT balance FROM customers WHERE id = ?`, [customerId]);
  if (!cur) throw new Error("customer not found");
  const next = Number(cur.balance || 0) + Math.trunc(delta);

  db.run(`UPDATE customers SET balance = ?, updatedAt = ? WHERE id = ?`, [
    next,
    new Date().toISOString(),
    customerId,
  ]);

  const id = uuidv4();
  db.run(
    `INSERT INTO walletTransactions(id, customerId, apiKeyId, delta, balanceAfter, type, refType, refId, provider, model, promptTokens, completionTokens, meta, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      customerId,
      apiKeyId,
      Math.trunc(delta),
      next,
      type,
      refType,
      refId,
      provider,
      model,
      Math.trunc(promptTokens || 0),
      Math.trunc(completionTokens || 0),
      meta ? stringifyJson(meta) : null,
      new Date().toISOString(),
    ]
  );

  return { id, balanceAfter: next };
}

/**
 * Standalone wrapper that opens its own transaction. Use for top-up,
 * manual adjust, refund — anywhere the caller is not already in a txn.
 */
export async function applyWalletDelta(opts) {
  const db = await getAdapter();
  let result;
  db.transaction(() => {
    result = applyWalletDeltaInTxn(db, opts);
  });
  return result;
}

/**
 * Set the customer's overdraft floor (negative = allow overdraft to that
 * limit). Audit logging is the caller's responsibility.
 */
export async function setBalanceMinLimit(customerId, minLimitMicroVnd) {
  if (!customerId) throw new Error("customerId is required");
  const db = await getAdapter();
  db.run(`UPDATE customers SET balanceMinLimit = ?, updatedAt = ? WHERE id = ?`, [
    Math.trunc(Number(minLimitMicroVnd) || 0),
    new Date().toISOString(),
    customerId,
  ]);
  return getWalletBalance(customerId);
}

/**
 * List ledger rows for a customer (newest first). Optional period + type
 * filters mirror the user-facing wallet page.
 */
export async function listWalletTransactions(customerId, {
  limit = 50,
  offset = 0,
  type = null,
  startDate = null,
  endDate = null,
} = {}) {
  if (!customerId) return { items: [], total: 0 };
  const db = await getAdapter();
  const conds = ["customerId = ?"];
  const params = [customerId];
  if (type) { conds.push("type = ?"); params.push(type); }
  if (startDate) { conds.push("createdAt >= ?"); params.push(new Date(startDate).toISOString()); }
  if (endDate) { conds.push("createdAt <= ?"); params.push(new Date(endDate).toISOString()); }
  const where = `WHERE ${conds.join(" AND ")}`;
  const rows = db.all(
    `SELECT * FROM walletTransactions ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [...params, Math.max(1, Math.min(500, Number(limit) || 50)), Math.max(0, Number(offset) || 0)]
  );
  const totalRow = db.get(`SELECT COUNT(*) AS c FROM walletTransactions ${where}`, params);
  return { items: rows.map(rowToTxn), total: Number(totalRow?.c || 0) };
}

/**
 * Aggregate stats for admin revenue charts. Returns micro-VND sums grouped
 * by ISO date (YYYY-MM-DD, local UTC) over the last `days` calendar days.
 */
export async function getWalletDailyStats({ days = 30, type = null } = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (type) { conds.push("type = ?"); params.push(type); }
  const cutoff = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString();
  conds.push("createdAt >= ?");
  params.push(cutoff);
  const where = `WHERE ${conds.join(" AND ")}`;
  const rows = db.all(
    `SELECT substr(createdAt, 1, 10) AS dateKey,
            COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS creditMicro,
            COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS debitMicro,
            COUNT(*) AS count
       FROM walletTransactions ${where}
      GROUP BY dateKey
      ORDER BY dateKey ASC`,
    params
  );
  return rows.map((r) => ({
    dateKey: r.dateKey,
    creditMicroVnd: Number(r.creditMicro || 0),
    debitMicroVnd: Number(r.debitMicro || 0),
    count: Number(r.count || 0),
  }));
}

/**
 * Look up a transaction by id (admin detail view).
 */
export async function getWalletTransactionById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToTxn(db.get(`SELECT * FROM walletTransactions WHERE id = ?`, [id]));
}
