"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/store/account";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Đăng nhập thất bại");
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
        <h1 className="text-2xl font-semibold">Đăng nhập</h1>
        <p className="text-sm text-text-muted">Truy cập key, usage và đơn của bạn.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Mật khẩu</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
          />
        </label>
        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-primary px-4 py-2.5 font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Đang xử lý..." : "Đăng nhập"}
        </button>
        <div className="flex justify-between text-xs text-text-muted">
          <Link href="/store/forgot" className="hover:text-primary">Quên mật khẩu?</Link>
          <Link href="/store/register" className="hover:text-primary">Tạo tài khoản</Link>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />}>
      <LoginForm />
    </Suspense>
  );
}
