// Notifications repo. Two storage models in one table:
//   1. Targeted: customerId set -> visible only to that customer.
//   2. Broadcast: customerId NULL -> visible to all customers.
// notificationReads tracks per-customer read state across both kinds.
//
// Status lifecycle:
//   - status='sent'      : in-app row is visible to recipients (default).
//   - status='scheduled' : not yet visible. Will be promoted to 'sent' at
//                          scheduledAt by the scheduler tick (or admin
//                          run-due endpoint). For scheduled broadcasts that
//                          re-resolve recipients (e.g. filter-based) we
//                          stash the recipient spec in targetSpec and
//                          materialize per-customer rows at fire time.
//   - status='cancelled' : admin cancelled before fire time.
//   - status='failed'    : scheduler failed to dispatch (kept for audit).

import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToNotification(row) {
  if (!row) return null;
  let channels = [];
  try { channels = JSON.parse(row.channels || "[]"); } catch { channels = []; }
  let targetSpec = null;
  if (row.targetSpec) {
    try { targetSpec = JSON.parse(row.targetSpec); } catch { targetSpec = null; }
  }
  return {
    id: row.id,
    customerId: row.customerId || null,
    title: row.title,
    body: row.body,
    type: row.type || "info",
    link: row.link || null,
    channels,
    createdAt: row.createdAt,
    createdBy: row.createdBy || null,
    isRead: row.isRead === 1 || row.isRead === true,
    readAt: row.readAt || null,
    scheduledAt: row.scheduledAt || null,
    status: row.status || "sent",
    sentAt: row.sentAt || null,
    targetSpec,
  };
}

export async function createNotification({
  customerId = null,
  title,
  body,
  type = "info",
  link = null,
  channels = ["inapp"],
  createdBy = null,
  scheduledAt = null,
  status = "sent",
  sentAt = null,
  targetSpec = null,
}) {
  if (!title) throw new Error("title is required");
  if (!body) throw new Error("body is required");
  const db = await getAdapter();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO notifications(id, customerId, title, body, type, link, channels, createdAt, createdBy, scheduledAt, status, sentAt, targetSpec)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      customerId || null,
      String(title),
      String(body),
      String(type || "info"),
      link || null,
      JSON.stringify(Array.isArray(channels) ? channels : []),
      now,
      createdBy || null,
      scheduledAt || null,
      status || "sent",
      sentAt || (status === "sent" ? now : null),
      targetSpec ? JSON.stringify(targetSpec) : null,
    ]
  );
  return getNotificationById(id);
}

export async function getNotificationById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM notifications WHERE id = ?`, [id]);
  return rowToNotification(row);
}

// Returns notifications visible to customer (targeted + broadcast),
// most-recent first. Adds isRead via LEFT JOIN on notificationReads.
// Only 'sent' rows are surfaced to customers — scheduled/cancelled/failed
// rows must never appear in the bell or REST listing.
export async function listForCustomer(customerId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  if (!customerId) return [];
  const db = await getAdapter();
  const where = unreadOnly ? "AND r.notificationId IS NULL" : "";
  const rows = db.all(
    `SELECT n.*,
            CASE WHEN r.notificationId IS NULL THEN 0 ELSE 1 END AS isRead,
            r.readAt AS readAt
       FROM notifications n
       LEFT JOIN notificationReads r
              ON r.notificationId = n.id AND r.customerId = ?
      WHERE (n.customerId = ? OR n.customerId IS NULL)
        AND COALESCE(n.status,'sent') = 'sent' ${where}
      ORDER BY n.createdAt DESC
      LIMIT ? OFFSET ?`,
    [customerId, customerId, Number(limit) || 50, Number(offset) || 0]
  );
  return rows.map(rowToNotification);
}

export async function countUnreadForCustomer(customerId) {
  if (!customerId) return 0;
  const db = await getAdapter();
  const row = db.get(
    `SELECT COUNT(*) AS c
       FROM notifications n
       LEFT JOIN notificationReads r
              ON r.notificationId = n.id AND r.customerId = ?
      WHERE (n.customerId = ? OR n.customerId IS NULL)
        AND COALESCE(n.status,'sent') = 'sent'
        AND r.notificationId IS NULL`,
    [customerId, customerId]
  );
  return Number(row?.c || 0);
}

export async function markRead(customerId, notificationId) {
  if (!customerId || !notificationId) return false;
  const db = await getAdapter();
  // Verify visibility before recording the read so a customer cannot
  // mark someone else's targeted notification as read.
  const visible = db.get(
    `SELECT id FROM notifications WHERE id = ? AND (customerId = ? OR customerId IS NULL) AND COALESCE(status,'sent') = 'sent'`,
    [notificationId, customerId]
  );
  if (!visible) return false;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO notificationReads(notificationId, customerId, readAt)
     VALUES(?, ?, ?)
     ON CONFLICT(notificationId, customerId) DO UPDATE SET readAt = excluded.readAt`,
    [notificationId, customerId, now]
  );
  return true;
}

export async function markAllRead(customerId) {
  if (!customerId) return 0;
  const db = await getAdapter();
  const now = new Date().toISOString();
  const rows = db.all(
    `SELECT n.id FROM notifications n
       LEFT JOIN notificationReads r
              ON r.notificationId = n.id AND r.customerId = ?
      WHERE (n.customerId = ? OR n.customerId IS NULL)
        AND COALESCE(n.status,'sent') = 'sent'
        AND r.notificationId IS NULL`,
    [customerId, customerId]
  );
  let count = 0;
  for (const r of rows) {
    db.run(
      `INSERT INTO notificationReads(notificationId, customerId, readAt)
       VALUES(?, ?, ?)
       ON CONFLICT(notificationId, customerId) DO UPDATE SET readAt = excluded.readAt`,
      [r.id, customerId, now]
    );
    count++;
  }
  return count;
}

// Admin: list notifications with optional filtering. Status filter:
//   - undefined/empty: only 'sent' rows (history default).
//   - 'all': every status.
//   - 'sent' | 'scheduled' | 'cancelled' | 'failed': exact match.
export async function listAllNotifications({ q = "", type = "", scope = "", status = "", limit = 200 } = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (q) {
    where.push(`(title LIKE ? OR body LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like);
  }
  if (type) {
    where.push(`type = ?`);
    params.push(type);
  }
  if (scope === "broadcast") where.push(`customerId IS NULL`);
  if (scope === "targeted") where.push(`customerId IS NOT NULL`);
  if (status === "all") {
    // no status filter
  } else if (status) {
    where.push(`COALESCE(status,'sent') = ?`);
    params.push(status);
  } else {
    where.push(`COALESCE(status,'sent') = 'sent'`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(Number(limit) || 200);
  // For scheduled rows we want them ordered by scheduledAt asc; for everything
  // else newest first. ORDER BY uses COALESCE so scheduled bubble naturally.
  const rows = db.all(
    `SELECT * FROM notifications ${whereSql}
       ORDER BY CASE WHEN COALESCE(status,'sent') = 'scheduled' THEN 0 ELSE 1 END,
                CASE WHEN COALESCE(status,'sent') = 'scheduled' THEN scheduledAt END ASC,
                createdAt DESC
       LIMIT ?`,
    params
  );
  return rows.map(rowToNotification);
}

export async function deleteNotification(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM notificationReads WHERE notificationId = ?`, [id]);
  const res = db.run(`DELETE FROM notifications WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// Scheduler helpers ─────────────────────────────────────────────────────────

// Returns scheduled rows whose scheduledAt has passed. Used by the periodic
// tick + by the manual /run-due admin endpoint.
export async function listDueScheduled({ now = new Date().toISOString(), limit = 50 } = {}) {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM notifications
      WHERE COALESCE(status,'sent') = 'scheduled'
        AND scheduledAt IS NOT NULL
        AND scheduledAt <= ?
      ORDER BY scheduledAt ASC
      LIMIT ?`,
    [now, Number(limit) || 50]
  );
  return rows.map(rowToNotification);
}

export async function listUpcomingScheduled({ limit = 200 } = {}) {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM notifications
      WHERE COALESCE(status,'sent') = 'scheduled'
      ORDER BY scheduledAt ASC
      LIMIT ?`,
    [Number(limit) || 200]
  );
  return rows.map(rowToNotification);
}

export async function markScheduledStatus(id, { status, sentAt = null } = {}) {
  if (!id || !status) return false;
  const db = await getAdapter();
  const res = db.run(
    `UPDATE notifications SET status = ?, sentAt = COALESCE(?, sentAt) WHERE id = ?`,
    [status, sentAt, id]
  );
  return (res?.changes ?? 0) > 0;
}

export async function cancelScheduled(id) {
  return markScheduledStatus(id, { status: "cancelled" });
}
