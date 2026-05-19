// Shared helper for the local CLI bypass token.
//
// The token is a random 32-byte secret persisted in the data directory
// (mode 0600 on Unix). It replaces the older machine-id-derived token, which
// could be forged by anyone who could read /etc/machine-id or the Windows
// registry. The CLI reads the same file via cli/src/cli/api/client.js.
//
// Rotate by deleting the file and restarting the dashboard process.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { safeEqual } from "@/shared/utils/safeCompare";

export const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_FILE = path.join(DATA_DIR, "cli-token");

let cachedCliToken = null;

function generateCliToken() {
  return crypto.randomBytes(32).toString("hex");
}

function loadOrCreate() {
  try {
    const raw = fs.readFileSync(CLI_TOKEN_FILE, "utf8").trim();
    if (raw) return raw;
  } catch {}
  const token = generateCliToken();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLI_TOKEN_FILE, token, { mode: 0o600 });
  } catch (e) {
    // Even if we couldn't persist, returning the generated token is still
    // safer than the previous machine-id derivation. CLI requests will fail
    // until the file can be written, which surfaces config issues quickly.
    console.warn("[cliToken] failed to persist token file:", e?.message || e);
  }
  return token;
}

export async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = loadOrCreate();
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  const token = request.headers.get?.(CLI_TOKEN_HEADER);
  if (!token) return false;
  const expected = await getCliToken();
  return safeEqual(token, expected);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLoopbackRequest(request) {
  const host = request.headers.get?.("host") || "";
  const name = host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTS.has(name);
}
