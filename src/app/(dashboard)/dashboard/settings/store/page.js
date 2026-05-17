"use client";

import { useEffect, useState } from "react";
import { Card, Input, Button, Toggle } from "@/shared/components";

const STORE_FIELDS = [
  { key: "storeName", label: "Tên store", placeholder: "9Router" },
  { key: "storeUrl", label: "Public URL của store", placeholder: "https://9router.tudonghoa.me" },
  { key: "adminHosts", label: "Admin hostname(s)", placeholder: "admin.example.com, internal.example.com", hint: "Để trống = mọi hostname đều có dashboard. Set tên miền riêng (cách nhau bởi dấu phẩy) để ẩn dashboard khỏi storefront. Loopback luôn truy cập được." },
  { key: "adminPathPrefix", label: "Admin path prefix (bí mật)", placeholder: "x9k2", hint: "Để trống = login ở /login. Set chuỗi bí mật (chỉ a-z, A-Z, 0-9, _, -) — login chỉ truy cập được tại /<prefix>. Mở /login thông thường sẽ trả 404." },
  { key: "paymentInstructions", label: "Ghi chú thêm cho khách (tùy chọn)", textarea: true, placeholder: "Hướng dẫn thanh toán mở rộng, lưu ý đặc biệt cho khách..." },
];

const TELEGRAM_FIELDS = [
  { key: "telegramBotToken", label: "Bot token", placeholder: "123456:ABC-DEF...", type: "password", hint: "Tạo bot qua @BotFather. Lưu lại token rồi paste vào đây." },
];

const SMTP_FIELDS = [
  { key: "smtpHost", label: "SMTP host", placeholder: "smtp.gmail.com" },
  { key: "smtpPort", label: "Port", placeholder: "587", type: "number" },
  { key: "smtpUser", label: "User", placeholder: "you@gmail.com" },
  { key: "smtpPass", label: "Pass / App password", type: "password" },
  { key: "smtpFrom", label: "From", placeholder: "noreply@example.com" },
];

const GOOGLE_FIELDS = [
  { key: "customerGoogleClientId", label: "Google Client ID", placeholder: "xxxxx.apps.googleusercontent.com" },
  { key: "customerGoogleClientSecret", label: "Google Client Secret", type: "password" },
  { key: "customerGoogleRedirectUri", label: "Redirect URI", placeholder: "https://domain.com/api/account/google/callback" },
];

const BANK_FIELDS = [
  { key: "bankAccountNo", label: "Số tài khoản", placeholder: "0123456789" },
  { key: "bankAccountName", label: "Tên chủ tài khoản (không dấu)", placeholder: "NGUYEN VAN A", hint: "Bắt buộc viết hoa, không dấu — VietQR yêu cầu vậy." },
  { key: "momoPhone", label: "MoMo — số điện thoại (tùy chọn)", placeholder: "0987654321" },
  { key: "momoName", label: "MoMo — tên (tùy chọn)", placeholder: "NGUYEN VAN A" },
];

const APIBANK_FIELDS = [
  { key: "apibankBaseUrl", label: "APIBank base URL", placeholder: "https://apibak.tudonghoa.me", hint: "Domain của instance APIBank, không có dấu / cuối." },
  { key: "apibankApiKey", label: "API key", type: "password", placeholder: "sk_live_...", hint: "Tạo trong APIBank · Settings → API Keys, scope orders:write + orders:read + bank_accounts:read." },
];

export default function StoreSettingsPage() {
  const [settings, setSettings] = useState({});
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tg, setTg] = useState(null);
  const [link, setLink] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState("");
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState("");
  const [apibankTest, setApibankTest] = useState(null);
  const [apibankBusy, setApibankBusy] = useState(false);
  const [apibankAccounts, setApibankAccounts] = useState(null);
  const [apibankAccountsErr, setApibankAccountsErr] = useState("");

  async function load() {
    setLoading(true);
    const [s, t, p] = await Promise.all([
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/telegram/link", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/store/payment", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    setSettings(s || {});
    setTg(t || null);
    setBanks(p?.banks || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save(patch) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json();
        setMsg(d?.error || "Lưu thất bại");
        return;
      }
      const d = await res.json();
      setSettings(d);
      setMsg("Đã lưu");
    } finally { setBusy(false); }
  }

  async function startAdminLink() {
    setLinkBusy(true);
    setLinkErr("");
    setLink(null);
    try {
      const res = await fetch("/api/admin/telegram/link", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setLinkErr(d?.error || "Không tạo được link"); return; }
      setLink(d);
      const stop = Date.now() + 5 * 60 * 1000;
      const poll = setInterval(async () => {
        if (Date.now() > stop) { clearInterval(poll); return; }
        const r = await fetch("/api/admin/telegram/link", { cache: "no-store" });
        const dd = await r.json();
        if (dd?.linked) {
          clearInterval(poll);
          setTg(dd);
          setLink(null);
        }
      }, 3000);
    } finally { setLinkBusy(false); }
  }

  async function unlinkAdmin() {
    if (!confirm("Hủy liên kết Admin Telegram?")) return;
    await fetch("/api/admin/telegram/link", { method: "DELETE" });
    await load();
  }

  async function setupWebhook() {
    setWebhookBusy(true);
    setWebhookMsg("");
    try {
      const publicUrl = settings.storeUrl || (typeof window !== "undefined" ? window.location.origin : "");
      const res = await fetch("/api/admin/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl }),
      });
      const d = await res.json();
      if (!res.ok) { setWebhookMsg(d?.error || "setWebhook failed"); return; }
      setWebhookMsg("Đã đăng ký webhook: " + d.webhookUrl);
      await load();
    } finally { setWebhookBusy(false); }
  }

  async function clearWebhook() {
    if (!confirm("Xóa webhook hiện tại?")) return;
    setWebhookBusy(true);
    try {
      await fetch("/api/admin/telegram/webhook", { method: "DELETE" });
      setWebhookMsg("Đã xóa webhook");
      await load();
    } finally { setWebhookBusy(false); }
  }

  async function generateApibankSecret() {
    setApibankBusy(true);
    try {
      const res = await fetch("/api/admin/apibank/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generateSecret" }),
      });
      const d = await res.json();
      if (d?.secret) {
        setSettings({ ...settings, apibankWebhookSecret: d.secret });
        setApibankTest({ ok: true, msg: "Đã sinh secret mới (64 ký tự hex). Nhớ lưu rồi paste sang APIBank dashboard." });
      }
    } catch (e) {
      setApibankTest({ ok: false, msg: e.message });
    } finally { setApibankBusy(false); }
  }

  async function testApibank() {
    setApibankBusy(true);
    setApibankTest(null);
    try {
      // Send only fields that are non-empty so saved (encrypted) values get
      // used for blanks — admin doesn't need to re-paste apiKey to re-test.
      const body = {};
      if (settings.apibankBaseUrl) body.baseUrl = settings.apibankBaseUrl;
      if (settings.apibankApiKey) body.apiKey = settings.apibankApiKey;
      const res = await fetch("/api/admin/apibank/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      setApibankTest({ ok: !!d?.ok, msg: d?.ok ? "Kết nối OK" : (d?.error || "Test thất bại") });
    } catch (e) {
      setApibankTest({ ok: false, msg: e.message });
    } finally { setApibankBusy(false); }
  }

  async function loadApibankAccounts() {
    setApibankBusy(true);
    setApibankAccountsErr("");
    try {
      const body = {};
      if (settings.apibankBaseUrl) body.baseUrl = settings.apibankBaseUrl;
      if (settings.apibankApiKey) body.apiKey = settings.apibankApiKey;
      const res = await fetch("/api/admin/apibank/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d?.error) {
        setApibankAccountsErr(d.error);
        setApibankAccounts([]);
        return;
      }
      const list = Array.isArray(d?.accounts) ? d.accounts : [];
      setApibankAccounts(list);
      // Nếu admin chưa chọn ID hoặc ID đã lưu không còn trong list → auto
      // pick cái đầu để giảm friction.
      if (list.length && !list.find((a) => a.id === settings.apibankBankAccountId)) {
        setSettings({ ...settings, apibankBankAccountId: list[0].id });
      }
    } catch (e) {
      setApibankAccountsErr(e.message || "Không tải được danh sách");
      setApibankAccounts([]);
    } finally { setApibankBusy(false); }
  }

  function copyText(value) {
    if (!value) return;
    try { navigator.clipboard.writeText(value); } catch {}
  }

  function field({ key, label, type = "text", placeholder, textarea, hint }) {
    const value = settings[key] ?? "";
    if (textarea) {
      return (
        <label key={key} className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">{label}</span>
          <textarea
            rows={4}
            value={value}
            onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
            placeholder={placeholder}
            className="rounded-lg border border-border bg-bg px-3 py-2"
          />
          {hint && <span className="text-xs text-text-muted">{hint}</span>}
        </label>
      );
    }
    return (
      <Input key={key} label={label} type={type} value={value} placeholder={placeholder}
        onChange={(e) => setSettings({ ...settings, [key]: type === "number" ? Number(e.target.value) : e.target.value })} hint={hint} />
    );
  }

  if (loading) return <Card><div className="h-32 animate-pulse" /></Card>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Cài đặt store</h1>
        <p className="text-sm text-text-muted">Storefront, tài khoản nhận thanh toán, Telegram bot, SMTP. Mọi secret đều được mã hóa.</p>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Storefront</h2>
        <div className="flex flex-col gap-3">
          {STORE_FIELDS.map((f) => field(f))}
        </div>
        <div className="mt-4 flex gap-3">
          <Button onClick={() => save(Object.fromEntries(STORE_FIELDS.map((f) => [f.key, settings[f.key] ?? ""])))} disabled={busy}>Lưu</Button>
          {msg && <span className="self-center text-sm text-text-muted">{msg}</span>}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Tài khoản nhận thanh toán</h2>
        <p className="mb-3 text-xs text-text-muted">Khách thanh toán qua VietQR (mọi app banking VN scan được). MoMo là tùy chọn — chỉ hiện kèm thông tin.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Ngân hàng</span>
            <select
              value={settings.bankCode || ""}
              onChange={(e) => setSettings({ ...settings, bankCode: e.target.value })}
              className="rounded-lg border border-border bg-bg px-3 py-2"
            >
              <option value="">— Chọn ngân hàng —</option>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
              ))}
            </select>
          </label>
          {BANK_FIELDS.map((f) => field(f))}
        </div>

        {settings.bankCode && settings.bankAccountNo && settings.bankAccountName && (
          <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2 p-4">
            <p className="text-xs uppercase text-text-muted">Preview QR</p>
            <p className="mt-1 text-xs text-text-muted">Mỗi đơn sẽ có QR riêng với số tiền + nội dung CK = mã đơn.</p>
            <img
              src={`https://img.vietqr.io/image/${encodeURIComponent(settings.bankCode)}-${encodeURIComponent(settings.bankAccountNo)}-compact2.png?accountName=${encodeURIComponent(settings.bankAccountName)}`}
              alt="VietQR preview"
              className="mt-3 max-w-[260px] rounded-lg border border-border"
            />
          </div>
        )}

        <div className="mt-4">
          <Button onClick={() => save({
            bankCode: settings.bankCode || "",
            bankAccountNo: settings.bankAccountNo || "",
            bankAccountName: settings.bankAccountName || "",
            momoPhone: settings.momoPhone || "",
            momoName: settings.momoName || "",
          })} disabled={busy}>Lưu thông tin thanh toán</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">APIBank — Thanh toán tự động</h2>
        <p className="mb-3 text-xs text-text-muted">
          Tích hợp với <a href="https://apibak.tudonghoa.me" target="_blank" rel="noreferrer" className="text-primary hover:underline">apibak.tudonghoa.me</a> để tự động xác nhận đơn khi khách CK xong, không cần admin bấm Telegram. Tắt = quay về xác nhận thủ công.
        </p>

        <label className="mb-3 flex items-center gap-2 text-sm">
          <Toggle checked={!!settings.apibankEnabled} onChange={(v) => setSettings({ ...settings, apibankEnabled: v })} size="sm" />
          <span>Bật thanh toán tự động qua APIBank</span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          {APIBANK_FIELDS.map((f) => field({
            ...f,
            hint: f.key === "apibankApiKey" && settings.hasApibankApiKey ? "Đã lưu (để trống nếu giữ nguyên)" : f.hint,
          }))}
        </div>

        <div className="mt-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Bank account ID</span>
            <div className="flex gap-2">
              <select
                value={settings.apibankBankAccountId || ""}
                onChange={(e) => setSettings({ ...settings, apibankBankAccountId: e.target.value })}
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
              >
                {!settings.apibankBankAccountId && (
                  <option value="">— Chọn tài khoản từ APIBank —</option>
                )}
                {settings.apibankBankAccountId && !(apibankAccounts || []).find((a) => a.id === settings.apibankBankAccountId) && (
                  <option value={settings.apibankBankAccountId}>
                    {settings.apibankBankAccountId} (đã lưu)
                  </option>
                )}
                {(apibankAccounts || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bank_code} · {a.account_no} · {a.account_holder}
                    {a.status !== "active" ? ` · ${a.status}` : ""}
                  </option>
                ))}
              </select>
              <Button onClick={loadApibankAccounts} disabled={apibankBusy || !settings.apibankBaseUrl || !(settings.apibankApiKey || settings.hasApibankApiKey)} size="sm" variant="ghost">
                {apibankAccounts ? "Tải lại" : "Tải danh sách"}
              </Button>
            </div>
            <span className="text-xs text-text-muted">
              {apibankAccountsErr
                ? <span className="text-red-500">{apibankAccountsErr}</span>
                : apibankAccounts === null
                  ? "Bấm \"Tải danh sách\" để fetch tài khoản từ APIBank (cần scope bank_accounts:read)."
                  : apibankAccounts.length === 0
                    ? "Không có bank account nào — vào APIBank dashboard tạo trước."
                    : `${apibankAccounts.length} tài khoản. Chỉ tài khoản trạng thái active mới nhận tiền được.`}
            </span>
          </label>
        </div>

        <div className="mt-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Webhook secret <span className="text-text-muted/60">(≥ 16 ký tự — 9router dùng để verify mỗi event)</span></span>
            <div className="flex gap-2">
              <input
                type="password"
                value={settings.apibankWebhookSecret || ""}
                placeholder={settings.hasApibankWebhookSecret ? "••••••••••••••••" : "openssl rand -hex 32"}
                onChange={(e) => setSettings({ ...settings, apibankWebhookSecret: e.target.value })}
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm"
              />
              <Button onClick={generateApibankSecret} disabled={apibankBusy} size="sm" variant="ghost">Sinh secret mới</Button>
              {settings.apibankWebhookSecret && (
                <Button onClick={() => copyText(settings.apibankWebhookSecret)} size="sm" variant="ghost">Copy</Button>
              )}
            </div>
            <span className="text-xs text-text-muted">
              {settings.hasApibankWebhookSecret ? "Đã lưu. Để trống = giữ giá trị cũ." : "Sau khi sinh + lưu, paste cùng giá trị này sang APIBank dashboard khi tạo Webhook endpoint."}
            </span>
          </label>
        </div>

        <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2 p-4">
          <p className="text-sm font-medium">Webhook URL (paste vào APIBank)</p>
          <p className="mt-1 text-xs text-text-muted">Mở APIBank dashboard · Settings → Webhooks → New endpoint, dán URL này, dùng cùng secret ở trên, chọn event <code>payment.succeeded</code>.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-bg px-3 py-2 text-xs">
              {(settings.storeUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "")}/api/webhooks/apibank
            </code>
            <Button
              onClick={() => copyText(`${(settings.storeUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "")}/api/webhooks/apibank`)}
              size="sm"
              variant="ghost"
            >
              Copy
            </Button>
          </div>
          {!settings.storeUrl && (
            <p className="mt-2 text-xs text-amber-500">Nên set Storefront → Public URL trước khi đăng ký webhook để URL khớp domain công khai.</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => save({
            apibankEnabled: !!settings.apibankEnabled,
            apibankBaseUrl: (settings.apibankBaseUrl || "").trim().replace(/\/$/, ""),
            apibankApiKey: settings.apibankApiKey || "",
            apibankBankAccountId: settings.apibankBankAccountId || "",
            apibankWebhookSecret: settings.apibankWebhookSecret || "",
          })} disabled={busy}>Lưu APIBank</Button>
          <Button onClick={testApibank} disabled={apibankBusy || !(settings.apibankBaseUrl && (settings.apibankApiKey || settings.hasApibankApiKey))} size="sm" variant="ghost">
            Test kết nối
          </Button>
          {apibankTest && (
            <span className={`text-xs ${apibankTest.ok ? "text-green-500" : "text-red-500"}`}>{apibankTest.msg}</span>
          )}
          {settings.apibankConfigured && !apibankTest && (
            <span className="text-xs text-text-muted">Đã cấu hình đầy đủ.</span>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Telegram bot</h2>
        <p className="mb-3 text-xs text-text-muted">Tạo bot qua @BotFather để lấy token. Sau đó đăng ký webhook và liên kết admin chat — admin sẽ confirm/cancel đơn ngay trong chat bằng nút bấm.</p>

        <div className="flex flex-col gap-3">
          {TELEGRAM_FIELDS.map((f) => field({ ...f, hint: settings.hasTelegramBotToken ? "Đã lưu (để trống nếu giữ nguyên)" : f.hint }))}
        </div>
        <div className="mt-3">
          <Button onClick={() => save({ telegramBotToken: settings.telegramBotToken || "" })} disabled={busy} size="sm">Lưu token</Button>
        </div>

        <div className="mt-6 rounded-lg border border-border-subtle bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Webhook</p>
              <p className="text-xs text-text-muted break-all">{settings.telegramWebhookUrl || "Chưa đăng ký"}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={setupWebhook} disabled={!settings.hasTelegramBotToken || webhookBusy} size="sm">
                {settings.telegramWebhookUrl ? "Đăng ký lại" : "Đăng ký webhook"}
              </Button>
              {settings.telegramWebhookUrl && (
                <Button onClick={clearWebhook} disabled={webhookBusy} size="sm" variant="ghost">Xóa</Button>
              )}
            </div>
          </div>
          {webhookMsg && <p className="mt-2 text-xs text-text-muted">{webhookMsg}</p>}
        </div>

        <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Admin chat</p>
              <p className="text-xs text-text-muted">{tg?.linked ? `Đã liên kết · chat ID: ${tg.chatId}` : "Chưa liên kết — bạn sẽ không nhận noti đơn mới qua Telegram."}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={startAdminLink} disabled={!tg?.botConfigured || linkBusy} size="sm">
                {tg?.linked ? "Liên kết lại" : "Liên kết admin chat"}
              </Button>
              {tg?.linked && (
                <Button onClick={unlinkAdmin} size="sm" variant="ghost">Hủy</Button>
              )}
            </div>
          </div>
          {linkErr && <p className="mt-2 text-xs text-red-500">{linkErr}</p>}
          {link && (
            <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm font-medium">Bước 1: Mở chat với bot</p>
              <a href={link.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-primary hover:underline">{link.url}</a>
              <p className="mt-3 text-sm font-medium">Bước 2: Bấm Start, rồi nhập PIN sau vào chat:</p>
              <p className="mt-1 text-3xl font-mono tracking-widest text-primary">{link.pin}</p>
              <p className="mt-3 text-xs text-text-muted">PIN sống 5 phút, 3 lần thử. Trang tự đóng khi liên kết thành công.</p>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Google đăng nhập khách hàng</h2>
        <p className="mb-3 text-xs text-text-muted">Tạo OAuth Client trên Google Cloud, thêm redirect URI trùng cấu hình bên dưới.</p>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <Toggle checked={!!settings.customerGoogleOAuthEnabled} onChange={(v) => setSettings({ ...settings, customerGoogleOAuthEnabled: v })} size="sm" />
          <span>Bật đăng nhập bằng Google</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {GOOGLE_FIELDS.map((f) => field({ ...f, hint: f.key === "customerGoogleClientSecret" && settings.customerGoogleConfigured ? "Đã lưu (để trống nếu giữ nguyên)" : f.hint }))}
        </div>
        <div className="mt-4">
          <Button onClick={() => save({
            customerGoogleOAuthEnabled: !!settings.customerGoogleOAuthEnabled,
            customerGoogleClientId: settings.customerGoogleClientId || "",
            customerGoogleClientSecret: settings.customerGoogleClientSecret || "",
            customerGoogleRedirectUri: settings.customerGoogleRedirectUri || "",
          })} disabled={busy}>Lưu Google OAuth</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">SMTP (gửi email)</h2>
        <p className="mb-3 text-xs text-text-muted">Gmail: bật 2FA → tạo App password 16 ký tự. Hoặc dùng SES/Mailgun.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SMTP_FIELDS.map((f) => field(f))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <Toggle checked={!!settings.smtpSecure} onChange={(v) => setSettings({ ...settings, smtpSecure: v })} size="sm" />
          <span>Secure (TLS — bật khi port 465)</span>
        </label>
        <div className="mt-4">
          <Button onClick={() => save({
            smtpHost: settings.smtpHost,
            smtpPort: Number(settings.smtpPort) || 587,
            smtpSecure: !!settings.smtpSecure,
            smtpUser: settings.smtpUser,
            smtpPass: settings.smtpPass,
            smtpFrom: settings.smtpFrom,
          })} disabled={busy}>Lưu SMTP</Button>
        </div>
      </Card>
    </div>
  );
}
