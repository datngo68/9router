"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Card, Input, Button, Toggle, Modal, ConfirmModal } from "@/shared/components";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtUsd(v) { return `$${Number(v || 0).toFixed(3)}`; }
function fmtNum(v) { return Number(v || 0).toLocaleString("vi-VN"); }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

const TABS = [
  { id: "overview", label: "Tổng quan" },
  { id: "orders", label: "Đơn hàng" },
  { id: "usage", label: "Usage" },
  { id: "wallet", label: "Ví" },
  { id: "voucher", label: "Voucher" },
  { id: "keys", label: "API keys" },
  { id: "actions", label: "Hành động" },
];

export default function AdminCustomerDetailPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "overview");
  const [notes, setNotes] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [editingKey, setEditingKey] = useState(null); // { key, tab }
  const [bulkModal, setBulkModal] = useState(null); // { kind: 'compress'|'quota'|'expiry'|'rateLimit'|'models'|'providerAccess' }
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [toast, setToast] = useState("");

  async function load() {
    const r = await fetch(`/api/admin/customers/${id}`, { cache: "no-store" });
    const d = await r.json();
    setData(d);
    setNotes(d.customer?.notes || "");
    // drop selections that no longer match keys belonging to this customer
    const visible = new Set((d.keys || []).map((k) => k.id));
    setSelectedKeys((prev) => new Set([...prev].filter((kid) => visible.has(kid))));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  function notify(msg) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  async function saveNotes() {
    const res = await fetch(`/api/admin/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) { setSavedMsg("Đã lưu"); setTimeout(() => setSavedMsg(""), 2000); }
  }

  async function toggleKey(keyId) {
    await fetch(`/api/admin/customers/${id}/api-keys/${keyId}/toggle`, { method: "POST" });
    load();
  }

  async function runBulk(action, payload) {
    const ids = Array.from(selectedKeys);
    if (ids.length === 0) return;
    const res = await fetch("/api/admin/api-keys/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action, payload }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { notify(d?.error || "Bulk thất bại"); return; }
    notify(`Đã cập nhật ${d.updated || 0} key.`);
    setBulkModal(null);
    load();
  }

  async function resetPassword() {
    setConfirm(null);
    const res = await fetch(`/api/admin/customers/${id}/reset-password`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d?.ok) notify("Đã gửi email đặt lại mật khẩu.");
    else notify(d?.error || "Không gửi được email.");
  }

  if (!data) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;
  if (data.error) return <Card><p className="text-red-500">{data.error}</p></Card>;

  const { customer, orders, keys, summary, usageDaily, usageByModel, usageByProvider, keyLimitsUsage, nearLimitKeys, voucherRedemptions, referral } = data;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/customers" className="text-sm text-text-muted hover:text-primary">← Tất cả khách</Link>
        <h1 className="mt-2 text-2xl font-semibold">{customer.displayName || customer.email}</h1>
        <p className="text-sm text-text-muted">
          {customer.email}
          {customer.phone && ` · ${customer.phone}`}
          {customer.telegramChatId && ` · TG ${customer.telegramChatId}`}
          {` · Tạo ${fmtTime(customer.createdAt)}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border-subtle">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >{t.label}</button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          summary={summary}
          customer={customer}
          keys={keys}
          referral={referral}
          notes={notes}
          setNotes={setNotes}
          saveNotes={saveNotes}
          savedMsg={savedMsg}
        />
      )}
      {tab === "orders" && <OrdersTab orders={orders} />}
      {tab === "usage" && <UsageTab usageDaily={usageDaily} usageByModel={usageByModel} usageByProvider={usageByProvider} keyLimitsUsage={keyLimitsUsage} nearLimitKeys={nearLimitKeys} />}
      {tab === "voucher" && <VoucherTab redemptions={voucherRedemptions} />}
      {tab === "wallet" && <WalletTab customerId={id} notify={notify} />}
      {tab === "keys" && (
        <KeysTab
          keys={keys}
          keyLimitsUsage={keyLimitsUsage}
          selected={selectedKeys}
          onToggleSelect={(keyId) => {
            setSelectedKeys((prev) => {
              const next = new Set(prev);
              if (next.has(keyId)) next.delete(keyId); else next.add(keyId);
              return next;
            });
          }}
          onToggleSelectAll={(visibleKeys) => {
            if (!visibleKeys || visibleKeys.length === 0) return;
            const all = visibleKeys.every((k) => selectedKeys.has(k.id));
            setSelectedKeys(() => {
              const next = new Set(selectedKeys);
              if (all) visibleKeys.forEach((k) => next.delete(k.id));
              else visibleKeys.forEach((k) => next.add(k.id));
              return next;
            });
          }}
          onClearSelection={() => setSelectedKeys(new Set())}
          onBulk={(kind) => setBulkModal({ kind })}
          onBulkToggleActive={(isActive) => runBulk("toggleActive", { isActive })}
          onToggle={toggleKey}
          onEdit={(k, initialTab) => setEditingKey({ key: k, tab: initialTab || "limits" })}
        />
      )}
      {tab === "actions" && (
        <ActionsTab
          onResetPassword={() => setConfirm({
            title: "Gửi email đặt lại mật khẩu",
            message: `Gửi link reset password tới ${customer.email}? Link sẽ hết hạn sau 1 giờ.`,
            onConfirm: resetPassword,
          })}
        />
      )}

      <EditKeyModal
        modal={editingKey}
        customerId={id}
        onClose={() => setEditingKey(null)}
        onSaved={(msg) => {
          notify(msg || "Đã cập nhật.");
          setEditingKey(null);
          load();
        }}
        onError={(msg) => notify(msg)}
      />

      {/* Bulk modals: trigger by selecting rows + bulk toolbar */}
      <CompressModal
        modal={bulkModal?.kind === "compress" ? { bulkCount: selectedKeys.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setCompress", payload)}
      />
      <BulkQuotaModal
        modal={bulkModal?.kind === "quota" ? { bulkCount: selectedKeys.size } : null}
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
        modal={bulkModal?.kind === "expiry" ? { bulkCount: selectedKeys.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setExpiry", payload)}
      />
      <RateLimitModal
        modal={bulkModal?.kind === "rateLimit" ? { bulkCount: selectedKeys.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setRateLimit", payload)}
      />
      <ModelsModal
        modal={bulkModal?.kind === "models" ? { bulkCount: selectedKeys.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setAllowedModels", payload)}
      />
      <ProviderAccessModal
        modal={bulkModal?.kind === "providerAccess" ? { bulkCount: selectedKeys.size } : null}
        onClose={() => setBulkModal(null)}
        onSave={(payload) => runBulk("setProviderAccess", payload)}
      />

      <ConfirmModal isOpen={!!confirm} onClose={() => setConfirm(null)} onConfirm={confirm?.onConfirm} title={confirm?.title} message={confirm?.message} />

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-lg border border-border bg-surface px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ summary, customer, keys, referral, notes, setNotes, saveNotes, savedMsg }) {
  const activeKeys = keys.filter((k) => k.isActive).length;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="LTV (đơn delivered)" value={fmtVnd(summary.totalSpentVnd)} />
        <StatCard label="Đơn" value={`${summary.deliveredCount}/${summary.ordersCount}`} hint="delivered/total" />
        <StatCard label="Key đang dùng" value={`${activeKeys}/${keys.length}`} />
        <StatCard label="Hoạt động cuối" value={summary.lastActiveAt ? fmtTime(summary.lastActiveAt) : "—"} small />
      </div>

      <Card>
        <h2 className="font-semibold mb-2">Ghi chú nội bộ</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
          placeholder="Khách doanh nghiệp, ưu tiên kích hoạt nhanh..."
        />
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={saveNotes} size="sm">Lưu ghi chú</Button>
          {savedMsg && <span className="text-sm text-text-muted">{savedMsg}</span>}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold mb-2">Thông tin tài khoản</h2>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-text-muted">Auth provider</dt><dd>{customer.authProvider || "password"}</dd>
          <dt className="text-text-muted">Email verified</dt><dd>{customer.emailVerified ? "Đã xác minh" : "Chưa"}</dd>
          <dt className="text-text-muted">2FA TOTP</dt><dd>{customer.totpEnabled ? "Đang bật" : "Tắt"}</dd>
          <dt className="text-text-muted">Đơn đầu</dt><dd>{fmtTime(summary.firstOrderAt)}</dd>
          <dt className="text-text-muted">Đơn cuối</dt><dd>{fmtTime(summary.lastOrderAt)}</dd>
        </dl>
      </Card>

      {referral && (
        <Card>
          <h2 className="font-semibold mb-2">Giới thiệu</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-text-muted">Mã giới thiệu</dt>
            <dd><code className="rounded bg-surface-2 px-2 py-0.5 font-mono">{referral.referralCode || "—"}</code></dd>
            <dt className="text-text-muted">Được giới thiệu bởi</dt>
            <dd>
              {referral.referrer ? (
                <Link href={`/dashboard/customers/${referral.referrer.id}`} className="text-primary hover:underline">
                  {referral.referrer.email}
                </Link>
              ) : referral.referredBy ? (
                <span className="font-mono text-xs">{referral.referredBy} (không tìm thấy)</span>
              ) : "—"}
            </dd>
            <dt className="text-text-muted">Số người đã giới thiệu</dt>
            <dd>{fmtNum(referral.referredCount)}</dd>
            <dt className="text-text-muted">Đơn đầu đã thưởng</dt>
            <dd>{fmtNum(referral.grantsAsReferrer)}</dd>
            <dt className="text-text-muted">Token đã thưởng (nhận)</dt>
            <dd>{fmtNum(referral.tokensEarnedAsReferrer)}</dd>
          </dl>
        </Card>
      )}
    </div>
  );
}

function OrdersTab({ orders }) {
  return (
    <Card>
      <h2 className="font-semibold mb-3">Đơn ({orders.length})</h2>
      {orders.length === 0 ? <p className="text-sm text-text-muted">Khách chưa có đơn nào.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Mã</th>
                <th className="px-3 py-2 text-right">Tiền</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Tạo lúc</th>
                <th className="px-3 py-2 text-left">Delivered</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2 font-mono text-xs">{o.id}</td>
                  <td className="px-3 py-2 text-right">{fmtVnd(o.priceVnd)}</td>
                  <td className="px-3 py-2 text-xs">{o.status}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(o.createdAt)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(o.deliveredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function StatCard({ label, value, hint, small }) {
  return (
    <Card>
      <p className="text-xs uppercase text-text-muted">{label}</p>
      <p className={`mt-1 font-semibold ${small ? "text-sm" : "text-2xl"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </Card>
  );
}

function UsageTab({ usageDaily, usageByModel, usageByProvider, keyLimitsUsage, nearLimitKeys }) {
  const max = Math.max(0, ...(usageDaily || []).map((d) => d.costUsd));
  return (
    <div className="flex flex-col gap-6">
      {nearLimitKeys && nearLimitKeys.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-1">Cảnh báo quota</h3>
          <div className="flex flex-col gap-1">
            {nearLimitKeys.map((k) => (
              <div key={k.keyId} className="flex items-center gap-2 text-xs">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase ${k.level === "critical" ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}>
                  {k.level === "critical" ? "Critical" : "Warn"}
                </span>
                <span className="font-medium">{k.name}</span>
                <span className="text-text-muted">({k.keyDisplay}) — {k.maxPct}% quota</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {usageByProvider && usageByProvider.length > 0 && (
        <Card>
          <h2 className="font-semibold mb-3">Cost theo provider (30d)</h2>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-text-muted">
              <tr>
                <th className="pb-2 text-left font-normal">Provider</th>
                <th className="pb-2 text-right font-normal">Cost</th>
                <th className="pb-2 text-right font-normal">Tokens</th>
                <th className="pb-2 text-right font-normal">Req</th>
                <th className="pb-2 text-right font-normal">Share</th>
              </tr>
            </thead>
            <tbody>
              {usageByProvider.map((p) => (
                <tr key={p.provider} className="border-t border-border-subtle">
                  <td className="py-2 font-mono text-xs">{p.provider}</td>
                  <td className="py-2 text-right">{fmtUsd(p.costUsd)}</td>
                  <td className="py-2 text-right text-xs text-text-muted">{fmtNum(p.totalTokens)}</td>
                  <td className="py-2 text-right text-xs text-text-muted">{fmtNum(p.requests)}</td>
                  <td className="py-2 text-right text-xs text-text-muted">{p.sharePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <h2 className="font-semibold mb-3">Cost upstream theo ngày (30d)</h2>
        {max === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">Chưa có usage trong 30 ngày qua.</p>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={usageDaily} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d) => d.slice(5)}
                  tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
                  stroke="var(--color-border)"
                  minTickGap={16}
                />
                <YAxis
                  tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                  tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
                  stroke="var(--color-border)"
                  width={60}
                />
                <Tooltip
                  contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(d) => `Ngày ${d}`}
                  formatter={(value, _n, item) => [
                    fmtUsd(value),
                    `Cost (${item?.payload?.requests ?? 0} req · ${fmtNum(item?.payload?.totalTokens ?? 0)} tok)`,
                  ]}
                />
                <Line type="monotone" dataKey="costUsd" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Top model dùng nhiều (30d)</h2>
        {!usageByModel || usageByModel.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">Không có dữ liệu.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-text-muted">
              <tr>
                <th className="pb-2 text-left font-normal">Model</th>
                <th className="pb-2 text-right font-normal">Cost</th>
                <th className="pb-2 text-right font-normal">Tokens</th>
                <th className="pb-2 text-right font-normal">Req</th>
              </tr>
            </thead>
            <tbody>
              {usageByModel.map((m) => (
                <tr key={`${m.provider}/${m.model}`} className="border-t border-border-subtle">
                  <td className="py-2 font-mono text-xs">{m.provider}/{m.model}</td>
                  <td className="py-2 text-right">{fmtUsd(m.costUsd)}</td>
                  <td className="py-2 text-right text-xs text-text-muted">{fmtNum(m.totalTokens)}</td>
                  <td className="py-2 text-right text-xs text-text-muted">{fmtNum(m.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Key limits utilization</h2>
        {!keyLimitsUsage || keyLimitsUsage.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">Khách chưa có key.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {keyLimitsUsage.map((k) => (
              <div key={k.keyId} className="rounded-lg border border-border-subtle p-3">
                <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-medium">{k.name}</div>
                    <div className="font-mono text-xs text-text-muted">{k.keyDisplay}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${k.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-text-muted/15 text-text-muted"}`}>
                    {k.isActive ? "Active" : "Disabled"}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <UsageBar label="Daily" used={k.daily.used} limit={k.daily.limit} pct={k.daily.pct} />
                  <UsageBar label="Monthly" used={k.monthly.used} limit={k.monthly.limit} pct={k.monthly.pct} />
                  <UsageBar label="Lifetime" used={k.lifetime.used} limit={k.lifetime.limit} pct={k.lifetime.pct} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function UsageBar({ label, used, limit, pct }) {
  const showPct = pct !== null;
  const color = pct === null ? "bg-text-muted/30" : pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-primary";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-text-muted">{label}</span>
        <span className="font-mono">
          {fmtNum(used)} {limit > 0 ? `/ ${fmtNum(limit)}` : "/ ∞"}
          {showPct && <span className="ml-2 text-text-muted">({pct}%)</span>}
        </span>
      </div>
      <div className="h-1.5 w-full rounded bg-surface-2">
        <div className={`h-full rounded ${color}`} style={{ width: `${showPct ? pct : 0}%` }} />
      </div>
    </div>
  );
}

function WalletTab({ customerId, notify }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ deltaVnd: "", reason: "", type: "adjustment" });
  const [minLimitInput, setMinLimitInput] = useState("");

  async function load() {
    const r = await fetch(`/api/admin/customers/${customerId}/wallet`, { cache: "no-store" });
    const d = await r.json();
    setData(d);
    setMinLimitInput(String(d?.balance?.minLimitVnd || 0));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [customerId]);

  async function adjust() {
    if (!adjustForm.deltaVnd || !adjustForm.reason.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deltaVnd: Number(adjustForm.deltaVnd),
          reason: adjustForm.reason.trim(),
          type: adjustForm.type,
        }),
      });
      const d = await res.json();
      if (!res.ok) { notify(d?.error || "Điều chỉnh thất bại"); return; }
      notify("Đã ghi điều chỉnh ví.");
      setAdjustForm({ deltaVnd: "", reason: "", type: "adjustment" });
      await load();
    } finally { setBusy(false); }
  }

  async function saveMinLimit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/wallet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minLimitVnd: Number(minLimitInput) || 0 }),
      });
      const d = await res.json();
      if (!res.ok) { notify(d?.error || "Lưu thất bại"); return; }
      notify("Đã cập nhật mức tối thiểu.");
      await load();
    } finally { setBusy(false); }
  }

  if (!data) return <Card><p className="text-text-muted">Đang tải ví…</p></Card>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-text-muted">Số dư hiện tại</p>
            <p className="mt-1 text-2xl font-semibold">{fmtVnd(data.balance?.vnd || 0)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-text-muted">Hạn mức tối thiểu</p>
            <p className="mt-1 text-lg">{fmtVnd(data.balance?.minLimitVnd || 0)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-text-muted">Tổng giao dịch</p>
            <p className="mt-1 text-lg">{fmtNum(data.total)}</p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Điều chỉnh thủ công</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Input
            type="number"
            placeholder="Số tiền (VND, âm để trừ)"
            value={adjustForm.deltaVnd}
            onChange={(e) => setAdjustForm({ ...adjustForm, deltaVnd: e.target.value })}
          />
          <select
            value={adjustForm.type}
            onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value })}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm"
          >
            <option value="adjustment">Điều chỉnh</option>
            <option value="refund">Hoàn tiền</option>
          </select>
          <Input
            placeholder="Lý do (bắt buộc)"
            value={adjustForm.reason}
            onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
          />
          <Button onClick={adjust} disabled={busy || !adjustForm.deltaVnd || !adjustForm.reason.trim()}>
            Lưu
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Hạn mức overdraft</h2>
        <p className="text-xs text-text-muted mb-3">Số âm cho phép khách dùng quá số dư tới mức đó.</p>
        <div className="flex gap-2">
          <Input
            type="number"
            value={minLimitInput}
            onChange={(e) => setMinLimitInput(e.target.value)}
            placeholder="VND"
          />
          <Button onClick={saveMinLimit} disabled={busy}>Lưu</Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Lịch sử giao dịch ({fmtNum(data.total)})</h2>
        {data.items.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">Chưa có giao dịch.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-text-muted">
                <tr className="border-b border-border-subtle">
                  <th className="px-2 py-2 text-left">Thời gian</th>
                  <th className="px-2 py-2 text-left">Loại</th>
                  <th className="px-2 py-2 text-right">Delta</th>
                  <th className="px-2 py-2 text-right">Số dư sau</th>
                  <th className="px-2 py-2 text-left">Tham chiếu</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((tx) => (
                  <tr key={tx.id} className="border-b border-border-subtle/50">
                    <td className="px-2 py-2 text-text-muted">{fmtTime(tx.createdAt)}</td>
                    <td className="px-2 py-2">{tx.type}</td>
                    <td className={`px-2 py-2 text-right font-mono ${tx.delta > 0 ? "text-green-600" : "text-red-500"}`}>
                      {tx.delta > 0 ? "+" : ""}{fmtVnd(tx.deltaVnd)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{fmtVnd(tx.balanceAfterVnd)}</td>
                    <td className="px-2 py-2 text-text-muted text-xs">
                      {tx.refType === "order" && tx.refId && <Link href={`/dashboard/orders/${tx.refId}`} className="hover:text-primary">order {tx.refId}</Link>}
                      {tx.model && <span> · {tx.model}</span>}
                      {tx.meta?.reason && <span> · {tx.meta.reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function VoucherTab({ redemptions }) {
  return (
    <Card>
      <h2 className="font-semibold mb-3">Voucher đã dùng ({redemptions?.length || 0})</h2>
      {!redemptions || redemptions.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">Khách chưa dùng voucher nào.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Loại</th>
                <th className="px-3 py-2 text-right">Giá trị</th>
                <th className="px-3 py-2 text-right">Giảm (VND)</th>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Lúc</th>
              </tr>
            </thead>
            <tbody>
              {redemptions.map((r) => (
                <tr key={r.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2 font-mono">{r.code || "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.kind || "—"}</td>
                  <td className="px-3 py-2 text-right text-xs">
                    {r.kind === "percent" ? `${r.value}%` : r.value != null ? fmtVnd(r.value) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtVnd(r.discountVnd)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.orderId}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(r.redeemedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const KEY_FILTERS = [
  { id: "all", label: "Tất cả" },
  { id: "active", label: "Đang dùng" },
  { id: "inactive", label: "Đã tắt" },
  { id: "expiringSoon", label: "Sắp hết hạn" },
  { id: "expired", label: "Hết hạn" },
  { id: "nearLimit", label: "Gần limit" },
];

function getKeyStatus(k, usage) {
  if (!k.isActive) return { id: "inactive", label: "Đã tắt", palette: "bg-text-muted/15 text-text-muted" };
  if (k.expiresAt) {
    const t = new Date(k.expiresAt).getTime();
    if (t <= Date.now()) return { id: "expired", label: "Hết hạn", palette: "bg-red-500/15 text-red-500" };
    if (t - Date.now() <= 7 * 86400000) return { id: "expiringSoon", label: "Sắp hết hạn", palette: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  }
  if (usage) {
    const max = Math.max(usage.daily?.pct ?? 0, usage.monthly?.pct ?? 0, usage.lifetime?.pct ?? 0);
    if (max >= 95) return { id: "critical", label: "Đầy limit", palette: "bg-red-500/15 text-red-500" };
    if (max >= 80) return { id: "nearLimit", label: "Gần limit", palette: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  }
  return { id: "active", label: "Đang dùng", palette: "bg-emerald-500/15 text-emerald-500" };
}

function KeysTab({ keys, keyLimitsUsage, selected, onToggleSelect, onToggleSelectAll, onClearSelection, onBulk, onBulkToggleActive, onToggle, onEdit }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const usageById = new Map((keyLimitsUsage || []).map((u) => [u.keyId, u]));

  const enriched = keys.map((k) => ({ k, usage: usageById.get(k.id), status: getKeyStatus(k, usageById.get(k.id)) }));

  const counts = enriched.reduce((acc, { status }) => {
    acc.all += 1;
    acc[status.id] = (acc[status.id] || 0) + 1;
    if (status.id === "critical") acc.nearLimit = (acc.nearLimit || 0) + 1;
    return acc;
  }, { all: 0 });

  const filtered = enriched.filter(({ k, status }) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${k.name || ""} ${k.keyDisplay || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filter === "all") return true;
    if (filter === "nearLimit") return status.id === "nearLimit" || status.id === "critical";
    return status.id === filter;
  });

  const visibleKeys = filtered.map(({ k }) => k);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k.id));

  return (
    <div className="flex flex-col gap-3">
      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KeyStatChip label="Tổng" value={counts.all || 0} active={filter === "all"} onClick={() => setFilter("all")} />
        <KeyStatChip label="Đang dùng" value={counts.active || 0} tone="emerald" active={filter === "active"} onClick={() => setFilter("active")} />
        <KeyStatChip label="Đã tắt" value={counts.inactive || 0} tone="muted" active={filter === "inactive"} onClick={() => setFilter("inactive")} />
        <KeyStatChip label="Hết hạn / Sắp" value={(counts.expired || 0) + (counts.expiringSoon || 0)} tone="amber" active={filter === "expiringSoon" || filter === "expired"} onClick={() => setFilter(counts.expired ? "expired" : "expiringSoon")} />
        <KeyStatChip label="Gần limit" value={counts.nearLimit || 0} tone="amber" active={filter === "nearLimit"} onClick={() => setFilter("nearLimit")} />
      </div>

      {/* Filter + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {KEY_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                filter === f.id
                  ? "bg-primary text-white border-primary"
                  : "border-border text-text-muted hover:bg-surface-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto min-w-[200px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên hoặc prefix..."
          />
        </div>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 shadow-sm">
          <span className="text-sm font-medium">{selected.size} key được chọn</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => onBulkToggleActive(true)}>Bật</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkToggleActive(false)}>Tắt</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulk("compress")}>Compress</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulk("quota")}>Quota</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulk("expiry")}>Hạn dùng</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulk("rateLimit")}>Rate limit</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulk("models")}>Models</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulk("providerAccess")}>Provider</Button>
            <Button size="sm" variant="ghost" onClick={onClearSelection}>Bỏ chọn</Button>
          </div>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">API Keys ({filtered.length}/{keys.length})</h2>
          {filtered.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={() => onToggleSelectAll(visibleKeys)} />
              <span>Chọn tất cả trên trang</span>
            </label>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted py-8 text-center">{keys.length === 0 ? "Khách chưa có key nào." : "Không có key phù hợp."}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map(({ k, usage, status }) => (
              <KeyRow
                key={k.id}
                k={k}
                usage={usage}
                status={status}
                selected={selected.has(k.id)}
                onToggleSelect={() => onToggleSelect(k.id)}
                onToggleActive={() => onToggle(k.id)}
                onEdit={(initialTab) => onEdit(k, initialTab)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function KeyStatChip({ label, value, tone = "primary", active, onClick }) {
  const palette = active
    ? "bg-primary text-white border-primary"
    : tone === "emerald" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
    : tone === "amber" ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
    : tone === "muted" ? "border-border bg-surface-2 text-text-muted hover:bg-surface"
    : "border-border bg-surface-2 text-text-main hover:bg-surface";
  return (
    <button onClick={onClick} className={`text-left rounded-lg border px-3 py-2 transition ${palette}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </button>
  );
}

function KeyRow({ k, usage, status, selected, onToggleSelect, onToggleActive, onEdit }) {
  const allowedModels = Array.isArray(k.allowedModels) ? k.allowedModels : [];
  const providerCount = (k.allowedProviders?.length || 0) + (k.allowedConnectionIds?.length || 0);
  return (
    <div className={`rounded-lg border ${selected ? "border-primary/40 bg-primary/5" : "border-border-subtle"} p-3`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{k.name || "Untitled"}</span>
            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase ${status.palette}`}>{status.label}</span>
            <code className="text-xs font-mono text-text-muted">{k.keyDisplay}</code>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
            <span>Hết hạn: {fmtTime(k.expiresAt)}</span>
            <span>RPM: {k.requestsPerMinute || "∞"}</span>
            <span>Max/req: {k.maxTokensPerRequest ? fmtNum(k.maxTokensPerRequest) : "∞"}</span>
            <span>Provider: {providerCount === 0 ? "Tất cả" : `${providerCount} đã chọn`}</span>
            <span>Models: {allowedModels.length === 0 ? "Tất cả" : `${allowedModels.length} đã chọn`}</span>
            <span>RTK: <CompressBadge value={k.rtkMode} kind="rtk" /></span>
            <span>Caveman: <CompressBadge value={k.cavemanMode} kind="caveman" /></span>
          </div>

          {/* Usage bars */}
          <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
            <UsageMicroBar label="Daily" used={usage?.daily?.used} limit={usage?.daily?.limit} pct={usage?.daily?.pct} onClick={() => onEdit("limits")} />
            <UsageMicroBar label="Monthly" used={usage?.monthly?.used} limit={usage?.monthly?.limit} pct={usage?.monthly?.pct} onClick={() => onEdit("limits")} />
            <UsageMicroBar label="Lifetime" used={usage?.lifetime?.used} limit={usage?.lifetime?.limit} pct={usage?.lifetime?.pct} onClick={() => onEdit("limits")} />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Toggle checked={k.isActive} onChange={onToggleActive} size="sm" title={k.isActive ? "Tắt key" : "Bật key"} />
          <Button size="sm" variant="ghost" onClick={() => onEdit("limits")}>Sửa</Button>
        </div>
      </div>
    </div>
  );
}

function UsageMicroBar({ label, used, limit, pct, onClick }) {
  const has = limit > 0;
  const p = has ? Math.min(100, pct || 0) : 0;
  const color = !has ? "bg-text-muted/30" : p >= 90 ? "bg-red-500" : p >= 70 ? "bg-amber-500" : "bg-primary";
  return (
    <button onClick={onClick} className="text-left w-full">
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-text-muted">{label}</span>
        <span className="font-mono text-text-muted">
          {fmtNum(used || 0)} {has ? `/ ${fmtNum(limit)} (${p}%)` : "/ ∞"}
        </span>
      </div>
      <div className="h-1.5 rounded bg-surface-2">
        <div className={`h-full rounded ${color}`} style={{ width: `${p}%` }} />
      </div>
    </button>
  );
}

function ProviderScopeBadge({ providers, connections }) {
  const p = Array.isArray(providers) ? providers : [];
  const c = Array.isArray(connections) ? connections : [];
  if (p.length === 0 && c.length === 0) {
    return <span className="inline-block rounded-full px-2 py-0.5 text-[10px] uppercase bg-text-muted/15 text-text-muted">Tất cả</span>;
  }
  const parts = [];
  if (p.length > 0) parts.push(`${p.length} prov`);
  if (c.length > 0) parts.push(`${c.length} conn`);
  return <span className="inline-block rounded-full px-2 py-0.5 text-[10px] uppercase bg-primary/15 text-primary">{parts.join(" · ")}</span>;
}

function CompressBadge({ value, kind }) {
  const v = value || "inherit";
  const palette =
    v === "inherit" ? "bg-text-muted/15 text-text-muted"
      : v === "off" ? "bg-text-muted/15 text-text-muted"
      : v === "on" ? "bg-emerald-500/15 text-emerald-500"
      : kind === "caveman" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-primary/15 text-primary";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase ${palette}`}>{v}</span>;
}

function ActionsTab({ onResetPassword }) {
  return (
    <Card>
      <h2 className="font-semibold mb-3">Hành động admin</h2>
      <p className="text-xs text-text-muted mb-4">Các thao tác ảnh hưởng tới tài khoản khách. Cần xác nhận trước khi chạy.</p>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-3">
          <div>
            <div className="font-medium">Gửi email đặt lại mật khẩu</div>
            <div className="text-xs text-text-muted">Khách nhận link reset mật khẩu (hết hạn 1 giờ). Cần SMTP đã cấu hình.</div>
          </div>
          <Button onClick={onResetPassword} size="sm" variant="ghost">Gửi email</Button>
        </div>
      </div>
    </Card>
  );
}

function EditKeyModal({ modal, customerId, onClose, onSaved, onError }) {
  const [tab, setTab] = useState("limits");
  const [form, setForm] = useState(null);
  const [providerOptions, setProviderOptions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [extendDays, setExtendDays] = useState(0);

  useEffect(() => {
    if (!modal?.key) return;
    setTab(modal.tab || "limits");
    const k = modal.key;
    setForm({
      name: k.name || "",
      isActive: !!k.isActive,
      dailyTokenLimit: k.dailyTokenLimit || 0,
      monthlyTokenLimit: k.monthlyTokenLimit || 0,
      lifetimeTokenLimit: k.lifetimeTokenLimit || 0,
      requestsPerMinute: k.requestsPerMinute || 0,
      maxTokensPerRequest: k.maxTokensPerRequest || 0,
      expiresAt: k.expiresAt ? k.expiresAt.slice(0, 16) : "",
      allowedModelsText: (k.allowedModels || []).join("\n"),
      allowedProviders: k.allowedProviders || [],
      allowedConnectionIds: k.allowedConnectionIds || [],
      rtkMode: k.rtkMode || "inherit",
      cavemanMode: k.cavemanMode || "inherit",
    });
    setExtendDays(0);
    if (!providerOptions) {
      fetch("/api/admin/provider-options", { cache: "no-store" })
        .then((r) => r.json())
        .then(setProviderOptions)
        .catch(() => setProviderOptions({ providers: [], connections: [] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  if (!modal?.key || !form) return null;
  const k = modal.key;

  async function save(patch, successMsg) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/api-keys/${k.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { onError?.(d?.error || "Lỗi cập nhật"); return false; }
      onSaved?.(successMsg || "Đã cập nhật.");
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveLimits() {
    const allowedModels = form.allowedModelsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    let expiresAt = form.expiresAt ? new Date(form.expiresAt).toISOString() : null;
    if (Number(extendDays) > 0) {
      const days = Math.floor(Number(extendDays));
      const base = k.expiresAt ? new Date(k.expiresAt) : new Date();
      expiresAt = new Date(base.getTime() + days * 86400000).toISOString();
    }
    await save({
      name: form.name.trim() || k.name,
      dailyTokenLimit: Number(form.dailyTokenLimit) || 0,
      monthlyTokenLimit: Number(form.monthlyTokenLimit) || 0,
      lifetimeTokenLimit: Number(form.lifetimeTokenLimit) || 0,
      requestsPerMinute: Number(form.requestsPerMinute) || 0,
      maxTokensPerRequest: Number(form.maxTokensPerRequest) || 0,
      expiresAt,
      allowedModels,
    }, "Đã lưu limits.");
  }

  async function saveProvider() {
    await save({
      allowedProviders: form.allowedProviders,
      allowedConnectionIds: form.allowedConnectionIds,
    }, "Đã lưu provider access.");
  }

  async function saveCompress() {
    await save({
      rtkMode: form.rtkMode,
      cavemanMode: form.cavemanMode,
    }, "Đã lưu compress.");
  }

  async function quickAddQuota() {
    // Cộng quota nhanh: dùng route quota của customer (mode=add)
    const payload = { mode: "add" };
    const dt = Number(form.dailyTokenLimit) - Number(k.dailyTokenLimit || 0);
    const mt = Number(form.monthlyTokenLimit) - Number(k.monthlyTokenLimit || 0);
    const lt = Number(form.lifetimeTokenLimit) - Number(k.lifetimeTokenLimit || 0);
    if (dt > 0) payload.dailyTokenLimit = dt;
    if (mt > 0) payload.monthlyTokenLimit = mt;
    if (lt > 0) payload.lifetimeTokenLimit = lt;
    if (Object.keys(payload).length === 1) {
      onError?.("Tăng giá trị limit so với hiện tại trước khi cộng thêm.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/api-keys/${k.id}/quota`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { onError?.(d?.error || "Lỗi cộng quota"); return; }
      onSaved?.("Đã cộng thêm quota.");
    } finally { setBusy(false); }
  }

  function toggleProvider(id) {
    setForm((prev) => ({
      ...prev,
      allowedProviders: prev.allowedProviders.includes(id)
        ? prev.allowedProviders.filter((p) => p !== id)
        : [...prev.allowedProviders, id],
    }));
  }
  function toggleConnection(id) {
    setForm((prev) => ({
      ...prev,
      allowedConnectionIds: prev.allowedConnectionIds.includes(id)
        ? prev.allowedConnectionIds.filter((c) => c !== id)
        : [...prev.allowedConnectionIds, id],
    }));
  }

  const TABS_EDIT = [
    { id: "limits", label: "Limits & Hạn dùng" },
    { id: "provider", label: "Models & Provider" },
    { id: "compress", label: "Compress" },
  ];

  return (
    <Modal isOpen={!!modal?.key} onClose={onClose} title={`Sửa key: ${k.name || k.keyDisplay}`}>
      <div className="flex flex-col gap-4 max-h-[75vh]">
        <div className="rounded-md bg-surface-2 p-2 text-xs text-text-muted flex flex-wrap gap-x-3 gap-y-1">
          <span>{k.keyDisplay}</span>
          <span>Hết hạn: {fmtTime(k.expiresAt)}</span>
          <span>{k.isActive ? "Đang dùng" : "Đã tắt"}</span>
        </div>

        <div className="flex gap-1 border-b border-border-subtle -mb-2">
          {TABS_EDIT.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px px-3 py-1.5 text-sm font-medium border-b-2 transition ${
                tab === t.id ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text-main"
              }`}
            >{t.label}</button>
          ))}
        </div>

        <div className="overflow-y-auto pr-1">
          {tab === "limits" && (
            <div className="flex flex-col gap-3">
              <Input label="Tên key" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

              <div className="grid grid-cols-3 gap-3">
                <Input label="Daily token limit" type="number" min={0} value={form.dailyTokenLimit} onChange={(e) => setForm({ ...form, dailyTokenLimit: e.target.value })} hint="0 = ∞" />
                <Input label="Monthly token limit" type="number" min={0} value={form.monthlyTokenLimit} onChange={(e) => setForm({ ...form, monthlyTokenLimit: e.target.value })} hint="0 = ∞" />
                <Input label="Lifetime token limit" type="number" min={0} value={form.lifetimeTokenLimit} onChange={(e) => setForm({ ...form, lifetimeTokenLimit: e.target.value })} hint="0 = ∞" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input label="Requests / phút" type="number" min={0} value={form.requestsPerMinute} onChange={(e) => setForm({ ...form, requestsPerMinute: e.target.value })} hint="0 = ∞" />
                <Input label="Max tokens / request" type="number" min={0} value={form.maxTokensPerRequest} onChange={(e) => setForm({ ...form, maxTokensPerRequest: e.target.value })} hint="0 = ∞" />
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <Input label="Hết hạn (set tường minh)" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} hint="Để trống = không bao giờ hết" />
                <Input label="Hoặc gia hạn thêm N ngày" type="number" min={0} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} hint="Cộng dồn vào hạn hiện tại khi lưu" />
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Allowed models</span>
                <textarea
                  value={form.allowedModelsText}
                  onChange={(e) => setForm({ ...form, allowedModelsText: e.target.value })}
                  rows={3}
                  placeholder="claude-sonnet-4&#10;gpt-4o"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm font-mono"
                />
                <span className="text-xs text-text-muted">Mỗi model 1 dòng (hoặc cách bằng dấu phẩy). Để trống = tất cả.</span>
              </label>

              <div className="flex gap-2 pt-2 border-t border-border-subtle">
                <Button onClick={saveLimits} disabled={busy} fullWidth>Lưu</Button>
                <Button onClick={quickAddQuota} disabled={busy} variant="ghost" fullWidth title="Dùng diff so với limit cũ để cộng thêm thay vì set">Cộng thêm quota</Button>
              </div>
            </div>
          )}

          {tab === "provider" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-muted">
                Để trống cả hai = không giới hạn. Chọn connection sẽ tự suy ra provider.
              </p>
              {!providerOptions ? (
                <div className="h-20 animate-pulse" />
              ) : (
                <>
                  <div>
                    <span className="text-sm font-medium">Providers ({form.allowedProviders.length}/{providerOptions.providers.length})</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {providerOptions.providers.map((p) => (
                        <label key={p.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="checkbox" checked={form.allowedProviders.includes(p.id)} onChange={() => toggleProvider(p.id)} />
                          <span>{p.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-medium">Connections ({form.allowedConnectionIds.length}/{providerOptions.connections.length})</span>
                    <div className="flex flex-col gap-1 mt-1 max-h-48 overflow-y-auto">
                      {providerOptions.connections.map((c) => (
                        <label key={c.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="checkbox" checked={form.allowedConnectionIds.includes(c.id)} onChange={() => toggleConnection(c.id)} />
                          <span>{c.name}</span>
                          <span className="text-xs text-text-muted ml-1">({c.providerName})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="flex gap-2 pt-2 border-t border-border-subtle">
                <Button onClick={saveProvider} disabled={busy} fullWidth>Lưu</Button>
              </div>
            </div>
          )}

          {tab === "compress" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-muted">
                <strong>Inherit</strong> dùng setting global. <strong>RTK</strong> nén tool_result, <strong>Caveman</strong> chèn system prompt nén theo level.
              </p>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">RTK mode</span>
                <select value={form.rtkMode} onChange={(e) => setForm({ ...form, rtkMode: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2">
                  {RTK_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-text-muted">Caveman mode</span>
                <select value={form.cavemanMode} onChange={(e) => setForm({ ...form, cavemanMode: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2">
                  {CAVEMAN_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <div className="flex gap-2 pt-2 border-t border-border-subtle">
                <Button onClick={saveCompress} disabled={busy} fullWidth>Lưu</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

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

function CompressModal({ modal, onClose, onSave }) {
  const [rtkMode, setRtkMode] = useState("inherit");
  const [cavemanMode, setCavemanMode] = useState("inherit");

  useEffect(() => {
    if (!modal) return;
    setRtkMode(modal.key?.rtkMode || "inherit");
    setCavemanMode(modal.key?.cavemanMode || "inherit");
  }, [modal]);

  if (!modal) return null;
  const k = modal.key;
  const title = k
    ? `Compress: ${k.name || k.keyDisplay}`
    : `Compress (${modal.bulkCount || 0} key)`;

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          <strong>Inherit</strong>: dùng setting global. <strong>RTK</strong> nén tool_result, <strong>Caveman</strong> chèn system prompt nén theo level.
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

function BulkQuotaModal({ modal, onClose, onSave }) {
  const [form, setForm] = useState({ mode: "add", dailyTokenLimit: 0, monthlyTokenLimit: 0, lifetimeTokenLimit: 0 });

  useEffect(() => {
    if (modal) setForm({ mode: "add", dailyTokenLimit: 0, monthlyTokenLimit: 0, lifetimeTokenLimit: 0 });
  }, [modal]);

  if (!modal) return null;

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={`Quota (${modal.bulkCount || 0} key)`}>
      <div className="flex flex-col gap-4">
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
    if (!modal) return;
    setMode("extend");
    setExtendDays(0);
    setExpiresAt("");
  }, [modal]);

  if (!modal) return null;
  const k = modal.key;
  const title = k
    ? `Hạn dùng: ${k.name || k.keyDisplay}`
    : `Hạn dùng (${modal.bulkCount || 0} key)`;

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
    <Modal isOpen={!!modal} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        {k && (
          <div className="rounded-md bg-surface-2 p-3 text-xs text-text-muted">
            Hết hạn hiện tại: {fmtTime(k.expiresAt)}
          </div>
        )}
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
          <Input label="ExpiresAt" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
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
    if (!modal) return;
    if (modal.key) {
      setRpm(modal.key.requestsPerMinute || 0);
      setMaxTok(modal.key.maxTokensPerRequest || 0);
    } else {
      setRpm(0);
      setMaxTok(0);
    }
  }, [modal]);

  if (!modal) return null;
  const k = modal.key;
  const title = k
    ? `Rate limit: ${k.name || k.keyDisplay}`
    : `Rate limit (${modal.bulkCount || 0} key)`;

  function submit() {
    const out = {};
    if (requestsPerMinute !== "" && Number(requestsPerMinute) >= 0) out.requestsPerMinute = Number(requestsPerMinute);
    if (maxTokensPerRequest !== "" && Number(maxTokensPerRequest) >= 0) out.maxTokensPerRequest = Number(maxTokensPerRequest);
    if (Object.keys(out).length === 0) return;
    onSave(out);
  }

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={title}>
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
    if (!modal) return;
    if (modal.key) {
      setText((modal.key.allowedModels || []).join("\n"));
      setMerge(false);
    } else {
      setText("");
      setMerge(false);
    }
  }, [modal]);

  if (!modal) return null;
  const k = modal.key;
  const title = k
    ? `Allowed models: ${k.name || k.keyDisplay}`
    : `Allowed models (${modal.bulkCount || 0} key)`;

  function submit() {
    const list = text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({ allowedModels: list, merge });
  }

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={title}>
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

function ProviderAccessModal({ modal, onClose, onSave }) {
  const [options, setOptions] = useState(null);
  const [selectedProviders, setSelectedProviders] = useState([]);
  const [selectedConnections, setSelectedConnections] = useState([]);
  const [mode, setMode] = useState("set");

  useEffect(() => {
    if (!modal) return;
    fetch("/api/admin/provider-options", { cache: "no-store" })
      .then((r) => r.json())
      .then(setOptions)
      .catch(() => setOptions({ providers: [], connections: [] }));
    if (modal.key) {
      setSelectedProviders(modal.key.allowedProviders || []);
      setSelectedConnections(modal.key.allowedConnectionIds || []);
      setMode("set");
    } else {
      setSelectedProviders([]);
      setSelectedConnections([]);
      setMode("set");
    }
  }, [modal]);

  if (!modal) return null;
  const isBulk = !modal.key;
  const title = isBulk
    ? `Provider access (${modal.bulkCount || 0} key)`
    : `Provider access: ${modal.key?.name || modal.key?.keyDisplay || ""}`;

  function toggleProvider(id) {
    setSelectedProviders((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  function toggleConnection(id) {
    setSelectedConnections((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function selectAllConnectionsOfProviders() {
    if (!options) return;
    const connIds = options.connections
      .filter((c) => selectedProviders.includes(c.provider))
      .map((c) => c.id);
    setSelectedConnections((prev) => Array.from(new Set([...prev, ...connIds])));
  }

  function submit() {
    const payload = isBulk ? { mode } : {};
    if (selectedProviders.length > 0 || !isBulk) payload.allowedProviders = selectedProviders;
    if (selectedConnections.length > 0 || !isBulk) payload.allowedConnectionIds = selectedConnections;
    onSave(payload);
  }

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
        <p className="text-xs text-text-muted">
          Để trống cả 2 = không giới hạn. Nếu chọn connection cụ thể, provider sẽ được suy ra tự động.
        </p>

        {isBulk && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Chế độ</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-border bg-bg px-3 py-2">
              <option value="set">Ghi đè</option>
              <option value="merge">Merge với danh sách hiện tại</option>
            </select>
          </label>
        )}

        {!options ? (
          <div className="h-20 animate-pulse" />
        ) : (
          <>
            <div>
              <span className="text-sm font-medium">Providers ({selectedProviders.length}/{options.providers.length})</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {options.providers.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={selectedProviders.includes(p.id)} onChange={() => toggleProvider(p.id)} />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">Connections ({selectedConnections.length}/{options.connections.length})</span>
                {selectedProviders.length > 0 && (
                  <button onClick={selectAllConnectionsOfProviders} className="text-xs text-primary hover:underline">
                    Chọn tất cả conn của provider đã chọn
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {options.connections.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={selectedConnections.includes(c.id)} onChange={() => toggleConnection(c.id)} />
                    <span>{c.name}</span>
                    <span className="text-xs text-text-muted ml-1">({c.providerName})</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex gap-2">
          <Button onClick={submit} fullWidth>Áp dụng</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Hủy</Button>
        </div>
      </div>
    </Modal>
  );
}
