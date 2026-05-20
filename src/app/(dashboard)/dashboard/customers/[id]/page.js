"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
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
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [notes, setNotes] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [quotaModal, setQuotaModal] = useState(null);
  const [compressModal, setCompressModal] = useState(null);
  const [toast, setToast] = useState("");

  async function load() {
    const r = await fetch(`/api/admin/customers/${id}`, { cache: "no-store" });
    const d = await r.json();
    setData(d);
    setNotes(d.customer?.notes || "");
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

  async function resetPassword() {
    setConfirm(null);
    const res = await fetch(`/api/admin/customers/${id}/reset-password`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d?.ok) notify("Đã gửi email đặt lại mật khẩu.");
    else notify(d?.error || "Không gửi được email.");
  }

  if (!data) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;
  if (data.error) return <Card><p className="text-red-500">{data.error}</p></Card>;

  const { customer, orders, keys, summary, usageDaily, usageByModel, keyLimitsUsage, voucherRedemptions, referral } = data;
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
      {tab === "usage" && <UsageTab usageDaily={usageDaily} usageByModel={usageByModel} keyLimitsUsage={keyLimitsUsage} />}
      {tab === "voucher" && <VoucherTab redemptions={voucherRedemptions} />}
      {tab === "wallet" && <WalletTab customerId={id} notify={notify} />}
      {tab === "keys" && (
        <KeysTab
          keys={keys}
          onToggle={toggleKey}
          onOpenQuota={(k) => setQuotaModal({ key: k, mode: "add", dailyTokenLimit: 0, monthlyTokenLimit: 0, lifetimeTokenLimit: 0, extendDays: 0 })}
          onOpenCompress={(k) => setCompressModal({ key: k })}
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

      <QuotaModal
        modal={quotaModal}
        onClose={() => setQuotaModal(null)}
        onSave={async (payload) => {
          const res = await fetch(`/api/admin/customers/${id}/api-keys/${quotaModal.key.id}/quota`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) { notify(d?.error || "Lỗi cập nhật quota"); return; }
          setQuotaModal(null);
          notify("Đã cập nhật quota.");
          load();
        }}
      />

      <CompressModal
        modal={compressModal}
        onClose={() => setCompressModal(null)}
        onSave={async (payload) => {
          const res = await fetch(`/api/admin/api-keys/${compressModal.key.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) { notify(d?.error || "Lỗi cập nhật compress"); return; }
          setCompressModal(null);
          notify("Đã cập nhật compress.");
          load();
        }}
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

function UsageTab({ usageDaily, usageByModel, keyLimitsUsage }) {
  const max = Math.max(0, ...(usageDaily || []).map((d) => d.costUsd));
  return (
    <div className="flex flex-col gap-6">
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

function KeysTab({ keys, onToggle, onOpenQuota, onOpenCompress }) {
  return (
    <Card>
      <h2 className="font-semibold mb-3">API Keys ({keys.length})</h2>
      {keys.length === 0 ? <p className="text-sm text-text-muted">Khách chưa có key nào.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Tên</th>
                <th className="px-3 py-2 text-left">Display</th>
                <th className="px-3 py-2 text-right">Daily</th>
                <th className="px-3 py-2 text-right">Monthly</th>
                <th className="px-3 py-2 text-right">Lifetime</th>
                <th className="px-3 py-2 text-left">Hết hạn</th>
                <th className="px-3 py-2 text-center">RTK</th>
                <th className="px-3 py-2 text-center">Caveman</th>
                <th className="px-3 py-2 text-center">Active</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2">{k.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{k.keyDisplay}</td>
                  <td className="px-3 py-2 text-right text-xs">{k.dailyTokenLimit ? fmtNum(k.dailyTokenLimit) : "∞"}</td>
                  <td className="px-3 py-2 text-right text-xs">{k.monthlyTokenLimit ? fmtNum(k.monthlyTokenLimit) : "∞"}</td>
                  <td className="px-3 py-2 text-right text-xs">{k.lifetimeTokenLimit ? fmtNum(k.lifetimeTokenLimit) : "∞"}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(k.expiresAt)}</td>
                  <td className="px-3 py-2 text-center"><CompressBadge value={k.rtkMode} kind="rtk" /></td>
                  <td className="px-3 py-2 text-center"><CompressBadge value={k.cavemanMode} kind="caveman" /></td>
                  <td className="px-3 py-2 text-center">
                    <Toggle checked={k.isActive} onChange={() => onToggle(k.id)} size="sm" />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button onClick={() => onOpenCompress(k)} size="sm" variant="ghost">Compress</Button>
                    <Button onClick={() => onOpenQuota(k)} size="sm" variant="ghost">Quota / gia hạn</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
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

function QuotaModal({ modal, onClose, onSave }) {
  const [form, setForm] = useState({ mode: "add", dailyTokenLimit: 0, monthlyTokenLimit: 0, lifetimeTokenLimit: 0, extendDays: 0 });

  useEffect(() => {
    if (modal) {
      setForm({ mode: "add", dailyTokenLimit: 0, monthlyTokenLimit: 0, lifetimeTokenLimit: 0, extendDays: 0 });
    }
  }, [modal]);

  if (!modal) return null;
  const k = modal.key;

  function submit() {
    const payload = { mode: form.mode };
    if (Number(form.dailyTokenLimit) > 0) payload.dailyTokenLimit = Number(form.dailyTokenLimit);
    if (Number(form.monthlyTokenLimit) > 0) payload.monthlyTokenLimit = Number(form.monthlyTokenLimit);
    if (Number(form.lifetimeTokenLimit) > 0) payload.lifetimeTokenLimit = Number(form.lifetimeTokenLimit);
    if (Number(form.extendDays) > 0) payload.extendDays = Number(form.extendDays);
    if (Object.keys(payload).length === 1) return; // chỉ có mode → không có thay đổi
    onSave(payload);
  }

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={`Cập nhật quota: ${k.name}`}>
      <div className="flex flex-col gap-4">
        <div className="rounded-md bg-surface-2 p-3 text-xs text-text-muted">
          <div>Hiện tại: daily {fmtNum(k.dailyTokenLimit) || "∞"} · monthly {fmtNum(k.monthlyTokenLimit) || "∞"} · lifetime {fmtNum(k.lifetimeTokenLimit) || "∞"}</div>
          <div>Hết hạn: {fmtTime(k.expiresAt)}</div>
        </div>

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

        <Input label="Gia hạn thêm (ngày)" type="number" min={0} value={form.extendDays} onChange={(e) => setForm({ ...form, extendDays: e.target.value })} hint="Cộng thêm N ngày vào hạn dùng. Để 0 nếu không gia hạn." />

        <div className="flex gap-2">
          <Button onClick={submit} fullWidth>Áp dụng</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Hủy</Button>
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

  return (
    <Modal isOpen={!!modal} onClose={onClose} title={`Compress: ${k.name || k.keyDisplay}`}>
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
