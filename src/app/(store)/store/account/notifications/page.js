"use client";

import { useEffect, useState } from "react";

const TYPE_BADGE = {
  info: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-500",
  warning: "bg-amber-500/10 text-amber-500",
  alert: "bg-red-500/10 text-red-500",
};

function fmtTime(s) {
  return s ? new Date(s).toLocaleString("vi-VN") : "—";
}

export default function NotificationsListPage() {
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/account/notifications?limit=100", { cache: "no-store" });
    const d = await r.json();
    setItems(d?.items || []);
    setUnread(Number(d?.unreadCount) || 0);
  }
  useEffect(() => { load(); }, []);

  async function markRead(id) {
    await fetch(`/api/account/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    load();
  }
  async function markAll() {
    setBusy(true);
    try {
      await fetch("/api/account/notifications/read-all", { method: "POST" });
      await load();
    } finally { setBusy(false); }
  }

  if (items === null) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Thông báo</h1>
          <p className="text-sm text-text-muted">{items.length} thông báo · {unread} chưa đọc</p>
        </div>
        {unread > 0 && (
          <button
            onClick={markAll}
            disabled={busy}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm hover:bg-surface-2/80"
          >Đánh dấu tất cả đã đọc</button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface p-10 text-center text-sm text-text-muted">
          Chưa có thông báo nào.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <li key={n.id} className={`rounded-xl border p-4 transition-colors ${n.isRead ? "border-border-subtle bg-surface" : "border-primary/30 bg-primary/5"}`}>
              <div className="flex items-start gap-3">
                <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] uppercase ${TYPE_BADGE[n.type] || TYPE_BADGE.info}`}>{n.type || "info"}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${n.isRead ? "" : "font-medium"}`}>{n.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{n.body}</p>
                  {n.link && (
                    <a href={n.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary hover:underline">
                      {n.link}
                    </a>
                  )}
                  <p className="mt-2 text-xs text-text-muted">{fmtTime(n.createdAt)}</p>
                </div>
                {!n.isRead && (
                  <button onClick={() => markRead(n.id)} className="text-xs text-primary hover:underline whitespace-nowrap">
                    Đã đọc
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
