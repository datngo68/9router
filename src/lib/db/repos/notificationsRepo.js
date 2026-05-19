// Notifications repo. Two storage models in one table:
//   1. Targeted: customerId set -> visible only to that customer.
//   2. Broadcast: customerId NULL -> visible to all customers.
// notificationReads tracks per-customer read state across both kinds.

import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToNotification(row) {
  if (!row) return null;
  let channels = [];
  try { channels = JSON.parse(row.channels || "[]"); } catch { channels = []; }
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
}) {
  if (!title) throw new Error("title is required");
  if (!body) throw new Error("body is required");
  const db = await getAdapter();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO notifications(id, customerId, title, body, type, link, channels, createdAt, createdBy)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      WHERE (n.customerId = ? OR n.customerId IS NULL) ${where}
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
    `SELECT id FROM notifications WHERE id = ? AND (customerId = ? OR customerId IS NULL)`,
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

// Admin: list all notifications with optional filtering.
export async function listAllNotifications({ q = "", type = "", scope = "", limit = 200 } = {}) {
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
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(Number(limit) || 200);
  const rows = db.all(
    `SELECT * FROM notifications ${whereSql} ORDER BY createdAt DESC LIMIT ?`,
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
