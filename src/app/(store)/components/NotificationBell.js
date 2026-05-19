"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function fmtRelative(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "vừa xong";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}p`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return d.toLocaleDateString("vi-VN");
}

const TYPE_ICON = {
  info: "info",
  success: "check_circle",
  warning: "warning",
  alert: "campaign",
};

export default function NotificationBell() {
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Detect auth state by polling /api/account/me lightweight; we already
  // poll unread-count but only when authenticated.
  useEffect(() => {
    fetch("/api/account/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAuthed(!!d?.customer))
      .catch(() => setAuthed(false));
  }, [pathname]);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/account/notifications/unread-count", { cache: "no-store" });
        const d = await r.json();
        if (!cancelled) setUnread(Number(d?.count) || 0);
      } catch {}
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [authed]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function loadList() {
    try {
      const r = await fetch("/api/account/notifications?limit=5", { cache: "no-store" });
      const d = await r.json();
      setItems(d?.items || []);
      setUnread(Number(d?.unreadCount) || 0);
    } catch {}
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  }

  async function markOne(id) {
    await fetch(`/api/account/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    loadList();
  }

  async function markAll() {
    await fetch("/api/account/notifications/read-all", { method: "POST" }).catch(() => {});
    loadList();
  }

  if (!authed) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="relative flex items-center justify-center rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-text-main"
        aria-label="Thông báo"
      >
        <span className="material-symbols-outlined">notifications</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="font-medium">Thông báo</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs text-primary hover:underline">
                Đánh dấu tất cả đã đọc
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-auto">
            {items.length === 0 ? (
              <div className="p-6 text-center text-sm text-text-muted">Chưa có thông báo</div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {items.map((n) => (
                  <li key={n.id} className={`px-3 py-2 ${!n.isRead ? "bg-primary/5" : ""}`}>
                    <button
                      onClick={() => {
                        if (!n.isRead) markOne(n.id);
                        if (n.link) window.open(n.link, "_blank");
                      }}
                      className="flex w-full items-start gap-2 text-left"
                    >
                      <span className="material-symbols-outlined mt-0.5 text-base text-primary">{TYPE_ICON[n.type] || "info"}</span>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${!n.isRead ? "font-medium" : ""}`}>{n.title}</p>
                        <p className="line-clamp-2 text-xs text-text-muted">{n.body}</p>
                        <p className="mt-0.5 text-[10px] text-text-muted">{fmtRelative(n.createdAt)}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-border-subtle px-3 py-2 text-center">
            <Link href="/store/account/notifications" onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">
              Xem tất cả
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
