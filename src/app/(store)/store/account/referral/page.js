"use client";

import { useEffect, useState } from "react";

function fmtNum(v) { return Number(v || 0).toLocaleString("vi-VN"); }
function fmtTime(s) { return s ? new Date(s).toLocaleString("vi-VN") : "—"; }

export default function ReferralPage() {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/account/referral", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ enabled: false }));
  }, []);

  function copy(text) {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  if (!data) return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;

  if (data.enabled === false) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface p-8 text-center text-sm text-text-muted">
        Chương trình giới thiệu hiện chưa được bật.
      </div>
    );
  }

  const { code, link, stats, rewards, refereeBonusTokens, referrerBonusTokens } = data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Giới thiệu nhận token</h1>
        <p className="mt-1 text-sm text-text-muted">
          Chia sẻ mã giới thiệu của bạn. Khi bạn bè đăng ký bằng mã và mua đơn ĐẦU TIÊN, cả hai cùng nhận token thưởng.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border-subtle bg-surface p-5">
          <p className="text-xs uppercase text-text-muted">Mã giới thiệu của bạn</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-lg font-semibold tracking-wider">{code || "—"}</code>
            <button onClick={() => copy(code)} className="rounded-lg border border-border px-3 py-2 text-sm hover:border-primary">
              <span className="material-symbols-outlined text-base">content_copy</span>
            </button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Người được giới thiệu nhận <strong>{fmtNum(refereeBonusTokens)}</strong> token, bạn nhận <strong>{fmtNum(referrerBonusTokens)}</strong> token khi họ mua đơn đầu.
          </p>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface p-5">
          <p className="text-xs uppercase text-text-muted">Link mời bạn bè</p>
          {link ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <input
                  readOnly value={link}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs"
                />
                <button onClick={() => copy(link)} className="rounded-lg border border-border px-3 py-2 text-sm hover:border-primary whitespace-nowrap">
                  {copied ? "Đã copy" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-text-muted">Người mới mở link sẽ thấy mã của bạn được điền sẵn ở form đăng ký.</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-text-muted">Cấu hình store URL trong dashboard để hiện link đầy đủ.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Đã giới thiệu" value={fmtNum(stats?.referredCount)} hint="Người đã đăng ký bằng mã" />
        <Stat label="Đã mua đơn đầu" value={fmtNum(stats?.purchasedCount)} hint="Trigger nhận thưởng" />
        <Stat label="Token bạn nhận" value={fmtNum(stats?.tokensEarnedAsReferrer)} hint="Cộng vào lifetime quota" />
        <Stat label="Token referee nhận (qua bạn)" value={fmtNum(stats?.tokensEarnedAsReferee)} hint="Token bạn nhận khi đăng ký bằng mã của ai đó" />
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface p-5">
        <h2 className="font-semibold">Lịch sử thưởng</h2>
        {!rewards || rewards.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">Chưa có thưởng nào. Chia sẻ mã của bạn để nhận token!</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Thời gian</th>
                  <th className="px-3 py-2 text-left">Người được giới thiệu</th>
                  <th className="px-3 py-2 text-right">Bạn nhận</th>
                  <th className="px-3 py-2 text-right">Họ nhận</th>
                </tr>
              </thead>
              <tbody>
                {rewards.map((r) => (
                  <tr key={r.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtTime(r.createdAt)}</td>
                    <td className="px-3 py-2 text-sm">{r.refereeName || r.refereeEmail || r.refereeId}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(r.referrerBonusTokens)}</td>
                    <td className="px-3 py-2 text-right text-text-muted">{fmtNum(r.refereeBonusTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4">
      <p className="text-xs uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
