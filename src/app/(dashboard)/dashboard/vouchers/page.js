"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Button, Modal, Input, Toggle, ConfirmModal } from "@/shared/components";

const EMPTY = {
  code: "",
  description: "",
  kind: "percent",
  value: 10,
  scopePlanIds: [],
  maxUses: 0,
  maxPerCustomer: 0,
  validFrom: "",
  validTo: "",
  minOrderVnd: 0,
  firstOrderOnly: 0,
  isActive: true,
};

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

// Browser <input type="datetime-local"> only accepts "YYYY-MM-DDTHH:mm" with
// no timezone. We store ISO timestamps in DB; convert each direction so the
// admin UI shows local time but the stored value remains canonical.
function isoToLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}
function localToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function AdminVouchersPage() {
  const [vouchers, setVouchers] = useState(null);
  const [plans, setPlans] = useState(null); // null = loading, [] = loaded empty
  const [planSearch, setPlanSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [vRes, pRes] = await Promise.all([
          fetch("/api/admin/vouchers", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/admin/pricing-plans", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setVouchers(vRes.vouchers || []);
        setPlans(pRes.plans || []);
      } catch (e) {
        if (cancelled) return;
        console.log("[admin/vouchers] load failed:", e?.message);
        setVouchers([]);
        setPlans([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function load() {
    try {
      const [vRes, pRes] = await Promise.all([
        fetch("/api/admin/vouchers", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/admin/pricing-plans", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setVouchers(vRes.vouchers || []);
      setPlans(pRes.plans || []);
    } catch (e) {
      console.log("[admin/vouchers] reload failed:", e?.message);
    }
  }

  const planLookup = useMemo(
    () => Object.fromEntries((plans || []).map((p) => [p.id, p])),
    [plans]
  );

  function openNew() { setEditing({ ...EMPTY, _new: true }); setError(""); setPlanSearch(""); }
  function openEdit(v) {
    setEditing({
      ...v,
      _new: false,
      validFrom: isoToLocal(v.validFrom),
      validTo: isoToLocal(v.validTo),
    });
    setError("");
    setPlanSearch("");
  }
  function close() { setEditing(null); setError(""); setPlanSearch(""); }

  async function save() {
    setError("");
    const isNew = editing._new;
    const payload = {
      code: editing.code,
      description: editing.description,
      kind: editing.kind,
      value: Number(editing.value || 0),
      scopePlanIds: editing.scopePlanIds || [],
      maxUses: Number(editing.maxUses || 0),
      maxPerCustomer: Number(editing.maxPerCustomer || 0),
      validFrom: localToIso(editing.validFrom),
      validTo: localToIso(editing.validTo),
      minOrderVnd: Number(editing.minOrderVnd || 0),
      firstOrderOnly: editing.firstOrderOnly ? 1 : 0,
      isActive: editing.isActive !== false,
    };
    const url = isNew ? "/api/admin/vouchers" : `/api/admin/vouchers/${editing.id}`;
    const method = isNew ? "POST" : "PATCH";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error || "Lưu thất bại");
      return;
    }
    close();
    load();
  }

  function askDelete(v) {
    setConfirm({
      title: "Xóa voucher",
      message: `Xóa mã "${v.code}"? Lịch sử redemption vẫn được giữ.`,
      onConfirm: async () => {
        setConfirm(null);
        await fetch(`/api/admin/vouchers/${v.id}`, { method: "DELETE" });
        load();
      },
    });
  }

  async function toggleActive(v) {
    await fetch(`/api/admin/vouchers/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !v.isActive }),
    });
    load();
  }

  function togglePlanInScope(planId) {
    const cur = new Set(editing.scopePlanIds || []);
    if (cur.has(planId)) cur.delete(planId); else cur.add(planId);
    setEditing({ ...editing, scopePlanIds: Array.from(cur) });
  }

  function selectAllVisiblePlans(visiblePlanIds, select) {
    const cur = new Set(editing.scopePlanIds || []);
    if (select) {
      for (const id of visiblePlanIds) cur.add(id);
    } else {
      for (const id of visiblePlanIds) cur.delete(id);
    }
    setEditing({ ...editing, scopePlanIds: Array.from(cur) });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vouchers</h1>
          <p className="text-sm text-text-muted">Mã giảm giá áp dụng tại checkout. Mỗi voucher gắn với một hoặc nhiều gói cụ thể.</p>
        </div>
        <Button icon="add" onClick={openNew}>Tạo voucher</Button>
      </div>

      {!vouchers ? (
        <Card><div className="h-32 animate-pulse" /></Card>
      ) : vouchers.length === 0 ? (
        <Card><p className="text-center text-text-muted">Chưa có voucher nào.</p></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Loại</th>
                  <th className="px-3 py-2 text-right">Giá trị</th>
                  <th className="px-3 py-2 text-left">Áp dụng</th>
                  <th className="px-3 py-2 text-right">Đã dùng</th>
                  <th className="px-3 py-2 text-left">Hiệu lực</th>
                  <th className="px-3 py-2 text-center">Active</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <tr key={v.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono">{v.code}</td>
                    <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{v.kind}</span></td>
                    <td className="px-3 py-2 text-right text-xs">{v.kind === "percent" ? `${v.value}%` : fmtVnd(v.value)}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {v.scopePlanIds.length === 0
                        ? "—"
                        : v.scopePlanIds.map((id) => planLookup[id]?.name || id.slice(0, 6)).join(", ")}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">{v.usedCount}{v.maxUses > 0 ? ` / ${v.maxUses}` : " / ∞"}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(v.validFrom)} → {fmtTime(v.validTo)}</td>
                    <td className="px-3 py-2 text-center"><Toggle checked={v.isActive} onChange={() => toggleActive(v)} size="sm" /></td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => openEdit(v)} className="rounded p-1 text-text-muted hover:text-primary"><span className="material-symbols-outlined text-base">edit</span></button>
                      <button onClick={() => askDelete(v)} className="rounded p-1 text-text-muted hover:text-red-500"><span className="material-symbols-outlined text-base">delete</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal isOpen={!!editing} onClose={close} title={editing?._new ? "Tạo voucher" : `Sửa ${editing?.code}`}>
        {editing && (
          <div className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Code" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="SALE10" />
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Loại</span>
                <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2">
                  <option value="percent">Phần trăm (%)</option>
                  <option value="fixed">Số tiền cố định (VND)</option>
                </select>
              </label>
            </div>
            <Input
              label={editing.kind === "percent" ? "Giá trị (%)" : "Giá trị (VND)"}
              type="number"
              min={0}
              max={editing.kind === "percent" ? 100 : undefined}
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: Number(e.target.value) })}
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">Mô tả (nội bộ)</span>
              <textarea value={editing.description} rows={2} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
            </label>

            <PlanScopePicker
              plans={plans}
              selected={editing.scopePlanIds || []}
              search={planSearch}
              onSearch={setPlanSearch}
              onToggle={togglePlanInScope}
              onBulkSelect={selectAllVisiblePlans}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input label="Tổng lượt dùng" type="number" min={0} value={editing.maxUses} onChange={(e) => setEditing({ ...editing, maxUses: Number(e.target.value) })} hint="0 = không giới hạn" />
              <Input label="Mỗi user dùng tối đa" type="number" min={0} value={editing.maxPerCustomer} onChange={(e) => setEditing({ ...editing, maxPerCustomer: Number(e.target.value) })} hint="0 = không giới hạn" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Hiệu lực từ</span>
                <input type="datetime-local" value={editing.validFrom || ""} onChange={(e) => setEditing({ ...editing, validFrom: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Hiệu lực đến</span>
                <input type="datetime-local" value={editing.validTo || ""} onChange={(e) => setEditing({ ...editing, validTo: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
              </label>
            </div>

            <Input
              label="Đơn tối thiểu (VND)"
              type="number"
              min={0}
              value={editing.minOrderVnd}
              onChange={(e) => setEditing({ ...editing, minOrderVnd: Number(e.target.value) })}
              hint="0 = không yêu cầu"
            />

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Toggle checked={!!editing.firstOrderOnly} onChange={(v) => setEditing({ ...editing, firstOrderOnly: v ? 1 : 0 })} />
                <span>Chỉ đơn đầu tiên</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Toggle checked={editing.isActive !== false} onChange={(v) => setEditing({ ...editing, isActive: v })} />
                <span>Active</span>
              </label>
            </div>

            {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

            <div className="mt-2 flex gap-2">
              <Button onClick={save} fullWidth disabled={!editing.code || (editing.scopePlanIds || []).length === 0}>Lưu</Button>
              <Button onClick={close} variant="ghost" fullWidth>Hủy</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal isOpen={!!confirm} onClose={() => setConfirm(null)} onConfirm={confirm?.onConfirm} title={confirm?.title} message={confirm?.message} variant="danger" />
    </div>
  );
}

function PlanScopePicker({ plans, selected, search, onSearch, onToggle, onBulkSelect }) {
  const selectedSet = useMemo(() => new Set(selected || []), [selected]);

  const filtered = useMemo(() => {
    if (!plans) return null;
    const q = (search || "").trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q) ||
      String(p.priceVnd).includes(q)
    );
  }, [plans, search]);

  // Split active vs inactive — admin should see inactive plans (cho lịch sử
  // hoặc voucher chuẩn bị trước khi enable lại) nhưng phân biệt rõ.
  const { activePlans, inactivePlans } = useMemo(() => {
    if (!filtered) return { activePlans: [], inactivePlans: [] };
    const a = [], i = [];
    for (const p of filtered) (p.isActive ? a : i).push(p);
    return { activePlans: a, inactivePlans: i };
  }, [filtered]);

  const visibleIds = useMemo(
    () => (filtered || []).map((p) => p.id),
    [filtered]
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  const totalSelected = (selected || []).length;
  const totalPlans = plans?.length ?? 0;

  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium">Áp dụng cho gói</p>
          <p className="text-[11px] text-text-muted">
            {totalSelected > 0
              ? `Đã chọn ${totalSelected}/${totalPlans} gói`
              : "Bắt buộc chọn ít nhất 1 gói"}
          </p>
        </div>
        {plans && plans.length > 0 && (
          <button
            type="button"
            onClick={() => onBulkSelect(visibleIds, !allVisibleSelected)}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:border-primary/40 hover:text-primary"
          >
            {allVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </button>
        )}
      </div>

      {plans === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-surface-2" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface-2/30 p-4 text-center">
          <p className="text-xs text-text-muted">Chưa có gói nào được tạo.</p>
          <Link
            href="/dashboard/pricing"
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Tạo gói rồi quay lại
          </Link>
        </div>
      ) : (
        <>
          {plans.length > 4 && (
            <div className="relative mb-2">
              <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-[14px]">
                search
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Tìm gói..."
                className="w-full rounded-md border border-border bg-bg pl-7 pr-2 py-1 text-xs focus:outline-none focus:border-primary"
              />
            </div>
          )}

          <div className="max-h-56 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-3">Không khớp gói nào.</p>
            ) : (
              <>
                {activePlans.length > 0 && (
                  <PlanGroup
                    label={`Đang bán (${activePlans.length})`}
                    plans={activePlans}
                    selectedSet={selectedSet}
                    onToggle={onToggle}
                  />
                )}
                {inactivePlans.length > 0 && (
                  <PlanGroup
                    label={`Tạm ẩn (${inactivePlans.length})`}
                    plans={inactivePlans}
                    selectedSet={selectedSet}
                    onToggle={onToggle}
                    muted
                  />
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PlanGroup({ label, plans, selectedSet, onToggle, muted }) {
  return (
    <div className="mb-2">
      <p className={`mb-1 text-[10px] uppercase tracking-wide ${muted ? "text-text-muted/70" : "text-text-muted"}`}>
        {label}
      </p>
      <div className="flex flex-col gap-1">
        {plans.map((p) => (
          <PlanRow
            key={p.id}
            plan={p}
            checked={selectedSet.has(p.id)}
            onToggle={() => onToggle(p.id)}
            muted={muted}
          />
        ))}
      </div>
    </div>
  );
}

function PlanRow({ plan, checked, onToggle, muted }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
        checked
          ? "border-primary bg-primary/10"
          : "border-border bg-surface hover:border-primary/40 hover:bg-surface-2"
      } ${muted ? "opacity-70" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            checked ? "border-primary bg-primary text-white" : "border-border bg-bg"
          }`}
        >
          {checked && (
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "12px" }}>
              check
            </span>
          )}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`truncate font-medium ${muted ? "text-text-muted" : "text-text-main"}`}>
              {plan.name}
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                plan.kind === "monthly"
                  ? "bg-blue-500/10 text-blue-500"
                  : "bg-emerald-500/10 text-emerald-600"
              }`}
            >
              {plan.kind === "monthly" ? "Tháng" : "Top-up"}
            </span>
            {!plan.isActive && (
              <span className="shrink-0 rounded-full bg-text-muted/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted">
                Ẩn
              </span>
            )}
          </div>
          {plan.description && (
            <div className="truncate text-[10px] text-text-muted" title={plan.description}>
              {plan.description}
            </div>
          )}
        </div>
      </div>
      <span className={`shrink-0 font-mono ${checked ? "text-primary" : "text-text-muted"}`}>
        {fmtVnd(plan.priceVnd)}
      </span>
    </button>
  );
}
