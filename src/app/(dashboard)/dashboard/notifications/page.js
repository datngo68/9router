"use client";

import { useEffect, useState } from "react";
import { Card, Input, Button } from "@/shared/components";

const TYPES = [
  { id: "info", label: "Info" },
  { id: "success", label: "Success" },
  { id: "warning", label: "Warning" },
  { id: "alert", label: "Alert" },
];

const CHANNELS = [
  { id: "inapp", label: "Trong app (chuông)" },
  { id: "email", label: "Email" },
  { id: "telegram", label: "Telegram" },
];

function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

export default function AdminNotificationsPage() {
  const [tab, setTab] = useState("compose");
  const [history, setHistory] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({
    target: "all",
    customerId: "",
    title: "",
    body: "",
    type: "info",
    link: "",
    channels: ["inapp"],
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadHistory() {
    const r = await fetch("/api/admin/notifications", { cache: "no-store" });
    const d = await r.json();
    setHistory(d?.items || []);
  }
  async function loadCustomers() {
    const r = await fetch("/api/admin/customers", { cache: "no-store" });
    const d = await r.json();
    setCustomers(d?.customers || []);
  }
  useEffect(() => { loadHistory(); loadCustomers(); }, []);

  function toggleChannel(c) {
    setForm((f) => {
      const has = f.channels.includes(c);
      return { ...f, channels: has ? f.channels.filter((x) => x !== c) : [...f.channels, c] };
    });
  }

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const payload = {
        target: form.target,
        title: form.title,
        body: form.body,
        type: form.type,
        link: form.link || undefined,
        channels: form.channels,
      };
      if (form.target === "customer") payload.customerId = form.customerId;
      const r = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(d?.error || "Gửi thất bại"); return; }
      setMsg(`Đã gửi tới ${d.recipientCount === "all" ? "tất cả" : `${d.recipientCount} khách`}`);
      setForm({ ...form, title: "", body: "", link: "" });
      loadHistory();
    } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Xóa thông báo này?")) return;
    await fetch(`/api/admin/notifications/${id}`, { method: "DELETE" });
    loadHistory();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Thông báo</h1>
        <p className="text-sm text-text-muted">Soạn thông báo gửi cho khách qua chuông in-app, email và Telegram.</p>
      </div>

      <div className="flex gap-1 border-b border-border-subtle">
        {[{ id: "compose", label: "Soạn" }, { id: "history", label: "Lịch sử" }].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.id ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >{t.label}</button>
        ))}
      </div>

      {tab === "compose" && (
        <Card>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">Đối tượng</span>
              <select
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                className="rounded-lg border border-border bg-bg px-3 py-2"
              >
                <option value="all">Tất cả khách (broadcast)</option>
                <option value="customer">Một khách cụ thể</option>
              </select>
            </label>

            {form.target === "customer" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Khách</span>
                <select
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  className="rounded-lg border border-border bg-bg px-3 py-2"
                >
                  <option value="">— Chọn khách —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.email}{c.displayName ? ` (${c.displayName})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <Input label="Tiêu đề" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">Nội dung</span>
              <textarea
                rows={5}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="rounded-lg border border-border bg-bg px-3 py-2"
                placeholder="Nội dung thông báo gửi tới khách..."
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Loại</span>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="rounded-lg border border-border bg-bg px-3 py-2"
                >
                  {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <Input label="Link CTA (tùy chọn)" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://..." />
            </div>

            <div>
              <p className="mb-2 text-sm text-text-muted">Kênh gửi</p>
              <div className="flex flex-wrap gap-3">
                {CHANNELS.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.channels.includes(c.id)}
                      onChange={() => toggleChannel(c.id)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-muted">Email/Telegram chỉ tới khách đã cấu hình kênh đó. Hãy bật ít nhất 1 kênh.</p>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={submit}
                disabled={busy || !form.title.trim() || !form.body.trim() || form.channels.length === 0 || (form.target === "customer" && !form.customerId)}
              >
                Gửi thông báo
              </Button>
              {msg && <span className="self-center text-sm text-text-muted">{msg}</span>}
            </div>
          </div>
        </Card>
      )}

      {tab === "history" && (
        <Card>
          <h2 className="font-semibold mb-3">Đã gửi ({history.length})</h2>
          {history.length === 0 ? (
            <p className="text-sm text-text-muted">Chưa gửi thông báo nào.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Thời gian</th>
                    <th className="px-3 py-2 text-left">Loại</th>
                    <th className="px-3 py-2 text-left">Đối tượng</th>
                    <th className="px-3 py-2 text-left">Tiêu đề</th>
                    <th className="px-3 py-2 text-left">Kênh</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((n) => (
                    <tr key={n.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtTime(n.createdAt)}</td>
                      <td className="px-3 py-2 text-xs">{n.type}</td>
                      <td className="px-3 py-2 text-xs">{n.customerId ? `1 khách` : "Broadcast"}</td>
                      <td className="px-3 py-2"><div className="font-medium">{n.title}</div><div className="text-xs text-text-muted line-clamp-1">{n.body}</div></td>
                      <td className="px-3 py-2 text-xs">{(n.channels || []).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => remove(n.id)} className="text-xs text-red-500 hover:underline">Xóa</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
