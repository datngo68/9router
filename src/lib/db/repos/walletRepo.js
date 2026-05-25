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
 * Aggregate totals across the wallet ledger over a window. Returns micro-VND
 * sums grouped by transaction `type` (topup / charge / planPurchase / refund /
 * adjustment / etc.) so the admin overview can show "tổng nạp", "tổng tiêu"
 * etc. without re-scanning the table.
 */
export async function getWalletTotals({ days = 30 } = {}) {
  const db = await getAdapter();
  const cutoff = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString();
  const rows = db.all(
    `SELECT type,
            COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS creditMicro,
            COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS debitMicro,
            COUNT(*) AS count
       FROM walletTransactions
      WHERE createdAt >= ?
      GROUP BY type
      ORDER BY type ASC`,
    [cutoff]
  );
  return rows.map((r) => ({
    type: r.type,
    creditMicroVnd: Number(r.creditMicro || 0),
    debitMicroVnd: Number(r.debitMicro || 0),
    count: Number(r.count || 0),
  }));
}

/**
 * Snapshot of currently held balances. Used by admin overview to track total
 * float and customer concentration. Only returns customers with non-zero
 * balance OR balanceMinLimit (overdraft floor) to keep the list short on
 * deployments with thousands of dormant customers.
 */
export async function getWalletBalanceSnapshot({ limit = 50 } = {}) {
  const db = await getAdapter();
  const totals = db.get(
    `SELECT
        COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS positiveMicro,
        COALESCE(SUM(CASE WHEN balance < 0 THEN -balance ELSE 0 END), 0) AS negativeMicro,
        COUNT(CASE WHEN balance > 0 THEN 1 END) AS positiveCount,
        COUNT(CASE WHEN balance < 0 THEN 1 END) AS negativeCount,
        COUNT(*) AS totalCustomers
       FROM customers`
  );
  const top = db.all(
    `SELECT id, email, displayName, balance, balanceMinLimit, updatedAt
       FROM customers
      WHERE balance != 0 OR balanceMinLimit != 0
      ORDER BY balance DESC
      LIMIT ?`,
    [Math.max(1, Math.min(500, Number(limit) || 50))]
  );
  return {
    positiveMicroVnd: Number(totals?.positiveMicro || 0),
    negativeMicroVnd: Number(totals?.negativeMicro || 0),
    positiveCount: Number(totals?.positiveCount || 0),
    negativeCount: Number(totals?.negativeCount || 0),
    totalCustomers: Number(totals?.totalCustomers || 0),
    top: top.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      balanceMicroVnd: Number(r.balance || 0),
      balanceMinLimitMicroVnd: Number(r.balanceMinLimit || 0),
      updatedAt: r.updatedAt,
    })),
  };
}

/**
 * Top customers by activity in the period. Caller picks the metric:
 *   - "topup"        sum of credits with type='topup'
 *   - "charge"       sum of debits with type='charge' (PAYG burn)
 *   - "planPurchase" sum of debits with type='planPurchase'
 *   - "spend"        sum of all debits regardless of type
 */
export async function getTopWalletCustomers({ days = 30, metric = "spend", limit = 10 } = {}) {
  const db = await getAdapter();
  const cutoff = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString();
  let whereType = "";
  let valueExpr = "";
  if (metric === "topup") {
    whereType = "AND wt.type = 'topup'";
    valueExpr = "SUM(CASE WHEN wt.delta > 0 THEN wt.delta ELSE 0 END)";
  } else if (metric === "charge") {
    whereType = "AND wt.type = 'charge'";
    valueExpr = "SUM(CASE WHEN wt.delta < 0 THEN -wt.delta ELSE 0 END)";
  } else if (metric === "planPurchase") {
    whereType = "AND wt.type = 'planPurchase'";
    valueExpr = "SUM(CASE WHEN wt.delta < 0 THEN -wt.delta ELSE 0 END)";
  } else {
    valueExpr = "SUM(CASE WHEN wt.delta < 0 THEN -wt.delta ELSE 0 END)";
  }
  const rows = db.all(
    `SELECT wt.customerId AS id, c.email, c.displayName, c.balance,
            ${valueExpr} AS value, COUNT(*) AS count
       FROM walletTransactions wt
       LEFT JOIN customers c ON c.id = wt.customerId
      WHERE wt.createdAt >= ? ${whereType}
      GROUP BY wt.customerId
     HAVING value > 0
      ORDER BY value DESC
      LIMIT ?`,
    [cutoff, Math.max(1, Math.min(100, Number(limit) || 10))]
  );
  return rows.map((r) => ({
    customerId: r.id,
    email: r.email || r.id,
    displayName: r.displayName || null,
    valueMicroVnd: Number(r.value || 0),
    count: Number(r.count || 0),
    balanceMicroVnd: Number(r.balance || 0),
  }));
}

/**
 * Top models by PAYG burn over the period. Used for admin product analytics
 * (which models bring in the most VND).
 */
export async function getTopWalletModels({ days = 30, limit = 10 } = {}) {
  const db = await getAdapter();
  const cutoff = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString();
  const rows = db.all(
    `SELECT provider, model,
            COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS debitMicro,
            SUM(promptTokens) AS prompt,
            SUM(completionTokens) AS completion,
            COUNT(*) AS count
       FROM walletTransactions
      WHERE createdAt >= ? AND type = 'charge' AND model IS NOT NULL
      GROUP BY provider, model
      ORDER BY debitMicro DESC
      LIMIT ?`,
    [cutoff, Math.max(1, Math.min(100, Number(limit) || 10))]
  );
  return rows.map((r) => ({
    provider: r.provider || "?",
    model: r.model || "?",
    debitMicroVnd: Number(r.debitMicro || 0),
    promptTokens: Number(r.prompt || 0),
    completionTokens: Number(r.completion || 0),
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
