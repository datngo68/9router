"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

const TABS = [
  { href: "/store/account", label: "Tổng quan", icon: "dashboard" },
  { href: "/store/account/keys", label: "API Keys", icon: "vpn_key" },
  { href: "/store/account/usage", label: "Usage", icon: "monitoring" },
  { href: "/store/account/orders", label: "Đơn hàng", icon: "receipt_long" },
  { href: "/store/account/notifications", label: "Thông báo", icon: "notifications" },
  { href: "/store/account/referral", label: "Giới thiệu", icon: "redeem" },
  { href: "/store/account/profile", label: "Tài khoản", icon: "person" },
];

export default function AccountLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.customer) {
          router.push(`/store/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        setMe(d.customer);
      })
      .finally(() => setLoading(false));
  }, [pathname, router]);

  async function logout() {
    await fetch("/api/account/logout", { method: "POST" });
    router.push("/store/login");
    router.refresh();
  }

  if (loading) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;
  if (!me) return null;

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface p-3">
        <div className="border-b border-border-subtle px-3 py-3">
          <p className="text-xs uppercase tracking-wide text-text-muted">Đang đăng nhập</p>
          <p className="mt-1 truncate font-medium">{me.displayName || me.email}</p>
          <p className="truncate text-xs text-text-muted">{me.email}</p>
        </div>
        <nav className="mt-2 flex flex-col gap-1">
          {TABS.map((t) => {
            const active = t.href === "/store/account" ? pathname === t.href : pathname?.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-primary text-white" : "text-text-muted hover:bg-surface-2 hover:text-text-main"}`}
              >
                <span className="material-symbols-outlined text-lg">{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="mt-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:bg-red-500/10 hover:text-red-500"
        >
          <span className="material-symbols-outlined text-lg">logout</span>
          Đăng xuất
        </button>
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
