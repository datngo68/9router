// Customer session storage. We never persist the raw token; only sha256(token)
// and use that to look up. This means a DB leak does not expose live cookies.

import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import { getAdapter } from "../driver.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customerId,
    expiresAt: row.expiresAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Create a new session. Returns { id, token } where token is the raw value
 * the caller must put in the cookie. Never returns the hash.
 */
export async function createCustomerSession({ customerId, ipAddress = null, userAgent = null, ttlMs = SESSION_TTL_MS }) {
  if (!customerId) throw new Error("customerId is required");
  const db = await getAdapter();
  const id = uuidv4();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  db.run(
    `INSERT INTO customerSessions(id, customerId, tokenHash, expiresAt, ipAddress, userAgent, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [id, customerId, tokenHash, expiresAt, ipAddress, userAgent, now.toISOString()]
  );
  return { id, token, expiresAt };
}

/**
 * Look up a session by raw token, returning null if missing/expired/revoked.
 */
export async function findCustomerSessionByToken(token) {
  if (!token) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM customerSessions WHERE tokenHash = ? AND revokedAt IS NULL`,
    [hashToken(token)]
  );
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return rowToSession(row);
}

export async function revokeCustomerSession(id) {
  const db = await getAdapter();
  db.run(`UPDATE customerSessions SET revokedAt = ? WHERE id = ?`, [new Date().toISOString(), id]);
}

export async function revokeAllSessionsForCustomer(customerId) {
  const db = await getAdapter();
  db.run(`UPDATE customerSessions SET revokedAt = ? WHERE customerId = ? AND revokedAt IS NULL`, [new Date().toISOString(), customerId]);
}

export async function pruneExpiredSessions() {
  const db = await getAdapter();
  db.run(`DELETE FROM customerSessions WHERE expiresAt < ?`, [new Date().toISOString()]);
}
