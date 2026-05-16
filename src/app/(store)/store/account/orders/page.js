"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function n(v) { return Number(v || 0).toLocaleString("vi-VN"); }
function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

const STATUS_COLOR = {
  pending: "bg-amber-500/10 text-amber-500",
  paid: "bg-blue-500/10 text-blue-500",
  delivered: "bg-green-500/10 text-green-500",
  cancelled: "bg-text-muted/10 text-text-muted",
  refunded: "bg-purple-500/10 text-purple-500",
};

export default function AccountOrdersPage() {
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    fetch("/api/account/orders", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setOrders(d.orders || []));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Đơn hàng</h1>
          <p className="text-sm text-text-muted">Lịch sử mua gói + trạng thái thanh toán.</p>
        </div>
        <Link href="/store/pricing" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90">Mua gói mới</Link>
      </header>

      {!orders ? (
        <div className="h-48 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
          <span className="material-symbols-outlined text-3xl text-text-muted">receipt_long</span>
          <p className="mt-2 text-text-muted">Chưa có đơn hàng nào.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-4 py-2 text-left">Mã đơn</th>
                <th className="px-4 py-2 text-left">Gói</th>
                <th className="px-4 py-2 text-right">Tiền</th>
                <th className="px-4 py-2 text-left">Trạng thái</th>
                <th className="px-4 py-2 text-left">Tạo lúc</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border-subtle hover:bg-surface-2">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/store/order/${o.id}`} className="hover:text-primary">{o.id}</Link>
                  </td>
                  <td className="px-4 py-2">{o.planName || o.planId}</td>
                  <td className="px-4 py-2 text-right">{fmtVnd(o.priceVnd)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_COLOR[o.status] || "bg-surface-2"}`}>{o.status}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-text-muted">{fmtTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
