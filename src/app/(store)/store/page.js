import Link from "next/link";
import PlanCardList from "../components/PlanCardList";

const FEATURES = [
  { icon: "router", title: "Multi-provider", desc: "Gọi tới OpenAI, Anthropic, Gemini, Cursor, Kiro, Cloudflare AI và nhiều provider khác qua một endpoint duy nhất." },
  { icon: "shuffle", title: "Smart routing & fallback", desc: "Round-robin, sticky session, auto fallback khi provider lỗi. Khách hàng không bao giờ bị trắng response." },
  { icon: "shield_lock", title: "Quota cứng", desc: "Giới hạn token/ngày/tháng/lifetime, RPM, max_tokens/request — chống vượt quota một cách triệt để ngay tại gateway." },
  { icon: "monitoring", title: "Usage minh bạch", desc: "Mọi request đều log chi tiết. Xem biểu đồ realtime trong portal." },
];

export default function StoreLanding() {
  return (
    <div className="flex flex-col gap-12">
      {/* Hero */}
      <section className="flex flex-col items-center text-center gap-6 py-8 sm:py-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
          <span className="material-symbols-outlined text-sm">bolt</span>
          Multi-provider LLM gateway
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          Một endpoint, mọi LLM, <span className="text-primary">giá theo VND</span>
        </h1>
        <p className="max-w-2xl text-text-muted sm:text-lg">
          9Router gom routing thông minh, fallback, quota cứng và billing minh bạch — sẵn sàng cho team Việt Nam dùng OpenAI, Anthropic, Gemini, Cursor, Kiro... mà không cần thẻ quốc tế.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/store/pricing" className="rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary/90">
            Xem bảng giá
          </Link>
          <Link href="/store/docs" className="rounded-lg border border-border px-5 py-2.5 font-medium hover:bg-surface-2">
            API Docs
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border border-border-subtle bg-surface p-5">
            <span className="material-symbols-outlined text-primary text-2xl">{f.icon}</span>
            <h3 className="mt-3 font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-text-muted">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Pricing teaser */}
      <section>
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Gói nổi bật</h2>
            <p className="text-sm text-text-muted">Chọn gói monthly hoặc topup, đáp ứng từ cá nhân tới team.</p>
          </div>
          <Link href="/store/pricing" className="text-sm text-primary hover:underline">
            Xem tất cả →
          </Link>
        </div>
        <PlanCardList limit={3} />
      </section>
    </div>
  );
}
