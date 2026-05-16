import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { updateCustomer } from "@/lib/localDb";
import { createLinkToken } from "@/lib/notify/telegramLink";
import { buildStartLink, getBotIdentity } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

// POST /api/account/telegram/link
//   Returns a one-shot Telegram start URL the customer clicks. Webhook will
//   bind the resulting chatId to the logged-in customerId.
export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bot = await getBotIdentity();
  if (!bot) return NextResponse.json({ error: "Telegram bot chưa được cấu hình" }, { status: 503 });

  const { token, expiresAt } = await createLinkToken({ purpose: "customer", customerId: session.customer.id });
  const url = await buildStartLink(token);
  return NextResponse.json({ url, expiresAt, botUsername: bot.username });
}

// DELETE /api/account/telegram/link — unlink current customer
export async function DELETE(request) {
  const session = await getCurrentCustomer(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await updateCustomer(session.customer.id, { telegramChatId: null });
  return NextResponse.json({ ok: true });
}
