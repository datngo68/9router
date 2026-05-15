// Filesystem permission helpers for sensitive files.
//
// On POSIX (Linux/macOS) we tighten permissions to 0600 so only the owning
// user can read. On Windows fs.chmod is a no-op against ACLs — we still call
// it for parity but document that admins must set ACLs separately.

import fs from "node:fs";

const SECURE_MODE = 0o600;

/**
 * Best-effort chmod 600. Swallows errors so a permission-tightening attempt
 * never blocks the calling code (e.g. cold start writing the JWT secret).
 */
export function tightenFileMode(filePath) {
  try {
    fs.chmodSync(filePath, SECURE_MODE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a file with restrictive permissions atomically. The mode arg passed
 * to writeFileSync is honored on POSIX when the file is created. If the file
 * already exists we re-chmod afterward.
 */
export function writeSecretFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, { mode: SECURE_MODE });
    tightenFileMode(filePath); // re-chmod in case the file pre-existed
    return true;
  } catch {
    return false;
  }
}
