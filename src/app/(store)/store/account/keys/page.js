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
  const [showRaw, setShowRaw] = useState(null); // {id, key, keyDisplay}
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/account/keys", { cache: "no-store" });
    const data = await res.json();
    setKeys(data.keys || []);
  }
  useEffect(() => { load(); }, []);

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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API Keys</h1>
          <p className="text-sm text-text-muted">Quản lý các key đã được phát hành theo gói của bạn.</p>
        </div>
        <Link href="/store/pricing" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90">Mua thêm gói</Link>
      </header>

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
