"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, Input, Button } from "@/shared/components";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

export default function AdminCustomerDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  async function load() {
    const r = await fetch(`/api/admin/customers/${id}`, { cache: "no-store" });
    const d = await r.json();
    setData(d);
    setNotes(d.customer?.notes || "");
  }
  useEffect(() => { load(); }, [id]);

  async function saveNotes() {
    const res = await fetch(`/api/admin/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) { setSavedMsg("Đã lưu"); setTimeout(() => setSavedMsg(""), 2000); }
  }

  if (!data) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;
  const { customer, orders, keys } = data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/customers" className="text-sm text-text-muted hover:text-primary">← Tất cả khách</Link>
        <h1 className="mt-2 text-2xl font-semibold">{customer.displayName || customer.email}</h1>
        <p className="text-sm text-text-muted">{customer.email} {customer.phone && `· ${customer.phone}`} {customer.telegramChatId && `· TG ${customer.telegramChatId}`}</p>
      </div>

      <Card>
        <h2 className="font-semibold mb-2">Ghi chú nội bộ</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
          placeholder="Khách doanh nghiệp, ưu tiên kích hoạt nhanh..."
        />
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={saveNotes} size="sm">Lưu ghi chú</Button>
          {savedMsg && <span className="text-sm text-text-muted">{savedMsg}</span>}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Đơn ({orders.length})</h2>
        {orders.length === 0 ? <p className="text-sm text-text-muted">Khách chưa có đơn nào.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr><th className="px-3 py-2 text-left">Mã</th><th className="px-3 py-2 text-right">Tiền</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Tạo lúc</th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-xs">{o.id}</td>
                    <td className="px-3 py-2 text-right">{fmtVnd(o.priceVnd)}</td>
                    <td className="px-3 py-2 text-xs">{o.status}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{fmtTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">API Keys ({keys.length})</h2>
        {keys.length === 0 ? <p className="text-sm text-text-muted">Khách chưa có key nào.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr><th className="px-3 py-2 text-left">Tên</th><th className="px-3 py-2 text-left">Display</th><th className="px-3 py-2 text-right">Daily</th><th className="px-3 py-2 text-right">Monthly</th><th className="px-3 py-2 text-right">Lifetime</th><th className="px-3 py-2 text-left">Active</th></tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2">{k.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{k.keyDisplay}</td>
                    <td className="px-3 py-2 text-right text-xs">{k.dailyTokenLimit || "∞"}</td>
                    <td className="px-3 py-2 text-right text-xs">{k.monthlyTokenLimit || "∞"}</td>
                    <td className="px-3 py-2 text-right text-xs">{k.lifetimeTokenLimit || "∞"}</td>
                    <td className="px-3 py-2 text-xs">{k.isActive ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
