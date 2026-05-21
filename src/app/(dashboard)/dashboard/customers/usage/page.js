"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Input, Button } from "@/shared/components";

function fmtUsd(v) { return `$${Number(v || 0).toFixed(3)}`; }
function fmtNum(v) { return Number(v || 0).toLocaleString("vi-VN"); }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

const PERIODS = [
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "30 ngày" },
  { id: "90d", label: "90 ngày" },
];

const SORT_OPTIONS = [
  { id: "cost", label: "Cost" },
  { id: "tokens", label: "Tokens" },
  { id: "requests", label: "Requests" },
  { id: "lastActive", label: "Hoạt động cuối" },
  { id: "spike", label: "Spike" },
];

function statusBadge(status) {
  const map = {
    ok: "bg-emerald-500/15 text-emerald-500",
    warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    critical: "bg-red-500/15 text-red-500",
    spike: "bg-purple-500/15 text-purple-500",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase ${map[status] || map.ok}`}>
      {status}
    </span>
  );
}

function toQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default function AdminCustomersUsagePage() {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [period, setPeriod] = useState("30d");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("cost");
  const [order, setOrder] = useState("desc");
  const [nearLimit, setNearLimit] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  async function load() {
    setItems(null);
    const url = `/api/admin/customers/usage${toQuery({
      period, q, sort, order, nearLimit: nearLimit || undefined,
      limit: pageSize, offset: (page - 1) * pageSize,
    })}`;
    const res = await fetch(url, { cache: "no-store" });
    const d = await res.json();
    setItems(d.items || []);
    setTotal(d.total || 0);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period, q, sort, order, nearLimit, page]);

  function exportCsv() {
    if (!items || items.length === 0) return;
    const headers = ["Email", "Tên", "Cost (USD)", "Tokens", "Requests", "Top Provider", "Keys Active", "Max Quota %", "Spike", "Status", "Hoạt động cuối"];
    const rows = items.map((r) => [
      r.email || "", r.displayName || "", r.costUsd.toFixed(4), r.totalTokens, r.requests,
      r.topProvider?.name || "", r.keysActive, r.maxKeyUsagePct, r.spikeRatio, r.status, r.lastActiveAt || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers-usage-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/dashboard/customers" className="text-sm text-text-muted hover:text-primary">← Danh sách khách</Link>
        <h1 className="mt-2 text-2xl font-semibold">Usage theo khách hàng</h1>
        <p className="text-sm text-text-muted">Theo dõi lượng sử dụng, phát hiện spike và khách gần limit để đưa ra hướng kinh doanh phù hợp.</p>
      </header>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Input
              label="Tìm kiếm"
              value={q}
              onChange={(e) => { setPage(1); setQ(e.target.value); }}
              placeholder="Email, tên khách..."
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Khoảng thời gian</span>
            <div className="inline-flex rounded-lg border border-border p-1">
              {PERIODS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setPage(1); setPeriod(t.id); }}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${period === t.id ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
                >{t.label}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Sắp xếp</span>
            <select
              value={sort}
              onChange={(e) => { setPage(1); setSort(e.target.value); }}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            >
              {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Thứ tự</span>
            <select
              value={order}
              onChange={(e) => { setPage(1); setOrder(e.target.value); }}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            >
              <option value="desc">Giảm dần</option>
              <option value="asc">Tăng dần</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
            <input type="checkbox" checked={nearLimit} onChange={(e) => { setPage(1); setNearLimit(e.target.checked); }} />
            <span>Chỉ gần limit</span>
          </label>
          <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!items || items.length === 0}>
            Export CSV
          </Button>
        </div>
      </Card>

      <Card>
        {!items ? (
          <div className="h-32 animate-pulse" />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-text-muted">Không có dữ liệu phù hợp.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Khách</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-right">Req</th>
                  <th className="px-3 py-2 text-left">Top Provider</th>
                  <th className="px-3 py-2 text-right">Keys</th>
                  <th className="px-3 py-2 text-right">Quota %</th>
                  <th className="px-3 py-2 text-right">Spike</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-left">Hoạt động cuối</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.customerId} className="border-t border-border-subtle align-middle">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.displayName || r.email}</div>
                      {r.displayName && <div className="text-xs text-text-muted">{r.email}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtUsd(r.costUsd)}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtNum(r.totalTokens)}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtNum(r.requests)}</td>
                    <td className="px-3 py-2 text-xs">{r.topProvider?.name || "—"}</td>
                    <td className="px-3 py-2 text-right text-xs">{r.keysActive}/{r.keysTotal}</td>
                    <td className="px-3 py-2 text-right text-xs">
                      <span className={r.maxKeyUsagePct >= 95 ? "text-red-500 font-medium" : r.maxKeyUsagePct >= 80 ? "text-amber-500" : ""}>
                        {r.maxKeyUsagePct > 0 ? `${r.maxKeyUsagePct}%` : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {r.spikeRatio >= 2 ? (
                        <span className="text-purple-500 font-medium">{r.spikeRatio}x</span>
                      ) : r.spikeRatio > 0 ? `${r.spikeRatio}x` : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">{statusBadge(r.status)}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(r.lastActiveAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/dashboard/customers/${r.customerId}?tab=usage`}
                        className="text-xs text-primary hover:underline"
                      >
                        Chi tiết
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted">
            {total.toLocaleString("vi-VN")} khách · Trang {page}/{totalPages}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>Trước</Button>
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>Sau</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
