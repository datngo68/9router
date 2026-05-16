import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getApiKeysByCustomer } from "@/lib/localDb";
import { getApiKeyDailyUsageSummary, getApiKeyMonthlyTokenUsage, getApiKeyLifetimeTokenUsage } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

// GET /api/account/keys — list api keys owned by the logged-in customer.
// Each key carries usage summaries (daily/monthly/lifetime) so the portal
// can render progress bars without further round-trips.
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await getApiKeysByCustomer(session.customer.id);
  const enriched = await Promise.all(keys.map(async (k) => {
    const [daily, monthly, lifetime] = await Promise.all([
      getApiKeyDailyUsageSummary(k),
      getApiKeyMonthlyTokenUsage(k.id),
      getApiKeyLifetimeTokenUsage(k.id),
    ]);
    return {
      ...k,
      usage: {
        daily,
        monthly: {
          totalTokens: monthly.totalTokens,
          limit: k.monthlyTokenLimit,
          remaining: k.monthlyTokenLimit > 0 ? Math.max(0, k.monthlyTokenLimit - monthly.totalTokens) : null,
          percent: k.monthlyTokenLimit > 0 ? Math.min(100, Math.round(monthly.totalTokens / k.monthlyTokenLimit * 100)) : 0,
        },
        lifetime: {
          totalTokens: lifetime.totalTokens,
          limit: k.lifetimeTokenLimit,
          remaining: k.lifetimeTokenLimit > 0 ? Math.max(0, k.lifetimeTokenLimit - lifetime.totalTokens) : null,
          percent: k.lifetimeTokenLimit > 0 ? Math.min(100, Math.round(lifetime.totalTokens / k.lifetimeTokenLimit * 100)) : 0,
        },
      },
    };
  }));
  return NextResponse.json({ keys: enriched });
}
