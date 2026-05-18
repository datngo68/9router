"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";

function fmtPrice(v) {
  if (v == null) return "—";
  if (v === 0) return "Free";
  return `$${Number(v).toFixed(v < 1 ? 3 : 2)}`;
}

function fmtCtx(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const KIND_LABELS = {
  llm: "Chat",
  image: "Image",
  imageToText: "Vision",
  embedding: "Embedding",
  tts: "TTS",
  stt: "STT",
  webSearch: "Search",
  webFetch: "Fetch",
};

function KindBadge({ kind }) {
  const label = KIND_LABELS[kind] || kind;
  const color =
    kind === "image" || kind === "imageToText" ? "bg-purple-500/10 text-purple-600"
    : kind === "embedding" ? "bg-emerald-500/10 text-emerald-600"
    : kind === "tts" || kind === "stt" ? "bg-amber-500/10 text-amber-600"
    : kind === "webSearch" || kind === "webFetch" ? "bg-sky-500/10 text-sky-600"
    : "bg-primary/10 text-primary";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>{label}</span>
  );
}

export default function ModelsPage() {
  const [data, setData] = useState(null); // { models, unrestricted }
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState("");

  useEffect(() => {
    fetch("/api/store/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData({ models: d.models || [], unrestricted: !!d.unrestricted }))
      .catch(() => setData({ models: [], unrestricted: false }));
  }, []);

  const models = data?.models || null;

  const providers = useMemo(() => {
    if (!models) return [];
    const map = new Map();
    for (const m of models) {
      if (!map.has(m.providerAlias)) {
        map.set(m.providerAlias, { alias: m.providerAlias, name: m.providerName, count: 0 });
      }
      map.get(m.providerAlias).count += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [models]);

  const kinds = useMemo(() => {
    if (!models) return [];
    return Array.from(new Set(models.map((m) => m.kind))).sort();
  }, [models]);

  const groups = useMemo(() => {
    if (!models) return [];
    const q = search.trim().toLowerCase();
    const filtered = models.filter((m) => {
      if (provider && m.providerAlias !== provider) return false;
      if (kind && m.kind !== kind) return false;
      if (q && !m.fullId.toLowerCase().includes(q) && !(m.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
    const map = new Map();
    for (const m of filtered) {
      if (!map.has(m.providerAlias)) {
        map.set(m.providerAlias, {
          alias: m.providerAlias,
          name: m.providerName,
          color: m.providerColor,
          items: [],
        });
      }
      map.get(m.providerAlias).items.push(m);
    }
    for (const g of map.values()) g.items.sort((a, b) => a.name.localeCompare(b.name));
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [models, search, provider, kind]);

  const totalShown = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Catalog model</h1>
        <p className="mt-1 text-text-muted">
          Danh sách model có trong các gói 9Router đang bán. Giá tham khảo theo USD / 1 triệu tokens — quy đổi VND tại thời điểm thanh toán.
        </p>
        {data && data.unrestricted && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
            <span className="material-symbols-outlined text-[14px]">all_inclusive</span>
            Có gói cho phép dùng mọi model — toàn bộ catalog đang được phục vụ.
          </p>
        )}
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Tìm model theo tên hoặc id..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
        >
          <option value="">Tất cả provider ({providers.length})</option>
          {providers.map((p) => (
            <option key={p.alias} value={p.alias}>{p.name} ({p.count})</option>
          ))}
        </select>
        {kinds.length > 1 && (
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Mọi loại</option>
            {kinds.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k] || k}</option>
            ))}
          </select>
        )}
      </div>

      {!models ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-border-subtle bg-surface" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-text-muted">search_off</span>
          <p className="mt-2 text-text-muted">Không có model phù hợp.</p>
          {models.length === 0 && (
            <p className="mt-1 text-xs text-text-muted">
              Chưa có gói nào active. Quay lại{" "}
              <Link href="/store/pricing" className="text-primary hover:underline">trang bảng giá</Link>.
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            Hiện {totalShown} model trong {groups.length} provider.
          </p>
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.alias} className="rounded-xl border border-border-subtle bg-surface">
                <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
                  <ProviderIcon
                    src={`/providers/${group.alias}.png`}
                    alt={group.name}
                    size={28}
                    fallbackText={(group.name || group.alias).slice(0, 2).toUpperCase()}
                    fallbackColor={group.color}
                    className="rounded-md"
                  />
                  <div className="flex-1">
                    <h2 className="text-sm font-semibold">{group.name}</h2>
                    <p className="text-[11px] text-text-muted">{group.items.length} model</p>
                  </div>
                </header>
                <div className="grid gap-px bg-border-subtle/40 sm:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((m) => (
                    <ModelCard key={m.fullId} model={m} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ModelCard({ model: m }) {
  const ctx = fmtCtx(m.contextWindow);
  return (
    <div className="flex flex-col gap-2 bg-surface p-4 transition-colors hover:bg-surface-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={m.name}>{m.name}</div>
          <div className="truncate font-mono text-[11px] text-text-muted" title={m.fullId}>{m.fullId}</div>
        </div>
        <KindBadge kind={m.kind} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Input</span>
          <span className="font-medium">{fmtPrice(m.input)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Output</span>
          <span className="font-medium">{fmtPrice(m.output)}</span>
        </div>
        {m.cached != null && (
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Cached</span>
            <span className="font-medium">{fmtPrice(m.cached)}</span>
          </div>
        )}
        {ctx && (
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Context</span>
            <span className="font-medium">{ctx}</span>
          </div>
        )}
      </div>

      {m.plans && m.plans.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.plans.slice(0, 3).map((p) => (
            <Link
              key={p.id}
              href={`/store/plans/${p.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
              title={`Xem chi tiết gói ${p.name}`}
            >
              <span className="material-symbols-outlined text-[11px]">sell</span>
              {p.name}
            </Link>
          ))}
          {m.plans.length > 3 && (
            <span className="rounded-full bg-text-muted/10 px-2 py-0.5 text-[10px] text-text-muted">
              +{m.plans.length - 3} gói
            </span>
          )}
        </div>
      )}
    </div>
  );
}
