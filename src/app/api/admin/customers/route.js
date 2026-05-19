import { NextResponse } from "next/server";
import { getCustomers, getOrders } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/admin/customers
//   ?q=...                         search email/displayName/phone
//   ?planIds=p1,p2                 only customers with delivered/paid order in any plan
//   ?hasTelegram=1                 only customers with telegramChatId set
//   ?hasVerifiedEmail=1            only customers whose email is verified
//   ?withPlanIds=1                 include the resolved planIds[] per customer
//                                   (delivered/paid orders) — used by the
//                                   notifications composer to show which
//                                   plans each customer holds.
export async function GET(request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.toLowerCase() || "";
  const planIdsParam = url.searchParams.get("planIds") || "";
  const planFilter = planIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
  const hasTelegram = url.searchParams.get("hasTelegram") === "1";
  const hasVerifiedEmail = url.searchParams.get("hasVerifiedEmail") === "1";
  const withPlanIds = url.searchParams.get("withPlanIds") === "1";

  let customers = await getCustomers();
  if (search) {
    customers = customers.filter((c) => `${c.email} ${c.displayName || ""} ${c.phone || ""}`.toLowerCase().includes(search));
  }
  if (hasTelegram) customers = customers.filter((c) => !!c.telegramChatId);
  if (hasVerifiedEmail) customers = customers.filter((c) => !!c.emailVerified);

  if (planFilter.length > 0 || withPlanIds) {
    const planSet = new Set(planFilter);
    const enriched = [];
    for (const c of customers) {
      let planIds = [];
      try {
        const orders = await getOrders({ customerId: c.id, limit: 200 });
        const ids = new Set();
        for (const o of orders) {
          if ((o.status === "delivered" || o.status === "paid") && o.planId) ids.add(o.planId);
        }
        planIds = Array.from(ids);
      } catch { /* skip */ }
      if (planFilter.length > 0) {
        const matched = planIds.some((id) => planSet.has(id));
        if (!matched) continue;
      }
      enriched.push(withPlanIds ? { ...c, planIds } : c);
    }
    customers = enriched;
  }

  return NextResponse.json({ customers });
}
