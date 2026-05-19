"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Input, Button, Toggle, Modal, ConfirmModal } from "@/shared/components";

const STATUS_OPTIONS = [
  { id: "all", label: "Tất cả" },
  { id: "active", label: "Đang dùng" },
  { id: "inactive", label: "Đã tắt" },
  { id: "expired", label: "Hết hạn" },
  { id: "expiringSoon", label: "Sắp hết hạn (7d)" },
];

const RTK_MODES = [
  { id: "inherit", label: "Inherit" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
];

const CAVEMAN_MODES = [
  { id: "inherit", label: "Inherit" },
  { id: "off", label: "Off" },
  { id: "lite", label: "Lite" },
  { id: "full", label: "Full" },
  { id: "ultra", label: "Ultra" },
];

function fmtNum(v) { return Number(v || 0).toLocaleString("vi-VN"); }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

function toQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default function AdminApiKeysPage() {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState("desc");

  const [selected, setSelected] = useState(() => new Set());
  const [toast, setToast] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [bulkModal, setBulkModal] = useState(null); // { kind: 'compress'|'quota'|'expiry'|'rateLimit'|'models' }
  const [singleModal, setSingleModal] = useState(null); // { kind, key }

  function notify(msg) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  async function load() {
    setItems(null);
    const url = `/api/admin/api-keys${toQuery({ q, status, sort, order, page, pageSize })}`;
    const res = await fetch(url, { cache: "no-store" });
    const d = await res.json();
    setItems(d.items || []);
    setTotal(d.total || 0);
    // Drop selections that no longer match the current page
    const visible = new Set((d.items || []).map((k) => k.id));
    setSelected((prev) => new Set([...prev].filter((id) => visible.has(id))));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [q, status, sort, order, page, pageSize]);

  const allOnPageSelected = useMemo(() => {
    if (!items || items.length === 0) return false;
    return items.every((k) => selected.has(k.id));
  }, [items, selected]);

  function toggleAllOnPage() {
    if (!items) return;
    if (allOnPageSelected) {
      const next = new Set(selected);
      for (const k of items) next.delete(k.id);
      setSelected(next);
    } else {
      const next = new Set(selected);
      for (const k of items) next.add(k.id);
      setSelected(next);
    }
  }

  function toggleOne(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function changeSort(col) {
    if (sort === col) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(col);
      setOrder("desc");
    }
  }

  async function patchKey(id, patch) {
    const res = await fetch(`/api/admin/api-keys/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { notify(d?.error || "Lỗi cập nhật"); return false; }
    return true;
  }

  async function toggleActive(key) {
    const ok = await patchKey(key.id, { isActive: !key.isActive });
    if (ok) { notify(`Đã ${!key.isActive ? "bật" : "tắt"} key ${key.keyDisplay}`); load(); }
  }

  async function deleteOne(key) {
    setConfirm(null);
    const res = await fetch(`/api/admin/api-keys/${key.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { notify(d?.error || "Xoá thất bại"); return; }
    notify("Đã xoá key.");
    load();
  }

  async function runBulk(action, payload) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const res = await fetch("/api/admin/api-keys/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action, payload }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { notify(d?.error || "Bulk thất bại"); return; }
    if (action === "delete") {
      notify(`Đã xoá ${d.deleted || 0} key.`);
      setSelected(new Set());
    } else {
      notify(`Đã cập nhật ${d.updated || 0} key.`);
    }
    setBulkModal(null);
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <p className="text-sm text-text-muted">Quản lý toàn bộ API key. Tổng {total.toLocaleString("vi-VN")} key.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Input
              label="Tìm kiếm"
              value={q}
              onChange={(e) => { setPage(1); setQ(e.target.value); }}
              placeholder="Tên key, prefix/last4, email khách..."
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Trạng thái</span>
            <select
              value={status}
              onChange={(e) => { setPage(1); setStatus(e.target.value); }}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 shadow-sm">
          <span className="text-sm font-medium">{selected.size} key được chọn</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => runBulk("toggleActive", { isActive: true })}>Bật</Button>
            <Button size="sm" variant="ghost" onClick={() => runBulk("toggleActive", { isActive: false })}>Tắt</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulkModal({ kind: "compress" })}>Compress</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulkModal({ kind: "quota" })}>Quota</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulkModal({ kind: "expiry" })}>Hạn dùng</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulkModal({ kind: "rateLimit" })}>Rate limit</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulkModal({ kind: "models" })}>Models</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirm({
                title: `Xoá ${selected.size} key?`,
                message: "Việc xoá là vĩnh viễn. Khách sẽ không dùng lại được các key này.",
                onConfirm: () => { setConfirm(null); runBulk("delete"); },
              })}
              className="text-red-500"
            >
              Xoá
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Bỏ chọn</Button>
          </div>
        </div>
      )}

      <Card>
        {!items ? (
          <div className="h-32 animate-pulse" />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-text-muted">Không có key phù hợp.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                  </th>
                  <th className="px-3 py-2 text-left">Key</th>
                  <SortHeader label="Tên" col="name" sort={sort} order={order} onClick={changeSort} />
                  <th className="px-3 py-2 text-left">Khách</th>
                  <SortHeader label="Daily" col="dailyTokenLimit" sort={sort} order={order} onClick={changeSort} align="right" />
                  <SortHeader label="Monthly" col="monthlyTokenLimit" sort={sort} order={order} onClick={changeSort} align="right" />
                  <SortHeader label="Lifetime" col="lifetimeTokenLimit" sort={sort} order={order} onClick={changeSort} align="right" />
                  <th className="px-3 py-2 text-right">RPM</th>
                  <SortHeader label="Hết hạn" col="expiresAt" sort={sort} order={order} onClick={changeSort} />
                  <th className="px-3 py-2 text-center">RTK</th>
                  <th className="px-3 py-2 text-center">Caveman</th>
                  <th className="px-3 py-2 text-center">Active</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((k) => (
                  <tr key={k.id} className="border-t border-border-subtle align-middle">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(k.id)} onChange={() => toggleOne(k.id)} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{k.keyDisplay}</td>
                    <td className="px-3 py-2">{k.name || "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {k.customerId ? (
                        <Link href={`/dashboard/customers/${k.customerId}`} className="hover:text-primary">
                          {k.customerEmail || k.customerName || k.customerId}
                        </Link>
                      ) : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">{k.dailyTokenLimit ? fmtNum(k.dailyTokenLimit) : "∞"}</td>
                    <td className="px-3 py-2 text-right text-xs">{k.monthlyTokenLimit ? fmtNum(k.monthlyTokenLimit) : "∞"}</td>
                    <td className="px-3 py-2 text-right text-xs">{k.lifetimeTokenLimit ? fmtNum(k.lifetimeTokenLimit) : "∞"}</td>
                    <td className="px-3 py-2 text-right text-xs">{k.requestsPerMinute || "∞"}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(k.expiresAt)}</td>
                    <td className="px-3 py-2 text-center">
                      <ModeBadge value={k.rtkMode} kind="rtk" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ModeBadge value={k.cavemanMode} kind="caveman" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Toggle checked={k.isActive} onChange={() => toggleActive(k)} size="sm" />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setSingleModal({ kind: "compress", key: k })}>
                        Compress
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSingleModal({ kind: "quota", key: k })}>
                        Quota
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500"
                        onClick={() => setConfirm({
                          title: `Xoá key ${k.keyDisplay}?`,
                          message: "Khách sẽ không dùng được key này nữa.",
                          onConfirm: () => deleteOne(k),
                        })}
                      >
                        Xoá
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted">
            Trang {page}/{totalPages}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>Trước</Button>
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>Sau</Button>
          </div>
        </div>
      </Card>

      <CompressModal
        modal={singleModal?.kind === "compress" ? singleModal : null}
        onClose={() => setSingleModal(null)}
        onSave={async (patch) => {
          const ok = await patchKey(singleModal.key.id, patch);
          if (ok) { notify("Đã cập nhật compress."); setSingleModal(null); load(); }
        }}
      />
      <CompressModal
        modal={bulkModal?.kind === "compress" ? { bulkCount: selected.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setCompress", payload)}
      />

      <QuotaModal
        modal={singleModal?.kind === "quota" ? { key: singleModal.key } : null}
        onClose={() => setSingleModal(null)}
        onSave={async (payload) => {
          const k = singleModal.key;
          const patch = {};
          const num = (v) => Number(v) > 0 ? Number(v) : null;
          for (const f of ["dailyTokenLimit", "monthlyTokenLimit", "lifetimeTokenLimit"]) {
            const n = num(payload[f]);
            if (n != null) patch[f] = payload.mode === "set" ? n : (Number(k[f]) || 0) + n;
          }
          if (Number(payload.extendDays) > 0) {
            const days = Math.floor(Number(payload.extendDays));
            const base = k.expiresAt ? new Date(k.expiresAt) : new Date();
            patch.expiresAt = new Date(base.getTime() + days * 86400000).toISOString();
          }
          if (Object.keys(patch).length === 0) { notify("Chưa nhập thay đổi nào."); return; }
          const ok = await patchKey(k.id, patch);
          if (ok) { notify("Đã cập nhật quota."); setSingleModal(null); load(); }
        }}
      />
      <QuotaModal
        modal={bulkModal?.kind === "quota" ? { bulkCount: selected.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => {
          const out = { mode: payload.mode };
          for (const f of ["dailyTokenLimit", "monthlyTokenLimit", "lifetimeTokenLimit"]) {
            if (Number(payload[f]) > 0) out[f] = Number(payload[f]);
          }
          if (Object.keys(out).length <= 1) { notify("Chưa nhập field quota."); return; }
          runBulk("setQuota", out);
        }}
      />

      <ExpiryModal
        modal={bulkModal?.kind === "expiry" ? { bulkCount: selected.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setExpiry", payload)}
      />

      <RateLimitModal
        modal={bulkModal?.kind === "rateLimit" ? { bulkCount: selected.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setRateLimit", payload)}
      />

      <ModelsModal
        modal={bulkModal?.kind === "models" ? { bulkCount: selected.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setAllowedModels", payload)}
      />

      <ConfirmModal isOpen={!!confirm} onClose={() => setConfirm(null)} onConfirm={confirm?.onConfirm} title={confirm?.title} message={confirm?.message} variant="danger" />

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-lg border border-border bg-surface px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function SortHeader({ label, col, sort, order, onClick, align = "left" }) {
  const active = sort === col;
  return (
    <th className={`px-3 py-2 text-${align}`}>
      <button onClick={() => onClick(col)} className={`uppercase text-xs ${active ? "text-primary" : "text-text-muted hover:text-text-main"}`}>
        {label}
        {active ? (order === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function ModeBadge({ value, kind }) {
  const v = value || "inherit";
  const palette =
    v === "inherit" ? "bg-text-muted/15 text-text-muted"
      : v === "off" ? "bg-text-muted/15 text-text-muted"
      : v === "on" ? "bg-emerald-500/15 text-emerald-500"
      : kind === "caveman" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-primary/15 text-primary";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase ${palette}`}>{v}</span>;
}

function CompressModal({ modal, onClose, onSave }) {
  const [rtkMode, setRtkMode] = useState("inherit");
  const [cavemanMode, setCavemanMode] = useState("inherit");

  useEffect(() => {
    if (!modal) return;
    if (modal.key) {
      setRtkMode(modal.key.rtkMode || "inherit");
      setCavemanMode(modal.key.cavemanMode || "inherit");
    } else {
      setRtkMode("inherit");
      setCavemanMode("inherit");
    }
  }, [modal]);

  if (!modal) return null;
  const title = modal.key
    ? `Compress: ${modal.key.name || modal.key.keyDisplay}`
    : `Compress (${modal.bulkCount || 0} key)`;

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          <strong>Inherit</strong>: dùng setting global.
          <strong className="ml-2">RTK</strong>: nén tool_result. <strong>Caveman</strong>: chèn system prompt nén output theo level.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">RTK mode</span>
          <select value={rtkMode} onChange={(e) => setRtkMode(e.target.value)} className="rounded-lg border border-border bg-bg px-3 py-2">
            {RTK_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Caveman mode</span>
          <select value={cavemanMode} onChange={(e) => setCavemanMode(e.target.value)} className="rounded-lg border border-border bg-bg px-3 py-2">
            {CAVEMAN_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>

        <div className="flex gap-2">
          <Button onClick={() => onSave({ rtkMode, cavemanMode })} fullWidth>Áp dụng</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Hủy</Button>
        </div>
      </div>
    </Modal>
  );
}

function QuotaModal({ modal, onClose, onSave }) {
  const [form, setForm] = useState({ mode: "add", dailyTokenLimit: 0, monthlyTokenLimit: 0, lifetimeTokenLimit: 0, extendDays: 0 });

  useEffect(() => {
    if (modal) {
      setForm({ mode: "add", dailyTokenLimit: 0, monthlyTokenLimit: 0, lifetimeTokenLimit: 0, extendDays: 0 });
    }
  }, [modal]);

  if (!modal) return null;
  const isBulk = !modal.key;
  const title = isBulk ? `Quota (${modal.bulkCount || 0} key)` : `Quota: ${modal.key.name || modal.key.keyDisplay}`;
  const k = modal.key;

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        {!isBulk && (
          <div className="rounded-md bg-surface-2 p-3 text-xs text-text-muted">
            <div>Hiện tại: daily {fmtNum(k.dailyTokenLimit) || "∞"} · monthly {fmtNum(k.monthlyTokenLimit) || "∞"} · lifetime {fmtNum(k.lifetimeTokenLimit) || "∞"}</div>
            <div>Hết hạn: {fmtTime(k.expiresAt)}</div>
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Chế độ</span>
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2">
            <option value="add">Cộng thêm vào limit hiện tại</option>
            <option value="set">Ghi đè limit hiện tại</option>
          </select>
        </label>

        <div className="grid grid-cols-3 gap-3">
          <Input label="Daily" type="number" min={0} value={form.dailyTokenLimit} onChange={(e) => setForm({ ...form, dailyTokenLimit: e.target.value })} />
          <Input label="Monthly" type="number" min={0} value={form.monthlyTokenLimit} onChange={(e) => setForm({ ...form, monthlyTokenLimit: e.target.value })} />
          <Input label="Lifetime" type="number" min={0} value={form.lifetimeTokenLimit} onChange={(e) => setForm({ ...form, lifetimeTokenLimit: e.target.value })} />
        </div>

        {!isBulk && (
          <Input label="Gia hạn thêm (ngày)" type="number" min={0} value={form.extendDays} onChange={(e) => setForm({ ...form, extendDays: e.target.value })} hint="Cộng thêm N ngày vào hạn dùng. Để 0 nếu không gia hạn." />
        )}

        <div className="flex gap-2">
          <Button onClick={() => onSave(form)} fullWidth>Áp dụng</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Hủy</Button>
        </div>
      </div>
    </Modal>
  );
}

function ExpiryModal({ modal, onClose, onSave }) {
  const [mode, setMode] = useState("extend");
  const [extendDays, setExtendDays] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    if (modal) {
      setMode("extend");
      setExtendDays(0);
      setExpiresAt("");
    }
  }, [modal]);

  if (!modal) return null;

  function submit() {
    if (mode === "extend") {
      const n = Number(extendDays);
      if (!n || n <= 0) return;
      onSave({ extendDays: n });
    } else if (mode === "set") {
      onSave({ expiresAt: expiresAt || null });
    } else {
      onSave({ expiresAt: null });
    }
  }

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={`Hạn dùng (${modal.bulkCount || 0} key)`}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Chế độ</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-border bg-bg px-3 py-2">
            <option value="extend">Gia hạn thêm N ngày</option>
            <option value="set">Set hạn dùng tường minh</option>
            <option value="clear">Bỏ hạn (không bao giờ hết)</option>
          </select>
        </label>

        {mode === "extend" && (
          <Input label="Số ngày" type="number" min={1} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} hint="Cộng vào hạn hiện tại của mỗi key (hoặc tính từ hôm nay nếu key chưa có hạn)." />
        )}
        {mode === "set" && (
          <Input label="ExpiresAt (ISO)" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        )}

        <div className="flex gap-2">
          <Button onClick={submit} fullWidth>Áp dụng</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Hủy</Button>
        </div>
      </div>
    </Modal>
  );
}

function RateLimitModal({ modal, onClose, onSave }) {
  const [requestsPerMinute, setRpm] = useState(0);
  const [maxTokensPerRequest, setMaxTok] = useState(0);

  useEffect(() => {
    if (modal) {
      setRpm(0);
      setMaxTok(0);
    }
  }, [modal]);

  if (!modal) return null;

  function submit() {
    const out = {};
    if (Number(requestsPerMinute) >= 0 && requestsPerMinute !== "") out.requestsPerMinute = Number(requestsPerMinute);
    if (Number(maxTokensPerRequest) >= 0 && maxTokensPerRequest !== "") out.maxTokensPerRequest = Number(maxTokensPerRequest);
    onSave(out);
  }

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={`Rate limit (${modal.bulkCount || 0} key)`}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">Đặt 0 để không giới hạn.</p>
        <Input label="Requests / phút" type="number" min={0} value={requestsPerMinute} onChange={(e) => setRpm(e.target.value)} />
        <Input label="Max tokens / request" type="number" min={0} value={maxTokensPerRequest} onChange={(e) => setMaxTok(e.target.value)} />
        <div className="flex gap-2">
          <Button onClick={submit} fullWidth>Áp dụng</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Hủy</Button>
        </div>
      </div>
    </Modal>
  );
}

function ModelsModal({ modal, onClose, onSave }) {
  const [text, setText] = useState("");
  const [merge, setMerge] = useState(false);

  useEffect(() => {
    if (modal) {
      setText("");
      setMerge(false);
    }
  }, [modal]);

  if (!modal) return null;

  function submit() {
    const list = text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({ allowedModels: list, merge });
  }

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={`Allowed models (${modal.bulkCount || 0} key)`}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          Mỗi model trên một dòng (hoặc cách nhau bằng dấu phẩy). Để trống danh sách + bỏ chọn merge để cho phép tất cả.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Models</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm font-mono"
            placeholder="claude-sonnet-4&#10;gpt-4o&#10;cursor/cursor-small"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
          <span>Merge với danh sách hiện tại (thay vì ghi đè)</span>
        </label>
        <div className="flex gap-2">
          <Button onClick={submit} fullWidth>Áp dụng</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Hủy</Button>
        </div>
      </div>
    </Modal>
  );
}
