import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import {
  getSettings,
  createTopupOrder,
  getOrders,
  attachApibankOrder,
} from "@/lib/localDb";
import {
  getWalletBalance,
  listWalletTransactions,
  microToVnd,
} from "@/lib/db/repos/walletRepo.js";
import { createApibankOrder } from "@/lib/payments/apibank";
import { getClientIp, recordFailure, checkLogin } from "@/lib/auth/loginThrottle";
import { apiError } from "@/shared/utils/apiError";

export const dynamic = "force-dynamic";

// GET /api/account/wallet — balance + ledger for the logged-in customer.
//   query: ?limit=50&offset=0&type=topup|charge|adjustment|refund
export async function GET(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const type = url.searchParams.get("type") || null;

  const balance = await getWalletBalance(session.customer.id);
  const ledger = await listWalletTransactions(session.customer.id, { limit, offset, type });
  const settings = await getSettings();

  // Return open top-up orders so the wallet page can show pending QR if any.
  const openOrders = await getOrders({ customerId: session.customer.id, status: "pending" });
  const pendingTopups = openOrders.filter((o) => o.kind === "walletTopup");

  return NextResponse.json({
    walletEnabled: !!settings.walletEnabled,
    paygSelfServe: settings.walletPaygSelfServeKeys !== false,
    paygMaxKeysPerCustomer: Number(settings.walletPaygMaxKeysPerCustomer || 5),
    balance: {
      micro: balance?.balance || 0,
      vnd: microToVnd(balance?.balance || 0),
      minLimitMicro: balance?.balanceMinLimit || 0,
      minLimitVnd: microToVnd(balance?.balanceMinLimit || 0),
    },
    lowBalanceThresholdVnd: Number(settings.walletLowBalanceThresholdVnd || 0),
    topupMinVnd: Number(settings.walletTopupMinVnd || 0),
    topupMaxVnd: Number(settings.walletTopupMaxVnd || 0),
    items: ledger.items.map((t) => ({
      ...t,
      deltaVnd: microToVnd(t.delta),
      balanceAfterVnd: microToVnd(t.balanceAfter),
    })),
    total: ledger.total,
    pendingTopups,
  });
}

// POST /api/account/wallet/topup — create a wallet top-up order.
//   body: { amountVnd }
export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = getClientIp(request);
  const lock = checkLogin(`walletTopup:${ip}`);
  if (lock.locked) {
    const retrySec = Math.max(1, Math.ceil(lock.retryAfterMs / 1000));
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu, thử lại sau." },
      { status: 429, headers: { "Retry-After": String(retrySec) } }
    );
  }

  const settings = await getSettings();
  if (!settings.walletEnabled) {
    return NextResponse.json({ error: "Tính năng ví chưa được bật" }, { status: 403 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const amountVnd = Math.trunc(Number(body?.amountVnd) || 0);
  const minVnd = Number(settings.walletTopupMinVnd || 1);
  const maxVnd = Number(settings.walletTopupMaxVnd || 0);
  if (amountVnd < minVnd) {
    recordFailure(`walletTopup:${ip}`);
    return NextResponse.json(
      { error: `Số tiền tối thiểu là ${minVnd.toLocaleString("vi-VN")} VND` },
      { status: 400 }
    );
  }
  if (maxVnd > 0 && amountVnd > maxVnd) {
    recordFailure(`walletTopup:${ip}`);
    return NextResponse.json(
      { error: `Số tiền tối đa là ${maxVnd.toLocaleString("vi-VN")} VND` },
      { status: 400 }
    );
  }

  let order;
  try {
    order = await createTopupOrder({ customerId: session.customer.id, amountVnd });
  } catch (e) {
    recordFailure(`walletTopup:${ip}`);
    return apiError(e, "Tạo đơn nạp ví thất bại", 400, "wallet/topup");
  }

  // Attach APIBank order so the webhook can match by customer_ref or apibankCode.
  try {
    if (settings?.apibankEnabled && settings?.apibankBaseUrl && settings?.apibankApiKey && settings?.apibankBankAccountId) {
      const ab = await createApibankOrder({
        routerOrderId: order.id,
        amountVnd: order.priceVnd,
        description: `Wallet topup · ${order.id}`,
        ttlSeconds: 900,
      });
      if (ab?.id && ab?.code) {
        order = await attachApibankOrder(order.id, {
          apibankOrderId: ab.id,
          apibankCode: ab.code,
          apibankExpiredAt: ab.expired_at || null,
        });
      }
    }
  } catch (e) {
    console.log(`[wallet topup] APIBank create failed for ${order.id}:`, e.message);
  }

  return NextResponse.json({ order }, { status: 201 });
}
