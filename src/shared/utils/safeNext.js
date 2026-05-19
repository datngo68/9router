/**
 * Sanitize a `next`/return-to path supplied by the user.
 *
 * Open-redirect protections:
 *   - Reject non-string input.
 *   - Reject protocol-relative (`//host`, `\\host`) and absolute external
 *     (`http://`, `https://`) URLs.
 *   - Reject CRLF injection (`\r`, `\n`).
 *   - Whitelist pathnames starting with `/store/` or `/dashboard/` only;
 *     anything else falls back to `defaultPath`.
 *   - Trim and cap length at 500 characters.
 */
export function sanitizeNextPath(input, defaultPath = "/store/account") {
  if (typeof input !== "string") return defaultPath;
  const trimmed = input.trim();
  if (!trimmed) return defaultPath;
  if (trimmed.length > 500) return defaultPath;
  if (/[\r\n]/.test(trimmed)) return defaultPath;
  if (trimmed.startsWith("//") || trimmed.startsWith("\\\\")) return defaultPath;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return defaultPath;
  if (!(trimmed.startsWith("/store/") || trimmed.startsWith("/dashboard/"))) {
    return defaultPath;
  }
  return trimmed;
}
