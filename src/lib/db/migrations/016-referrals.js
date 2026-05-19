// Migration 016: referrals.
// Adds referralCode + referredBy columns to customers and creates the
// referralRewards table tracking grants. Backfills referralCode for any
// existing customer that lacks one (random 8 char A-Z0-9, retry on collision).

import crypto from "node:crypto";

function genCode() {
  // 8 chars, uppercase alphanumeric, avoid ambiguous 0/O/1/I.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export default {
  version: 16,
  name: "referrals",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(customers)`).map((r) => r.name));
    if (!cols.has("referralCode")) {
      db.exec(`ALTER TABLE customers ADD COLUMN referralCode TEXT`);
    }
    if (!cols.has("referredBy")) {
      db.exec(`ALTER TABLE customers ADD COLUMN referredBy TEXT`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cust_refcode ON customers(referralCode)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cust_refby ON customers(referredBy)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS referralRewards (
        id TEXT PRIMARY KEY,
        referrerId TEXT NOT NULL,
        refereeId TEXT NOT NULL,
        orderId TEXT NOT NULL,
        refereeBonusTokens INTEGER DEFAULT 0,
        referrerBonusTokens INTEGER DEFAULT 0,
        refereeKeyId TEXT,
        referrerKeyId TEXT,
        status TEXT DEFAULT 'granted',
        createdAt TEXT NOT NULL
      )
    `);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_referee_order ON referralRewards(refereeId, orderId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rr_referrer ON referralRewards(referrerId)`);

    // Backfill referralCode for any existing customer.
    const rows = db.all(`SELECT id FROM customers WHERE referralCode IS NULL OR referralCode = ''`);
    for (const r of rows) {
      let code = genCode();
      let attempts = 0;
      while (attempts < 10) {
        const taken = db.get(`SELECT id FROM customers WHERE referralCode = ?`, [code]);
        if (!taken) break;
        code = genCode();
        attempts++;
      }
      db.run(`UPDATE customers SET referralCode = ? WHERE id = ?`, [code, r.id]);
    }
  },
};
