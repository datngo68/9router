import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalJwtSecret = process.env.JWT_SECRET;
let tempDir;
let db;
let session;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-jwt-version-"));
  process.env.DATA_DIR = tempDir;
  // Pin a JWT secret so module init is deterministic and not reset across runs.
  process.env.JWT_SECRET = "test-jwt-secret-for-version-suite";
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  session = await import("@/lib/auth/dashboardSession.js");
}

beforeAll(async () => {
  await loadFresh();
});

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

describe("JWT tokenVersion revocation (Phase 2.3)", () => {
  it("verifies a freshly issued token", async () => {
    const token = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(token)).toBe(true);
  });

  it("revokeAllDashboardSessions invalidates previously issued tokens", async () => {
    const token = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(token)).toBe(true);

    const newVersion = await session.revokeAllDashboardSessions();
    expect(newVersion).toBeGreaterThanOrEqual(1);

    expect(await session.verifyDashboardAuthToken(token)).toBe(false);

    // A fresh token after revocation works again.
    const fresh = await session.createDashboardAuthToken();
    expect(await session.verifyDashboardAuthToken(fresh)).toBe(true);
  });

  it("getDashboardAuthSession returns payload for current version, null for old", async () => {
    const token = await session.createDashboardAuthToken();
    const payload = await session.getDashboardAuthSession(token);
    expect(payload?.authenticated).toBe(true);

    await session.revokeAllDashboardSessions();
    expect(await session.getDashboardAuthSession(token)).toBeNull();
  });
});
