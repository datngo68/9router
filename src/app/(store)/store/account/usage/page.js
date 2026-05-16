"use client";

import { useEffect, useState } from "react";

function n(v) { return Number(v || 0).toLocaleString("vi-VN"); }

export default function AccountUsagePage() {
  const [period, setPeriod] = useState("7d");
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/account/usage?period=${period}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }, [period]);

  const max = data ? Math.max(1, ...(data.byDay || []).map((d) => d.promptTokens + d.completionTokens)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Usage</h1>
          <p className="text-sm text-text-muted">Token sử dụng theo ngày, model và key.</p>
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
        <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border-subtle bg-surface p-5">
              <p className="text-xs uppercase text-text-muted">Prompt tokens</p>
              <p className="mt-1 text-xl font-semibold">{n(data.totals?.promptTokens)}</p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-surface p-5">
              <p className="text-xs uppercase text-text-muted">Completion tokens</p>
              <p className="mt-1 text-xl font-semibold">{n(data.totals?.completionTokens)}</p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-surface p-5">
              <p className="text-xs uppercase text-text-muted">Cost ước tính</p>
              <p className="mt-1 text-xl font-semibold">${(data.totals?.cost || 0).toFixed(3)}</p>
            </div>
          </div>

          <div className="rounded-xl border border-border-subtle bg-surface p-6">
            <h2 className="font-semibold">Tokens theo ngày</h2>
            <div className="mt-4 grid items-end gap-1" style={{ gridTemplateColumns: `repeat(${data.byDay.length}, 1fr)`, height: 160 }}>
              {data.byDay.map((d) => {
                const total = d.promptTokens + d.completionTokens;
                const h = Math.round((total / max) * 100);
                return (
                  <div key={d.day} className="flex flex-col items-center gap-1">
                    <div className="w-full rounded bg-primary/40 hover:bg-primary/60 transition" style={{ height: `${h}%`, minHeight: total > 0 ? "2px" : "0" }} title={`${d.day}: ${n(total)}`} />
                    <span className="text-[10px] text-text-muted">{d.day.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border-subtle bg-surface p-6">
              <h2 className="font-semibold">Theo model</h2>
              {data.byModel.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">Chưa có request nào.</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-xs text-text-muted">
                    <tr>
                      <th className="text-left font-normal">Model</th>
                      <th className="text-right font-normal">Tokens</th>
                      <th className="text-right font-normal">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.slice(0, 15).map((m) => (
                      <tr key={m.fullId} className="border-t border-border-subtle">
                        <td className="py-2 font-mono text-xs">{m.fullId}</td>
                        <td className="py-2 text-right">{n(m.promptTokens + m.completionTokens)}</td>
                        <td className="py-2 text-right text-text-muted">{m.requests}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-xl border border-border-subtle bg-surface p-6">
              <h2 className="font-semibold">Theo key</h2>
              {data.byKey.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">Chưa có request nào.</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-xs text-text-muted">
                    <tr>
                      <th className="text-left font-normal">Key</th>
                      <th className="text-right font-normal">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byKey.map((k) => (
                      <tr key={k.apiKeyId} className="border-t border-border-subtle">
                        <td className="py-2"><span className="font-medium">{k.name || "—"}</span> <code className="ml-2 text-xs text-text-muted">{k.keyDisplay}</code></td>
                        <td className="py-2 text-right">{n(k.promptTokens + k.completionTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
