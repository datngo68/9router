import crypto from "crypto";

// New format: sk_<32-char base64url> = 192 bits of entropy.
// We removed the legacy `sk-{machineId}-{6}-{crc8}` form because:
//   1. machineId leaked the host fingerprint in every key.
//   2. CRC + 6-char keyId was only ~31 bits of brute-force surface and
//      depended on a static API_KEY_SECRET shared by all keys.
//   3. With keys hashed in DB and looked up by sha256(rawKey), the only
//      thing that needs to be unguessable is the random portion itself.

const KEY_PREFIX = "sk_";
const RAW_BYTES = 24; // → 32 base64url chars, ~192 bits entropy

/**
 * Generate a new API key. machineId is accepted for backward-compat with the
 * existing call site signature but is NOT embedded in the key any more.
 * Returned `keyId` is the suffix (without the "sk_" prefix).
 *
 * @param {string} _machineId - Unused; preserved for caller signature.
 * @returns {{ key: string, keyId: string }}
 */
export function generateApiKeyWithMachine(_machineId) {
  const random = crypto.randomBytes(RAW_BYTES).toString("base64url");
  const key = `${KEY_PREFIX}${random}`;
  return { key, keyId: random };
}

/**
 * Best-effort parser. With the new format there is no machineId or CRC to
 * extract — only the random keyId — but we keep this function for legacy
 * call sites that still pull `keyId` out of the key string.
 *
 * Recognized formats:
 * - New: sk_<32 char base64url>
 * - Legacy: sk-<machineId>-<6 chars>-<crc8>
 */
export function parseApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;

  if (apiKey.startsWith(KEY_PREFIX)) {
    const keyId = apiKey.slice(KEY_PREFIX.length);
    if (!keyId) return null;
    return { machineId: null, keyId, isNewFormat: true };
  }

  if (apiKey.startsWith("sk-")) {
    const parts = apiKey.split("-");
    // Legacy 4-part: sk-{machineId}-{keyId}-{crc8}
    if (parts.length === 4) {
      return { machineId: parts[1] || null, keyId: parts[2] || null, isNewFormat: false };
    }
    // Legacy 2-part: sk-{random}
    if (parts.length === 2) {
      return { machineId: null, keyId: parts[1] || null, isNewFormat: false };
    }
  }

  return null;
}

/**
 * No CRC in the new format — verification is performed by hashing and looking
 * up `keyHash` in the DB. Kept for backward compatibility; returns true if
 * the raw key parses to a known shape.
 */
export function verifyApiKeyCrc(apiKey) {
  return parseApiKey(apiKey) !== null;
}

export function isNewFormatKey(apiKey) {
  return parseApiKey(apiKey)?.isNewFormat === true;
}
