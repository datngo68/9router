// Admin proxy: list APIBank bank accounts so the settings UI can render a
// dropdown instead of asking admin to paste a UUID.
//
// Accepts an optional `baseUrl` + `apiKey` in the JSON body so admin can
// query during the initial config flow (before saving). Falls back to saved
// settings when omitted.

import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { listApibankBankAccounts } from "@/lib/payments/apibank";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  let { baseUrl, apiKey } = body || {};
  if (!baseUrl || !apiKey) {
    const s = await getSettings();
    baseUrl = baseUrl || s.apibankBaseUrl;
    apiKey = apiKey || s.apibankApiKey;
  }
  if (!baseUrl || !apiKey) {
    return NextResponse.json({ error: "baseUrl và apiKey bắt buộc" }, { status: 400 });
  }
  try {
    const accounts = await listApibankBankAccounts({ baseUrl, apiKey });
    return NextResponse.json({ accounts });
  } catch (e) {
    const msg = e.message || "lỗi khi list bank accounts";
    if (e.status === 403) {
      return NextResponse.json({
        error: "API key thiếu scope bank_accounts:read. Vào APIBank dashboard · API Keys, edit key và tick scope này (hoặc tạo key mới).",
      }, { status: 200 });
    }
    return NextResponse.json({ error: msg, status: e.status || null }, { status: 200 });
  }
}
