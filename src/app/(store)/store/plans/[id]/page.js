"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

function fmtVnd(v) {
  return Number(v || 0).toLocaleString("vi-VN") + "đ";
}

function fmtTokens(n) {
  if (!n || n <= 0) return "Không giới hạn";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function fmtPrice(v) {
  if (v == null) return "—";
  if (v === 0) return "Free";
  return `$${Number(v).toFixed(v < 1 ? 3 : 2)}`;
}

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params?.id;
  const [plan, setPlan] = useState(null);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [models, setModels] = useState([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/store/plans", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = d.plans || [];
        setPlan(list.find((p) => p.id === planId) || null);
      })
      .catch(() => setPlan(null))
      .finally(() => setPlansLoaded(true));

    fetch("/api/store/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setModels(d.models || []))
      .catch(() => setModels([]))
      .finally(() => setModelsLoaded(true));
  }, [planId]);

  // Map allowedModels (full ids like "cx/gpt-5-codex") to enriched model rows.
  // Unknown ids still appear as raw strings so the user knows the exact key
  // their API key will accept.
  const grouped = useMemo(() => {
    if (!plan) return null;
    const allowed = Array.isArray(plan.allowedModels) ? plan.allowedModels : [];
    if (allowed.length === 0) return null; // "all models" — handled separately
    const byFullId = new Map(models.map((m) => [m.fullId, m]));
    const groups = new Map();
    for (const fullId of allowed) {
      const m = byFullId.get(fullId);
      const key = m?.providerAlias || fullId.split("/")[0] || "khác";
      const name = m?.providerName || key;
      if (!groups.has(key)) groups.set(key, { name, alias: key, items: [] });
      groups.get(key).items.push({
        fullId,
        id: m?.id || fullId.split("/").slice(1).join("/") || fullId,
        name: m?.name || fullId.split("/").slice(1).join("/") || fullId,
        kind: m?.kind || "llm",
        input: m?.input ?? null,
        output: m?.output ?? null,
        contextWindow: m?.contextWindow ?? null,
        known: !!m,
      });
    }
    // Sort items inside each group, then groups alphabetically.
    for (const g of groups.values()) {
      g.items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [plan, models]);

  const totalAllowed = plan?.allowedModels?.length || 0;
  const filteredGroups = useMemo(() => {
    if (!grouped) return null;
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (m) => m.fullId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [grouped, search]);

  if (!plansLoaded) {
    return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;
  }

  if (!plan) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-dashed border-border bg-surface p-12 text-center">
        <span className="material-symbols-outlined text-3xl text-text-muted">search_off</span>
        <p className="mt-2 text-text-muted">Không tìm thấy gói.</p>
        <Link href="/store/pricing" className="mt-4 inline-block text-sm text-primary hover:underline">
          ← Quay lại bảng giá
        </Link>
      </div>
    );
  }

  const purchaseLimit = Number(plan.maxPurchasesPerCustomer || 0);
  const purchasedUsed = Number(plan.purchasedCount || 0);
  const limitReached = purchaseLimit > 0 && purchasedUsed >= purchaseLimit;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/store/pricing" className="text-sm text-text-muted hover:text-primary">
        ← Quay lại bảng giá
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div className="flex flex-col gap-6">
          <header className="rounded-xl border border-border-subtle bg-surface p-6">
            <p className="text-xs uppercase tracking-wide text-primary">
              {plan.kind === "monthly" ? "Hàng tháng" : "Top-up"}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{plan.name}</h1>
            {plan.description && (
              <p className="mt-2 text-text-muted">{plan.description}</p>
            )}
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-bold">{fmtVnd(plan.priceVnd)}</span>
              {plan.kind === "monthly" && (
                <span className="text-sm text-text-muted">/tháng</span>
              )}
            </div>
          </header>

          {/* Allowed models */}
          <section className="rounded-xl border border-border-subtle bg-surface p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold">Models được phép</h2>
                <p className="text-sm text-text-muted">
                  {totalAllowed === 0
                    ? "Gói này cho phép tất cả model 9Router hỗ trợ."
                    : `${totalAllowed} model · group theo provider`}
                </p>
              </div>
              {totalAllowed > 0 && (
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm model..."
                  className="w-full sm:w-56 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                />
              )}
            </div>

            {totalAllowed === 0 ? (
              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-text-main">
                <span className="material-symbols-outlined align-middle text-primary mr-1 text-base">
                  check_circle
                </span>
                Bạn có thể dùng mọi model trong{" "}
                <Link href="/store/models" className="text-primary hover:underline">
                  catalog
                </Link>
                .
              </div>
            ) : !modelsLoaded ? (
              <div className="mt-4 h-40 animate-pulse rounded-lg bg-surface-2/60" />
            ) : !filteredGroups || filteredGroups.length === 0 ? (
              <p className="mt-4 text-sm text-text-muted">Không khớp model nào.</p>
            ) : (
              <div className="mt-4 flex flex-col gap-5">
                {filteredGroups.map((group) => (
                  <div key={group.alias}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-semibold text-primary">{group.name}</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        {group.items.length}
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-border-subtle">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                          <tr>
                            <th className="px-3 py-2 text-left">Model</th>
                            <th className="px-3 py-2 text-left">Loại</th>
                            <th className="px-3 py-2 text-right">Input / 1M</th>
                            <th className="px-3 py-2 text-right">Output / 1M</th>
                            <th className="px-3 py-2 text-right">Context</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((m) => (
                            <tr key={m.fullId} className="border-t border-border-subtle">
                              <td className="px-3 py-2">
                                <div className="font-mono text-xs">{m.fullId}</div>
                                {m.known && m.name !== m.id && (
                                  <div className="text-[11px] text-text-muted">{m.name}</div>
                                )}
                                {!m.known && (
                                  <div className="text-[11px] text-amber-600">
                                    Chưa có trong catalog public
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                                  {m.kind}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">{fmtPrice(m.input)}</td>
                              <td className="px-3 py-2 text-right">{fmtPrice(m.output)}</td>
                              <td className="px-3 py-2 text-right text-xs text-text-muted">
                                {m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}k` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-text-muted">
                  Giá tham khảo theo USD / 1 triệu tokens. 9Router quy đổi VND khi tính usage.
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Side column */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-border-subtle bg-surface p-5">
            <h3 className="text-sm font-semibold">Hạn mức &amp; chính sách</h3>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              <Item
                label="Token / ngày"
                value={plan.dailyTokenLimit > 0 ? fmtTokens(plan.dailyTokenLimit) : "Không giới hạn"}
              />
              <Item
                label="Token / tháng"
                value={plan.monthlyTokenLimit > 0 ? fmtTokens(plan.monthlyTokenLimit) : "Không giới hạn"}
              />
              <Item
                label="Lifetime tokens"
                value={plan.lifetimeTokenLimit > 0 ? fmtTokens(plan.lifetimeTokenLimit) : "—"}
              />
              <Item
                label="RPM"
                value={plan.requestsPerMinute > 0 ? `${plan.requestsPerMinute} req/phút` : "Không giới hạn"}
              />
              <Item
                label="Max tokens / request"
                value={
                  plan.maxTokensPerRequest > 0
                    ? `${fmtTokens(plan.maxTokensPerRequest)} tokens`
                    : "Không giới hạn"
                }
              />
              <Item
                label="Hết hạn"
                value={plan.expiresAfterDays > 0 ? `${plan.expiresAfterDays} ngày` : "Không hết hạn"}
              />
              {purchaseLimit > 0 && (
                <Item
                  label="Tối đa / tài khoản"
                  value={`${purchasedUsed}/${purchaseLimit} lần`}
                />
              )}
            </ul>
          </div>

          {limitReached ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-center text-sm text-amber-600">
              Bạn đã mua đủ {purchaseLimit} lần.
            </div>
          ) : (
            <Link
              href={`/store/checkout/${plan.id}`}
              className="rounded-xl bg-primary px-4 py-3 text-center text-sm font-semibold text-white hover:bg-primary/90"
            >
              Mua ngay — {fmtVnd(plan.priceVnd)}
            </Link>
          )}
          <p className="text-xs text-text-muted">
            Sau khi thanh toán, key được phát qua email{" "}
            (kèm Telegram nếu bạn đã liên kết).
          </p>
        </aside>
      </div>
    </div>
  );
}

function Item({ label, value }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </li>
  );
}
