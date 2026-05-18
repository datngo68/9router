"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/shared/components";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtUsd(v) { return `$${Number(v || 0).toFixed(3)}`; }
function fmtNum(v) { return Number(v || 0).toLocaleString("vi-VN"); }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }
function daysSince(iso) {
  if (!iso) return null;
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  return Math.max(0, Math.floor(d));
}

const PERIODS = [
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "30 ngày" },
  { id: "90d", label: "90 ngày" },
];

export default function AdminCustomersAnalyticsPage() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/admin/customers/analytics?period=${period}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: true }));
  }, [period]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/customers" className="text-sm text-text-muted hover:text-primary">← Danh sách khách</Link>
          <h1 className="mt-2 text-2xl font-semibold">Customer Analytics</h1>
          <p className="text-sm text-text-muted">Tổng quan khách hàng, top spender, top usage và churn risk.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border p-1">
          {PERIODS.map((t) => (
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
      ) : data.error ? (
        <Card><p className="text-center text-red-500">Không tải được dữ liệu analytics.</p></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Tổng khách" value={fmtNum(data.stats.totalCustomers)} />
            <StatCard label="Active 30 ngày" value={fmtNum(data.stats.activeLast30d)} hint={`${data.stats.totalCustomers ? Math.round((data.stats.activeLast30d / data.stats.totalCustomers) * 100) : 0}% tổng`} />
            <StatCard label="Khách mới 30 ngày" value={fmtNum(data.stats.newLast30d)} />
            <StatCard label="LTV (mọi đơn delivered)" value={fmtVnd(data.stats.totalLtvVnd)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <LeaderboardCard
              title="Top spender"
              hint={`Tổng VND đơn delivered trong ${period}`}
              empty="Chưa có đơn nào trong khoảng thời gian này."
              rows={data.topSpenders}
              columns={[
                { header: "Khách", render: (r) => (
                  <Link href={`/dashboard/customers/${r.customerId}`} className="hover:text-primary">
                    {r.displayName || r.email}
                  </Link>
                ) },
                { header: "Tổng VND", align: "right", render: (r) => fmtVnd(r.totalVnd) },
                { header: "Đơn", align: "right", muted: true, render: (r) => fmtNum(r.orders) },
              ]}
            />
            <LeaderboardCard
              title="Top usage (cost upstream)"
              hint={`Tổng cost USD trong ${period}, JOIN apiKeys → usageHistory`}
              empty="Chưa có usage trong khoảng thời gian này."
              rows={data.topUsage}
              columns={[
                { header: "Khách", render: (r) => (
                  <Link href={`/dashboard/customers/${r.customerId}`} className="hover:text-primary">
                    {r.displayName || r.email}
                  </Link>
                ) },
                { header: "Cost", align: "right", render: (r) => fmtUsd(r.costUsd) },
                { header: "Req", align: "right", muted: true, render: (r) => fmtNum(r.requests) },
              ]}
            />
          </div>

          <Card>
            <div className="mb-3">
              <h2 className="font-semibold">Churn risk</h2>
              <p className="text-xs text-text-muted">Khách có LTV &gt; 0 và không hoạt động trong {data.inactiveDays} ngày gần nhất.</p>
            </div>
            {data.churnRisk.length === 0 ? (
              <p className="text-center text-sm text-text-muted py-6">Không có khách nào trong nhóm này.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Khách</th>
                      <th className="px-3 py-2 text-right">LTV (VND)</th>
                      <th className="px-3 py-2 text-left">Hoạt động cuối</th>
                      <th className="px-3 py-2 text-right">Im lặng (ngày)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.churnRisk.map((r) => (
                      <tr key={r.customerId} className="border-t border-border-subtle">
                        <td className="px-3 py-2">
                          <Link href={`/dashboard/customers/${r.customerId}`} className="hover:text-primary">
                            {r.displayName || r.email}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right">{fmtVnd(r.ltvVnd)}</td>
                        <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(r.lastActiveAt)}</td>
                        <td className="px-3 py-2 text-right text-xs">{daysSince(r.lastActiveAt) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <Card>
      <p className="text-xs uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </Card>
  );
}

function LeaderboardCard({ title, hint, empty, rows, columns }) {
  return (
    <Card>
      <div className="mb-3">
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
      {!rows || rows.length === 0 ? (
        <p className="text-center text-sm text-text-muted py-6">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-text-muted">
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={`pb-2 font-normal ${c.align === "right" ? "text-right" : "text-left"}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.customerId || idx} className="border-t border-border-subtle">
                {columns.map((c, i) => (
                  <td key={i} className={`py-2 ${c.align === "right" ? "text-right" : "text-left"} ${c.muted ? "text-text-muted text-xs" : ""}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
