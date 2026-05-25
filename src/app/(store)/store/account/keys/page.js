"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function n(v) { return Number(v || 0).toLocaleString("vi-VN"); }
function fmtTokens(v) { if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`; if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`; return String(v); }

function Bar({ used, limit, color = "bg-primary" }) {
  if (!limit || limit <= 0) {
    return <p className="text-xs text-text-muted">{n(used)} (không giới hạn)</p>;
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs text-text-muted">
        <span>{fmtTokens(used)} / {fmtTokens(limit)}</span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface-2">
        <div className={`${color} h-full rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AccountKeysPage() {
  const [keys, setKeys] = useState(null);
  const [busy, setBusy] = useState(null); // id of key being mutated
  const [creating, setCreating] = useState(false);
  const [showRaw, setShowRaw] = useState(null); // {id, key, keyDisplay}
  const [error, setError] = useState("");
  const [walletState, setWalletState] = useState(null); // {walletEnabled, paygSelfServe, balanceVnd}
  const [topupKey, setTopupKey] = useState(null); // key currently being topped up

  async function load() {
    const res = await fetch("/api/account/keys", { cache: "no-store" });
    const data = await res.json();
    setKeys(data.keys || []);
  }
  useEffect(() => {
    load();
    // PAYG self-serve toggle + wallet balance live in the wallet endpoint.
    fetch("/api/account/wallet?limit=1", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setWalletState({
        walletEnabled: !!d?.walletEnabled,
        paygSelfServe: d?.paygSelfServe !== false,
        balanceVnd: Number(d?.balance?.vnd || 0),
      }))
      .catch(() => setWalletState({ walletEnabled: false, paygSelfServe: false, balanceVnd: 0 }));
  }, []);

  async function createPayg() {
    const name = prompt("Đặt tên cho key PAYG mới (tùy chọn):", "");
    if (name === null) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/account/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || "Tạo key PAYG thất bại"); return; }
      setShowRaw({ id: data.apiKey.id, key: data.apiKey.key, keyDisplay: data.apiKey.keyDisplay });
      await load();
    } finally { setCreating(false); }
  }

  async function togglePause(key) {
    setBusy(key.id);
    setError("");
    try {
      const res = await fetch(`/api/account/keys/${key.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !key.isActive }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d?.error || "Không cập nhật được");
        return;
      }
      await load();
    } finally { setBusy(null); }
  }

  async function rename(key) {
    const name = prompt("Đổi tên key", key.name || "");
    if (name == null) return;
    setBusy(key.id);
    try {
      await fetch(`/api/account/keys/${key.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await load();
    } finally { setBusy(null); }
  }

  async function regenerate(key) {
    if (!confirm(`Tạo key mới cho "${key.name || key.keyDisplay}"? Key cũ sẽ bị thu hồi ngay.`)) return;
    setBusy(key.id);
    setError("");
    try {
      const res = await fetch(`/api/account/keys/${key.id}/regenerate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || "Tạo mới thất bại"); return; }
      setShowRaw({ id: data.apiKey.id, key: data.apiKey.key, keyDisplay: data.apiKey.keyDisplay });
      await load();
    } finally { setBusy(null); }
  }

  function copy(text) { navigator.clipboard.writeText(text); }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">API Keys</h1>
          <p className="text-sm text-text-muted">Quản lý các key đã được phát hành theo gói của bạn.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {walletState?.walletEnabled && walletState.paygSelfServe && (
            <button
              onClick={createPayg}
              disabled={creating}
              className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {creating ? "Đang tạo..." : "+ Tạo key PAYG"}
            </button>
          )}
          <Link href="/store/pricing" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90">Mua thêm gói</Link>
        </div>
      </header>

      {walletState?.walletEnabled && walletState.paygSelfServe && (
        <p className="text-xs text-text-muted">
          PAYG: tạo key không cần mua gói, mỗi request trừ trực tiếp từ ví VND theo giá model.{" "}
          <Link href="/store/account/wallet" className="text-primary hover:underline">Số dư hiện tại: {walletState.balanceVnd.toLocaleString("vi-VN")} ₫</Link>
        </p>
      )}

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

      {!keys ? (
        <div className="h-48 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      ) : keys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
          <span className="material-symbols-outlined text-3xl text-text-muted">vpn_key</span>
          <p className="mt-2 text-text-muted">Chưa có key nào.</p>
          <Link href="/store/pricing" className="mt-4 inline-block text-primary hover:underline">Mua gói đầu tiên →</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map((k) => {
            const expired = k.expiresAt && new Date(k.expiresAt).getTime() < Date.now();
            return (
              <div key={k.id} className="rounded-xl border border-border-subtle bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{k.name || "Untitled"}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${expired ? "bg-red-500/10 text-red-500" : k.isActive ? "bg-green-500/10 text-green-500" : "bg-amber-500/10 text-amber-500"}`}>
                        {expired ? "expired" : k.isActive ? "active" : "paused"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="rounded bg-surface-2 px-2 py-1 font-mono text-xs">{k.keyDisplay}</code>
                      <button onClick={() => copy(k.keyDisplay)} className="text-xs text-text-muted hover:text-primary">copy</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => rename(k)} disabled={busy === k.id} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-surface-2">Đổi tên</button>
                    <button onClick={() => setTopupKey(k)} disabled={busy === k.id} className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-1 text-xs text-primary hover:bg-primary/10">Gia hạn / Top-up</button>
                    <button onClick={() => togglePause(k)} disabled={busy === k.id} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-surface-2">{k.isActive ? "Tạm dừng" : "Kích hoạt"}</button>
                    <button onClick={() => regenerate(k)} disabled={busy === k.id} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-600 hover:bg-amber-500/20">Tạo lại</button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase text-text-muted">Hôm nay</p>
                    <Bar used={k.usage?.daily?.usedTokens || 0} limit={k.usage?.daily?.dailyTokenLimit || 0} />
                  </div>
                  <div>
                    <p className="text-xs uppercase text-text-muted">Tháng này</p>
                    <Bar used={k.usage?.monthly?.totalTokens || 0} limit={k.usage?.monthly?.limit || 0} />
                  </div>
                  <div>
                    <p className="text-xs uppercase text-text-muted">Lifetime</p>
                    <Bar used={k.usage?.lifetime?.totalTokens || 0} limit={k.usage?.lifetime?.limit || 0} />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  {k.requestsPerMinute > 0 && <span>RPM: {k.requestsPerMinute}</span>}
                  {k.maxTokensPerRequest > 0 && <span>Max tokens/request: {k.maxTokensPerRequest.toLocaleString()}</span>}
                  {k.allowedModels?.length > 0 && <span>{k.allowedModels.length} model</span>}
                  {k.expiresAt && <span>Hết hạn: {new Date(k.expiresAt).toLocaleDateString("vi-VN")}</span>}
                </div>

                <div className="mt-3 flex items-center justify-between rounded-lg border border-border-subtle bg-surface-2 px-3 py-2">
                  <div className="text-xs">
                    <p className="font-medium">Trả thêm bằng ví khi hết quota</p>
                    <p className="text-text-muted">Khi quota gói hết, request tiếp theo sẽ trừ tiền từ ví VND.</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!k.paygEnabled}
                      disabled={busy === k.id}
                      onChange={async () => {
                        setBusy(k.id);
                        try {
                          await fetch(`/api/account/keys/${k.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ paygEnabled: !k.paygEnabled }),
                          });
                          await load();
                        } finally { setBusy(null); }
                      }}
                    />
                    <span>{k.paygEnabled ? "Bật" : "Tắt"}</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {topupKey && (
        <TopupModal
          targetKey={topupKey}
          walletBalanceVnd={walletState?.balanceVnd || 0}
          onClose={() => setTopupKey(null)}
          onSuccess={async (msg) => {
            setTopupKey(null);
            await load();
            // Refresh wallet balance after a wallet top-up.
            fetch("/api/account/wallet?limit=1", { cache: "no-store" })
              .then((r) => r.ok ? r.json() : null)
              .then((d) => d && setWalletState((s) => ({ ...(s || {}), balanceVnd: Number(d.balance?.vnd || 0) })));
          }}
        />
      )}

      {showRaw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowRaw(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl border border-primary bg-bg p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-primary">Key mới đã được tạo</h3>
            <p className="mt-2 text-sm text-text-muted">Hãy lưu key bên dưới — đây là lần duy nhất hiển thị đầy đủ. Key cũ đã bị thu hồi.</p>
            <pre className="mt-4 break-all rounded-lg bg-surface-2 p-4 font-mono text-sm">{showRaw.key}</pre>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => copy(showRaw.key)} className="rounded-lg border border-border px-4 py-2 text-sm">Copy</button>
              <button onClick={() => setShowRaw(null)} className="rounded-lg bg-primary px-4 py-2 text-sm text-white">Đã lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }

/**
 * Choose a top-up plan to extend the selected key. Quota fields stack onto the
 * existing key and expiry takes the latest of (plan-derived, current). Wallet
 * payment delivers immediately; bank/momo redirects to the QR page.
 */
function TopupModal({ targetKey, walletBalanceVnd, onClose, onSuccess }) {
  const [plans, setPlans] = useState(null);
  const [selected, setSelected] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("bank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetch("/api/store/plans", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPlans((d.plans || []).filter((p) => p.kind === "topup" || p.kind === "monthly")))
      .catch(() => setPlans([]));
  }, []);

  const canPayWallet = !!selected && walletBalanceVnd >= Number(selected.priceVnd || 0);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selected.id,
          paymentMethod,
          targetApiKeyId: targetKey.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || "Tạo đơn thất bại"); return; }
      if (paymentMethod === "wallet") {
        onSuccess?.("Đã top-up key thành công.");
        return;
      }
      // Redirect to the QR page for non-wallet payments.
      window.location.href = `/store/order/${data.order.id}`;
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-xl border border-border bg-bg p-6 shadow-xl max-h-[85vh] overflow-y-auto">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Gia hạn / Top-up key</h3>
            <p className="mt-1 text-sm text-text-muted">
              Cộng thêm quota vào key{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{targetKey.keyDisplay}</code>{" "}
              <span className="text-text-muted">({targetKey.name || "Untitled"})</span>
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-main">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="mt-4">
          <p className="text-xs uppercase text-text-muted">Chọn gói cộng thêm</p>
          {!plans ? (
            <div className="mt-2 h-32 animate-pulse rounded-lg bg-surface-2" />
          ) : plans.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">Chưa có gói topup nào khả dụng.</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {plans.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm ${
                    selected?.id === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-surface-2"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input type="radio" checked={selected?.id === p.id} onChange={() => setSelected(p)} />
                      <span className="font-medium">{p.name}</span>
                    </div>
                    <span className="font-semibold">{fmtVnd(p.priceVnd)}</span>
                  </div>
                  <div className="ml-6 text-xs text-text-muted">
                    {p.dailyTokenLimit > 0 && <span>{p.dailyTokenLimit.toLocaleString("vi-VN")} token/ngày · </span>}
                    {p.monthlyTokenLimit > 0 && <span>{p.monthlyTokenLimit.toLocaleString("vi-VN")} token/tháng · </span>}
                    {p.lifetimeTokenLimit > 0 && <span>{p.lifetimeTokenLimit.toLocaleString("vi-VN")} token lifetime · </span>}
                    {(p.expiresAfterDays > 0 || p.expiresAfterMinutes > 0) && (
                      <span>Hết hạn sau {p.expiresAfterDays > 0 ? `${p.expiresAfterDays} ngày` : `${p.expiresAfterMinutes} phút`}</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-text-muted">
            Khi gia hạn, key sẽ chạy theo policy của gói mới (quota, hạn dùng, allowedModels được ghi đè theo gói). ID/keyHash giữ nguyên, mọi tích hợp hiện có vẫn dùng được.
          </p>
        </div>

        {selected && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="font-semibold text-amber-700 dark:text-amber-500 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">warning</span>
              Xác nhận thay đổi policy
            </p>
            <ul className="mt-2 ml-6 list-disc text-xs space-y-1 text-text-main">
              <li>
                <strong>Quota daily/monthly/lifetime sẽ làm mới</strong> — bộ đếm token đã dùng được reset về 0 từ thời điểm gia hạn.
              </li>
              <li>
                Hạn dùng và allowedModels sẽ <strong>ghi đè</strong> theo gói mới
                {selected.expiresAfterDays > 0 || selected.expiresAfterMinutes > 0
                  ? ` (hết hạn sau ${selected.expiresAfterDays > 0 ? `${selected.expiresAfterDays} ngày` : `${selected.expiresAfterMinutes} phút`})`
                  : " (gói không hết hạn → key cũng sẽ không hết hạn)"}.
              </li>
              {Array.isArray(selected.allowedModels) && selected.allowedModels.length > 0 ? (
                <li>Sau gia hạn key chỉ dùng được {selected.allowedModels.length} model trong gói. Models cũ ngoài danh sách sẽ bị chặn.</li>
              ) : (
                <li>Sau gia hạn key sẽ dùng được tất cả model 9Router hỗ trợ.</li>
              )}
              <li>Key đang paused/hết hạn sẽ được kích hoạt lại tự động.</li>
            </ul>
          </div>
        )}

        {selected && (
          <div className="mt-4">
            <p className="text-xs uppercase text-text-muted">Phương thức thanh toán</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm sm:col-span-2 ${
                  paymentMethod === "wallet" ? "border-primary bg-primary/5" : "border-border"
                } ${!canPayWallet ? "opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  checked={paymentMethod === "wallet"}
                  onChange={() => setPaymentMethod("wallet")}
                  disabled={!canPayWallet}
                />
                <span className="material-symbols-outlined text-base">account_balance_wallet</span>
                <span className="flex-1">
                  <span className="font-medium">Trả từ ví</span>
                  <span className="ml-2 text-xs text-text-muted">Số dư: {fmtVnd(walletBalanceVnd)}</span>
                </span>
                {!canPayWallet && (
                  <span className="text-xs text-amber-600">Không đủ — nạp thêm trước</span>
                )}
              </label>
              {[
                { id: "bank", label: "Chuyển khoản ngân hàng" },
                { id: "momo", label: "Ví MoMo" },
              ].map((m) => (
                <label key={m.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${paymentMethod === m.id ? "border-primary bg-primary/5" : "border-border"}`}>
                  <input type="radio" checked={paymentMethod === m.id} onChange={() => setPaymentMethod(m.id)} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

        {selected && (
          <label className="mt-4 flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={confirming}
              onChange={(e) => setConfirming(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Tôi hiểu policy hiện tại của key sẽ bị thay thế bằng policy gói <strong>{selected.name}</strong> và bộ đếm quota sẽ bắt đầu lại từ 0.
            </span>
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-border-subtle pt-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2">Hủy</button>
          <button
            onClick={submit}
            disabled={busy || !selected || !confirming || (paymentMethod === "wallet" && !canPayWallet)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Đang xử lý..." : selected ? `Top-up ${fmtVnd(selected.priceVnd)}` : "Chọn gói"}
          </button>
        </div>
      </div>
    </div>
  );
}
