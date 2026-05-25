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

function formatRateWindow(sec) {
  const s = Number(sec || 0);
  if (s <= 0) return "phút";
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60} phút`;
  return `${s}s`;
}

function formatPlanExpiry(plan) {
  const m = Number(plan?.expiresAfterMinutes || 0);
  const d = Number(plan?.expiresAfterDays || 0);
  if (m > 0) {
    const days = Math.floor(m / 1440);
    const hours = Math.floor((m % 1440) / 60);
    const mins = m % 60;
    const parts = [];
    if (days) parts.push(`${days} ngày`);
    if (hours) parts.push(`${hours}h`);
    if (mins) parts.push(`${mins} phút`);
    return parts.join(" ") || `${m} phút`;
  }
  if (d > 0) return `${d} ngày`;
  return "";
}

function PlanFeatures({ plan }) {
  const items = [];
  if (plan.dailyTokenLimit > 0) items.push(`${formatTokens(plan.dailyTokenLimit)} tokens/ngày`);
  if (plan.monthlyTokenLimit > 0) items.push(`${formatTokens(plan.monthlyTokenLimit)} tokens/tháng`);
  if (plan.lifetimeTokenLimit > 0) items.push(`Tổng ${formatTokens(plan.lifetimeTokenLimit)} tokens`);
  if (plan.requestsPerMinute > 0) items.push(`${plan.requestsPerMinute} req/${formatRateWindow(plan.rateLimitWindowSec)}`);
  if (plan.maxTokensPerRequest > 0) items.push(`max ${formatTokens(plan.maxTokensPerRequest)} tokens/request`);
  const expiryLabel = formatPlanExpiry(plan);
  if (expiryLabel) items.push(`Hết hạn sau ${expiryLabel}`);
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
      {filtered.map((plan) => {
        const limit = Number(plan.maxPurchasesPerCustomer || 0);
        const used = Number(plan.purchasedCount || 0);
        const limitReached = limit > 0 && used >= limit;
        return (
          <div key={plan.id} className="flex flex-col rounded-xl border border-border-subtle bg-surface p-6 transition-colors hover:border-primary/40">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-primary">{plan.kind === "monthly" ? "Hàng tháng" : "Top-up"}</p>
                <h3 className="mt-1 text-lg font-semibold">{plan.name}</h3>
              </div>
              {limit > 0 && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    limitReached
                      ? "bg-amber-500/10 text-amber-600"
                      : "bg-text-muted/10 text-text-muted"
                  }`}
                  title="Số lần bạn đã mua / giới hạn mỗi tài khoản"
                >
                  {used}/{limit} lần
                </span>
              )}
            </div>
            {plan.description && <p className="mt-2 text-sm text-text-muted line-clamp-3">{plan.description}</p>}
            <p className="mt-4 text-3xl font-bold">
              {formatVnd(plan.priceVnd)}
              {plan.kind === "monthly" && <span className="text-sm font-normal text-text-muted"> /tháng</span>}
            </p>
            <PlanFeatures plan={plan} />
            <Link
              href={`/store/plans/${plan.id}`}
              className="mt-4 inline-flex items-center justify-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Xem chi tiết models
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
            {limitReached ? (
              <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-center text-sm text-amber-600">
                Bạn đã mua đủ {limit} lần
              </div>
            ) : (
              <Link
                href={`/store/checkout/${plan.id}`}
                className="mt-6 block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-primary/90"
              >
                Mua ngay
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
