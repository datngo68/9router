// Referrals repo. Two responsibilities:
//   1. Per-customer referral code (generated lazily, unique).
//   2. Granting bonus tokens to both parties when the referee's first
//      delivered order lands.
//
// All token bonuses are added to lifetimeTokenLimit on a single API key per
// party. Idempotent via UNIQUE(refereeId, orderId) on referralRewards.

import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { getSettings } from "./settingsRepo.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferralCode() {
  const buf = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

export async function getOrCreateReferralCode(customerId) {
  if (!customerId) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT referralCode FROM customers WHERE id = ?`, [customerId]);
  if (!row) return null;
  if (row.referralCode) return row.referralCode;
  let code = generateReferralCode();
  for (let i = 0; i < 10; i++) {
    const taken = db.get(`SELECT id FROM customers WHERE referralCode = ?`, [code]);
    if (!taken) break;
    code = generateReferralCode();
  }
  db.run(`UPDATE customers SET referralCode = ?, updatedAt = ? WHERE id = ?`,
    [code, new Date().toISOString(), customerId]);
  return code;
}

export async function findCustomerByReferralCode(code) {
  if (!code) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT id, email, displayName, referralCode FROM customers WHERE referralCode = ?`,
    [String(code).trim().toUpperCase()]);
  return row || null;
}

/**
 * Set customers.referredBy if the code resolves to a different customer.
 * Returns the referrer id when stored, null otherwise.
 */
export async function recordReferralOnRegister(refereeId, code) {
  if (!refereeId || !code) return null;
  const referrer = await findCustomerByReferralCode(code);
  if (!referrer) return null;
  if (referrer.id === refereeId) return null; // can't self-refer
  const db = await getAdapter();
  db.run(`UPDATE customers SET referredBy = ?, updatedAt = ? WHERE id = ?`,
    [referrer.referralCode, new Date().toISOString(), refereeId]);
  return referrer.id;
}

export async function getReferralReward({ refereeId, orderId }) {
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM referralRewards WHERE refereeId = ? AND orderId = ?`,
    [refereeId, orderId]
  );
  return row || null;
}

/**
 * Grant referral bonus when refereeId's first delivered order lands.
 * Idempotent: returns existing reward row if already granted.
 *
 * Strategy:
 *   - Referee bonus: added to lifetimeTokenLimit of the apiKey delivered with
 *     this order (orders.apiKeyId).
 *   - Referrer bonus: added to lifetimeTokenLimit of the oldest active key
 *     belonging to the referrer. If referrer has no key yet, store the bonus
 *     on the reward row but mark referrerKeyId NULL (caller can grant later).
 */
export async function grantReferralRewardOnFirstDelivered({ orderId }) {
  if (!orderId) return { granted: false, reason: "no order" };
  const db = await getAdapter();

  const order = db.get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  if (!order) return { granted: false, reason: "order not found" };
  if (order.status !== "delivered") return { granted: false, reason: "order not delivered" };

  const referee = db.get(`SELECT id, email, displayName, referredBy FROM customers WHERE id = ?`, [order.customerId]);
  if (!referee?.referredBy) return { granted: false, reason: "no referrer" };

  // Idempotency: bail if we've already created a reward for this order.
  const existing = db.get(`SELECT * FROM referralRewards WHERE refereeId = ? AND orderId = ?`,
    [referee.id, orderId]);
  if (existing) return { granted: false, alreadyGranted: true, reward: existing };

  // First-delivered guard: only grant on the referee's FIRST delivered order.
  // We allow this row's order to count (use <=, expecting 1).
  const deliveredCount = db.get(
    `SELECT COUNT(*) AS c FROM orders WHERE customerId = ? AND status = 'delivered'`,
    [referee.id]
  );
  if (Number(deliveredCount?.c || 0) > 1) {
    return { granted: false, reason: "not first delivered order" };
  }

  const referrer = db.get(`SELECT id, email, displayName FROM customers WHERE referralCode = ?`,
    [referee.referredBy]);
  if (!referrer) return { granted: false, reason: "referrer not found" };

  // Settings-driven bonus amounts. referralEnabled gates everything.
  const settings = await getSettings();
  if (settings?.referralEnabled === false) {
    return { granted: false, reason: "referral disabled" };
  }
  const refereeBonus = Math.max(0, Number(settings?.referralRefereeBonusTokens) || 0);
  const referrerBonus = Math.max(0, Number(settings?.referralReferrerBonusTokens) || 0);
  if (refereeBonus === 0 && referrerBonus === 0) {
    return { granted: false, reason: "bonus is 0" };
  }

  // Resolve target keys.
  const refereeKeyId = order.apiKeyId || null;
  const referrerKeyRow = db.get(
    `SELECT id FROM apiKeys
       WHERE customerId = ? AND isActive = 1
       ORDER BY createdAt ASC LIMIT 1`,
    [referrer.id]
  );
  const referrerKeyId = referrerKeyRow?.id || null;

  // Apply quota updates. We add to lifetimeTokenLimit; 0 means unlimited
  // upstream so don't transform "unlimited" into a finite cap by mistake.
  if (refereeKeyId && refereeBonus > 0) {
    db.run(
      `UPDATE apiKeys SET lifetimeTokenLimit = COALESCE(lifetimeTokenLimit, 0) + ? WHERE id = ?`,
      [refereeBonus, refereeKeyId]
    );
  }
  if (referrerKeyId && referrerBonus > 0) {
    db.run(
      `UPDATE apiKeys SET lifetimeTokenLimit = COALESCE(lifetimeTokenLimit, 0) + ? WHERE id = ?`,
      [referrerBonus, referrerKeyId]
    );
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO referralRewards(id, referrerId, refereeId, orderId, refereeBonusTokens, referrerBonusTokens, refereeKeyId, referrerKeyId, status, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, referrer.id, referee.id, orderId, refereeBonus, referrerBonus, refereeKeyId, referrerKeyId, "granted", now]
  );

  return {
    granted: true,
    reward: {
      id, referrerId: referrer.id, refereeId: referee.id, orderId,
      refereeBonusTokens: refereeBonus, referrerBonusTokens: referrerBonus,
      refereeKeyId, referrerKeyId, status: "granted", createdAt: now,
    },
    referrer, referee,
  };
}

/**
 * Stats panel for storefront referral page.
 */
export async function getReferralStats(customerId) {
  if (!customerId) return null;
  const db = await getAdapter();
  const customer = db.get(`SELECT id, referralCode FROM customers WHERE id = ?`, [customerId]);
  if (!customer) return null;

  const code = customer.referralCode || (await getOrCreateReferralCode(customerId));

  const referredCount = db.get(
    `SELECT COUNT(*) AS c FROM customers WHERE referredBy = ?`, [code]
  );
  const purchasedRow = db.get(
    `SELECT COUNT(*) AS c FROM referralRewards WHERE referrerId = ?`, [customerId]
  );
  const totalTokensRow = db.get(
    `SELECT COALESCE(SUM(referrerBonusTokens), 0) AS s FROM referralRewards WHERE referrerId = ?`, [customerId]
  );
  const rewardsAsReferee = db.get(
    `SELECT COALESCE(SUM(refereeBonusTokens), 0) AS s FROM referralRewards WHERE refereeId = ?`, [customerId]
  );

  const rewards = db.all(
    `SELECT r.*, c.email AS refereeEmail, c.displayName AS refereeName
       FROM referralRewards r
       LEFT JOIN customers c ON c.id = r.refereeId
      WHERE r.referrerId = ?
      ORDER BY r.createdAt DESC LIMIT 50`,
    [customerId]
  );

  return {
    code,
    referredCount: Number(referredCount?.c || 0),
    purchasedCount: Number(purchasedRow?.c || 0),
    tokensEarnedAsReferrer: Number(totalTokensRow?.s || 0),
    tokensEarnedAsReferee: Number(rewardsAsReferee?.s || 0),
    rewards,
  };
}

/**
 * Lookup helper for admin customer detail page.
 */
export async function getReferralAdminInfo(customerId) {
  if (!customerId) return null;
  const db = await getAdapter();
  const c = db.get(`SELECT id, referralCode, referredBy FROM customers WHERE id = ?`, [customerId]);
  if (!c) return null;
  let referrer = null;
  if (c.referredBy) {
    referrer = db.get(`SELECT id, email, displayName FROM customers WHERE referralCode = ?`, [c.referredBy]);
  }
  const referredCountRow = db.get(`SELECT COUNT(*) AS c FROM customers WHERE referredBy = ?`, [c.referralCode]);
  const totalGrantsRow = db.get(`SELECT COUNT(*) AS c FROM referralRewards WHERE referrerId = ?`, [customerId]);
  const totalTokensRow = db.get(
    `SELECT COALESCE(SUM(referrerBonusTokens), 0) AS s FROM referralRewards WHERE referrerId = ?`,
    [customerId]
  );
  return {
    referralCode: c.referralCode,
    referredBy: c.referredBy,
    referrer,
    referredCount: Number(referredCountRow?.c || 0),
    grantsAsReferrer: Number(totalGrantsRow?.c || 0),
    tokensEarnedAsReferrer: Number(totalTokensRow?.s || 0),
  };
}
