"use client";

import { useEffect, useMemo, useState } from "react";
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

const PRESETS = [
  {
    id: "maintenance",
    label: "Bảo trì hệ thống",
    icon: "build",
    apply: () => ({
      title: "Thông báo bảo trì hệ thống",
      body:
        "Xin chào,\n\nHệ thống sẽ tạm dừng phục vụ để bảo trì trong khoảng [TỪ] đến [ĐẾN]. Trong thời gian này một số API có thể bị gián đoạn.\n\nMong bạn thông cảm và sắp xếp công việc phù hợp. Cảm ơn bạn đã đồng hành!",
      type: "warning",
      channels: ["inapp", "email", "telegram"],
    }),
  },
  {
    id: "update",
    label: "Cập nhật phiên bản",
    icon: "system_update_alt",
    apply: () => ({
      title: "Đã cập nhật phiên bản mới",
      body:
        "Phiên bản mới đã được phát hành với một số cải tiến và sửa lỗi. Bạn có thể xem chi tiết tại link bên dưới.",
      type: "info",
      channels: ["inapp", "telegram"],
    }),
  },
  {
    id: "incident",
    label: "Sự cố khẩn",
    icon: "error",
    apply: () => ({
      title: "Cảnh báo sự cố",
      body:
        "Hệ thống đang gặp sự cố tại [DỊCH VỤ]. Đội ngũ kỹ thuật đang xử lý. Sẽ cập nhật ngay khi có tiến triển.",
      type: "alert",
      channels: ["inapp", "email", "telegram"],
    }),
  },
];

const DEFAULT_FORM = {
  target: "all", // 'all' | 'customers' | 'filter'
  customerIds: [],
  filter: { planIds: [], hasTelegram: false, hasVerifiedEmail: false, q: "" },
  title: "",
  body: "",
  type: "info",
  link: "",
  channels: ["inapp"],
  scheduleEnabled: false,
  scheduleAt: "",
};

function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }
function localInputToIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
function nowPlusMinutes(min) {
  const d = new Date(Date.now() + min * 60_000);
  // datetime-local needs YYYY-MM-DDTHH:mm in local time
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminNotificationsPage() {
  const [tab, setTab] = useState("compose");
  const [history, setHistory] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  async function loadHistory() {
    const r = await fetch("/api/admin/notifications?status=sent", { cache: "no-store" });
    const d = await r.json();
    setHistory(d?.items || []);
  }
  async function loadScheduled() {
    const r = await fetch("/api/admin/notifications?status=scheduled", { cache: "no-store" });
    const d = await r.json();
    setScheduled(d?.items || []);
  }
  async function loadCustomers() {
    const r = await fetch("/api/admin/customers?withPlanIds=1", { cache: "no-store" });
    const d = await r.json();
    setCustomers(d?.customers || []);
  }
  async function loadPlans() {
    try {
      const r = await fetch("/api/admin/pricing-plans", { cache: "no-store" });
      const d = await r.json();
      const list = Array.isArray(d?.plans) ? d.plans : (Array.isArray(d) ? d : []);
      setPlans(list);
    } catch { setPlans([]); }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadHistory(); loadScheduled(); loadCustomers(); loadPlans(); }, []);

  function toggleChannel(c) {
    setForm((f) => {
      const has = f.channels.includes(c);
      return { ...f, channels: has ? f.channels.filter((x) => x !== c) : [...f.channels, c] };
    });
  }

  function applyPreset(preset) {
    const next = preset.apply();
    setForm((f) => ({ ...f, ...next }));
    setMsg(`Đã áp preset: ${preset.label}`);
  }

  // Filter view of customers shown inside the multi-select picker.
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerOnlyTelegram, setPickerOnlyTelegram] = useState(false);
  const [pickerOnlyEmailVerified, setPickerOnlyEmailVerified] = useState(false);
  const [pickerPlanId, setPickerPlanId] = useState("");

  const visibleCustomers = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return customers.filter((c) => {
      if (q && !`${c.email} ${c.displayName || ""} ${c.phone || ""}`.toLowerCase().includes(q)) return false;
      if (pickerOnlyTelegram && !c.telegramChatId) return false;
      if (pickerOnlyEmailVerified && !c.emailVerified) return false;
      if (pickerPlanId && !(Array.isArray(c.planIds) && c.planIds.includes(pickerPlanId))) return false;
      return true;
    });
  }, [customers, pickerSearch, pickerOnlyTelegram, pickerOnlyEmailVerified, pickerPlanId]);

  function toggleCustomerId(id) {
    setForm((f) => {
      const has = f.customerIds.includes(id);
      return { ...f, customerIds: has ? f.customerIds.filter((x) => x !== id) : [...f.customerIds, id] };
    });
  }
  function selectAllVisible() {
    const ids = visibleCustomers.map((c) => c.id);
    setForm((f) => ({ ...f, customerIds: Array.from(new Set([...f.customerIds, ...ids])) }));
  }
  function clearSelection() {
    setForm((f) => ({ ...f, customerIds: [] }));
  }

  const selectedCustomers = useMemo(
    () => customers.filter((c) => form.customerIds.includes(c.id)),
    [customers, form.customerIds]
  );

  function buildPayload() {
    const payload = {
      target: form.target,
      title: form.title,
      body: form.body,
      type: form.type,
      link: form.link || undefined,
      channels: form.channels,
    };
    if (form.target === "customers") payload.customerIds = form.customerIds;
    if (form.target === "filter") payload.filter = form.filter;
    if (form.scheduleEnabled) {
      const iso = localInputToIso(form.scheduleAt);
      if (iso) payload.scheduleAt = iso;
    }
    return payload;
  }

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const payload = buildPayload();
      const r = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(d?.error || "Gửi thất bại"); return; }
      if (d.scheduled) {
        setMsg(`Đã lên lịch lúc ${fmtTime(d.notification?.scheduledAt)}`);
        loadScheduled();
      } else {
        setMsg(`Đã gửi tới ${d.recipientCount === "all" ? "tất cả" : `${d.recipientCount} khách`}`);
        loadHistory();
      }
      setForm((f) => ({ ...f, title: "", body: "", link: "", scheduleEnabled: false, scheduleAt: "" }));
    } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Xóa thông báo này?")) return;
    await fetch(`/api/admin/notifications/${id}`, { method: "DELETE" });
    loadHistory();
    loadScheduled();
  }
  async function cancelSchedule(id) {
    if (!confirm("Hủy lịch gửi này?")) return;
    await fetch(`/api/admin/notifications/${id}?cancel=1`, { method: "DELETE" });
    loadScheduled();
  }
  async function runDueNow() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/notifications/run-due", { method: "POST" });
      const d = await r.json();
      setMsg(`Scheduler: xử lý ${d?.processed ?? 0} thông báo`);
      loadScheduled();
      loadHistory();
    } finally { setBusy(false); }
  }

  const canSubmit =
    !busy &&
    form.title.trim() &&
    form.body.trim() &&
    form.channels.length > 0 &&
    (form.target !== "customers" || form.customerIds.length > 0) &&
    (!form.scheduleEnabled || !!localInputToIso(form.scheduleAt));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Thông báo</h1>
        <p className="text-sm text-text-muted">Soạn và lên lịch thông báo gửi cho khách qua chuông in-app, email và Telegram.</p>
      </div>

      <div className="flex gap-1 border-b border-border-subtle">
        {[
          { id: "compose", label: "Soạn" },
          { id: "scheduled", label: `Lịch hẹn (${scheduled.length})` },
          { id: "history", label: "Lịch sử" },
        ].map((t) => (
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
            <div>
              <p className="mb-2 text-sm text-text-muted">Preset</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary hover:text-primary"
                  >
                    <span className="material-symbols-outlined text-base">{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">Đối tượng</span>
              <select
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                className="rounded-lg border border-border bg-bg px-3 py-2"
              >
                <option value="all">Tất cả khách (broadcast)</option>
                <option value="customers">Chọn nhiều khách...</option>
                <option value="filter">Theo điều kiện (plan / kênh)</option>
              </select>
            </label>

            {form.target === "customers" && (
              <div className="rounded-lg border border-border-subtle p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm">Đã chọn <strong>{form.customerIds.length}</strong> khách</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPickerOpen((v) => !v)} className="text-xs underline">
                      {pickerOpen ? "Ẩn picker" : "Chọn khách"}
                    </button>
                    {form.customerIds.length > 0 && (
                      <button type="button" onClick={clearSelection} className="text-xs text-red-500 underline">Xoá lựa chọn</button>
                    )}
                  </div>
                </div>

                {selectedCustomers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedCustomers.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                        {c.email}
                        <button type="button" onClick={() => toggleCustomerId(c.id)} className="text-text-muted hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                )}

                {pickerOpen && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input placeholder="Tìm email/tên/sđt..." value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} />
                      <select
                        value={pickerPlanId}
                        onChange={(e) => setPickerPlanId(e.target.value)}
                        className="rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                      >
                        <option value="">— Mọi gói —</option>
                        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={pickerOnlyTelegram} onChange={(e) => setPickerOnlyTelegram(e.target.checked)} />
                        Có Telegram
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={pickerOnlyEmailVerified} onChange={(e) => setPickerOnlyEmailVerified(e.target.checked)} />
                        Email đã xác thực
                      </label>
                      <button type="button" onClick={selectAllVisible} className="ml-auto underline">Chọn tất cả ({visibleCustomers.length})</button>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-border-subtle">
                      {visibleCustomers.length === 0 ? (
                        <p className="p-3 text-xs text-text-muted">Không có khách phù hợp.</p>
                      ) : (
                        <ul className="divide-y divide-border-subtle">
                          {visibleCustomers.map((c) => (
                            <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                              <input
                                type="checkbox"
                                checked={form.customerIds.includes(c.id)}
                                onChange={() => toggleCustomerId(c.id)}
                              />
                              <span className="flex-1 truncate">
                                {c.email}{c.displayName ? <span className="text-text-muted"> · {c.displayName}</span> : null}
                              </span>
                              {c.telegramChatId && <span className="text-xs text-text-muted">tg</span>}
                              {c.emailVerified && <span className="text-xs text-text-muted">✓ email</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {form.target === "filter" && (
              <div className="rounded-lg border border-border-subtle p-3 flex flex-col gap-3">
                <p className="text-sm text-text-muted">Gửi cho mọi khách thoả các điều kiện sau (re-resolve tại thời điểm gửi).</p>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-text-muted">Có gói (delivered/paid)</span>
                  <div className="flex flex-wrap gap-2">
                    {plans.map((p) => {
                      const checked = form.filter.planIds.includes(p.id);
                      return (
                        <label key={p.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs cursor-pointer ${checked ? "bg-primary/10 text-primary" : "bg-surface-2"}`}>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={checked}
                            onChange={() => setForm((f) => {
                              const has = f.filter.planIds.includes(p.id);
                              return { ...f, filter: { ...f.filter, planIds: has ? f.filter.planIds.filter((x) => x !== p.id) : [...f.filter.planIds, p.id] } };
                            })}
                          />
                          {p.name}
                        </label>
                      );
                    })}
                    {plans.length === 0 && <span className="text-xs text-text-muted">Chưa có gói nào.</span>}
                  </div>
                </label>
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.filter.hasTelegram}
                      onChange={(e) => setForm((f) => ({ ...f, filter: { ...f.filter, hasTelegram: e.target.checked } }))}
                    />
                    Đã liên kết Telegram
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.filter.hasVerifiedEmail}
                      onChange={(e) => setForm((f) => ({ ...f, filter: { ...f.filter, hasVerifiedEmail: e.target.checked } }))}
                    />
                    Email đã xác thực
                  </label>
                </div>
                <Input
                  placeholder="Lọc thêm theo email/tên/sđt (tuỳ chọn)..."
                  value={form.filter.q}
                  onChange={(e) => setForm((f) => ({ ...f, filter: { ...f.filter, q: e.target.value } }))}
                />
              </div>
            )}

            <Input label="Tiêu đề" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">Nội dung</span>
              <textarea
                rows={6}
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

            <div className="rounded-lg border border-border-subtle p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.scheduleEnabled}
                  onChange={(e) => setForm({ ...form, scheduleEnabled: e.target.checked, scheduleAt: e.target.checked && !form.scheduleAt ? nowPlusMinutes(15) : form.scheduleAt })}
                />
                Lên lịch gửi sau
              </label>
              {form.scheduleEnabled && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={form.scheduleAt}
                    onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })}
                    className="rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {[15, 60, 6 * 60, 24 * 60].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm({ ...form, scheduleAt: nowPlusMinutes(m) })}
                        className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-primary hover:text-primary"
                      >
                        +{m < 60 ? `${m}p` : m === 60 ? "1h" : m === 360 ? "6h" : "1 ngày"}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-text-muted">Tick chạy mỗi 60 giây.</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={submit} disabled={!canSubmit}>
                {form.scheduleEnabled ? "Lên lịch gửi" : "Gửi thông báo"}
              </Button>
              {msg && <span className="self-center text-sm text-text-muted">{msg}</span>}
            </div>
          </div>
        </Card>
      )}

      {tab === "scheduled" && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Lịch hẹn ({scheduled.length})</h2>
            <button onClick={runDueNow} disabled={busy} className="text-xs underline">Chạy scheduler ngay</button>
          </div>
          {scheduled.length === 0 ? (
            <p className="text-sm text-text-muted">Không có lịch hẹn nào.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Thời điểm gửi</th>
                    <th className="px-3 py-2 text-left">Loại</th>
                    <th className="px-3 py-2 text-left">Đối tượng</th>
                    <th className="px-3 py-2 text-left">Tiêu đề</th>
                    <th className="px-3 py-2 text-left">Kênh</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {scheduled.map((n) => (
                    <tr key={n.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtTime(n.scheduledAt)}</td>
                      <td className="px-3 py-2 text-xs">{n.type}</td>
                      <td className="px-3 py-2 text-xs">
                        {n.targetSpec?.target === "all" && "Tất cả"}
                        {n.targetSpec?.target === "customers" && `${n.targetSpec.ids?.length || 0} khách`}
                        {n.targetSpec?.target === "filter" && "Theo filter"}
                        {!n.targetSpec && (n.customerId ? "1 khách" : "Tất cả")}
                      </td>
                      <td className="px-3 py-2"><div className="font-medium">{n.title}</div><div className="text-xs text-text-muted line-clamp-1">{n.body}</div></td>
                      <td className="px-3 py-2 text-xs">{(n.channels || []).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-right space-x-2">
                        <button onClick={() => cancelSchedule(n.id)} className="text-xs text-yellow-600 hover:underline">Hủy lịch</button>
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
                      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtTime(n.sentAt || n.createdAt)}</td>
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
