"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtUsd(v) { return `$${Number(v || 0).toFixed(3)}`; }

export default function AdminRevenuePage() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/admin/revenue?period=${period}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }, [period]);

  const max = data ? Math.max(1, ...(data.byDay || []).map((d) => d.revenueVnd)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Revenue</h1>
          <p className="text-sm text-text-muted">Doanh thu từ orders đã giao + cost upstream từ usage.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border p-1">
          {[
            { id: "today", label: "Hôm nay" },
            { id: "7d", label: "7 ngày" },
            { id: "30d", label: "30 ngày" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setPeriod(t.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${period === t.id ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
            >{t.label}</button>
          ))}
        </div>
      </header>

      {!data ? (
        <Card><div className="h-32 animate-pulse" /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs uppercase text-text-muted">Doanh thu</p>
              <p className="mt-1 text-2xl font-semibold">{fmtVnd(data.totalRevenueVnd)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-text-muted">Đơn delivered</p>
              <p className="mt-1 text-2xl font-semibold">{data.deliveredCount}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-text-muted">Đơn pending</p>
              <p className="mt-1 text-2xl font-semibold">{data.pendingCount}</p>
            </Card>
          </div>

          <Card>
            <h2 className="font-semibold mb-3">Doanh thu theo ngày</h2>
            <div className="grid items-end gap-1" style={{ gridTemplateColumns: `repeat(${data.byDay.length}, 1fr)`, height: 180 }}>
              {data.byDay.map((d) => {
                const h = Math.round((d.revenueVnd / max) * 100);
                return (
                  <div key={d.day} className="flex flex-col items-center gap-1">
                    <div className="w-full rounded bg-primary/40 hover:bg-primary/60 transition" style={{ height: `${h}%`, minHeight: d.revenueVnd > 0 ? "2px" : "0" }} title={`${d.day}: ${fmtVnd(d.revenueVnd)}`} />
                    <span className="text-[10px] text-text-muted">{d.day.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="font-semibold mb-3">Top khách hàng</h2>
              {data.topCustomers.length === 0 ? <p className="text-sm text-text-muted">Chưa có dữ liệu.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-text-muted">
                    <tr><th className="text-left font-normal">Khách</th><th className="text-right font-normal">Tổng VND</th><th className="text-right font-normal">Đơn</th></tr>
                  </thead>
                  <tbody>
                    {data.topCustomers.map((c) => (
                      <tr key={c.customerId} className="border-t border-border-subtle">
                        <td className="py-2">{c.displayName || c.email}</td>
                        <td className="py-2 text-right">{fmtVnd(c.total)}</td>
                        <td className="py-2 text-right text-text-muted">{c.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card>
              <h2 className="font-semibold mb-3">Top models theo upstream cost</h2>
              {data.topModels.length === 0 ? <p className="text-sm text-text-muted">Chưa có usage.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-text-muted">
                    <tr><th className="text-left font-normal">Model</th><th className="text-right font-normal">Cost</th><th className="text-right font-normal">Req</th></tr>
                  </thead>
                  <tbody>
                    {data.topModels.map((m) => (
                      <tr key={`${m.provider}/${m.model}`} className="border-t border-border-subtle">
                        <td className="py-2 font-mono text-xs">{m.provider}/{m.model}</td>
                        <td className="py-2 text-right">{fmtUsd(m.cost)}</td>
                        <td className="py-2 text-right text-text-muted">{m.requests}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
