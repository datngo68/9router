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
  const [voucherInput, setVoucherInput] = useState("");
  const [voucher, setVoucher] = useState(null); // { code, discountVnd, finalPriceVnd }
  const [voucherChecking, setVoucherChecking] = useState(false);
  const [voucherError, setVoucherError] = useState("");
  const [wallet, setWallet] = useState(null); // { walletEnabled, balanceVnd }

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
    fetch("/api/account/wallet?limit=1", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setWallet(d ? { walletEnabled: !!d.walletEnabled, balanceVnd: Number(d.balance?.vnd || 0) } : { walletEnabled: false, balanceVnd: 0 }))
      .catch(() => setWallet({ walletEnabled: false, balanceVnd: 0 }));
  }, [planId, router]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, paymentMethod, notes: notes || null, voucherCode: voucher?.code || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Tạo đơn thất bại");
        return;
      }
      // Wallet purchase delivered immediately — stash raw key view-once for
      // the order page to render. Falls through to the same redirect path.
      if (paymentMethod === "wallet" && data.apiKey?.key) {
        try {
          sessionStorage.setItem(
            `order:${data.order.id}:apiKey`,
            JSON.stringify({ key: data.apiKey.key, keyDisplay: data.apiKey.keyDisplay }),
          );
        } catch {}
      }
      router.push(`/store/order/${data.order.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyVoucher() {
    const code = voucherInput.trim().toUpperCase();
    if (!code) return;
    setVoucherChecking(true);
    setVoucherError("");
    try {
      const res = await fetch("/api/vouchers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, planId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setVoucher(null);
        setVoucherError(data?.reason || data?.error || "Mã không hợp lệ");
        return;
      }
      setVoucher({ code: data.code, discountVnd: data.discountVnd, finalPriceVnd: data.finalPriceVnd });
      setVoucherInput(data.code);
    } finally {
      setVoucherChecking(false);
    }
  }

  function clearVoucher() {
    setVoucher(null);
    setVoucherInput("");
    setVoucherError("");
  }

  if (!me || !plan) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;

  const limit = Number(plan.maxPurchasesPerCustomer || 0);
  const used = Number(plan.purchasedCount || 0);
  const limitReached = limit > 0 && used >= limit;
  const payAmount = voucher ? voucher.finalPriceVnd : plan.priceVnd;
  const walletCanPay = !!wallet?.walletEnabled && wallet.balanceVnd >= payAmount;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href="/store/pricing" className="text-sm text-text-muted hover:text-primary">← Quay lại bảng giá</Link>
      <h1 className="text-2xl font-semibold">Xác nhận đặt hàng</h1>

      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <p className="text-xs uppercase tracking-wide text-primary">{plan.kind === "monthly" ? "Hàng tháng" : "Top-up"}</p>
        <h2 className="mt-1 text-lg font-semibold">{plan.name}</h2>
        {plan.description && <p className="mt-1 text-sm text-text-muted">{plan.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-muted">
          <span>
            {plan.allowedModels?.length > 0
              ? `${plan.allowedModels.length} model được phép`
              : "Tất cả model"}
          </span>
          <Link href={`/store/plans/${plan.id}`} className="text-primary hover:underline">
            Xem chi tiết →
          </Link>
        </div>
        {limit > 0 && (
          <p className="mt-3 text-xs text-text-muted">
            Đã mua: <strong>{used}/{limit}</strong> lần (tối đa mỗi tài khoản)
          </p>
        )}
        <div className="mt-4 flex items-end justify-between">
          <span className="text-text-muted text-sm">Giá gốc</span>
          <span className={`text-lg font-medium ${voucher ? "text-text-muted line-through" : ""}`}>
            {fmtVnd(plan.priceVnd)}{plan.kind === "monthly" && <span className="text-sm font-normal text-text-muted"> /tháng</span>}
          </span>
        </div>
        {voucher && (
          <>
            <div className="mt-2 flex items-end justify-between text-sm text-green-600">
              <span>Giảm giá ({voucher.code})</span>
              <span>− {fmtVnd(voucher.discountVnd)}</span>
            </div>
            <div className="mt-2 flex items-end justify-between border-t border-border-subtle pt-3">
              <span className="text-text-muted text-sm">Thanh toán</span>
              <span className="text-2xl font-bold">{fmtVnd(voucher.finalPriceVnd)}</span>
            </div>
          </>
        )}
        {!voucher && (
          <div className="mt-2 flex items-end justify-between border-t border-border-subtle pt-3">
            <span className="text-text-muted text-sm">Tổng cộng</span>
            <span className="text-2xl font-bold">{fmtVnd(plan.priceVnd)}</span>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <h3 className="font-semibold">Mã giảm giá</h3>
        {voucher ? (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2 text-sm">
            <div>
              <p className="font-mono font-medium text-green-600">{voucher.code}</p>
              <p className="text-xs text-text-muted">Đã giảm {fmtVnd(voucher.discountVnd)}</p>
            </div>
            <button onClick={clearVoucher} className="text-xs text-text-muted hover:text-red-500">Bỏ mã</button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <input
              value={voucherInput}
              onChange={(e) => { setVoucherInput(e.target.value.toUpperCase()); setVoucherError(""); }}
              placeholder="Nhập mã, vd: SALE10"
              className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:border-primary"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyVoucher(); } }}
            />
            <button
              onClick={applyVoucher}
              disabled={voucherChecking || !voucherInput.trim()}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              {voucherChecking ? "..." : "Áp dụng"}
            </button>
          </div>
        )}
        {voucherError && <p className="mt-2 text-xs text-red-500">{voucherError}</p>}
      </div>

      {limitReached && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600">
          Bạn đã đạt giới hạn mua gói này ({used}/{limit}). Vui lòng chọn gói khác hoặc liên hệ admin nếu cần thêm.
        </div>
      )}

      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <h3 className="font-semibold">Phương thức thanh toán</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {wallet?.walletEnabled && (
            <label
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 text-sm sm:col-span-2 ${
                paymentMethod === "wallet" ? "border-primary bg-primary/5" : "border-border"
              } ${!walletCanPay ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={paymentMethod === "wallet"}
                  onChange={() => setPaymentMethod("wallet")}
                  disabled={!walletCanPay}
                />
                <span className="material-symbols-outlined text-base">account_balance_wallet</span>
                <span className="font-medium">Trả từ ví</span>
                <span className="ml-auto font-mono text-xs text-text-muted">
                  Số dư: {fmtVnd(wallet.balanceVnd)}
                </span>
              </div>
              {walletCanPay ? (
                <p className="text-xs text-text-muted">
                  Trừ trực tiếp {fmtVnd(payAmount)}, key được phát ngay không cần chờ chuyển khoản.
                </p>
              ) : (
                <p className="text-xs text-amber-600">
                  Số dư không đủ. Cần thêm {fmtVnd(payAmount - wallet.balanceVnd)} —{" "}
                  <Link href="/store/account/wallet" className="underline">nạp ví trước</Link>.
                </p>
              )}
            </label>
          )}
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
        <p className="mt-3 text-xs text-text-muted">
          {paymentMethod === "wallet"
            ? "Số dư ví bị trừ ngay, key cấp tự động — không cần chuyển khoản hay đợi xác nhận."
            : `Sau khi đặt, hệ thống sẽ hiển thị nội dung chuyển khoản. Admin xác nhận xong sẽ tự động gửi key qua email${me.telegramChatId ? " + Telegram" : ""}.`}
        </p>
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
        disabled={busy || limitReached}
        className="rounded-lg bg-primary px-4 py-3 font-medium text-white hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Đang tạo đơn..." : limitReached ? "Đã đạt giới hạn" : `Đặt đơn — ${fmtVnd(voucher ? voucher.finalPriceVnd : plan.priceVnd)}`}
      </button>
    </div>
  );
}
