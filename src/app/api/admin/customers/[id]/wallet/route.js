import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getCustomerById } from "@/lib/localDb";
import {
  getWalletBalance,
  listWalletTransactions,
  applyWalletDelta,
  setBalanceMinLimit,
  vndToMicro,
  microToVnd,
} from "@/lib/db/repos/walletRepo.js";

export const dynamic = "force-dynamic";

// GET /api/admin/customers/[id]/wallet — balance + ledger.
export async function GET(request, { params }) {
  const auth = await requireRole(request, "operator");
  if (auth.response) return auth.response;
  const { id } = await params;
  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const balance = await getWalletBalance(id);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 100));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const ledger = await listWalletTransactions(id, { limit, offset });
  return NextResponse.json({
    customer,
    balance: {
      micro: balance?.balance || 0,
      vnd: microToVnd(balance?.balance || 0),
      minLimitMicro: balance?.balanceMinLimit || 0,
      minLimitVnd: microToVnd(balance?.balanceMinLimit || 0),
    },
    items: ledger.items.map((t) => ({
      ...t,
      deltaVnd: microToVnd(t.delta),
      balanceAfterVnd: microToVnd(t.balanceAfter),
    })),
    total: ledger.total,
  });
}

// POST /api/admin/customers/[id]/wallet — manual adjustment.
//   body: { deltaVnd, reason, type? }   type defaults to 'adjustment' (or 'refund')
export async function POST(request, { params }) {
  const { id } = await params;
  const auth = await requireRole(request, "admin", {
    action: "wallet.adjust",
    targetType: "customer",
    targetId: id,
  });
  if (auth.response) return auth.response;

  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const deltaVnd = Number(body?.deltaVnd);
  const reason = String(body?.reason || "").trim();
  const type = body?.type === "refund" ? "refund" : "adjustment";
  if (!Number.isFinite(deltaVnd) || deltaVnd === 0) {
    return NextResponse.json({ error: "deltaVnd must be a non-zero number" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  try {
    const result = await applyWalletDelta({
      customerId: id,
      delta: vndToMicro(deltaVnd),
      type,
      meta: { reason, adminRole: auth.session?.role || null },
    });
    return NextResponse.json({
      ok: true,
      txId: result.id,
      balanceAfterVnd: microToVnd(result.balanceAfter),
    });
  } catch (e) {
    console.error("[admin/customers/wallet] adjust failed:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Adjustment failed" }, { status: 400 });
  }
}

// PATCH /api/admin/customers/[id]/wallet — update min limit (overdraft floor).
//   body: { minLimitVnd }   negative = allow overdraft to that amount
export async function PATCH(request, { params }) {
  const { id } = await params;
  const auth = await requireRole(request, "admin", {
    action: "wallet.set_min_limit",
    targetType: "customer",
    targetId: id,
  });
  if (auth.response) return auth.response;

  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const minLimitVnd = Number(body?.minLimitVnd);
  if (!Number.isFinite(minLimitVnd)) {
    return NextResponse.json({ error: "minLimitVnd must be a number" }, { status: 400 });
  }

  const updated = await setBalanceMinLimit(id, vndToMicro(minLimitVnd));
  return NextResponse.json({
    ok: true,
    minLimitVnd: microToVnd(updated?.balanceMinLimit || 0),
    balanceVnd: microToVnd(updated?.balance || 0),
  });
}
