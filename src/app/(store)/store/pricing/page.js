"use client";

import { useState } from "react";
import PlanCardList from "../../components/PlanCardList";

export default function PricingPage() {
  const [tab, setTab] = useState("all");
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-center text-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bảng giá</h1>
        <p className="max-w-xl text-text-muted">Chọn gói phù hợp. Subscription hàng tháng cho team thường xuyên dùng, hoặc topup theo gói tokens nếu chỉ thi thoảng cần.</p>
        <div className="mt-2 inline-flex rounded-lg border border-border p-1">
          {[
            { id: "all", label: "Tất cả" },
            { id: "monthly", label: "Hàng tháng" },
            { id: "topup", label: "Top-up" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === t.id ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <PlanCardList kind={tab === "all" ? undefined : tab} />
    </div>
  );
}
