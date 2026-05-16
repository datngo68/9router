"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/store", label: "Trang chủ" },
  { href: "/store/pricing", label: "Bảng giá" },
  { href: "/store/models", label: "Models" },
  { href: "/store/docs", label: "API Docs" },
];

export default function StoreNav() {
  const pathname = usePathname();
  const [me, setMe] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/account/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMe(d?.customer || null))
      .catch(() => setMe(null));
  }, [pathname]);

  const isActive = (href) => href === "/store" ? pathname === "/store" : pathname?.startsWith(href);

  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/store" className="flex items-center gap-2 font-semibold">
          <span className="material-symbols-outlined text-primary">router</span>
          9Router
        </Link>
        <nav className="hidden items-center gap-2 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${isActive(item.href) ? "text-primary bg-primary/10" : "text-text-muted hover:text-text-main"}`}
            >
              {item.label}
            </Link>
          ))}
          {me ? (
            <Link href="/store/account" className="ml-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90">
              {me.displayName || me.email}
            </Link>
          ) : (
            <>
              <Link href="/store/login" className="px-3 py-1.5 text-sm text-text-muted hover:text-text-main">Đăng nhập</Link>
              <Link href="/store/register" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90">Đăng ký</Link>
            </>
          )}
        </nav>
        <button
          onClick={() => setOpen((v) => !v)}
          className="md:hidden p-2 rounded-lg hover:bg-surface-2"
          aria-label="menu"
        >
          <span className="material-symbols-outlined">{open ? "close" : "menu"}</span>
        </button>
      </div>
      {open && (
        <nav className="border-t border-border-subtle px-4 py-3 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2 text-sm ${isActive(item.href) ? "bg-primary/10 text-primary" : "text-text-muted"}`}
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-2 border-t border-border-subtle pt-2">
            {me ? (
              <Link href="/store/account" className="block rounded-lg px-3 py-2 text-sm font-medium text-primary">{me.displayName || me.email}</Link>
            ) : (
              <>
                <Link href="/store/login" className="block rounded-lg px-3 py-2 text-sm text-text-muted">Đăng nhập</Link>
                <Link href="/store/register" className="block rounded-lg px-3 py-2 text-sm font-medium text-primary">Đăng ký</Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
