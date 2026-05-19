"use client";

import { useEffect, useState } from "react";

const CHANNEL_META = {
  contactEmail: { icon: "mail", label: "Email", build: (v) => `mailto:${v}` },
  contactPhone: { icon: "call", label: "Hotline", build: (v) => `tel:${String(v).replace(/\s+/g, "")}` },
  contactTelegram: {
    icon: "send", label: "Telegram",
    build: (v) => {
      const s = String(v).trim();
      if (s.startsWith("http")) return s;
      if (s.startsWith("@")) return `https://t.me/${s.slice(1)}`;
      return `https://t.me/${s}`;
    },
  },
  contactZalo: {
    icon: "chat", label: "Zalo",
    build: (v) => {
      const s = String(v).trim();
      if (s.startsWith("http")) return s;
      return `https://zalo.me/${s.replace(/\s+/g, "")}`;
    },
  },
  contactFacebook: { icon: "facebook", label: "Facebook", build: (v) => String(v).startsWith("http") ? v : `https://${v}` },
  contactAddress: { icon: "place", label: "Địa chỉ", build: () => null },
  contactBusinessHours: { icon: "schedule", label: "Giờ làm việc", build: () => null },
};

export default function ContactPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/store/contact", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData({ contact: {}, storeName: "9Router" }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;
  }

  const contact = data?.contact || {};
  const entries = Object.entries(contact).filter(([k]) => CHANNEL_META[k]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Liên hệ với chúng tôi</h1>
        <p className="mt-1 text-sm text-text-muted">
          Cần hỗ trợ về đơn hàng, API key hay tích hợp? Chọn kênh bên dưới — chúng tôi phản hồi sớm nhất có thể.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface p-8 text-center text-sm text-text-muted">
          Chưa có thông tin liên hệ. Quay lại sau nhé!
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map(([key, value]) => {
            const meta = CHANNEL_META[key];
            const href = meta.build ? meta.build(value) : null;
            const card = (
              <div className="flex h-full items-start gap-3 rounded-xl border border-border-subtle bg-surface p-4 transition-colors hover:border-primary">
                <span className="material-symbols-outlined mt-0.5 text-primary">{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide text-text-muted">{meta.label}</p>
                  <p className="mt-1 wrap-break-word text-sm font-medium">{value}</p>
                </div>
              </div>
            );
            if (href) {
              return (
                <a key={key} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="block">
                  {card}
                </a>
              );
            }
            return <div key={key}>{card}</div>;
          })}
        </div>
      )}

      {contact.contactNote && (
        <div className="rounded-xl border border-border-subtle bg-surface p-5">
          <h2 className="font-semibold">Ghi chú</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-muted">{contact.contactNote}</p>
        </div>
      )}
    </div>
  );
}
