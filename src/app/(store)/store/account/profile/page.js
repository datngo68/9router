"use client";

import { useEffect, useState } from "react";

export default function ProfilePage() {
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({ displayName: "", phone: "", telegramChatId: "" });
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [link, setLink] = useState(null);
  const [linkErr, setLinkErr] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [twoFa, setTwoFa] = useState({ secret: "", otpauthUrl: "", code: "", msg: "" });

  async function loadMe() {
    const d = await fetch("/api/account/me", { cache: "no-store" }).then((r) => r.json());
    if (d?.customer) {
      setMe(d.customer);
      setForm({
        displayName: d.customer.displayName || "",
        phone: d.customer.phone || "",
        telegramChatId: d.customer.telegramChatId || "",
      });
    }
  }
  useEffect(() => { loadMe(); }, []);

  // Modal mở ra khi thiếu Telegram, có thể bật lên bất kỳ lúc nào.
  useEffect(() => {
    if (me && !me.telegramChatId) setShowLink(true);
  }, [me]);

  async function startLink() {
    setLinkBusy(true);
    setLinkErr("");
    setLink(null);
    try {
      const res = await fetch("/api/account/telegram/link", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setLinkErr(d?.error || "Không tạo được link"); return; }
      setLink(d);
      // Bắt đầu polling /api/account/me để biết khi nào webhook đã liên kết
      const stop = Date.now() + 5 * 60 * 1000;
      const poll = setInterval(async () => {
        if (Date.now() > stop) { clearInterval(poll); return; }
        const r = await fetch("/api/account/me", { cache: "no-store" });
        const dd = await r.json();
        if (dd?.customer?.telegramChatId) {
          clearInterval(poll);
          setMe(dd.customer);
          setForm((f) => ({ ...f, telegramChatId: dd.customer.telegramChatId || "" }));
          setShowLink(false);
          setLink(null);
        }
      }, 3000);
    } finally {
      setLinkBusy(false);
    }
  }

  async function unlinkTelegram() {
    if (!confirm("Hủy liên kết Telegram?")) return;
    await fetch("/api/account/telegram/link", { method: "DELETE" });
    await loadMe();
  }

  async function save() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: form.displayName, phone: form.phone }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data?.error || "Cập nhật thất bại"); return; }
      setMe(data.customer);
      setMsg("Đã lưu");
    } finally { setBusy(false); }
  }

  async function setup2fa() {
    setTwoFa((v) => ({ ...v, msg: "" }));
    const res = await fetch("/api/account/2fa/setup", { method: "POST" });
    const data = await res.json();
    if (!res.ok) { setTwoFa((v) => ({ ...v, msg: data?.error || "Không tạo được 2FA" })); return; }
    setTwoFa({ secret: data.secret, otpauthUrl: data.otpauthUrl, code: "", msg: "Quét mã bằng Google Authenticator/Authy rồi nhập mã 6 số." });
  }

  async function verify2fa() {
    const res = await fetch("/api/account/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: twoFa.code }),
    });
    const data = await res.json();
    if (!res.ok) { setTwoFa((v) => ({ ...v, msg: data?.error || "Mã không hợp lệ" })); return; }
    setMe(data.customer);
    setTwoFa({ secret: "", otpauthUrl: "", code: "", msg: "Đã bật xác thực hai lớp." });
  }

  async function disable2fa() {
    const code = prompt("Nhập mã 2FA hiện tại để tắt");
    if (code === null) return;
    const res = await fetch("/api/account/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) { setTwoFa((v) => ({ ...v, msg: data?.error || "Không tắt được 2FA" })); return; }
    setMe(data.customer);
    setTwoFa({ secret: "", otpauthUrl: "", code: "", msg: "Đã tắt xác thực hai lớp." });
  }

  async function changePassword() {
    setPwdMsg("");
    if (pwd.next.length < 8) { setPwdMsg("Mật khẩu mới cần tối thiểu 8 ký tự"); return; }
    if (pwd.next !== pwd.confirm) { setPwdMsg("Nhập lại không khớp"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwd.current, newPassword: pwd.next }),
      });
      const data = await res.json();
      if (!res.ok) { setPwdMsg(data?.error || "Đổi mật khẩu thất bại"); return; }
      setPwd({ current: "", next: "", confirm: "" });
      setPwdMsg("Đã đổi mật khẩu. Các phiên khác đã bị đăng xuất.");
    } finally { setBusy(false); }
  }

  if (!me) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Tài khoản</h1>
        <p className="text-sm text-text-muted">Email <code className="text-primary">{me.email}</code> không thể thay đổi.</p>
      </header>

      <section className="rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Telegram</h2>
            <p className="text-sm text-text-muted">{me.telegramChatId ? `Đã liên kết · chat ID: ${me.telegramChatId}` : "Chưa liên kết Telegram. Bạn sẽ không nhận được key/đơn qua chat."}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowLink(true)} className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20">
              {me.telegramChatId ? "Liên kết lại" : "Liên kết ngay"}
            </button>
            {me.telegramChatId && (
              <button onClick={unlinkTelegram} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-red-500">Hủy liên kết</button>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Xác thực hai lớp</h2>
            <p className="text-sm text-text-muted">{me.totpEnabled ? "Đã bật 2FA bằng ứng dụng xác thực." : "Bảo vệ đăng nhập bằng mã 6 số từ Google Authenticator/Authy."}</p>
          </div>
          {me.totpEnabled ? (
            <button onClick={disable2fa} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-red-500">Tắt 2FA</button>
          ) : (
            <button onClick={setup2fa} className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20">Bật 2FA</button>
          )}
        </div>
        {twoFa.otpauthUrl && (
          <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2 p-4">
            <img alt="2FA QR" src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(twoFa.otpauthUrl)}`} className="rounded-lg border border-border" />
            <p className="mt-3 break-all text-xs text-text-muted">Secret: {twoFa.secret}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input value={twoFa.code} onChange={(e) => setTwoFa({ ...twoFa, code: e.target.value })} placeholder="Mã 6 số" className="rounded-lg border border-border bg-bg px-3 py-2" />
              <button onClick={verify2fa} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90">Xác nhận bật</button>
            </div>
          </div>
        )}
        {twoFa.msg && <p className="mt-3 text-sm text-text-muted">{twoFa.msg}</p>}
      </section>

      <section className="rounded-xl border border-border-subtle bg-surface p-6">
        <h2 className="font-semibold">Thông tin liên lạc</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Tên hiển thị</span>
            <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Số điện thoại</span>
            <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">Lưu</button>
          {msg && <span className="text-sm text-text-muted">{msg}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-border-subtle bg-surface p-6">
        <h2 className="font-semibold">Đổi mật khẩu</h2>
        <p className="text-sm text-text-muted">Sau khi đổi, các phiên khác sẽ bị đăng xuất.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <input type="password" placeholder="Mật khẩu hiện tại" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
          <input type="password" placeholder="Mật khẩu mới" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
          <input type="password" placeholder="Nhập lại mật khẩu" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} className="rounded-lg border border-border bg-bg px-3 py-2" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={changePassword} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">Đổi mật khẩu</button>
          {pwdMsg && <span className="text-sm text-text-muted">{pwdMsg}</span>}
        </div>
      </section>

      {showLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLink(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-border bg-bg p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Liên kết Telegram</h3>
            <p className="mt-2 text-sm text-text-muted">Chỉ cần 1 bước: nhấn nút bên dưới, Telegram mở ra, bấm Start. Hệ thống tự liên kết tài khoản với bot.</p>
            {linkErr && <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{linkErr}</p>}
            {link ? (
              <div className="mt-4 flex flex-col gap-3">
                <a href={link.url} target="_blank" rel="noreferrer" className="block rounded-lg bg-primary px-4 py-2.5 text-center font-medium text-white hover:bg-primary/90">
                  Mở Telegram & bấm Start
                </a>
                <p className="text-xs text-text-muted text-center">Sau khi bạn bấm Start, ô này tự đóng. Link hết hạn sau 30 phút.</p>
              </div>
            ) : (
              <button onClick={startLink} disabled={linkBusy} className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white hover:bg-primary/90 disabled:opacity-50">
                {linkBusy ? "Đang tạo link..." : "Tạo link liên kết"}
              </button>
            )}
            <button onClick={() => setShowLink(false)} className="mt-3 w-full text-xs text-text-muted hover:text-text-main">Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}
