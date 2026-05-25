// Orders repo. Lifecycle:
//   pending → paid → delivered     (happy path; admin confirms)
//   pending → cancelled
//   delivered → refunded            (manual)
//
// confirmOrderAtomic does the critical fulfilment in one transaction:
//   1. Create apiKey using policy from plan
//   2. Update order: apiKeyId, status=delivered, paidAt, deliveredAt
//   3. Tag apiKey with customerId + orderId
// Caller is responsible for sending notifications afterward.

import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { getPricingPlanById, planToApiKeyPolicy } from "./pricingPlansRepo.js";
import { hashApiKey } from "./apiKeysRepo.js";
import { validateVoucherForOrder, redeemVoucherInTxn } from "./vouchersRepo.js";

const ORDER_STATUS = new Set(["pending", "paid", "delivered", "cancelled", "refunded"]);

function shortRef() {
  // 8-char base32 friendly string for bank transfer memo.
  return crypto.randomBytes(5).toString("base64url").slice(0, 8).toUpperCase();
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customerId,
    planId: row.planId,
    kind: row.kind || "plan",
    status: row.status,
    priceVnd: Number(row.priceVnd || 0),
    originalPriceVnd: row.originalPriceVnd != null ? Number(row.originalPriceVnd) : Number(row.priceVnd || 0),
    discountVnd: Number(row.discountVnd || 0),
    voucherId: row.voucherId || null,
    voucherCode: row.voucherCode || null,
    paymentMethod: row.paymentMethod || null,
    paymentRef: row.paymentRef || null,
    apiKeyId: row.apiKeyId || null,
    targetApiKeyId: row.targetApiKeyId || null,
    notes: row.notes || null,
    createdAt: row.createdAt,
    paidAt: row.paidAt || null,
    deliveredAt: row.deliveredAt || null,
    cancelledAt: row.cancelledAt || null,
    refundedAt: row.refundedAt || null,
    apibankOrderId: row.apibankOrderId || null,
    apibankCode: row.apibankCode || null,
    apibankExpiredAt: row.apibankExpiredAt || null,
  };
}

/**
 * Apply a plan's policy onto an existing apiKey (renewal/top-up).
 *
 * Replace semantics: the key's policy fields (quota, caps, allowedModels,
 * expiry) become exactly the plan's values. Identity fields (id, keyHash,
 * name, customerId, paygEnabled, allowedProviders, allowedConnectionIds)
 * are preserved so existing integrations keep working.
 *
 * Notes:
 *   - Plan-derived expiry replaces the existing expiry. A "no-expiry" plan
 *     (expiresAfterDays = 0 AND expiresAfterMinutes = 0) clears expiry.
 *   - Quota fields become the plan's value verbatim — including 0 which
 *     means "unlimited" in the rest of the codebase.
 *   - Existing usage counters (daily/monthly/lifetime tokens) are computed
 *     against this apiKey's id from `usageHistory`, so a renewal does not
 *     wipe today's already-used tokens. Day/month rolls over naturally;
 *     lifetime carries over since the row keeps its id.
 *   - The key is force-activated (isActive = 1) so a paused/expired key is
 *     usable again right after renewal.
 *
 * Caller MUST run this inside an open transaction.
 */
function applyPlanTopupInTxn(db, { keyId, plan }) {
  const row = db.get(`SELECT id FROM apiKeys WHERE id = ?`, [keyId]);
  if (!row) throw new Error("target apiKey not found");
  const policy = planToApiKeyPolicy(plan);
  const now = new Date().toISOString();

  db.run(
    `UPDATE apiKeys
        SET dailyTokenLimit = ?,
            monthlyTokenLimit = ?,
            lifetimeTokenLimit = ?,
            requestsPerMinute = ?,
            maxTokensPerRequest = ?,
            rateLimitWindowSec = ?,
            expiresAt = ?,
            allowedModels = ?,
            quotaResetAt = ?,
            isActive = 1
      WHERE id = ?`,
    [
      Number(policy.dailyTokenLimit || 0),
      Number(policy.monthlyTokenLimit || 0),
      Number(policy.lifetimeTokenLimit || 0),
      Number(policy.requestsPerMinute || 0),
      Number(policy.maxTokensPerRequest || 0),
      Number(policy.rateLimitWindowSec || 0),
      policy.expiresAt || null,
      JSON.stringify(policy.allowedModels || []),
      now,
      keyId,
    ]
  );

  return { keyId, expiresAt: policy.expiresAt || null, quotaResetAt: now };
}

export async function createOrder({ customerId, planId, paymentMethod = "bank", notes = null, voucherCode = null, targetApiKeyId = null }) {
  if (!customerId) throw new Error("customerId is required");
  if (!planId) throw new Error("planId is required");
  const plan = await getPricingPlanById(planId);
  if (!plan) throw new Error("plan not found");
  if (!plan.isActive) throw new Error("plan is inactive");

  if (plan.maxPurchasesPerCustomer > 0) {
    const purchased = await countCustomerPlanPurchases({ customerId, planId });
    if (purchased >= plan.maxPurchasesPerCustomer) {
      throw new Error(`Bạn đã mua gói này tối đa ${plan.maxPurchasesPerCustomer} lần`);
    }
  }

  // Renewal/top-up target validation: must belong to the same customer.
  if (targetApiKeyId) {
    const db0 = await getAdapter();
    const row = db0.get(`SELECT customerId FROM apiKeys WHERE id = ?`, [targetApiKeyId]);
    if (!row) throw new Error("target apiKey không tồn tại");
    if (row.customerId !== customerId) throw new Error("target apiKey không thuộc tài khoản này");
  }

  // Voucher resolution: dry-run validate before opening the transaction so we
  // can return a clean human error. Inside the txn we re-check + redeem
  // atomically to handle race conditions on maxUses.
  let voucherCheck = null;
  if (voucherCode) {
    voucherCheck = await validateVoucherForOrder({
      code: voucherCode,
      customerId,
      plan,
    });
    if (!voucherCheck.ok) throw new Error(voucherCheck.reason || "Voucher không hợp lệ");
  }

  const db = await getAdapter();
  const id = `9R-${shortRef()}`;
  const now = new Date().toISOString();
  const originalPriceVnd = plan.priceVnd;
  const discountVnd = voucherCheck?.discountVnd || 0;
  const finalPriceVnd = Math.max(0, originalPriceVnd - discountVnd);

  db.transaction(() => {
    db.run(
      `INSERT INTO orders(id, customerId, planId, kind, status, priceVnd, originalPriceVnd, discountVnd, voucherId, voucherCode, paymentMethod, targetApiKeyId, notes, createdAt) VALUES(?, ?, ?, 'plan', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        customerId,
        planId,
        finalPriceVnd,
        originalPriceVnd,
        discountVnd,
        voucherCheck?.voucher?.id || null,
        voucherCheck?.voucher?.code || null,
        paymentMethod,
        targetApiKeyId || null,
        notes,
        now,
      ]
    );
    if (voucherCheck?.voucher) {
      redeemVoucherInTxn({
        db,
        voucherId: voucherCheck.voucher.id,
        customerId,
        orderId: id,
        discountVnd,
        planId,
        planPriceVnd: originalPriceVnd,
      });
    }
  });
  return getOrderById(id);
}

/**
 * Create a wallet top-up order. No plan, no voucher — just a customer
 * crediting their PAYG balance. The webhook handler detects `kind = 'walletTopup'`
 * and credits the wallet instead of creating an apiKey.
 */
export async function createTopupOrder({ customerId, amountVnd, paymentMethod = "bank", notes = null }) {
  if (!customerId) throw new Error("customerId is required");
  const amount = Math.trunc(Number(amountVnd) || 0);
  if (amount <= 0) throw new Error("amountVnd must be positive");

  const db = await getAdapter();
  const id = `9W-${shortRef()}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO orders(id, customerId, planId, kind, status, priceVnd, originalPriceVnd, discountVnd, paymentMethod, notes, createdAt) VALUES(?, ?, NULL, 'walletTopup', 'pending', ?, ?, 0, ?, ?, ?)`,
    [id, customerId, amount, amount, paymentMethod, notes, now]
  );
  return getOrderById(id);
}

/**
 * Counts how many orders of (customerId, planId) consume a purchase slot.
 * Status policy: pending / paid / delivered all count (so a user can't
 * spam-create pending orders to bypass the limit). Cancelled and refunded
 * do NOT count — they free the slot back up.
 */
export async function countCustomerPlanPurchases({ customerId, planId }) {
  if (!customerId || !planId) return 0;
  const db = await getAdapter();
  const row = db.get(
    `SELECT COUNT(*) AS n FROM orders WHERE customerId = ? AND planId = ? AND status IN ('pending', 'paid', 'delivered')`,
    [customerId, planId]
  );
  return Number(row?.n || 0);
}

export async function getOrderById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToOrder(db.get(`SELECT * FROM orders WHERE id = ?`, [id]));
}

/**
 * Look up an order by the APIBank `customer_ref` (which is the 9router order
 * id) or by the parallel APIBank order id we previously stored. Used by the
 * webhook handler to resolve `payment.succeeded` events back to a 9router
 * order without trusting only one identifier.
 */
export async function findOrderByApibankRef({ routerOrderId = null, apibankOrderId = null, apibankCode = null } = {}) {
  const db = await getAdapter();
  if (routerOrderId) {
    const row = db.get(`SELECT * FROM orders WHERE id = ?`, [routerOrderId]);
    if (row) return rowToOrder(row);
  }
  if (apibankOrderId) {
    const row = db.get(`SELECT * FROM orders WHERE apibankOrderId = ?`, [apibankOrderId]);
    if (row) return rowToOrder(row);
  }
  if (apibankCode) {
    const row = db.get(`SELECT * FROM orders WHERE apibankCode = ?`, [apibankCode]);
    if (row) return rowToOrder(row);
  }
  return null;
}

/**
 * Persist the APIBank order returned from POST /v1/orders so we can render
 * the right QR + reconcile webhooks later. Idempotent — overwrites previous
 * values (admin may re-create an APIBank order if the first one expired).
 */
export async function attachApibankOrder(orderId, { apibankOrderId, apibankCode, apibankExpiredAt = null } = {}) {
  if (!orderId) throw new Error("orderId is required");
  if (!apibankOrderId || !apibankCode) throw new Error("apibankOrderId and apibankCode are required");
  const db = await getAdapter();
  db.run(
    `UPDATE orders SET apibankOrderId = ?, apibankCode = ?, apibankExpiredAt = ? WHERE id = ?`,
    [apibankOrderId, apibankCode, apibankExpiredAt, orderId]
  );
  return getOrderById(orderId);
}

export async function getOrders({ customerId = null, status = null, limit = 200 } = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (customerId) { where.push("customerId = ?"); params.push(customerId); }
  if (status) { where.push("status = ?"); params.push(status); }
  const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY createdAt DESC LIMIT ?`;
  params.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
  return db.all(sql, params).map(rowToOrder);
}

export async function cancelOrder(id) {
  const db = await getAdapter();
  const order = await getOrderById(id);
  if (!order) return null;
  if (order.status !== "pending") throw new Error(`cannot cancel order in status ${order.status}`);
  const now = new Date().toISOString();
  db.run(`UPDATE orders SET status = 'cancelled', cancelledAt = ? WHERE id = ?`, [now, id]);
  return getOrderById(id);
}

export async function markOrderRefunded(id, { notes = null } = {}) {
  const db = await getAdapter();
  const order = await getOrderById(id);
  if (!order) return null;
  if (order.status !== "delivered" && order.status !== "paid") {
    throw new Error(`cannot refund order in status ${order.status}`);
  }
  const now = new Date().toISOString();
  db.run(
    `UPDATE orders SET status = 'refunded', refundedAt = ?, notes = COALESCE(?, notes) WHERE id = ?`,
    [now, notes, id]
  );
  return getOrderById(id);
}

/**
 * Atomic confirm: create an apiKey using the plan's policy and mark the order
 * delivered. Returns { order, apiKey: { id, key (raw, view-once), keyDisplay } }.
 * Idempotent: if the order is already delivered, returns the existing apiKey.
 */
export async function confirmOrderAtomic({ orderId, paymentRef = null, machineId, actorIp = null }) {
  const db = await getAdapter();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("order not found");
  if (order.status === "delivered") {
    if (order.kind === "walletTopup") {
      return { order, walletTopup: { alreadyDelivered: true, amountVnd: order.priceVnd } };
    }
    if (order.apiKeyId) {
      // Already delivered — surface a stub view-once placeholder so callers don't
      // accidentally treat this as a brand-new key. Raw key is unrecoverable.
      return { order, apiKey: { id: order.apiKeyId, key: null, alreadyDelivered: true } };
    }
  }
  if (order.status !== "pending") throw new Error(`cannot confirm order in status ${order.status}`);

  // ── Wallet top-up branch: credit the customer's wallet, no apiKey created.
  if (order.kind === "walletTopup") {
    const now = new Date().toISOString();
    const microVnd = Math.trunc(Number(order.priceVnd || 0) * 1_000_000);
    if (microVnd <= 0) throw new Error("topup amount must be positive");

    const { v4 } = await import("uuid");
    db.transaction(() => {
      const cur = db.get(`SELECT balance FROM customers WHERE id = ?`, [order.customerId]);
      if (!cur) throw new Error("customer not found");
      const balanceAfter = Number(cur.balance || 0) + microVnd;
      db.run(`UPDATE customers SET balance = ?, updatedAt = ? WHERE id = ?`, [balanceAfter, now, order.customerId]);
      db.run(
        `INSERT INTO walletTransactions(id, customerId, apiKeyId, delta, balanceAfter, type, refType, refId, provider, model, promptTokens, completionTokens, meta, createdAt)
         VALUES(?, ?, NULL, ?, ?, 'topup', 'order', ?, NULL, NULL, 0, 0, ?, ?)`,
        [
          v4(),
          order.customerId,
          microVnd,
          balanceAfter,
          order.id,
          JSON.stringify({ paymentRef, amountVnd: order.priceVnd }),
          now,
        ]
      );
      db.run(
        `UPDATE orders SET status = 'delivered', paymentRef = COALESCE(?, paymentRef), paidAt = COALESCE(paidAt, ?), deliveredAt = ? WHERE id = ?`,
        [paymentRef, now, now, order.id]
      );
    });

    return {
      order: await getOrderById(order.id),
      walletTopup: { amountVnd: order.priceVnd, microVnd },
    };
  }

  // ── Plan branch: provision apiKey or top up an existing one.
  if (!machineId && !order.targetApiKeyId) throw new Error("machineId is required");

  const plan = await getPricingPlanById(order.planId);
  if (!plan) throw new Error("plan no longer exists");

  // Top-up branch: extend an existing apiKey instead of issuing a new one.
  if (order.targetApiKeyId) {
    const now = new Date().toISOString();
    let topup;
    db.transaction(() => {
      // Confirm the target still belongs to the same customer to avoid
      // race-condition cross-account top-ups (e.g. customer transferred).
      const owner = db.get(`SELECT customerId FROM apiKeys WHERE id = ?`, [order.targetApiKeyId]);
      if (!owner) throw new Error("target apiKey không tồn tại");
      if (owner.customerId !== order.customerId) throw new Error("target apiKey không còn thuộc khách hàng này");

      topup = applyPlanTopupInTxn(db, { keyId: order.targetApiKeyId, plan });
      db.run(
        `UPDATE orders SET status = 'delivered', apiKeyId = ?, paymentRef = COALESCE(?, paymentRef), paidAt = COALESCE(paidAt, ?), deliveredAt = ? WHERE id = ?`,
        [order.targetApiKeyId, paymentRef, now, now, order.id]
      );
    });

    try {
      const { logKeyAudit } = await import("./keyAuditRepo.js");
      await logKeyAudit({
        keyId: order.targetApiKeyId,
        action: "topup-from-order",
        actorIp,
        metadata: { orderId: order.id, planId: plan.id, planName: plan.name, priceVnd: order.priceVnd, expiresAt: topup?.expiresAt || null },
      });
    } catch {}

    return {
      order: await getOrderById(order.id),
      apiKey: { id: order.targetApiKeyId, key: null, alreadyDelivered: false, topup: true },
    };
  }

  const policy = planToApiKeyPolicy(plan);

  // Generate the raw key + hash now so the transaction below is purely sync.
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const { key: rawKey } = generateApiKeyWithMachine(machineId);
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, Math.min(7, rawKey.length));
  const keyLast4 = rawKey.length >= 4 ? rawKey.slice(-4) : rawKey;
  const apiKeyId = uuidv4();
  const apiKeyName = `Order ${order.id} — ${plan.name}`;
  const now = new Date().toISOString();

  // Audit will be written after success below (kept out of the txn since it
  // imports DB indirectly).
  db.transaction(() => {
    db.run(
      `INSERT INTO apiKeys(id, key, keyHash, keyPrefix, keyLast4, name, machineId, isActive, dailyTokenLimit, monthlyTokenLimit, lifetimeTokenLimit, requestsPerMinute, maxTokensPerRequest, expiresAt, allowedModels, allowedIps, customerId, orderId, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
      [
        apiKeyId,
        null,
        keyHash,
        keyPrefix,
        keyLast4,
        apiKeyName,
        machineId,
        policy.dailyTokenLimit,
        policy.monthlyTokenLimit,
        policy.lifetimeTokenLimit,
        policy.requestsPerMinute,
        policy.maxTokensPerRequest,
        policy.expiresAt,
        JSON.stringify(policy.allowedModels || []),
        order.customerId,
        order.id,
        now,
      ]
    );
    db.run(
      `UPDATE orders SET status = 'delivered', apiKeyId = ?, paymentRef = COALESCE(?, paymentRef), paidAt = COALESCE(paidAt, ?), deliveredAt = ? WHERE id = ?`,
      [apiKeyId, paymentRef, now, now, order.id]
    );
  });

  // Audit log outside the txn.
  try {
    const { logKeyAudit } = await import("./keyAuditRepo.js");
    await logKeyAudit({
      keyId: apiKeyId,
      action: "create-from-order",
      actorIp,
      metadata: { orderId: order.id, planId: plan.id, planName: plan.name, priceVnd: order.priceVnd },
    });
  } catch {}

  return {
    order: await getOrderById(order.id),
    apiKey: {
      id: apiKeyId,
      key: rawKey,                    // view-once: caller must deliver and discard
      keyDisplay: `${keyPrefix}...${keyLast4}`,
      name: apiKeyName,
      policy,
    },
  };
}

/**
 * Purchase a plan paying directly from the customer's wallet balance.
 *
 * Atomic: validates funds, creates order, debits wallet, provisions apiKey,
 * marks order delivered, and writes a wallet ledger row — all in one txn.
 *
 * Throws when:
 *   - balance is insufficient (after honoring balanceMinLimit overdraft floor)
 *   - plan/voucher invalid
 *   - per-customer plan purchase limit hit
 *
 * Returns { order, apiKey: { id, key, keyDisplay, name, policy } }.
 */
export async function purchasePlanWithWallet({ customerId, planId, voucherCode = null, notes = null, machineId, actorIp = null, targetApiKeyId = null }) {
  if (!customerId) throw new Error("customerId is required");
  if (!planId) throw new Error("planId is required");
  if (!machineId && !targetApiKeyId) throw new Error("machineId is required");

  const plan = await getPricingPlanById(planId);
  if (!plan) throw new Error("plan not found");
  if (!plan.isActive) throw new Error("plan is inactive");

  if (plan.maxPurchasesPerCustomer > 0) {
    const purchased = await countCustomerPlanPurchases({ customerId, planId });
    if (purchased >= plan.maxPurchasesPerCustomer) {
      throw new Error(`Bạn đã mua gói này tối đa ${plan.maxPurchasesPerCustomer} lần`);
    }
  }

  // Voucher dry-run before opening the txn so we can return a clean error.
  let voucherCheck = null;
  if (voucherCode) {
    voucherCheck = await validateVoucherForOrder({ code: voucherCode, customerId, plan });
    if (!voucherCheck.ok) throw new Error(voucherCheck.reason || "Voucher không hợp lệ");
  }

  const originalPriceVnd = plan.priceVnd;
  const discountVnd = voucherCheck?.discountVnd || 0;
  const finalPriceVnd = Math.max(0, originalPriceVnd - discountVnd);
  const debitMicroVnd = Math.trunc(finalPriceVnd * 1_000_000);

  // Either provision a fresh key or top up the targeted one. Decide once
  // upfront so both branches share the same transaction shape below.
  const isTopup = !!targetApiKeyId;
  const policy = planToApiKeyPolicy(plan);

  let rawKey = null;
  let apiKeyId;
  let keyPrefix = null;
  let keyLast4 = null;
  let apiKeyName = `Plan ${plan.name}`;

  if (isTopup) {
    apiKeyId = targetApiKeyId;
  } else {
    const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
    const generated = generateApiKeyWithMachine(machineId);
    rawKey = generated.key;
    keyPrefix = rawKey.slice(0, Math.min(7, rawKey.length));
    keyLast4 = rawKey.length >= 4 ? rawKey.slice(-4) : rawKey;
    apiKeyId = uuidv4();
  }

  const db = await getAdapter();
  const orderId = `9R-${shortRef()}`;
  const now = new Date().toISOString();

  let createdApiKey = null;
  db.transaction(() => {
    // 1. Verify wallet balance honoring overdraft floor.
    const cust = db.get(`SELECT balance, balanceMinLimit FROM customers WHERE id = ?`, [customerId]);
    if (!cust) throw new Error("customer not found");
    const balance = Number(cust.balance || 0);
    const minLimit = Number(cust.balanceMinLimit || 0);
    if (debitMicroVnd > 0 && balance - debitMicroVnd < minLimit) {
      const shortMicro = debitMicroVnd - (balance - minLimit);
      const shortVnd = Math.ceil(shortMicro / 1_000_000);
      throw new Error(`Số dư ví không đủ. Cần thêm ${shortVnd.toLocaleString("vi-VN")} VND.`);
    }

    if (isTopup) {
      const owner = db.get(`SELECT customerId FROM apiKeys WHERE id = ?`, [targetApiKeyId]);
      if (!owner) throw new Error("target apiKey không tồn tại");
      if (owner.customerId !== customerId) throw new Error("target apiKey không thuộc tài khoản này");
    }

    // 2. Create order (kind='plan', paymentMethod='wallet').
    db.run(
      `INSERT INTO orders(id, customerId, planId, kind, status, priceVnd, originalPriceVnd, discountVnd, voucherId, voucherCode, paymentMethod, targetApiKeyId, notes, createdAt) VALUES(?, ?, ?, 'plan', 'pending', ?, ?, ?, ?, ?, 'wallet', ?, ?, ?)`,
      [
        orderId,
        customerId,
        planId,
        finalPriceVnd,
        originalPriceVnd,
        discountVnd,
        voucherCheck?.voucher?.id || null,
        voucherCheck?.voucher?.code || null,
        targetApiKeyId || null,
        notes,
        now,
      ]
    );
    if (voucherCheck?.voucher) {
      redeemVoucherInTxn({
        db,
        voucherId: voucherCheck.voucher.id,
        customerId,
        orderId,
        discountVnd,
        planId,
        planPriceVnd: originalPriceVnd,
      });
    }

    // 3. Provision (or top up) apiKey from the plan.
    if (isTopup) {
      applyPlanTopupInTxn(db, { keyId: targetApiKeyId, plan });
    } else {
      db.run(
        `INSERT INTO apiKeys(id, key, keyHash, keyPrefix, keyLast4, name, machineId, isActive, dailyTokenLimit, monthlyTokenLimit, lifetimeTokenLimit, requestsPerMinute, maxTokensPerRequest, expiresAt, allowedModels, allowedIps, customerId, orderId, createdAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
        [
          apiKeyId,
          null,
          hashApiKey(rawKey),
          keyPrefix,
          keyLast4,
          apiKeyName,
          machineId,
          policy.dailyTokenLimit,
          policy.monthlyTokenLimit,
          policy.lifetimeTokenLimit,
          policy.requestsPerMinute,
          policy.maxTokensPerRequest,
          policy.expiresAt,
          JSON.stringify(policy.allowedModels || []),
          customerId,
          orderId,
          now,
        ]
      );
    }

    // 4. Debit wallet + write ledger row (skip when free order).
    if (debitMicroVnd > 0) {
      const balanceAfter = balance - debitMicroVnd;
      db.run(`UPDATE customers SET balance = ?, updatedAt = ? WHERE id = ?`, [balanceAfter, now, customerId]);
      db.run(
        `INSERT INTO walletTransactions(id, customerId, apiKeyId, delta, balanceAfter, type, refType, refId, provider, model, promptTokens, completionTokens, meta, createdAt)
         VALUES(?, ?, ?, ?, ?, 'planPurchase', 'order', ?, NULL, NULL, 0, 0, ?, ?)`,
        [
          uuidv4(),
          customerId,
          apiKeyId,
          -debitMicroVnd,
          balanceAfter,
          orderId,
          JSON.stringify({
            planId,
            planName: plan.name,
            voucherCode: voucherCheck?.voucher?.code || null,
            topup: isTopup,
          }),
          now,
        ]
      );
    }

    // 5. Mark order delivered.
    db.run(
      `UPDATE orders SET status = 'delivered', apiKeyId = ?, paymentMethod = 'wallet', paidAt = ?, deliveredAt = ? WHERE id = ?`,
      [apiKeyId, now, now, orderId]
    );

    createdApiKey = isTopup
      ? { id: apiKeyId, key: null, topup: true }
      : {
          id: apiKeyId,
          key: rawKey,
          keyDisplay: `${keyPrefix}...${keyLast4}`,
          name: apiKeyName,
          policy,
        };
  });

  // Post-commit audit.
  try {
    const { logKeyAudit } = await import("./keyAuditRepo.js");
    await logKeyAudit({
      keyId: apiKeyId,
      action: isTopup ? "topup-from-wallet" : "create-from-wallet",
      actorIp,
      metadata: { orderId, planId: plan.id, planName: plan.name, priceVnd: finalPriceVnd },
    });
  } catch {}

  return {
    order: await getOrderById(orderId),
    apiKey: createdApiKey,
  };
}
