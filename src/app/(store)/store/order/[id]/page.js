"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

const STATUS_LABEL = {
  pending: "Chờ thanh toán",
  paid: "Đã nhận thanh toán",
  delivered: "Đã giao key",
  cancelled: "Đã hủy",
  refunded: "Đã hoàn tiền",
};

function PendingPaymentBlock({ order }) {
  const [qr, setQr] = useState(null);
  useEffect(() => {
    fetch(`/api/orders/${order.id}/qr`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then(setQr)
      .catch(() => setQr(null));
  }, [order.id]);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-6">
      <h3 className="font-semibold">Hướng dẫn thanh toán</h3>
      <p className="mt-2 text-sm text-text-muted">
        Quét QR bằng app banking — số tiền <strong className="text-text-main">{fmtVnd(order.priceVnd)}</strong> và nội dung CK đã được điền sẵn.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col items-center gap-3">
          {qr?.url ? (
            <img src={qr.url} alt="VietQR" className="w-full max-w-[280px] rounded-lg border border-border" />
          ) : qr === null ? (
            <div className="aspect-square w-full max-w-[280px] animate-pulse rounded-lg bg-surface-2" />
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-center text-sm text-amber-600">
              Admin chưa cấu hình tài khoản nhận thanh toán. Liên hệ admin để được hướng dẫn.
            </div>
          )}
          <p className="text-[11px] text-text-muted">Mọi app banking VN: Vietcombank, Techcombank, MB, ...</p>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          {qr?.bankName && (
            <Row label="Ngân hàng" value={qr.bankName} />
          )}
          {qr?.accountNo && (
            <Row label="Số tài khoản" value={qr.accountNo} copyable />
          )}
          {qr?.accountName && (
            <Row label="Tên tài khoản" value={qr.accountName} />
          )}
          <Row label="Số tiền" value={fmtVnd(order.priceVnd)} />
          <Row label="Nội dung CK" value={order.id} copyable highlight />
        </div>
      </div>

      <p className="mt-4 text-xs text-text-muted">Giữ nguyên nội dung CK để admin đối chiếu nhanh. Trang tự cập nhật khi đơn được xác nhận.</p>
    </div>
  );
}

function Row({ label, value, copyable, highlight }) {
  function copy() { navigator.clipboard.writeText(value); }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-mono text-sm ${highlight ? "text-primary" : ""}`}>{value}</span>
        {copyable && <button onClick={copy} className="text-xs text-text-muted hover:text-primary">copy</button>}
      </div>
    </div>
  );
}

export default function OrderTrackPage() {
  const params = useParams();
  const id = params?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const r = await fetch(`/api/orders/${id}`, { cache: "no-store" });
        if (r.status === 401) { setError("Vui lòng đăng nhập."); return; }
        const d = await r.json();
        if (!r.ok) { setError(d?.error || "Không tải được đơn"); return; }
        setData(d);
        if (!stop && d.order.status === "pending") {
          setTimeout(poll, 8000);
        }
      } catch (e) {
        setError(e.message);
      }
    }
    poll();
    return () => { stop = true; };
  }, [id]);

  if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-500">{error}</div>;
  if (!data) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;

  const { order, plan, apiKey } = data;
  const status = order.status;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/store/account/orders" className="text-sm text-text-muted hover:text-primary">← Tất cả đơn của tôi</Link>
        <h1 className="mt-2 text-2xl font-semibold">Đơn {order.id}</h1>
        <p className="text-sm text-text-muted">{plan?.name || ""} · {fmtVnd(order.priceVnd)}</p>
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <h3 className="font-semibold">Trạng thái</h3>
        <div className="mt-4 flex flex-col gap-2">
          {["pending", "paid", "delivered"].map((s, i, arr) => {
            const reached = (status === "delivered") || (status === "paid" && s !== "delivered") || (status === "pending" && s === "pending");
            return (
              <div key={s} className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-base ${reached ? "text-primary" : "text-text-muted/40"}`}>{reached ? "check_circle" : "radio_button_unchecked"}</span>
                <span className={`text-sm ${reached ? "text-text-main" : "text-text-muted/60"}`}>{STATUS_LABEL[s]}</span>
                {s === "pending" && <span className="ml-auto text-xs text-text-muted">{fmtTime(order.createdAt)}</span>}
                {s === "paid" && order.paidAt && <span className="ml-auto text-xs text-text-muted">{fmtTime(order.paidAt)}</span>}
                {s === "delivered" && order.deliveredAt && <span className="ml-auto text-xs text-text-muted">{fmtTime(order.deliveredAt)}</span>}
              </div>
            );
          })}
          {status === "cancelled" && <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">Đơn đã bị hủy.</p>}
          {status === "refunded" && <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-500">Đơn đã được hoàn tiền.</p>}
        </div>
      </div>

      {status === "pending" && (
        <PendingPaymentBlock order={order} />
      )}

      {status === "delivered" && apiKey && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
          <h3 className="font-semibold text-primary">Key đã được giao</h3>
          <p className="mt-2 text-sm">Key (rút gọn): <code className="font-mono">{apiKey.keyDisplay}</code></p>
          <p className="mt-1 text-xs text-text-muted">Key đầy đủ đã được gửi qua email của bạn. Có thể quản lý usage trong portal.</p>
          <Link href="/store/account/keys" className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90">
            Mở portal
          </Link>
        </div>
      )}
    </div>
  );
}
