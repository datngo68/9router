"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/account/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <h1 className="text-2xl font-semibold text-center">Quên mật khẩu</h1>
      {done ? (
        <div className="rounded-xl border border-border-subtle bg-surface p-6 text-center text-sm text-text-muted">
          Nếu email tồn tại trong hệ thống, chúng tôi đã gửi link đặt lại mật khẩu (hết hạn sau 1 giờ). Hãy kiểm tra hộp thư.
          <div className="mt-4">
            <Link href="/store/login" className="text-primary hover:underline">Quay lại đăng nhập</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Email tài khoản</span>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary"
            />
          </label>
          <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2.5 font-medium text-white hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Đang gửi..." : "Gửi link đặt lại"}
          </button>
        </form>
      )}
    </div>
  );
}
