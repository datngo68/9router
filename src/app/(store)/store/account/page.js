"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function n(v) { return Number(v || 0).toLocaleString("vi-VN"); }

export default function AccountOverviewPage() {
  const [keys, setKeys] = useState(null);
  const [usage, setUsage] = useState(null);
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    fetch("/api/account/keys", { cache: "no-store" }).then((r) => r.json()).then((d) => setKeys(d.keys || []));
    fetch("/api/account/usage?period=7d", { cache: "no-store" }).then((r) => r.json()).then(setUsage);
    fetch("/api/account/orders", { cache: "no-store" }).then((r) => r.json()).then((d) => setOrders(d.orders || []));
  }, []);

  const activeKeys = (keys || []).filter((k) => k.isActive).length;
  const pendingOrders = (orders || []).filter((o) => o.status === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tổng quan</h1>
        <p className="text-sm text-text-muted">Hoạt động của tài khoản trong 7 ngày qua.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active keys" value={n(activeKeys)} icon="vpn_key" />
        <Stat label="Tokens 7 ngày" value={n((usage?.totals?.totalTokens) || 0)} icon="bar_chart" />
        <Stat label="Đơn chờ thanh toán" value={n(pendingOrders)} icon="receipt_long" />
        <Stat label="Cost ước tính (USD)" value={`$${(usage?.totals?.cost || 0).toFixed(3)}`} icon="payments" />
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">7 ngày gần nhất</h2>
          <Link href="/store/account/usage" className="text-xs text-primary hover:underline">Xem chi tiết →</Link>
        </div>
        {!usage ? (
          <div className="mt-3 h-32 animate-pulse rounded bg-surface-2" />
        ) : (
          <div className="mt-4 grid grid-cols-7 items-end gap-1 h-32">
            {(usage.byDay || []).map((d) => {
              const v = d.promptTokens + d.completionTokens;
              const max = Math.max(1, ...usage.byDay.map((x) => x.promptTokens + x.completionTokens));
              const h = Math.round((v / max) * 100);
              return (
                <div key={d.day} className="flex flex-col items-center gap-1">
                  <div className="w-full rounded bg-primary/30 hover:bg-primary/50" style={{ height: `${h}%`, minHeight: "2px" }} title={`${d.day}: ${n(v)} tokens`} />
                  <span className="text-[10px] text-text-muted">{d.day.slice(5)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border-subtle bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Top models</h2>
            <Link href="/store/account/usage" className="text-xs text-primary hover:underline">Xem tất cả →</Link>
          </div>
          {!usage ? (
            <div className="mt-3 h-32 animate-pulse rounded bg-surface-2" />
          ) : (usage.byModel || []).length === 0 ? (
            <p className="mt-4 text-sm text-text-muted">Chưa có request nào.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2 text-sm">
              {usage.byModel.slice(0, 5).map((m) => (
                <li key={m.fullId} className="flex justify-between gap-4">
                  <span className="truncate font-mono text-xs">{m.fullId}</span>
                  <span className="text-text-muted">{n(m.promptTokens + m.completionTokens)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Đơn gần đây</h2>
            <Link href="/store/account/orders" className="text-xs text-primary hover:underline">Xem tất cả →</Link>
          </div>
          {!orders ? (
            <div className="mt-3 h-32 animate-pulse rounded bg-surface-2" />
          ) : orders.length === 0 ? (
            <div className="mt-4 text-sm text-text-muted">
              Chưa có đơn nào. <Link href="/store/pricing" className="text-primary hover:underline">Mua gói đầu tiên</Link>
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-2 text-sm">
              {orders.slice(0, 5).map((o) => (
                <li key={o.id} className="flex justify-between gap-4">
                  <Link href={`/store/order/${o.id}`} className="font-mono text-xs hover:text-primary">{o.id}</Link>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">{o.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-5">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-primary text-2xl">{icon}</span>
        <div>
          <p className="text-xs uppercase text-text-muted">{label}</p>
          <p className="mt-1 text-lg font-semibold">{value}</p>
        </div>
      </div>
    </div>
  );
}
