"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/store/account";
  const initialRef = (params.get("ref") || "").trim().toUpperCase();
  const [form, setForm] = useState({ email: "", password: "", confirmPassword: "", displayName: "", telegramChatId: "", referralCode: initialRef });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function set(field, v) { setForm((f) => ({ ...f, [field]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (form.password.length < 8) { setError("Mật khẩu cần tối thiểu 8 ký tự"); return; }
    if (form.password !== form.confirmPassword) { setError("Nhập lại mật khẩu không khớp"); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Đăng ký thất bại");
        return;
      }
      router.push(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Tạo tài khoản</h1>
        <p className="text-sm text-text-muted">Bạn sẽ nhận key qua email + Telegram (nếu có).</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Email *</span>
          <input
            type="email" required autoComplete="email"
            value={form.email} onChange={(e) => set("email", e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Mật khẩu * <span className="text-xs">(≥ 8 ký tự)</span></span>
          <input
            type="password" required autoComplete="new-password"
            value={form.password} onChange={(e) => set("password", e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Nhập lại mật khẩu *</span>
          <input
            type="password" required autoComplete="new-password"
            value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Tên hiển thị</span>
          <input
            type="text"
            value={form.displayName} onChange={(e) => set("displayName", e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Telegram chat ID <span className="text-xs">(tùy chọn — để nhận key qua Telegram)</span></span>
          <input
            type="text"
            value={form.telegramChatId} onChange={(e) => set("telegramChatId", e.target.value)}
            placeholder="vd: 123456789"
            className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Mã giới thiệu <span className="text-xs">(tùy chọn — nhận token thưởng cho cả hai khi mua đơn đầu)</span></span>
          <input
            type="text"
            value={form.referralCode}
            onChange={(e) => set("referralCode", e.target.value.toUpperCase())}
            placeholder="vd: ABCD1234"
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono uppercase focus:outline-none focus:border-primary"
          />
        </label>
        <a href={`/api/account/google/start?next=${encodeURIComponent(next)}`} className="rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium hover:border-primary hover:text-primary">
          Đăng ký bằng Google
        </a>
        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2.5 font-medium text-white hover:bg-primary/90 disabled:opacity-50">
          {busy ? "Đang xử lý..." : "Đăng ký"}
        </button>
        <p className="text-center text-xs text-text-muted">
          Đã có tài khoản? <Link href="/store/login" className="text-primary hover:underline">Đăng nhập</Link>
        </p>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />}>
      <RegisterForm />
    </Suspense>
  );
}
