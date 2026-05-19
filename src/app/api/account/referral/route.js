import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getReferralStats } from "@/lib/db/repos/referralsRepo";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/account/referral
//   Returns the customer's referral code, full link, stats and reward history.
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stats = await getReferralStats(session.customer.id);
  const settings = await getSettings();

  const base = String(settings?.storeUrl || "").trim().replace(/\/$/, "");
  const link = stats?.code
    ? `${base || ""}/store/register?ref=${encodeURIComponent(stats.code)}`
    : null;

  return NextResponse.json({
    enabled: settings?.referralEnabled !== false,
    refereeBonusTokens: Number(settings?.referralRefereeBonusTokens) || 0,
    referrerBonusTokens: Number(settings?.referralReferrerBonusTokens) || 0,
    code: stats?.code || null,
    link,
    stats: stats ? {
      referredCount: stats.referredCount,
      purchasedCount: stats.purchasedCount,
      tokensEarnedAsReferrer: stats.tokensEarnedAsReferrer,
      tokensEarnedAsReferee: stats.tokensEarnedAsReferee,
    } : null,
    rewards: stats?.rewards || [],
  });
}
