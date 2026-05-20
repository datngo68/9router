"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function fmtVnd(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function txTypeLabel(t) {
  switch (t) {
    case "topup": return { label: "Nạp ví", color: "bg-green-500/10 text-green-600" };
    case "charge": return { label: "Sử dụng API", color: "bg-blue-500/10 text-blue-600" };
    case "adjustment": return { label: "Điều chỉnh", color: "bg-amber-500/10 text-amber-600" };
    case "refund": return { label: "Hoàn tiền", color: "bg-purple-500/10 text-purple-600" };
    default: return { label: t || "Khác", color: "bg-surface-2 text-text-muted" };
  }
}

export default function WalletPage() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amountInput, setAmountInput] = useState("100000");
  const [filter, setFilter] = useState("");

  async function load() {
    const qs = filter ? `?type=${filter}` : "";
    const res = await fetch(`/api/account/wallet${qs}`, { cache: "no-store" });
    setData(await res.json());
  }
  useEffect(() => { load(); }, [filter]);

  async function topup(amount) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountVnd: Number(amount) }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error || "Tạo đơn nạp thất bại");
        return;
      }
      window.location.href = `/store/order/${d.order.id}`;
    } finally { setBusy(false); }
  }

  if (!data) {
    return <div className="h-48 animate-pulse rounded-xl border border-border-subtle bg-surface" />;
  }

  if (!data.walletEnabled) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
        <span className="material-symbols-outlined text-3xl text-text-muted">account_balance_wallet</span>
        <p className="mt-2 text-text-muted">Tính năng ví chưa được kích hoạt.</p>
      </div>
    );
  }

  const balanceVnd = data.balance?.vnd || 0;
  const isLow = balanceVnd < (data.lowBalanceThresholdVnd || 0);

  const presets = [50000, 100000, 200000, 500000, 1000000];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Ví của tôi</h1>
        <p className="text-sm text-text-muted">Số dư VND dùng để trả thêm khi quota gói hết.</p>
      </header>

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className={`rounded-xl border p-5 ${isLow ? "border-amber-500/40 bg-amber-500/5" : "border-border-subtle bg-surface"}`}>
          <p className="text-xs uppercase text-text-muted">Số dư hiện tại</p>
          <p className="mt-2 text-3xl font-semibold">{fmtVnd(balanceVnd)} ₫</p>
          {isLow && (
            <p className="mt-2 text-xs text-amber-600">Sắp hết — bạn nên nạp thêm để tránh gián đoạn.</p>
          )}
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface p-5">
          <p className="text-xs uppercase text-text-muted">Hạn mức tối thiểu</p>
          <p className="mt-2 text-xl font-medium">{fmtVnd(data.balance?.minLimitVnd || 0)} ₫</p>
          <p className="mt-1 text-xs text-text-muted">Có thể âm khi admin cho phép overdraft.</p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface p-5">
          <p className="text-xs uppercase text-text-muted">Đơn nạp đang chờ</p>
          <p className="mt-2 text-xl font-medium">{data.pendingTopups?.length || 0}</p>
          {data.pendingTopups?.[0] && (
            <Link href={`/store/order/${data.pendingTopups[0].id}`} className="mt-1 inline-block text-xs text-primary hover:underline">
              Xem QR đơn gần nhất →
            </Link>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-border-subtle bg-surface p-5">
        <h2 className="font-semibold">Nạp tiền vào ví</h2>
        <p className="mt-1 text-sm text-text-muted">Quét QR chuyển khoản, ví được cộng tự động sau khi xác nhận.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setAmountInput(String(p))}
              className={`rounded-lg border px-4 py-2 text-sm ${String(p) === amountInput ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-surface-2"}`}
            >
              {fmtVnd(p)} ₫
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <input
            type="number"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            min={data.topupMinVnd || 1}
            max={data.topupMaxVnd || undefined}
            className="w-48 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            placeholder="Số tiền VND"
          />
          <button
            onClick={() => topup(amountInput)}
            disabled={busy || !Number(amountInput)}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Đang tạo..." : "Tạo đơn nạp"}
          </button>
          <p className="text-xs text-text-muted">
            Min {fmtVnd(data.topupMinVnd || 0)} ₫ — Max {fmtVnd(data.topupMaxVnd || 0)} ₫
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-border-subtle bg-surface">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-semibold">Lịch sử giao dịch</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-1 text-xs"
          >
            <option value="">Tất cả</option>
            <option value="topup">Nạp ví</option>
            <option value="charge">Sử dụng API</option>
            <option value="adjustment">Điều chỉnh</option>
            <option value="refund">Hoàn tiền</option>
          </select>
        </div>

        {data.items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-muted">Chưa có giao dịch nào.</p>
        ) : (
          <div className="divide-y divide-border-subtle">
            {data.items.map((tx) => {
              const meta = txTypeLabel(tx.type);
              const positive = tx.delta > 0;
              return (
                <div key={tx.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${meta.color}`}>{meta.label}</span>
                      {tx.model && <code className="truncate text-xs text-text-muted">{tx.model}</code>}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {new Date(tx.createdAt).toLocaleString("vi-VN")}
                      {tx.refType === "order" && tx.refId && ` · order ${tx.refId}`}
                      {tx.meta?.reason && ` · ${tx.meta.reason}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono font-medium ${positive ? "text-green-600" : "text-red-500"}`}>
                      {positive ? "+" : ""}{fmtVnd(tx.deltaVnd)} ₫
                    </p>
                    <p className="text-xs text-text-muted">Số dư: {fmtVnd(tx.balanceAfterVnd)} ₫</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
