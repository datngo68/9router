// Wallet-related notification helpers.
//
// Three event types:
//   wallet.low_balance     warning  — balance dropped below threshold; fired
//                                     by the cron tick at most once per
//                                     customer per 24h.
//   wallet.topup_success   success  — top-up order delivered.
//   payg.charge_failed     alert    — request rejected because wallet has no
//                                     headroom or PAYG pricing is missing.
//
// All helpers are best-effort: logged failures never throw.

import { getAdapter } from "@/lib/db/driver.js";
import {
  createNotification,
  listForCustomer,
} from "@/lib/db/repos/notificationsRepo.js";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";

const LOW_BALANCE_DEDUPE_MS = 24 * 60 * 60 * 1000;
const TITLE_PREFIX = "[wallet] ";

function fmtVnd(v) {
  return Number(v || 0).toLocaleString("vi-VN");
}

/**
 * Send a low-balance notification once per 24h per customer. Detects
 * existing notifications by title prefix to avoid spamming.
 */
export async function notifyLowBalance(customer, { balanceVnd, thresholdVnd } = {}) {
  if (!customer?.id) return false;
  try {
    const recent = await listForCustomer(customer.id, { limit: 50 });
    const cutoff = Date.now() - LOW_BALANCE_DEDUPE_MS;
    const exists = recent.some(
      (n) =>
        n.title?.startsWith(TITLE_PREFIX + "Số dư ví thấp") &&
        new Date(n.createdAt).getTime() > cutoff
    );
    if (exists) return false;
    await createNotification({
      customerId: customer.id,
      title: TITLE_PREFIX + "Số dư ví thấp",
      body: `Số dư ví hiện chỉ còn ${fmtVnd(balanceVnd)} ₫ (ngưỡng cảnh báo: ${fmtVnd(thresholdVnd)} ₫). Hãy nạp thêm để các request PAYG không bị gián đoạn.`,
      type: "warning",
      link: "/store/account/wallet",
      channels: ["inapp"],
      createdBy: "system",
    });
    return true;
  } catch (e) {
    console.warn("[walletEvents] notifyLowBalance failed:", e.message);
    return false;
  }
}

export async function notifyTopupSuccess(customer, { amountVnd, balanceAfterVnd, orderId } = {}) {
  if (!customer?.id) return false;
  try {
    await createNotification({
      customerId: customer.id,
      title: TITLE_PREFIX + "Nạp ví thành công",
      body: `Đã cộng ${fmtVnd(amountVnd)} ₫ vào ví. Số dư hiện tại: ${fmtVnd(balanceAfterVnd)} ₫.`,
      type: "success",
      link: orderId ? `/store/order/${orderId}` : "/store/account/wallet",
      channels: ["inapp"],
      createdBy: "system",
    });
    return true;
  } catch (e) {
    console.warn("[walletEvents] notifyTopupSuccess failed:", e.message);
    return false;
  }
}

export async function notifyPaygChargeFailed(customer, { reason, model } = {}) {
  if (!customer?.id) return false;
  try {
    await createNotification({
      customerId: customer.id,
      title: TITLE_PREFIX + "Request bị từ chối",
      body: `Request${model ? ` cho model ${model}` : ""} không thể tính phí ví: ${reason}.`,
      type: "alert",
      link: "/store/account/wallet",
      channels: ["inapp"],
      createdBy: "system",
    });
    return true;
  } catch (e) {
    console.warn("[walletEvents] notifyPaygChargeFailed failed:", e.message);
    return false;
  }
}

/**
 * Cron tick: scan customers whose balance is below the configured threshold
 * AND have at least one apiKey with paygEnabled. Send low-balance noti for
 * each (deduped per-customer 24h via notifyLowBalance).
 *
 * Returns a count of notifications sent.
 */
export async function tickLowBalanceCheck() {
  const settings = await getSettings();
  if (!settings.walletEnabled) return { sent: 0, scanned: 0 };
  const thresholdVnd = Number(settings.walletLowBalanceThresholdVnd || 0);
  if (thresholdVnd <= 0) return { sent: 0, scanned: 0 };
  const thresholdMicro = Math.trunc(thresholdVnd * 1_000_000);

  const db = await getAdapter();
  const rows = db.all(
    `SELECT c.id, c.email, c.displayName, c.balance
       FROM customers c
      WHERE c.balance < ?
        AND EXISTS (
          SELECT 1 FROM apiKeys k WHERE k.customerId = c.id AND k.paygEnabled = 1 AND k.isActive = 1
        )`,
    [thresholdMicro]
  );

  let sent = 0;
  for (const r of rows) {
    const ok = await notifyLowBalance(
      { id: r.id, email: r.email, displayName: r.displayName },
      {
        balanceVnd: Math.floor(Number(r.balance || 0) / 1_000_000),
        thresholdVnd,
      }
    );
    if (ok) sent += 1;
  }
  return { sent, scanned: rows.length };
}
