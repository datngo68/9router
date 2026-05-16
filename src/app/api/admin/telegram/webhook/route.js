import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getBotIdentity, clearBotIdentityCache } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

// POST /api/admin/telegram/webhook
//   body: { publicUrl }
//   Sets the Telegram bot webhook to <publicUrl>/api/telegram/webhook with a
//   freshly-generated secret. Stores secret in settings.
export async function POST(request) {
  const settings = await getSettings();
  if (!settings.telegramBotToken) {
    return NextResponse.json({ error: "Telegram bot token chưa được cấu hình" }, { status: 400 });
  }
  let body = {};
  try { body = await request.json(); } catch {}
  const publicUrl = (body?.publicUrl || settings.storeUrl || "").trim().replace(/\/$/, "");
  if (!publicUrl) return NextResponse.json({ error: "publicUrl bắt buộc (hoặc set settings.storeUrl)" }, { status: 400 });

  const secret = crypto.randomBytes(24).toString("base64url");
  const webhookUrl = `${publicUrl}/api/telegram/webhook`;
  const tgRes = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  });
  const data = await tgRes.json().catch(() => ({}));
  if (!tgRes.ok || !data?.ok) {
    return NextResponse.json({ error: data?.description || "setWebhook failed" }, { status: 400 });
  }
  await updateSettings({ telegramWebhookSecret: secret, telegramWebhookUrl: webhookUrl });
  // Refresh @username cache so the link page reflects new bot config.
  clearBotIdentityCache();
  await getBotIdentity();
  return NextResponse.json({ ok: true, webhookUrl });
}

// DELETE /api/admin/telegram/webhook — remove webhook
export async function DELETE() {
  const settings = await getSettings();
  if (settings.telegramBotToken) {
    await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/deleteWebhook`).catch(() => {});
  }
  await updateSettings({ telegramWebhookSecret: null, telegramWebhookUrl: null });
  return NextResponse.json({ ok: true });
}

// GET /api/admin/telegram/webhook — current state
export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    webhookUrl: settings.telegramWebhookUrl || null,
    hasSecret: !!settings.telegramWebhookSecret,
    botConfigured: !!settings.telegramBotToken,
  });
}
