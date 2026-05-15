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

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
