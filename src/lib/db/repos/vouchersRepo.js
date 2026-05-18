// Vouchers / discount codes.
//
// validateVoucherForOrder() is the SINGLE source of truth for "is this code
// usable right now for this customer + plan + amount". It returns either
// { ok: true, voucher, discountVnd, finalPriceVnd } or
// { ok: false, reason } so the checkout API and the order-creation path can
// share the exact same rules.
//
// redeemVoucherInTxn() must be called inside an existing db.transaction() —
// it does the final atomic check (isActive, validity window, maxUses,
// maxPerCustomer) and inserts the redemption + bumps usedCount in one shot.
// This is what prevents the race "two users redeeming the very last slot at
// the same time".

import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const VALID_KINDS = new Set(["percent", "fixed"]);

function nonNegInt(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normalizeCode(raw) {
  return String(raw || "").trim().toUpperCase();
}

function rowToVoucher(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    description: row.description || "",
    kind: row.kind,
    value: nonNegInt(row.value),
    scopePlanIds: parseJson(row.scopePlanIds, []) || [],
    maxUses: nonNegInt(row.maxUses),
    maxPerCustomer: nonNegInt(row.maxPerCustomer),
    usedCount: nonNegInt(row.usedCount),
    validFrom: row.validFrom || null,
    validTo: row.validTo || null,
    minOrderVnd: nonNegInt(row.minOrderVnd),
    firstOrderOnly: row.firstOrderOnly === 1 || row.firstOrderOnly === true ? 1 : 0,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateInput(input) {
  if (!input.code) throw new Error("code is required");
  if (!VALID_KINDS.has(input.kind)) throw new Error(`kind must be one of: ${[...VALID_KINDS].join(", ")}`);
  const value = Number(input.value || 0);
  if (input.kind === "percent" && (value <= 0 || value > 100)) {
    throw new Error("value must be 1..100 for percent vouchers");
  }
  if (input.kind === "fixed" && value <= 0) {
    throw new Error("value must be > 0 for fixed vouchers");
  }
  if (input.validFrom && input.validTo && new Date(input.validFrom) > new Date(input.validTo)) {
    throw new Error("validFrom must be before validTo");
  }
  if (!Array.isArray(input.scopePlanIds) || input.scopePlanIds.length === 0) {
    throw new Error("scopePlanIds must contain at least one plan id");
  }
}

export async function getVouchers() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM vouchers ORDER BY createdAt DESC`).map(rowToVoucher);
}

export async function getVoucherById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToVoucher(db.get(`SELECT * FROM vouchers WHERE id = ?`, [id]));
}

export async function getVoucherByCode(code) {
  const c = normalizeCode(code);
  if (!c) return null;
  const db = await getAdapter();
  return rowToVoucher(db.get(`SELECT * FROM vouchers WHERE code = ?`, [c]));
}

export async function createVoucher(input) {
  validateInput(input);
  const db = await getAdapter();
  const id = uuidv4();
  const now = new Date().toISOString();
  const code = normalizeCode(input.code);
  const existing = db.get(`SELECT id FROM vouchers WHERE code = ?`, [code]);
  if (existing) throw new Error("code already exists");
  db.run(
    `INSERT INTO vouchers(id, code, description, kind, value, scopePlanIds, maxUses, maxPerCustomer, usedCount, validFrom, validTo, minOrderVnd, firstOrderOnly, isActive, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      code,
      input.description || null,
      input.kind,
      nonNegInt(input.value),
      stringifyJson(input.scopePlanIds || []),
      nonNegInt(input.maxUses),
      nonNegInt(input.maxPerCustomer),
      input.validFrom || null,
      input.validTo || null,
      nonNegInt(input.minOrderVnd),
      input.firstOrderOnly ? 1 : 0,
      input.isActive === false ? 0 : 1,
      now,
      now,
    ]
  );
  return getVoucherById(id);
}

export async function updateVoucher(id, patch) {
  const existing = await getVoucherById(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "code")) {
    merged.code = normalizeCode(patch.code);
  }
  validateInput(merged);
  const db = await getAdapter();
  if (merged.code !== existing.code) {
    const dup = db.get(`SELECT id FROM vouchers WHERE code = ? AND id != ?`, [merged.code, id]);
    if (dup) throw new Error("code already exists");
  }
  const now = new Date().toISOString();
  db.run(
    `UPDATE vouchers SET code = ?, description = ?, kind = ?, value = ?, scopePlanIds = ?, maxUses = ?, maxPerCustomer = ?, validFrom = ?, validTo = ?, minOrderVnd = ?, firstOrderOnly = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
    [
      merged.code,
      merged.description || null,
      merged.kind,
      nonNegInt(merged.value),
      stringifyJson(merged.scopePlanIds || []),
      nonNegInt(merged.maxUses),
      nonNegInt(merged.maxPerCustomer),
      merged.validFrom || null,
      merged.validTo || null,
      nonNegInt(merged.minOrderVnd),
      merged.firstOrderOnly ? 1 : 0,
      merged.isActive === false ? 0 : 1,
      now,
      id,
    ]
  );
  return getVoucherById(id);
}

export async function deleteVoucher(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM vouchers WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

function isVoucherInWindow(v, now = new Date()) {
  const t = now.getTime();
  if (v.validFrom && new Date(v.validFrom).getTime() > t) return false;
  if (v.validTo && new Date(v.validTo).getTime() < t) return false;
  return true;
}

function computeDiscount(voucher, priceVnd) {
  if (!voucher) return 0;
  const price = nonNegInt(priceVnd);
  if (price <= 0) return 0;
  let d = 0;
  if (voucher.kind === "percent") {
    d = Math.floor((price * Math.min(100, Math.max(0, voucher.value))) / 100);
  } else if (voucher.kind === "fixed") {
    d = Math.min(price, nonNegInt(voucher.value));
  }
  return Math.max(0, Math.min(price, d));
}

/**
 * Public validation used by both /api/vouchers/validate (for checkout
 * preview) and /api/orders (for the actual order creation). Returns either
 * { ok: true, voucher, discountVnd, finalPriceVnd } or { ok: false, reason }.
 *
 * NOTE: this is a dry-run check. Race conditions on maxUses are handled
 * inside redeemVoucherInTxn() at order-create time.
 */
export async function validateVoucherForOrder({ code, customerId, plan }) {
  if (!code) return { ok: false, reason: "Vui lòng nhập mã" };
  const voucher = await getVoucherByCode(code);
  if (!voucher) return { ok: false, reason: "Mã không tồn tại" };
  if (!voucher.isActive) return { ok: false, reason: "Mã đã bị vô hiệu hóa" };
  if (!isVoucherInWindow(voucher)) return { ok: false, reason: "Mã không trong thời gian áp dụng" };
  if (!plan) return { ok: false, reason: "Plan không hợp lệ" };
  if (!Array.isArray(voucher.scopePlanIds) || !voucher.scopePlanIds.includes(plan.id)) {
    return { ok: false, reason: "Mã không áp dụng cho gói này" };
  }
  if (voucher.maxUses > 0 && voucher.usedCount >= voucher.maxUses) {
    return { ok: false, reason: "Mã đã hết lượt sử dụng" };
  }
  if (voucher.minOrderVnd > 0 && plan.priceVnd < voucher.minOrderVnd) {
    return { ok: false, reason: `Đơn tối thiểu ${voucher.minOrderVnd.toLocaleString("vi-VN")}đ` };
  }
  if (customerId) {
    const db = await getAdapter();
    if (voucher.maxPerCustomer > 0) {
      const row = db.get(
        `SELECT COUNT(*) AS n FROM voucherRedemptions WHERE voucherId = ? AND customerId = ?`,
        [voucher.id, customerId]
      );
      if (Number(row?.n || 0) >= voucher.maxPerCustomer) {
        return { ok: false, reason: "Bạn đã dùng mã này tối đa" };
      }
    }
    if (voucher.firstOrderOnly) {
      const row = db.get(
        `SELECT COUNT(*) AS n FROM orders WHERE customerId = ? AND status IN ('pending', 'paid', 'delivered')`,
        [customerId]
      );
      if (Number(row?.n || 0) > 0) {
        return { ok: false, reason: "Mã chỉ áp dụng cho đơn đầu tiên" };
      }
    }
  }

  const discountVnd = computeDiscount(voucher, plan.priceVnd);
  return {
    ok: true,
    voucher,
    discountVnd,
    finalPriceVnd: Math.max(0, plan.priceVnd - discountVnd),
  };
}

/**
 * Atomic redeem. MUST be called from inside an existing db.transaction().
 * Re-checks all constraints under SQLite's transaction lock to guarantee:
 *   - usedCount never goes above maxUses (fixes "last slot" race)
 *   - one (voucherId, orderId) can be redeemed at most once
 *   - validity window + isActive haven't changed since the dry-run
 *
 * Throws on any violation so the caller's outer transaction rolls back.
 */
export function redeemVoucherInTxn({ db, voucherId, customerId, orderId, discountVnd, planId, planPriceVnd }) {
  const row = db.get(`SELECT * FROM vouchers WHERE id = ?`, [voucherId]);
  if (!row) throw new Error("Voucher không tồn tại");
  const v = rowToVoucher(row);
  if (!v.isActive) throw new Error("Voucher đã bị vô hiệu hóa");
  if (!isVoucherInWindow(v)) throw new Error("Voucher không trong thời gian áp dụng");
  if (!v.scopePlanIds.includes(planId)) throw new Error("Voucher không áp dụng cho gói này");
  if (v.minOrderVnd > 0 && planPriceVnd < v.minOrderVnd) throw new Error("Đơn không đạt giá trị tối thiểu");
  if (v.maxUses > 0 && v.usedCount >= v.maxUses) throw new Error("Voucher đã hết lượt");
  if (v.maxPerCustomer > 0) {
    const r = db.get(
      `SELECT COUNT(*) AS n FROM voucherRedemptions WHERE voucherId = ? AND customerId = ?`,
      [v.id, customerId]
    );
    if (Number(r?.n || 0) >= v.maxPerCustomer) throw new Error("Bạn đã dùng voucher này tối đa");
  }
  if (v.firstOrderOnly) {
    const r = db.get(
      `SELECT COUNT(*) AS n FROM orders WHERE customerId = ? AND id != ? AND status IN ('pending', 'paid', 'delivered')`,
      [customerId, orderId]
    );
    if (Number(r?.n || 0) > 0) throw new Error("Voucher chỉ áp dụng cho đơn đầu tiên");
  }

  db.run(
    `INSERT INTO voucherRedemptions(id, voucherId, customerId, orderId, discountVnd, redeemedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [uuidv4(), v.id, customerId, orderId, nonNegInt(discountVnd), new Date().toISOString()]
  );
  db.run(`UPDATE vouchers SET usedCount = usedCount + 1, updatedAt = ? WHERE id = ?`, [new Date().toISOString(), v.id]);
}

export async function getRedemptionsForVoucher(voucherId, { limit = 200 } = {}) {
  if (!voucherId) return [];
  const db = await getAdapter();
  return db.all(
    `SELECT * FROM voucherRedemptions WHERE voucherId = ? ORDER BY redeemedAt DESC LIMIT ?`,
    [voucherId, Math.max(1, Math.min(1000, Number(limit) || 200))]
  );
}
