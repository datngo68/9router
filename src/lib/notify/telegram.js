// Telegram notifications. Stub-friendly: silent no-op if bot token isn't set.
//
// Bot token + admin chat ID live in encrypted settings (admin UI). Customer
// chat ID is on the customer record (optional self-set).

import { getSettings } from "@/lib/localDb";

async function readTgSettings() {
  try {
    const settings = await getSettings();
    return {
      botToken: settings.telegramBotToken,
      botUsername: settings.telegramBotUsername || null,
      adminChatId: settings.telegramAdminChatId,
    };
  } catch {
    return null;
  }
}

let cachedBotMe = null;
/**
 * Read the bot's own profile via getMe. Cached for the lifetime of the
 * process; called whenever we need the @username for deep-links and the
 * `telegramBotUsername` setting hasn't been pre-populated.
 */
export async function getBotIdentity() {
  if (cachedBotMe) return cachedBotMe;
  const cfg = await readTgSettings();
  if (!cfg?.botToken) return null;
  if (cfg.botUsername) {
    cachedBotMe = { username: cfg.botUsername, configured: true };
    return cachedBotMe;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok) return null;
    cachedBotMe = { username: data.result.username, id: data.result.id, configured: true };
    return cachedBotMe;
  } catch (e) {
    console.log("[telegram] getMe failed:", e.message);
    return null;
  }
}

export function clearBotIdentityCache() {
  cachedBotMe = null;
}

/**
 * Build the deep-link URL to start a chat with payload.
 *   https://t.me/<bot>?start=<token>
 */
export async function buildStartLink(token) {
  const me = await getBotIdentity();
  if (!me?.username) return null;
  return `https://t.me/${me.username}?start=${encodeURIComponent(token)}`;
}

/**
 * Resolve a path into a fully-qualified URL using settings.storeUrl. Used
 * everywhere we need to send a clickable link in email or Telegram, where
 * relative paths render as plain text.
 */
export async function resolvePublicUrl(path = "") {
  if (!path) return "";
  try {
    const settings = await readTgSettings();
    const base = await getStoreBase();
    if (base) return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  } catch {}
  return path;
}

async function getStoreBase() {
  try {
    const { getSettings } = await import("@/lib/localDb");
    const s = await getSettings();
    const base = String(s?.storeUrl || "").trim().replace(/\/$/, "");
    return base || "";
  } catch { return ""; }
}

async function tgSend(chatId, text, opts = {}) {
  const cfg = await readTgSettings();
  if (!cfg?.botToken || !chatId) {
    console.log("[telegram] not configured; skipping", { chatId, text: text.slice(0, 60) });
    return { skipped: true };
  }
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  try {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };
    if (opts.replyMarkup) body.reply_markup = opts.replyMarkup;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const respText = await res.text().catch(() => "");
      console.log("[telegram] non-OK response", res.status, respText);
      return { ok: false };
    }
    const data = await res.json().catch(() => null);
    return { ok: true, messageId: data?.result?.message_id || null };
  } catch (e) {
    console.log("[telegram] send failed:", e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Edit a previously-sent admin message — used after callback_query to update
 * the order status row in-chat.
 */
export async function tgEditMessage(chatId, messageId, text, opts = {}) {
  const cfg = await readTgSettings();
  if (!cfg?.botToken) return { skipped: true };
  const url = `https://api.telegram.org/bot${cfg.botToken}/editMessageText`;
  try {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };
    if (opts.replyMarkup) body.reply_markup = opts.replyMarkup;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok };
  } catch (e) {
    console.log("[telegram] edit failed:", e.message);
    return { ok: false };
  }
}

/**
 * Acknowledge a callback_query so Telegram stops the spinner.
 */
export async function tgAnswerCallback(callbackQueryId, text) {
  const cfg = await readTgSettings();
  if (!cfg?.botToken) return;
  await fetch(`https://api.telegram.org/bot${cfg.botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || "" }),
  }).catch(() => {});
}

/**
 * Low-level send helper for non-notification flows (e.g. webhook replies).
 */
export async function sendTelegramMessage(chatId, text) {
  return tgSend(chatId, text);
}

export async function notifyAdminOrderCreated({ order, customer, planName }) {
  const cfg = await readTgSettings();
  if (!cfg?.adminChatId) return { skipped: true };
  const text = [
    `*Đơn mới ${order.id}*`,
    `Khách: ${customer?.email || customer?.id}`,
    `Gói: ${planName}`,
    `Tiền: ${order.priceVnd.toLocaleString("vi-VN")}đ`,
    `Thanh toán: ${order.paymentMethod || "-"}`,
  ].join("\n");
  // Inline keyboard with Confirm/Cancel buttons. Callback data = "ord:<id>:<action>"
  const replyMarkup = {
    inline_keyboard: [[
      { text: "✅ Xác nhận thanh toán", callback_data: `ord:${order.id}:confirm` },
      { text: "❌ Hủy đơn", callback_data: `ord:${order.id}:cancel` },
    ]],
  };
  return tgSend(cfg.adminChatId, text, { replyMarkup });
}

export async function notifyAdminOrderConfirmed({ order, customer, planName }) {
  const cfg = await readTgSettings();
  if (!cfg?.adminChatId) return { skipped: true };
  const text = [
    `*Đã giao ${order.id}*`,
    `Khách: ${customer?.email}`,
    `Gói: ${planName}`,
  ].join("\n");
  return tgSend(cfg.adminChatId, text);
}

export async function notifyCustomerKeyDelivered({ customer, planName, key, keyDisplay, portalUrl }) {
  if (!customer?.telegramChatId) return { skipped: true };
  const lines = [
    `*Key đã sẵn sàng*`,
    `Gói: ${planName}`,
  ];
  if (key) {
    // Send the raw key in a Markdown code block so the user can long-press to
    // copy in the Telegram app. We escape backticks defensively.
    const safe = String(key).replace(/`/g, "");
    lines.push("");
    lines.push("Key đầy đủ (long-press để copy):");
    lines.push("```");
    lines.push(safe);
    lines.push("```");
    lines.push(`Rút gọn: \`${keyDisplay}\``);
  } else {
    lines.push(`Key (rút gọn): \`${keyDisplay}\``);
  }
  if (portalUrl) lines.push(`Quản lý: ${portalUrl}`);
  return tgSend(customer.telegramChatId, lines.join("\n"));
}

export async function notifyCustomerKeyRegenerated({ customer, key, keyDisplay }) {
  if (!customer?.telegramChatId) return { skipped: true };
  const safe = String(key || "").replace(/`/g, "");
  const text = [
    `*Key đã được làm mới*`,
    `Key cũ đã bị thu hồi.`,
    "",
    "Key đầy đủ mới (long-press để copy):",
    "```",
    safe,
    "```",
    `Rút gọn: \`${keyDisplay}\``,
  ].join("\n");
  return tgSend(customer.telegramChatId, text);
}

/**
 * Generic per-customer notification — used by admin broadcast + referral rewards.
 * Body markdown is sent as-is; caller is responsible for escaping.
 */
export async function notifyCustomerCustom({ customer, title, body, link }) {
  if (!customer?.telegramChatId) return { skipped: true };
  const lines = [`*${String(title || "").replace(/\*/g, "")}*`];
  if (body) {
    lines.push("");
    lines.push(String(body));
  }
  if (link) {
    lines.push("");
    lines.push(link);
  }
  return tgSend(customer.telegramChatId, lines.join("\n"));
}
