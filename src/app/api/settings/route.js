import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import { validateSettingsPatch } from "@/lib/security/tunnelGuard";
import { apiError } from "@/shared/utils/apiError";
import { normalizeAllowedOrigin } from "@/sse/utils/cors";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, telegramBotToken, telegramWebhookSecret, smtpPass, customerGoogleClientSecret, apibankApiKey, apibankWebhookSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    safeSettings.hasTelegramBotToken = !!telegramBotToken;
    safeSettings.hasTelegramWebhookSecret = !!telegramWebhookSecret;
    safeSettings.hasSmtpPass = !!smtpPass;
    safeSettings.customerGoogleConfigured = !!(safeSettings.customerGoogleClientId && customerGoogleClientSecret);
    safeSettings.hasApibankApiKey = !!apibankApiKey;
    safeSettings.hasApibankWebhookSecret = !!apibankWebhookSecret;
    safeSettings.apibankConfigured = !!(safeSettings.apibankBaseUrl && apibankApiKey && safeSettings.apibankBankAccountId && apibankWebhookSecret);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    return apiError(error, "Failed to load settings", 500, "settings/get");
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    // Reject patches that would weaken security while a tunnel is active.
    const guard = await validateSettingsPatch(body);
    if (guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
      // Invalidate all existing sessions when password changes.
      const { revokeAllDashboardSessions } = await import("@/lib/auth/dashboardSession");
      const newVersion = await revokeAllDashboardSessions();
      body.tokenVersion = newVersion;
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    // Storefront sensitive setters: ignore empty values so admin doesn't
    // accidentally wipe them by re-saving a sanitized form.
    for (const k of ["telegramBotToken", "smtpPass", "customerGoogleClientSecret", "apibankApiKey", "apibankWebhookSecret"]) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        if (!body[k] || !String(body[k]).trim()) delete body[k];
      }
    }

    // Validate APIBank config when admin enables it.
    if (body.apibankEnabled === true) {
      const merged = { ...(await getSettings()), ...body };
      if (!String(merged.apibankBaseUrl || "").trim()) {
        return NextResponse.json({ error: "APIBank base URL bắt buộc khi bật." }, { status: 400 });
      }
      if (!String(merged.apibankApiKey || "").trim()) {
        return NextResponse.json({ error: "APIBank API key bắt buộc khi bật." }, { status: 400 });
      }
      if (!String(merged.apibankBankAccountId || "").trim()) {
        return NextResponse.json({ error: "APIBank bank_account_id bắt buộc khi bật." }, { status: 400 });
      }
      const sec = String(merged.apibankWebhookSecret || "").trim();
      if (sec.length < 16) {
        return NextResponse.json({ error: "APIBank webhook secret phải ≥ 16 ký tự. Bấm 'Sinh secret mới' để tạo nhanh." }, { status: 400 });
      }
    }

    // Validate corsAllowedOrigins format. Each entry must be `*` or
    // `http(s)://host(:port)` — reject the patch on the first malformed
    // item rather than silently dropping it, so admin sees the typo.
    if (Object.prototype.hasOwnProperty.call(body, "corsAllowedOrigins")) {
      const raw = body.corsAllowedOrigins;
      const items = Array.isArray(raw)
        ? raw
        : (typeof raw === "string" ? raw.split(",") : []);
      const cleaned = [];
      for (const item of items) {
        const trimmed = String(item || "").trim();
        if (!trimmed) continue;
        const norm = normalizeAllowedOrigin(trimmed);
        if (!norm) {
          return NextResponse.json(
            { error: `corsAllowedOrigins entry không hợp lệ: ${trimmed}. Dùng dạng https://host(:port) hoặc *.` },
            { status: 400 }
          );
        }
        cleaned.push(norm);
      }
      body.corsAllowedOrigins = cleaned;
    }

    const settings = await updateSettings(body);

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    const { password, oidcClientSecret, telegramBotToken, telegramWebhookSecret, smtpPass, customerGoogleClientSecret, apibankApiKey, apibankWebhookSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    safeSettings.hasTelegramBotToken = !!telegramBotToken;
    safeSettings.hasTelegramWebhookSecret = !!telegramWebhookSecret;
    safeSettings.hasSmtpPass = !!smtpPass;
    safeSettings.customerGoogleConfigured = !!(safeSettings.customerGoogleClientId && customerGoogleClientSecret);
    safeSettings.hasApibankApiKey = !!apibankApiKey;
    safeSettings.hasApibankWebhookSecret = !!apibankWebhookSecret;
    safeSettings.apibankConfigured = !!(safeSettings.apibankBaseUrl && apibankApiKey && safeSettings.apibankBankAccountId && apibankWebhookSecret);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    return apiError(error, "Failed to update settings", 500, "settings/update");
  }
}
