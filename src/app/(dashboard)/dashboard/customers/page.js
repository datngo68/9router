"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Input } from "@/shared/components";

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState(null);
  const [search, setSearch] = useState("");

  async function load() {
    const url = search ? `/api/admin/customers?q=${encodeURIComponent(search)}` : "/api/admin/customers";
    const r = await fetch(url, { cache: "no-store" });
    const d = await r.json();
    setCustomers(d.customers || []);
  }
  useEffect(() => { load(); }, [search]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Khách hàng</h1>
        <p className="text-sm text-text-muted">Tổng {customers?.length ?? "..."} khách. Click để xem chi tiết.</p>
      </div>

      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm email, tên hoặc số điện thoại..." />

      <Card>
        {!customers ? (
          <div className="h-32 animate-pulse" />
        ) : customers.length === 0 ? (
          <p className="py-8 text-center text-text-muted">Không có khách phù hợp.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Tên</th>
                  <th className="px-3 py-2 text-left">SĐT</th>
                  <th className="px-3 py-2 text-left">Telegram</th>
                  <th className="px-3 py-2 text-left">Tạo lúc</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2"><Link href={`/dashboard/customers/${c.id}`} className="hover:text-primary">{c.email}</Link></td>
                    <td className="px-3 py-2">{c.displayName || "—"}</td>
                    <td className="px-3 py-2 text-text-muted">{c.phone || "—"}</td>
                    <td className="px-3 py-2 text-text-muted">{c.telegramChatId || "—"}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{new Date(c.createdAt).toLocaleString("vi-VN")}</td>
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
