"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/shared/components";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtNum(v) { return Number(v || 0).toLocaleString("vi-VN"); }
function fmtVndShort(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const PERIODS = [
  { id: "today", label: "Hôm nay" },
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "30 ngày" },
  { id: "90d", label: "90 ngày" },
];

export default function AdminWalletPage() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/admin/wallet?period=${period}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: "Không tải được dữ liệu ví" }));
  }, [period]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Wallet &amp; PAYG</h1>
          <p className="text-sm text-text-muted">
            Tổng quan dòng tiền ví VND và doanh thu từ pay-as-you-go.{" "}
            <Link href="/dashboard/payg-pricing" className="text-primary hover:underline">PAYG pricing →</Link>
          </p>
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
        <Card><p className="text-red-500">{data.error}</p></Card>
      ) : (
        <>
          {/* Period totals */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Tiền nạp ví"
              value={fmtVnd(data.totals.topupVnd)}
              hint={`${fmtNum(data.totals.txCount)} giao dịch`}
              tone="emerald"
              icon="trending_up"
            />
            <StatCard
              label="Tiền tiêu (PAYG)"
              value={fmtVnd(data.totals.chargeVnd)}
              hint="Trừ ví cho request API"
              tone="primary"
              icon="bolt"
            />
            <StatCard
              label="Mua gói qua ví"
              value={fmtVnd(data.totals.planPurchaseVnd)}
              hint="Trả gói trực tiếp từ ví"
              tone="primary"
              icon="shopping_cart"
            />
            <StatCard
              label="Hoàn / Điều chỉnh"
              value={fmtVnd(data.totals.refundVnd + data.totals.adjustmentCreditVnd - data.totals.adjustmentDebitVnd)}
              hint={`Hoàn ${fmtVnd(data.totals.refundVnd)} · ĐC ${fmtVnd(data.totals.adjustmentCreditVnd - data.totals.adjustmentDebitVnd)}`}
              tone="amber"
              icon="undo"
            />
          </div>

          {/* Float snapshot — wallet liability owed to customers right now */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <p className="text-xs uppercase text-text-muted">Số dư ví đang nợ khách</p>
              <p className="mt-1 text-3xl font-semibold">{fmtVnd(data.snapshot.positiveVnd)}</p>
              <p className="mt-1 text-xs text-text-muted">{fmtNum(data.snapshot.positiveCount)} khách có số dư &gt; 0</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-text-muted">Khách đang âm (overdraft)</p>
              <p className="mt-1 text-3xl font-semibold">{fmtVnd(data.snapshot.negativeVnd)}</p>
              <p className="mt-1 text-xs text-text-muted">{fmtNum(data.snapshot.negativeCount)} khách đang âm số dư</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-text-muted">Key bật PAYG</p>
              <p className="mt-1 text-3xl font-semibold">{fmtNum(data.paygKeys.active)}<span className="text-base font-normal text-text-muted">/{fmtNum(data.paygKeys.total)}</span></p>
              <p className="mt-1 text-xs text-text-muted">Active / tổng key đã bật fallback PAYG</p>
            </Card>
          </div>

          {/* Daily chart */}
          <Card>
            <h2 className="font-semibold mb-3">Dòng tiền ví theo ngày</h2>
            <div style={{ width: "100%", height: 320 }}>
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
                    formatter={(value, name) => [fmtVnd(value), name === "creditVnd" ? "Nạp" : "Tiêu"]}
                    labelFormatter={(d) => `Ngày ${d}`}
                  />
                  <Legend
                    formatter={(name) => name === "creditVnd" ? "Nạp" : "Tiêu"}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="creditVnd" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="debitVnd" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Top customers + models */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="font-semibold mb-3">Top khách tiêu nhiều ví</h2>
              <CustomerTable rows={data.topCustomers} valueLabel="Tổng tiêu" />
            </Card>
            <Card>
              <h2 className="font-semibold mb-3">Top khách dùng PAYG</h2>
              <CustomerTable rows={data.topPaygCustomers} valueLabel="PAYG charge" />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="font-semibold mb-3">Top model tiêu ví (PAYG)</h2>
              {!data.topModels.length ? (
                <p className="text-sm text-text-muted">Chưa có request PAYG nào trong khoảng thời gian này.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-text-muted">
                    <tr>
                      <th className="text-left font-normal pb-2">Model</th>
                      <th className="text-right font-normal pb-2">Tổng VND</th>
                      <th className="text-right font-normal pb-2">Tokens</th>
                      <th className="text-right font-normal pb-2">Req</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topModels.map((m) => (
                      <tr key={`${m.provider}/${m.model}`} className="border-t border-border-subtle">
                        <td className="py-2 font-mono text-xs">{m.provider}/{m.model}</td>
                        <td className="py-2 text-right">{fmtVnd(m.debitVnd)}</td>
                        <td className="py-2 text-right text-xs text-text-muted">{fmtNum(m.promptTokens + m.completionTokens)}</td>
                        <td className="py-2 text-right text-xs text-text-muted">{fmtNum(m.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card>
              <h2 className="font-semibold mb-3">Khách có số dư cao nhất</h2>
              {!data.snapshot.top.length ? (
                <p className="text-sm text-text-muted">Chưa có khách nào có số dư.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-text-muted">
                    <tr>
                      <th className="text-left font-normal pb-2">Khách</th>
                      <th className="text-right font-normal pb-2">Số dư</th>
                      <th className="text-right font-normal pb-2">Min limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.snapshot.top.slice(0, 12).map((c) => (
                      <tr key={c.id} className="border-t border-border-subtle">
                        <td className="py-2">
                          <Link href={`/dashboard/customers/${c.id}?tab=wallet`} className="hover:text-primary truncate block max-w-[180px]">
                            {c.displayName || c.email}
                          </Link>
                        </td>
                        <td className={`py-2 text-right font-mono ${c.balanceVnd < 0 ? "text-red-500" : ""}`}>
                          {fmtVnd(c.balanceVnd)}
                        </td>
                        <td className="py-2 text-right text-xs text-text-muted font-mono">
                          {c.balanceMinLimitVnd !== 0 ? fmtVnd(c.balanceMinLimitVnd) : "—"}
                        </td>
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

function StatCard({ label, value, hint, tone = "primary", icon }) {
  const palette =
    tone === "emerald" ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "amber" ? "border-amber-500/30 bg-amber-500/5"
      : tone === "primary" ? "border-primary/20 bg-primary/5"
      : "border-border-subtle bg-surface";
  return (
    <div className={`rounded-xl border p-5 ${palette}`}>
      <div className="flex items-center gap-2">
        {icon && <span className="material-symbols-outlined text-base">{icon}</span>}
        <p className="text-xs uppercase text-text-muted">{label}</p>
      </div>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

function CustomerTable({ rows, valueLabel }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-text-muted">Chưa có dữ liệu.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-text-muted">
        <tr>
          <th className="text-left font-normal pb-2">Khách</th>
          <th className="text-right font-normal pb-2">{valueLabel}</th>
          <th className="text-right font-normal pb-2">Số dư</th>
          <th className="text-right font-normal pb-2">Tx</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.customerId} className="border-t border-border-subtle">
            <td className="py-2">
              <Link href={`/dashboard/customers/${c.customerId}?tab=wallet`} className="hover:text-primary truncate block max-w-[200px]">
                {c.displayName || c.email}
              </Link>
            </td>
            <td className="py-2 text-right">{fmtVnd(c.valueVnd)}</td>
            <td className={`py-2 text-right font-mono text-xs ${c.balanceVnd < 0 ? "text-red-500" : "text-text-muted"}`}>
              {fmtVnd(c.balanceVnd)}
            </td>
            <td className="py-2 text-right text-xs text-text-muted">{fmtNum(c.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
