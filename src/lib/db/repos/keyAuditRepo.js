import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

/**
 * Append a key admin action to the audit log.
 * action examples: "create", "update", "delete", "rotate".
 */
export async function logKeyAudit({ keyId, action, actorIp = null, metadata = null }) {
  if (!action) return;
  const db = await getAdapter();
  db.run(
    `INSERT INTO keyAuditLog(timestamp, keyId, action, actorIp, metadata) VALUES(?, ?, ?, ?, ?)`,
    [new Date().toISOString(), keyId || null, action, actorIp, metadata ? stringifyJson(metadata) : null]
  );
}

/**
 * Read recent audit entries. Filter by keyId optional.
 */
export async function getKeyAuditLog({ keyId = null, limit = 200 } = {}) {
  const db = await getAdapter();
  const params = [];
  let sql = `SELECT id, timestamp, keyId, action, actorIp, metadata FROM keyAuditLog`;
  if (keyId) { sql += ` WHERE keyId = ?`; params.push(keyId); }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
  const rows = db.all(sql, params);
  return rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    keyId: r.keyId,
    action: r.action,
    actorIp: r.actorIp,
    metadata: r.metadata ? parseJson(r.metadata, null) : null,
  }));
}
