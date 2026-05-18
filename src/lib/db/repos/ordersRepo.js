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
    status: row.status,
    priceVnd: Number(row.priceVnd || 0),
    originalPriceVnd: row.originalPriceVnd != null ? Number(row.originalPriceVnd) : Number(row.priceVnd || 0),
    discountVnd: Number(row.discountVnd || 0),
    voucherId: row.voucherId || null,
    voucherCode: row.voucherCode || null,
    paymentMethod: row.paymentMethod || null,
    paymentRef: row.paymentRef || null,
    apiKeyId: row.apiKeyId || null,
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

export async function createOrder({ customerId, planId, paymentMethod = "bank", notes = null, voucherCode = null }) {
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
      `INSERT INTO orders(id, customerId, planId, status, priceVnd, originalPriceVnd, discountVnd, voucherId, voucherCode, paymentMethod, notes, createdAt) VALUES(?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("order not found");
  if (order.status === "delivered" && order.apiKeyId) {
    // Already delivered — surface a stub view-once placeholder so callers don't
    // accidentally treat this as a brand-new key. Raw key is unrecoverable.
    return { order, apiKey: { id: order.apiKeyId, key: null, alreadyDelivered: true } };
  }
  if (order.status !== "pending") throw new Error(`cannot confirm order in status ${order.status}`);

  const plan = await getPricingPlanById(order.planId);
  if (!plan) throw new Error("plan no longer exists");
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
