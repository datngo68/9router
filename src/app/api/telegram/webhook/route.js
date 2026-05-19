import { NextResponse } from "next/server";
import { getSettings, updateSettings, updateCustomer, getCustomerById, getOrderById, getPricingPlanById, confirmOrderAtomic, cancelOrder } from "@/lib/localDb";
import {
  getLinkToken,
  consumeLinkToken,
  setPendingPin,
  getPendingPin,
  clearPendingPin,
  recordPinAttempt,
  MAX_ATTEMPTS,
} from "@/lib/notify/telegramLink";
import { sendTelegramMessage, tgEditMessage, tgAnswerCallback, resolvePublicUrl } from "@/lib/notify/telegram";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { sendKeyDeliveredEmail } from "@/lib/notify/email";
import { notifyCustomerKeyDelivered } from "@/lib/notify/telegram";
import { safeEqual } from "@/shared/utils/safeCompare";

export const dynamic = "force-dynamic";

async function isAdminChat(chatId) {
  const settings = await getSettings();
  return settings.telegramAdminChatId && String(chatId) === String(settings.telegramAdminChatId);
}

async function handleAdminOrderCallback({ orderId, action, callbackQuery, chatId }) {
  console.log("[tg-webhook] handleAdminOrderCallback", { orderId, action });
  const order = await getOrderById(orderId);
  if (!order) {
    console.log("[tg-webhook] order not found:", orderId);
    await tgAnswerCallback(callbackQuery.id, "Đơn không tồn tại");
    return;
  }
  console.log("[tg-webhook] order status:", order.status);

  if (action === "confirm") {
    if (order.status !== "pending") {
      await tgAnswerCallback(callbackQuery.id, `Đơn đang ở trạng thái ${order.status}, không thể confirm.`);
      return;
    }
    let result;
    try {
      const machineId = await getConsistentMachineId();
      console.log("[tg-webhook] machineId loaded, calling confirmOrderAtomic");
      result = await confirmOrderAtomic({ orderId, machineId, paymentRef: "via-telegram", actorIp: "telegram" });
      console.log("[tg-webhook] confirm OK, apiKeyId:", result.apiKey?.id);
    } catch (e) {
      console.error("[tg-webhook] confirm threw:", e);
      await tgAnswerCallback(callbackQuery.id, "Lỗi: " + e.message);
      return;
    }

    // Acknowledge the spinner in-chat ngay khi DB write thành công.
    await tgAnswerCallback(callbackQuery.id, "Đã confirm và phát key.");

    // Edit message + gửi notify cho customer chạy ngầm để webhook trả về
    // nhanh, tránh Telegram timeout (60s) hoặc admin chờ lâu.
    (async () => {
      try {
        const customer = await getCustomerById(order.customerId);
        const plan = await getPricingPlanById(order.planId);
        const portalUrl = await resolvePublicUrl("/store/account/keys");
        await tgEditMessage(chatId, callbackQuery.message?.message_id, [
          `✅ *Đã giao ${order.id}*`,
          `Khách: ${customer?.email || ""}`,
          `Gói: ${plan?.name || ""}`,
          `Tiền: ${order.priceVnd.toLocaleString("vi-VN")}đ`,
        ].join("\n"));
        if (result.apiKey?.key) {
          await sendKeyDeliveredEmail({
            email: customer?.email,
            displayName: customer?.displayName,
            planName: plan?.name || "Plan",
            key: result.apiKey.key,
            keyDisplay: result.apiKey.keyDisplay,
            portalUrl,
          });
          await notifyCustomerKeyDelivered({ customer, planName: plan?.name || "Plan", key: result.apiKey.key, keyDisplay: result.apiKey.keyDisplay, portalUrl });
        }
      } catch (e) { console.log("[tg-webhook] post-confirm notify failed:", e.message); }
    })();
    return;
  }

  if (action === "cancel") {
    if (order.status !== "pending") {
      await tgAnswerCallback(callbackQuery.id, `Đơn đang ở trạng thái ${order.status}, không thể hủy.`);
      return;
    }
    try {
      await cancelOrder(orderId);
    } catch (e) {
      console.error("[tg-webhook] cancel threw:", e);
      await tgAnswerCallback(callbackQuery.id, "Lỗi: " + e.message);
      return;
    }
    await tgAnswerCallback(callbackQuery.id, "Đã hủy đơn.");
    tgEditMessage(chatId, callbackQuery.message?.message_id, [
      `❌ *Đã hủy ${order.id}*`,
      `Tiền: ${order.priceVnd.toLocaleString("vi-VN")}đ`,
    ].join("\n")).catch((e) => console.log("[tg-webhook] edit failed:", e.message));
    return;
  }

  await tgAnswerCallback(callbackQuery.id, "Action không hỗ trợ.");
}

// POST /api/telegram/webhook?secret=<webhookSecret>
export async function POST(request) {
  const settings = await getSettings();
  if (!settings.telegramWebhookSecret) {
    console.log("[tg-webhook] no secret configured");
    return NextResponse.json({ ok: false, error: "webhook not configured" }, { status: 503 });
  }
  const provided = request.headers.get("x-telegram-bot-api-secret-token") || new URL(request.url).searchParams.get("secret");
  if (!safeEqual(provided || "", settings.telegramWebhookSecret)) {
    console.log("[tg-webhook] secret mismatch", {
      hasHeader: !!request.headers.get("x-telegram-bot-api-secret-token"),
      hasQuery: !!new URL(request.url).searchParams.get("secret"),
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update;
  try { update = await request.json(); }
  catch { return NextResponse.json({ ok: true }); }

  console.log("[tg-webhook] update kind:", Object.keys(update || {}).filter((k) => k !== "update_id").join(","));

  // Inline button click → callback_query (admin only)
  if (update?.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const data = String(cq.data || "");
    console.log("[tg-webhook] callback_query", { chatId, data, fromId: cq.from?.id });
    if (!chatId) return NextResponse.json({ ok: true });
    if (!(await isAdminChat(chatId))) {
      console.log("[tg-webhook] not admin chat — adminChatId in settings:", settings.telegramAdminChatId);
      await tgAnswerCallback(cq.id, "Chỉ admin được dùng nút này.");
      return NextResponse.json({ ok: true });
    }
    if (data.startsWith("ord:")) {
      const [, orderId, action] = data.split(":");
      try {
        await handleAdminOrderCallback({ orderId, action, callbackQuery: cq, chatId });
      } catch (e) {
        console.error("[tg-webhook] handler threw:", e);
        await tgAnswerCallback(cq.id, "Lỗi: " + e.message).catch(() => {});
      }
    } else {
      await tgAnswerCallback(cq.id);
    }
    return NextResponse.json({ ok: true });
  }

  const message = update?.message || update?.edited_message;
  const chatId = message?.chat?.id;
  const text = (message?.text || "").trim();
  if (!chatId || !text) return NextResponse.json({ ok: true });

  // /start <token>
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/, 2);
    const token = parts[1];
    if (!token) {
      await sendTelegramMessage(chatId, "Hi! Hãy mở link liên kết tài khoản từ portal/dashboard để bắt đầu.");
      return NextResponse.json({ ok: true });
    }
    const link = await getLinkToken(token);
    if (!link) {
      await sendTelegramMessage(chatId, "Link liên kết đã hết hạn hoặc không hợp lệ. Tạo link mới từ portal.");
      return NextResponse.json({ ok: true });
    }

    if (link.purpose === "customer") {
      const customer = await getCustomerById(link.customerId);
      if (!customer) {
        await consumeLinkToken(token);
        await sendTelegramMessage(chatId, "Tài khoản không tồn tại.");
        return NextResponse.json({ ok: true });
      }
      await updateCustomer(customer.id, { telegramChatId: String(chatId) });
      await consumeLinkToken(token);
      await sendTelegramMessage(chatId, `✅ Đã liên kết Telegram với tài khoản *${customer.email}*.\n\nKey và thông báo đơn sẽ được gửi tới đây.`);
      return NextResponse.json({ ok: true });
    }

    if (link.purpose === "admin") {
      await setPendingPin(chatId, token);
      await sendTelegramMessage(chatId, "Nhập mã PIN 6 chữ số hiển thị trong dashboard để hoàn tất liên kết admin.");
      return NextResponse.json({ ok: true });
    }
  }

  // PIN reply for pending admin link
  const pending = await getPendingPin(chatId);
  if (pending && /^\d{4,8}$/.test(text)) {
    const link = await getLinkToken(pending.token);
    if (!link || link.purpose !== "admin") {
      await clearPendingPin(chatId);
      await sendTelegramMessage(chatId, "Phiên liên kết admin đã hết hạn. Tạo link mới từ dashboard.");
      return NextResponse.json({ ok: true });
    }
    if (text === link.pin) {
      await updateSettings({ telegramAdminChatId: String(chatId) });
      await consumeLinkToken(pending.token);
      await clearPendingPin(chatId);
      await sendTelegramMessage(chatId, "✅ Đã liên kết Admin Telegram. Mọi đơn mới sẽ có nút Xác nhận / Hủy ngay trong chat.");
      return NextResponse.json({ ok: true });
    }
    const attempts = (link.pinAttempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await consumeLinkToken(pending.token);
      await clearPendingPin(chatId);
      await sendTelegramMessage(chatId, "❌ Sai PIN quá số lần cho phép. Vui lòng tạo link liên kết mới từ dashboard.");
    } else {
      await recordPinAttempt(pending.token, attempts);
      await sendTelegramMessage(chatId, `❌ PIN không đúng. Còn ${MAX_ATTEMPTS - attempts} lần thử.`);
    }
    return NextResponse.json({ ok: true });
  }

  await sendTelegramMessage(chatId, "Chat ID của bạn: `" + chatId + "`");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST only — Telegram webhook" });
}
