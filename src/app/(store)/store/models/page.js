"use client";

import { useEffect, useMemo, useState } from "react";

function fmtPrice(v) {
  if (v == null) return "—";
  if (v === 0) return "Free";
  return `$${Number(v).toFixed(v < 1 ? 3 : 2)}`;
}

export default function ModelsPage() {
  const [models, setModels] = useState(null);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [sort, setSort] = useState("provider");

  useEffect(() => {
    fetch("/api/store/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setModels(d.models || []))
      .catch(() => setModels([]));
  }, []);

  const providers = useMemo(() => {
    if (!models) return [];
    return Array.from(new Set(models.map((m) => m.providerAlias))).sort();
  }, [models]);

  const filtered = useMemo(() => {
    if (!models) return [];
    let list = models;
    if (provider) list = list.filter((m) => m.providerAlias === provider);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) =>
        m.fullId.toLowerCase().includes(q) ||
        (m.name || "").toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      if (sort === "input") return (a.input ?? Infinity) - (b.input ?? Infinity);
      if (sort === "output") return (a.output ?? Infinity) - (b.output ?? Infinity);
      return (a.providerAlias + a.id).localeCompare(b.providerAlias + b.id);
    });
    return list;
  }, [models, provider, search, sort]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Models &amp; Pricing</h1>
        <p className="mt-1 text-text-muted">Tất cả model 9Router hỗ trợ. Giá tính theo USD / 1 triệu tokens (input + output). Quy đổi VND tại thời điểm thanh toán.</p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="Tìm model..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
        />
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
        >
          <option value="">Tất cả provider</option>
          {providers.map((p) => (<option key={p} value={p}>{p}</option>))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
        >
          <option value="provider">Sort: provider</option>
          <option value="input">Sort: input price</option>
          <option value="output">Sort: output price</option>
        </select>
      </div>

      {!models ? (
        <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 text-left">Provider</th>
                <th className="px-4 py-3 text-left">Model</th>
                <th className="px-4 py-3 text-left">Kind</th>
                <th className="px-4 py-3 text-right">Input / 1M</th>
                <th className="px-4 py-3 text-right">Output / 1M</th>
                <th className="px-4 py-3 text-right">Cached</th>
                <th className="px-4 py-3 text-right">Reasoning</th>
                <th className="px-4 py-3 text-right">Context</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.fullId} className="border-t border-border-subtle hover:bg-surface-2">
                  <td className="px-4 py-3">{m.providerName || m.providerAlias}</td>
                  <td className="px-4 py-3 font-mono text-xs">{m.fullId}</td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{m.kind}</span></td>
                  <td className="px-4 py-3 text-right">{fmtPrice(m.input)}</td>
                  <td className="px-4 py-3 text-right">{fmtPrice(m.output)}</td>
                  <td className="px-4 py-3 text-right text-text-muted">{fmtPrice(m.cached)}</td>
                  <td className="px-4 py-3 text-right text-text-muted">{fmtPrice(m.reasoning)}</td>
                  <td className="px-4 py-3 text-right text-xs text-text-muted">{m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}k` : "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-text-muted">Không có model phù hợp.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
