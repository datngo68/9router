// Shared helper for the local CLI bypass token.
//
// The token is derived from the host's machine ID + a fixed salt so that any
// process running as the same OS user can prove "I'm local" without needing a
// stored secret. It mirrors the logic in `cli/src/cli/api/client.js` and
// `dashboardGuard.js`. Keep all three in sync.

import { getConsistentMachineId } from "@/shared/utils/machineId";

export const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;

export async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  const token = request.headers.get?.(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === (await getCliToken());
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLoopbackRequest(request) {
  const host = request.headers.get?.("host") || "";
  const name = host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTS.has(name);
}
