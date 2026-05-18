"use client";

import { useEffect, useState } from "react";
import { Card, Button, Modal, Input, ConfirmModal } from "@/shared/components";

const STATUS = ["all", "pending", "paid", "delivered", "cancelled", "refunded"];
const STATUS_COLOR = {
  pending: "bg-amber-500/10 text-amber-500",
  paid: "bg-blue-500/10 text-blue-500",
  delivered: "bg-green-500/10 text-green-500",
  cancelled: "bg-text-muted/10 text-text-muted",
  refunded: "bg-purple-500/10 text-purple-500",
};

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [confirming, setConfirming] = useState(null); // order being confirmed
  const [paymentRef, setPaymentRef] = useState("");
  const [modalKey, setModalKey] = useState(null); // raw key after confirm
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  async function load() {
    const url = filter === "all" ? "/api/admin/orders" : `/api/admin/orders?status=${filter}`;
    const r = await fetch(url, { cache: "no-store" });
    const d = await r.json();
    setOrders(d.orders || []);
  }
  useEffect(() => { load(); }, [filter]);

  async function doConfirm() {
    if (!confirming) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/orders/${confirming.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", paymentRef: paymentRef || null }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data?.error || "Confirm failed"); return; }
      setConfirming(null);
      setPaymentRef("");
      if (data.apiKey?.key) setModalKey({ key: data.apiKey.key, display: data.apiKey.keyDisplay, orderId: confirming.id });
      load();
    } finally { setBusy(false); }
  }

  function askCancel(order) {
    setConfirmDel({
      title: "Hủy đơn",
      message: `Hủy đơn ${order.id}? Khách sẽ phải đặt lại nếu muốn mua.`,
      onConfirm: async () => {
        setConfirmDel(null);
        await fetch(`/api/admin/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        });
        load();
      },
    });
  }

  function askRefund(order) {
    setConfirmDel({
      title: "Đánh dấu refunded",
      message: `Đơn ${order.id} đã hoàn tiền? Việc hoàn tiền thực tế phải xử lý ngoài hệ thống.`,
      onConfirm: async () => {
        setConfirmDel(null);
        await fetch(`/api/admin/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "refund" }),
        });
        load();
      },
    });
  }

  async function reconcileApibank(order) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apibank-reconcile" }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || "Đối soát thất bại");
        return;
      }
      if (data?.ok && data?.apiKey?.key) {
        setModalKey({ key: data.apiKey.key, display: data.apiKey.keyDisplay, orderId: order.id });
      } else if (data?.ok && data?.alreadyDelivered) {
        alert("Đơn đã được giao trước đó.");
      } else if (data?.message) {
        alert(data.message);
      }
      load();
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Đơn hàng</h1>
        <p className="text-sm text-text-muted">Xác nhận thanh toán → tự động tạo key + gửi email/Telegram cho khách.</p>
      </div>

      <div className="inline-flex flex-wrap rounded-lg border border-border p-1 self-start">
        {STATUS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${filter === s ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
          >{s}</button>
        ))}
      </div>

      <Card>
        {!orders ? (
          <div className="h-32 animate-pulse" />
        ) : orders.length === 0 ? (
          <p className="py-8 text-center text-text-muted">Không có đơn nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Mã</th>
                  <th className="px-3 py-2 text-left">Khách</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-right">Tiền</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Tạo lúc</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-xs">{o.id}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{o.customerId.slice(0, 8)}...</td>
                    <td className="px-3 py-2 text-xs">{o.planId.slice(0, 8)}...</td>
                    <td className="px-3 py-2 text-right">{fmtVnd(o.priceVnd)}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_COLOR[o.status] || ""}`}>{o.status}</span></td>
                    <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(o.createdAt)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {o.status === "pending" && (
                        <>
                          <button onClick={() => setConfirming(o)} className="mr-1 rounded border border-green-500/40 bg-green-500/10 px-2 py-1 text-xs text-green-600 hover:bg-green-500/20">Confirm</button>
                          {o.apibankOrderId && (
                            <button
                              onClick={() => reconcileApibank(o)}
                              disabled={busy}
                              className="mr-1 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-xs text-blue-600 hover:bg-blue-500/20"
                              title="Hỏi APIBank trạng thái thật rồi gạch nợ nếu đã paid"
                            >
                              Đối soát APIBank
                            </button>
                          )}
                          <button onClick={() => askCancel(o)} className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-red-500">Cancel</button>
                        </>
                      )}
                      {o.status === "delivered" && (
                        <button onClick={() => askRefund(o)} className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-purple-500">Refund</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal isOpen={!!confirming} onClose={() => setConfirming(null)} title={`Xác nhận đơn ${confirming?.id}`}>
        {confirming && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Khi xác nhận, hệ thống sẽ <strong>tạo API key</strong> theo policy của plan và gửi qua email/Telegram cho khách.
            </p>
            <Input
              label="Payment reference (số CK / mã GD)"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="VD: VCB-FT2026..."
            />
            <div className="flex gap-2">
              <Button onClick={doConfirm} fullWidth disabled={busy}>{busy ? "Đang xử lý..." : "Xác nhận & Phát key"}</Button>
              <Button onClick={() => setConfirming(null)} variant="ghost" fullWidth disabled={busy}>Hủy</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!modalKey} onClose={() => setModalKey(null)} title="Key đã được phát">
        {modalKey && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Khách đã nhận key qua email{modalKey.viaTelegram ? " + Telegram" : ""}. Đây cũng là lần duy nhất bạn thấy key đầy đủ ở đây.
            </p>
            <pre className="break-all rounded-lg bg-surface-2 p-4 font-mono text-sm">{modalKey.key}</pre>
            <Button onClick={() => { navigator.clipboard.writeText(modalKey.key); }}>Copy</Button>
            <Button onClick={() => setModalKey(null)} variant="ghost">Đóng</Button>
          </div>
        )}
      </Modal>

      <ConfirmModal isOpen={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={confirmDel?.onConfirm} title={confirmDel?.title} message={confirmDel?.message} variant="danger" />
    </div>
  );
}
