import { NextResponse } from "next/server";
import { updateSettings, getSettings } from "@/lib/localDb";
import { createLinkToken } from "@/lib/notify/telegramLink";
import { buildStartLink, getBotIdentity } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

// POST /api/admin/telegram/link
//   Returns a single-use start URL + 6-digit PIN. PIN must be re-typed in
//   the Telegram chat after Start to complete linking. Token expires 5m.
export async function POST() {
  const bot = await getBotIdentity();
  if (!bot) return NextResponse.json({ error: "Telegram bot chưa được cấu hình" }, { status: 503 });

  const { token, pin, expiresAt } = await createLinkToken({ purpose: "admin" });
  const url = await buildStartLink(token);
  return NextResponse.json({ url, pin, expiresAt, botUsername: bot.username });
}

// DELETE /api/admin/telegram/link — unlink admin chat
export async function DELETE() {
  await updateSettings({ telegramAdminChatId: null });
  return NextResponse.json({ ok: true });
}

// GET /api/admin/telegram/link — current state
export async function GET() {
  const settings = await getSettings();
  const bot = await getBotIdentity();
  return NextResponse.json({
    linked: !!settings.telegramAdminChatId,
    chatId: settings.telegramAdminChatId || null,
    botConfigured: !!bot,
    botUsername: bot?.username || null,
  });
}
