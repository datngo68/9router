import { getAdapter } from "../driver.js";
import crypto from "node:crypto";

/**
 * Append a row to the admin audit log. Caller passes already-stringified
 * meta when relevant. Errors are swallowed so audit failure can't break a
 * mutating action mid-flight.
 */
export async function logAdminAction({
  actorRole = null,
  action,
  targetType = null,
  targetId = null,
  ip = null,
  userAgent = null,
  payload = null,
  meta = null,
} = {}) {
  if (!action) return;
  try {
    const db = await getAdapter();
    const payloadHash = payload
      ? crypto.createHash("sha256").update(typeof payload === "string" ? payload : JSON.stringify(payload)).digest("hex")
      : null;
    db.run(
      `INSERT INTO adminAuditLog(createdAt, actorRole, action, targetType, targetId, ip, userAgent, payloadHash, meta)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date().toISOString(),
        actorRole,
        action,
        targetType,
        targetId,
        ip,
        userAgent,
        payloadHash,
        meta ? (typeof meta === "string" ? meta : JSON.stringify(meta)) : null,
      ]
    );
  } catch (e) {
    console.error("[adminAuditRepo] log failed:", e?.message || e);
  }
}

/**
 * Read recent admin audit entries. Optional filters: action, targetType.
 */
export async function getAdminAuditLog({ action = null, targetType = null, limit = 200 } = {}) {
  const db = await getAdapter();
  const params = [];
  const where = [];
  if (action) { where.push("action = ?"); params.push(action); }
  if (targetType) { where.push("targetType = ?"); params.push(targetType); }
  let sql = `SELECT id, createdAt, actorRole, action, targetType, targetId, ip, userAgent, payloadHash, meta FROM adminAuditLog`;
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
  const rows = db.all(sql, params);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    actorRole: r.actorRole,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    ip: r.ip,
    userAgent: r.userAgent,
    payloadHash: r.payloadHash,
    meta: r.meta ? safeParse(r.meta) : null,
  }));
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}
