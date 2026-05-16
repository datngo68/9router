"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }

export default function CheckoutPage() {
  const router = useRouter();
  const params = useParams();
  const planId = params?.planId;
  const [me, setMe] = useState(null);
  const [plan, setPlan] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("bank");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/account/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.customer) {
          router.push(`/store/login?next=${encodeURIComponent(`/store/checkout/${planId}`)}`);
          return;
        }
        setMe(d.customer);
      });
    fetch("/api/store/plans", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPlan((d.plans || []).find((p) => p.id === planId) || null));
  }, [planId, router]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, paymentMethod, notes: notes || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Tạo đơn thất bại");
        return;
      }
      router.push(`/store/order/${data.order.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!me || !plan) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href="/store/pricing" className="text-sm text-text-muted hover:text-primary">← Quay lại bảng giá</Link>
      <h1 className="text-2xl font-semibold">Xác nhận đặt hàng</h1>

      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <p className="text-xs uppercase tracking-wide text-primary">{plan.kind === "monthly" ? "Hàng tháng" : "Top-up"}</p>
        <h2 className="mt-1 text-lg font-semibold">{plan.name}</h2>
        {plan.description && <p className="mt-1 text-sm text-text-muted">{plan.description}</p>}
        <div className="mt-4 flex items-end justify-between">
          <span className="text-text-muted text-sm">Tổng cộng</span>
          <span className="text-2xl font-bold">{fmtVnd(plan.priceVnd)}{plan.kind === "monthly" && <span className="text-sm font-normal text-text-muted"> /tháng</span>}</span>
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <h3 className="font-semibold">Phương thức thanh toán</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { id: "bank", label: "Chuyển khoản ngân hàng" },
            { id: "momo", label: "Ví MoMo" },
          ].map((m) => (
            <label key={m.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${paymentMethod === m.id ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" checked={paymentMethod === m.id} onChange={() => setPaymentMethod(m.id)} />
              {m.label}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">Sau khi đặt, hệ thống sẽ hiển thị nội dung chuyển khoản. Admin xác nhận xong sẽ tự động gửi key qua email{me.telegramChatId ? " + Telegram" : ""}.</p>
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <h3 className="font-semibold">Ghi chú (tùy chọn)</h3>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="VD: cần kích hoạt trước 18h hôm nay..."
          className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:border-primary"
        />
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

      <button
        onClick={submit}
        disabled={busy}
        className="rounded-lg bg-primary px-4 py-3 font-medium text-white hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Đang tạo đơn..." : `Đặt đơn — ${fmtVnd(plan.priceVnd)}`}
      </button>
    </div>
  );
}
