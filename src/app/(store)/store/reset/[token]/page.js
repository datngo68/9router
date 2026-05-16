"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Mật khẩu cần tối thiểu 8 ký tự"); return; }
    if (password !== confirm) { setError("Mật khẩu nhập lại không khớp"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/account/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || "Đặt lại thất bại"); return; }
      setOk(true);
      setTimeout(() => router.push("/store/login"), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <h1 className="text-2xl font-semibold text-center">Đặt lại mật khẩu</h1>
      {ok ? (
        <div className="rounded-xl border border-border-subtle bg-surface p-6 text-center text-sm text-text-muted">
          Đặt lại thành công. Đang chuyển tới trang đăng nhập...
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Mật khẩu mới</span>
            <input
              type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Nhập lại mật khẩu</span>
            <input
              type="password" required value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
            />
          </label>
          {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2.5 font-medium text-white hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Đang xử lý..." : "Đặt lại mật khẩu"}
          </button>
          <p className="text-center text-xs text-text-muted">
            <Link href="/store/login" className="text-primary hover:underline">Quay lại đăng nhập</Link>
          </p>
        </form>
      )}
    </div>
  );
}
