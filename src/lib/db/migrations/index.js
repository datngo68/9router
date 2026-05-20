// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial.js";
import m002 from "./002-api-key-limits.js";
import m003 from "./003-api-key-rate-limit.js";
import m004 from "./004-api-key-hash.js";
import m005 from "./005-encrypt-credentials.js";
import m006 from "./006-api-key-monthly-lifetime.js";
import m007 from "./007-api-key-ip-allowlist.js";
import m008 from "./008-key-audit-log.js";
import m009 from "./009-storefront.js";
import m010 from "./010-customer-auth-upgrade.js";
import m011 from "./011-apibank-payment.js";
import m012 from "./012-plan-max-purchases.js";
import m013 from "./013-vouchers.js";
import m014 from "./014-api-key-compress-mode.js";
import m015 from "./015-notifications.js";
import m016 from "./016-referrals.js";
import m017 from "./017-notifications-schedule.js";
import m018 from "./018-payg-wallet.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011, m012, m013, m014, m015, m016, m017, m018].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
