import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { encryptString, decryptString, isEncrypted } from "@/lib/crypto/secretBox.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";

// Sensitive settings encrypted at rest (Phase 2.1 storefront extension).
const ENCRYPTED_SETTING_KEYS = [
  "telegramBotToken",
  "telegramWebhookSecret",
  "smtpPass",
  "customerGoogleClientSecret",
  "apibankApiKey",
  "apibankWebhookSecret",
];

function encryptSensitive(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  for (const k of ENCRYPTED_SETTING_KEYS) {
    if (typeof out[k] === "string" && out[k] && !isEncrypted(out[k])) {
      try { out[k] = encryptString(out[k]); }
      catch (e) { console.error(`encryptSensitive ${k}:`, e.message); }
    }
  }
  return out;
}

function decryptSensitive(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  for (const k of ENCRYPTED_SETTING_KEYS) {
    if (typeof out[k] === "string" && isEncrypted(out[k])) {
      try { out[k] = decryptString(out[k]); }
      catch (e) { console.error(`decryptSensitive ${k}:`, e.message); }
    }
  }
  return out;
}

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  requireLogin: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  enableObservability: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  cavemanEnabled: false,
  cavemanLevel: "full",
  customerGoogleOAuthEnabled: false,
  customerGoogleClientId: "",
  customerGoogleClientSecret: "",
  customerGoogleRedirectUri: "",
  // APIBank — automated payment via apibak.tudonghoa.me
  apibankEnabled: false,
  apibankBaseUrl: "",
  apibankApiKey: "",
  apibankBankAccountId: "",
  apibankWebhookSecret: "",
  // Wallet & PAYG — pay-as-you-go fallback billing
  walletEnabled: false,
  walletTopupMinVnd: 10000,
  walletTopupMaxVnd: 10000000,
  walletLowBalanceThresholdVnd: 10000,
  paygMinChargeVnd: 1,
  paygMarkupMultiplier: 1.5,
  paygFxVndPerUsd: 26000,
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? decryptSensitive(parseJson(row.data, {})) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  return merged;
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? decryptSensitive(parseJson(row.data, {})) : {};
    next = { ...current, ...updates };
    const persisted = encryptSensitive(next);
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(persisted)]
    );
  });
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

// Fields that are sensitive secrets and must never appear in exports/backups.
const SECRET_KEYS = ["password", "oidcClientSecret", "telegramBotToken", "telegramWebhookSecret", "smtpPass", "customerGoogleClientSecret", "apibankApiKey", "apibankWebhookSecret"];

export async function exportSettings({ includeSecrets = false } = {}) {
  const raw = await readRaw();
  if (includeSecrets) return raw;
  const sanitized = { ...raw };
  for (const k of SECRET_KEYS) delete sanitized[k];
  return sanitized;
}
