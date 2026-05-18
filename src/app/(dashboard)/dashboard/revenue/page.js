"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtUsd(v) { return `$${Number(v || 0).toFixed(3)}`; }
function fmtVndShort(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

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
            <div style={{ width: "100%", height: 340 }}>
              <ResponsiveContainer>
                <BarChart data={data.byDay} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(d) => d.slice(5)}
                    tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
                    stroke="var(--color-border)"
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis
                    tickFormatter={fmtVndShort}
                    tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
                    stroke="var(--color-border)"
                    width={60}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--color-surface-2)", opacity: 0.4 }}
                    contentStyle={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "var(--color-text-muted)" }}
                    formatter={(value, _name, item) => [
                      fmtVnd(value),
                      `Doanh thu (${item?.payload?.orders ?? 0} đơn)`,
                    ]}
                    labelFormatter={(d) => `Ngày ${d}`}
                  />
                  <Bar dataKey="revenueVnd" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
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
