// Migration 017: schedule + delivery state for notifications.
//
// Existing rows are treated as already-sent broadcasts/targeted (status=sent).
// New columns:
//   scheduledAt  ISO datetime when the notification should fire. NULL = immediate.
//   status       'sent' | 'scheduled' | 'cancelled' | 'failed'
//   sentAt       ISO datetime when externals (email/telegram) actually dispatched.
//   targetSpec   JSON snapshot of the recipient selection used for scheduled
//                broadcasts that should re-resolve recipients at fire time
//                (e.g. {"target":"all"} or {"target":"customers","ids":[...]} or
//                {"target":"filter","planIds":[...],"hasTelegram":true,...}).

const migration = {
  version: 17,
  name: "notifications-schedule",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(notifications)`).map((r) => r.name));
    if (!cols.has("scheduledAt")) {
      db.exec(`ALTER TABLE notifications ADD COLUMN scheduledAt TEXT`);
    }
    if (!cols.has("status")) {
      db.exec(`ALTER TABLE notifications ADD COLUMN status TEXT DEFAULT 'sent'`);
    }
    if (!cols.has("sentAt")) {
      db.exec(`ALTER TABLE notifications ADD COLUMN sentAt TEXT`);
    }
    if (!cols.has("targetSpec")) {
      db.exec(`ALTER TABLE notifications ADD COLUMN targetSpec TEXT`);
    }
    // Existing rows pre-migration are already delivered.
    db.exec(`UPDATE notifications SET status = 'sent' WHERE status IS NULL OR status = ''`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notif_status_sched ON notifications(status, scheduledAt)`);
  },
};

export default migration;
