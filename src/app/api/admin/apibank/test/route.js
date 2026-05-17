// Admin-only helpers for the APIBank settings card.
//
//   POST /api/admin/apibank/test       — verify base URL + API key by hitting
//                                        a low-cost APIBank endpoint. Accepts
//                                        an unsaved `baseUrl` + `apiKey` from
//                                        the body so admin can validate
//                                        before saving.
//   POST /api/admin/apibank/test       (no body)  — uses saved settings.
//   POST /api/admin/apibank/secret     — return a freshly-generated 64-hex
//                                        webhook secret for admin to paste
//                                        into both 9router and APIBank
//                                        dashboards.

import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { pingApibank, generateWebhookSecret } from "@/lib/payments/apibank";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}

  // Sub-action: just generate a secret. Lets the dashboard avoid bundling
  // crypto.randomBytes in the client when running in older browsers — and
  // keeps the secret format consistent with what we expect.
  if (body?.action === "generateSecret") {
    return NextResponse.json({ secret: generateWebhookSecret() });
  }

  // Default: ping connectivity. If admin omitted credentials, fall back to
  // saved settings so they can re-test an already-configured deployment.
  let { baseUrl, apiKey } = body || {};
  if (!baseUrl || !apiKey) {
    const s = await getSettings();
    baseUrl = baseUrl || s.apibankBaseUrl;
    apiKey = apiKey || s.apibankApiKey;
  }
  if (!baseUrl || !apiKey) {
    return NextResponse.json({ error: "baseUrl and apiKey required" }, { status: 400 });
  }

  try {
    const result = await pingApibank({ baseUrl, apiKey });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || "ping failed", status: e.status || null }, { status: 200 });
  }
}
