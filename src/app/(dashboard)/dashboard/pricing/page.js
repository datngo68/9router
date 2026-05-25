"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Button, Modal, Input, Toggle, ConfirmModal, ModelMultiSelectField } from "@/shared/components";

const EMPTY = {
  kind: "monthly",
  name: "",
  description: "",
  priceVnd: 0,
  dailyTokenLimit: 0,
  monthlyTokenLimit: 0,
  lifetimeTokenLimit: 0,
  requestsPerMinute: 0,
  maxTokensPerRequest: 0,
  rateLimitWindowSec: 0,
  expiresAfterDays: 0,
  expiresAfterMinutes: 0,
  allowedModels: [],
  maxPurchasesPerCustomer: 0,
  isActive: true,
  sortOrder: 0,
};

const WINDOW_PRESETS = [
  { label: "1 phút", sec: 60 },
  { label: "5 phút", sec: 300 },
  { label: "1 giờ", sec: 3600 },
  { label: "5 giờ", sec: 18000 },
  { label: "1 ngày", sec: 86400 },
];

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }

function fmtWindow(sec) {
  const s = Number(sec || 0);
  if (s <= 0) return "phút";
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60} phút`;
  return `${s}s`;
}

function fmtPlanExpiry(plan) {
  const m = Number(plan?.expiresAfterMinutes || 0);
  const d = Number(plan?.expiresAfterDays || 0);
  if (m > 0) {
    const days = Math.floor(m / (60 * 24));
    const hours = Math.floor((m % (60 * 24)) / 60);
    const mins = m % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (mins) parts.push(`${mins}m`);
    return parts.join(" ") || `${m}m`;
  }
  if (d > 0) return `${d}d`;
  return "—";
}

export default function AdminPricingPage() {
  const [plans, setPlans] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  async function load() {
    const r = await fetch("/api/admin/pricing-plans", { cache: "no-store" });
    const d = await r.json();
    setPlans(d.plans || []);
  }
  async function loadProviders() {
    try {
      const [providersRes, aliasesRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/models/alias", { cache: "no-store" }),
      ]);
      if (providersRes.ok) {
        const d = await providersRes.json();
        setActiveProviders(d.connections || []);
      }
      if (aliasesRes.ok) {
        const d = await aliasesRes.json();
        setModelAliases(d.aliases || {});
      }
    } catch (e) {
      console.log("Error loading providers/aliases:", e);
    }
  }
  useEffect(() => {
    load();
    loadProviders();
  }, []);

  function openNew() { setEditing({ ...EMPTY, _new: true }); }
  function openEdit(p) { setEditing({ ...p }); }
  function close() { setEditing(null); }

  async function save() {
    const isNew = editing._new;
    const body = { ...editing };
    delete body._new;
    delete body.id;
    const url = isNew ? "/api/admin/pricing-plans" : `/api/admin/pricing-plans/${editing.id}`;
    const method = isNew ? "POST" : "PATCH";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json();
      alert(d?.error || "Lưu thất bại");
      return;
    }
    close();
    load();
  }

  function askDelete(p) {
    setConfirm({
      title: "Xóa gói",
      message: `Xóa gói "${p.name}"? Đơn cũ vẫn giữ tham chiếu nhưng không bán được nữa.`,
      onConfirm: async () => {
        setConfirm(null);
        await fetch(`/api/admin/pricing-plans/${p.id}`, { method: "DELETE" });
        load();
      },
    });
  }

  async function toggleActive(p) {
    await fetch(`/api/admin/pricing-plans/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pricing Plans</h1>
          <p className="text-sm text-text-muted">Quản lý các gói bán cho khách. Plan inactive không hiển thị trong storefront.</p>
        </div>
        <Button icon="add" onClick={openNew}>Thêm gói</Button>
      </div>

      {!plans ? (
        <Card><div className="h-32 animate-pulse" /></Card>
      ) : plans.length === 0 ? (
        <Card><p className="text-center text-text-muted">Chưa có gói nào.</p></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Tên</th>
                  <th className="px-3 py-2 text-left">Loại</th>
                  <th className="px-3 py-2 text-right">Giá</th>
                  <th className="px-3 py-2 text-right">Daily / Monthly / Lifetime</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Hết hạn</th>
                  <th className="px-3 py-2 text-right">Max/user</th>
                  <th className="px-3 py-2 text-center">Active</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{p.kind}</span></td>
                    <td className="px-3 py-2 text-right">{fmtVnd(p.priceVnd)}</td>
                    <td className="px-3 py-2 text-right text-xs">{p.dailyTokenLimit || "—"} / {p.monthlyTokenLimit || "—"} / {p.lifetimeTokenLimit || "—"}</td>
                    <td className="px-3 py-2 text-right text-xs">{p.requestsPerMinute ? `${p.requestsPerMinute}/${fmtWindow(p.rateLimitWindowSec)}` : "—"}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtPlanExpiry(p)}</td>
                    <td className="px-3 py-2 text-right text-xs">{p.maxPurchasesPerCustomer ? `${p.maxPurchasesPerCustomer} lần` : "∞"}</td>
                    <td className="px-3 py-2 text-center"><Toggle checked={p.isActive} onChange={() => toggleActive(p)} size="sm" /></td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => openEdit(p)} className="rounded p-1 text-text-muted hover:text-primary"><span className="material-symbols-outlined text-base">edit</span></button>
                      <button onClick={() => askDelete(p)} className="rounded p-1 text-text-muted hover:text-red-500"><span className="material-symbols-outlined text-base">delete</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal isOpen={!!editing} onClose={close} title={editing?._new ? "Tạo gói mới" : "Sửa gói"}>
        {editing && (
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Loại</span>
                <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2">
                  <option value="monthly">Monthly</option>
                  <option value="topup">Topup</option>
                </select>
              </label>
              <Input label="Tên gói" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">Mô tả</span>
              <textarea value={editing.description} rows={2} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Giá (VND)" type="number" min={0} value={editing.priceVnd} onChange={(e) => setEditing({ ...editing, priceVnd: Number(e.target.value) })} />
              <ExpiryDurationField
                minutes={editing.expiresAfterMinutes}
                fallbackDays={editing.expiresAfterDays}
                onChange={(m) => setEditing({ ...editing, expiresAfterMinutes: m, expiresAfterDays: 0 })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Daily limit" type="number" min={0} value={editing.dailyTokenLimit} onChange={(e) => setEditing({ ...editing, dailyTokenLimit: Number(e.target.value) })} hint="0 = không giới hạn" />
              <Input label="Monthly limit" type="number" min={0} value={editing.monthlyTokenLimit} onChange={(e) => setEditing({ ...editing, monthlyTokenLimit: Number(e.target.value) })} />
              <Input label="Lifetime limit" type="number" min={0} value={editing.lifetimeTokenLimit} onChange={(e) => setEditing({ ...editing, lifetimeTokenLimit: Number(e.target.value) })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Số requests / window" type="number" min={0} value={editing.requestsPerMinute} onChange={(e) => setEditing({ ...editing, requestsPerMinute: Number(e.target.value) })} />
              <Input label="Max tokens / request" type="number" min={0} value={editing.maxTokensPerRequest} onChange={(e) => setEditing({ ...editing, maxTokensPerRequest: Number(e.target.value) })} />
            </div>
            <RateLimitWindowField
              value={editing.rateLimitWindowSec}
              onChange={(v) => setEditing({ ...editing, rateLimitWindowSec: v })}
              requestCount={editing.requestsPerMinute}
            />
            <Input
              label="Mỗi user mua tối đa (lần)"
              type="number"
              min={0}
              value={editing.maxPurchasesPerCustomer ?? 0}
              onChange={(e) => setEditing({ ...editing, maxPurchasesPerCustomer: Number(e.target.value) })}
              hint="0 = không giới hạn. Chỉ tính đơn pending/paid/delivered (đơn cancelled/refunded không trừ lượt)."
            />
            <ModelMultiSelectField
              label="Allowed models"
              value={editing.allowedModels || []}
              onChange={(models) => setEditing({ ...editing, allowedModels: models })}
              activeProviders={activeProviders}
              modelAliases={modelAliases}
              title="Chọn models cho gói"
              hint="Để trống = cho phép tất cả model. Bấm 'Chọn tất cả' ở mỗi provider để gán nhanh cả nhóm."
              addLabel="Thêm model"
            />
            <div className="grid grid-cols-2 gap-3 items-center">
              <Input label="Sort order" type="number" min={0} value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
              <label className="flex items-center gap-2 text-sm pt-6">
                <Toggle checked={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} />
                <span>Active</span>
              </label>
            </div>
            <div className="mt-2 flex gap-2">
              <Button onClick={save} fullWidth disabled={!editing.name}>Lưu</Button>
              <Button onClick={close} variant="ghost" fullWidth>Hủy</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal isOpen={!!confirm} onClose={() => setConfirm(null)} onConfirm={confirm?.onConfirm} title={confirm?.title} message={confirm?.message} variant="danger" />
    </div>
  );
}

function ExpiryDurationField({ minutes, fallbackDays, onChange }) {
  // Local state mirrors days/hours/mins so user can type each independently.
  const initialMinutes = useMemo(() => {
    const m = Number(minutes || 0);
    if (m > 0) return m;
    return Number(fallbackDays || 0) * 1440;
    // initialMinutes only matters on mount; subsequent edits flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [days, setDays] = useState(Math.floor(initialMinutes / 1440));
  const [hours, setHours] = useState(Math.floor((initialMinutes % 1440) / 60));
  const [mins, setMins] = useState(initialMinutes % 60);

  function emit(d, h, m) {
    const total = (Number(d) || 0) * 1440 + (Number(h) || 0) * 60 + (Number(m) || 0);
    onChange(total);
  }

  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <div className="text-xs text-text-muted mb-1">Hết hạn sau</div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          type="number"
          min={0}
          value={days}
          onChange={(e) => { const v = e.target.value; setDays(v); emit(v, hours, mins); }}
          placeholder="ngày"
        />
        <Input
          type="number"
          min={0}
          value={hours}
          onChange={(e) => { const v = e.target.value; setHours(v); emit(days, v, mins); }}
          placeholder="giờ"
        />
        <Input
          type="number"
          min={0}
          value={mins}
          onChange={(e) => { const v = e.target.value; setMins(v); emit(days, hours, v); }}
          placeholder="phút"
        />
      </div>
      <div className="text-xs text-text-muted mt-1">
        Tất cả 0 = không bao giờ hết hạn. Hệ thống lưu tổng số phút.
      </div>
    </div>
  );
}

function RateLimitWindowField({ value, onChange, requestCount }) {
  const sec = Number(value || 0);
  const isCustom = sec > 0 && !WINDOW_PRESETS.some((p) => p.sec === sec);
  const [customMode, setCustomMode] = useState(isCustom);

  const summary = Number(requestCount) > 0
    ? `≈ ${Number(requestCount).toLocaleString("vi-VN")} requests / ${sec > 0 ? fmtWindow(sec) : "phút"}`
    : "Đang tắt rate limit (số requests = 0)";

  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Rate limit window</span>
        <span className="text-xs text-text-muted">{summary}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => { setCustomMode(false); onChange(0); }}
          className={`px-2.5 py-1 rounded text-xs border transition ${
            sec === 0 && !customMode ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-surface-2"
          }`}
        >Mặc định (1 phút)</button>
        {WINDOW_PRESETS.map((p) => (
          <button
            type="button"
            key={p.sec}
            onClick={() => { setCustomMode(false); onChange(p.sec); }}
            className={`px-2.5 py-1 rounded text-xs border transition ${
              sec === p.sec && !customMode ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-surface-2"
            }`}
          >{p.label}</button>
        ))}
        <button
          type="button"
          onClick={() => setCustomMode(true)}
          className={`px-2.5 py-1 rounded text-xs border transition ${
            customMode ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:bg-surface-2"
          }`}
        >Custom</button>
      </div>
      {customMode && (
        <div className="mt-2">
          <Input
            type="number"
            min={1}
            value={sec}
            onChange={(e) => onChange(Number(e.target.value) || 0)}
            placeholder="Số giây"
            hint="VD 18000 = 5 giờ, 600 = 10 phút"
          />
        </div>
      )}
    </div>
  );
}
