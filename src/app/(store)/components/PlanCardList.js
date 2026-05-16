"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function formatVnd(n) {
  return Number(n || 0).toLocaleString("vi-VN") + "đ";
}

function formatTokens(n) {
  if (!n || n <= 0) return "Không giới hạn";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function PlanFeatures({ plan }) {
  const items = [];
  if (plan.dailyTokenLimit > 0) items.push(`${formatTokens(plan.dailyTokenLimit)} tokens/ngày`);
  if (plan.monthlyTokenLimit > 0) items.push(`${formatTokens(plan.monthlyTokenLimit)} tokens/tháng`);
  if (plan.lifetimeTokenLimit > 0) items.push(`Tổng ${formatTokens(plan.lifetimeTokenLimit)} tokens`);
  if (plan.requestsPerMinute > 0) items.push(`${plan.requestsPerMinute} req/phút`);
  if (plan.maxTokensPerRequest > 0) items.push(`max ${formatTokens(plan.maxTokensPerRequest)} tokens/request`);
  if (plan.expiresAfterDays > 0) items.push(`Hết hạn sau ${plan.expiresAfterDays} ngày`);
  if (plan.allowedModels?.length > 0) items.push(`${plan.allowedModels.length} model được phép`);
  else items.push("Tất cả model");

  return (
    <ul className="mt-4 flex flex-col gap-2 text-sm text-text-muted">
      {items.map((it) => (
        <li key={it} className="flex items-start gap-2">
          <span className="material-symbols-outlined text-primary text-base mt-0.5">check_circle</span>
          {it}
        </li>
      ))}
    </ul>
  );
}

export default function PlanCardList({ limit, kind }) {
  const [plans, setPlans] = useState(null);
  useEffect(() => {
    fetch("/api/store/plans", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []))
      .catch(() => setPlans([]));
  }, []);

  if (!plans) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />
        ))}
      </div>
    );
  }

  let filtered = plans;
  if (kind) filtered = filtered.filter((p) => p.kind === kind);
  if (limit) filtered = filtered.slice(0, limit);

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
        <span className="material-symbols-outlined text-3xl text-text-muted">storefront</span>
        <p className="mt-2 text-text-muted">Chưa có gói nào được công bố.</p>
        <p className="mt-1 text-xs text-text-muted">Vui lòng liên hệ admin hoặc quay lại sau.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filtered.map((plan) => (
        <div key={plan.id} className="flex flex-col rounded-xl border border-border-subtle bg-surface p-6 transition-colors hover:border-primary/40">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-primary">{plan.kind === "monthly" ? "Hàng tháng" : "Top-up"}</p>
              <h3 className="mt-1 text-lg font-semibold">{plan.name}</h3>
            </div>
          </div>
          {plan.description && <p className="mt-2 text-sm text-text-muted line-clamp-3">{plan.description}</p>}
          <p className="mt-4 text-3xl font-bold">
            {formatVnd(plan.priceVnd)}
            {plan.kind === "monthly" && <span className="text-sm font-normal text-text-muted"> /tháng</span>}
          </p>
          <PlanFeatures plan={plan} />
          <Link
            href={`/store/checkout/${plan.id}`}
            className="mt-6 block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-primary/90"
          >
            Mua ngay
          </Link>
        </div>
      ))}
    </div>
  );
}
