import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let guard;

async function loadFreshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tunnel-guard-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  guard = await import("@/lib/security/tunnelGuard.js");
}

beforeAll(async () => {
  await loadFreshDb();
});

beforeEach(async () => {
  // Reset settings between cases
  await db.updateSettings({ password: null, requireApiKey: false, tunnelEnabled: false, tailscaleEnabled: false, tunnelDashboardAccess: false });
});

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("tunnelGuard.assertSafeToEnableRemoteAccess", () => {
  it("blocks enabling tunnel when password is unset", async () => {
    await db.updateSettings({ password: null, requireApiKey: true });
    const res = await guard.assertSafeToEnableRemoteAccess();
    expect(res).toBeTruthy();
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/password/i);
  });

  it("blocks enabling tunnel when requireApiKey is off", async () => {
    await db.updateSettings({ password: "$2b$10$abc", requireApiKey: false });
    const res = await guard.assertSafeToEnableRemoteAccess();
    expect(res).toBeTruthy();
    expect(res.error).toMatch(/Require API key/i);
  });

  it("allows enabling tunnel when password is set and API key required", async () => {
    await db.updateSettings({ password: "$2b$10$abc", requireApiKey: true });
    const res = await guard.assertSafeToEnableRemoteAccess();
    expect(res).toBeNull();
  });
});

describe("tunnelGuard.validateSettingsPatch", () => {
  it("rejects requireApiKey:false while a tunnel is active", async () => {
    await db.updateSettings({ password: "$2b$10$abc", requireApiKey: true, tunnelEnabled: true });
    const res = await guard.validateSettingsPatch({ requireApiKey: false });
    expect(res).toBeTruthy();
    expect(res.error).toMatch(/Require API key/i);
  });

  it("rejects requireLogin:false while tunnel + dashboard access are on", async () => {
    await db.updateSettings({ password: "$2b$10$abc", tunnelEnabled: true, tunnelDashboardAccess: true });
    const res = await guard.validateSettingsPatch({ requireLogin: false });
    expect(res).toBeTruthy();
  });

  it("allows requireLogin:false when patch also disables dashboard access", async () => {
    await db.updateSettings({ password: "$2b$10$abc", tunnelEnabled: true, tunnelDashboardAccess: true });
    const res = await guard.validateSettingsPatch({ requireLogin: false, tunnelDashboardAccess: false });
    expect(res).toBeNull();
  });

  it("rejects tunnelDashboardAccess:true while password is default", async () => {
    await db.updateSettings({ password: null, tunnelEnabled: false });
    const res = await guard.validateSettingsPatch({ tunnelDashboardAccess: true });
    expect(res).toBeTruthy();
    expect(res.error).toMatch(/password/i);
  });

  it("rejects tunnelDashboardAccess:true when requireLogin is off", async () => {
    await db.updateSettings({ password: "$2b$10$abc", requireLogin: false });
    const res = await guard.validateSettingsPatch({ tunnelDashboardAccess: true });
    expect(res).toBeTruthy();
    expect(res.error).toMatch(/Require login/i);
  });

  it("allows arbitrary patches when no tunnel is active", async () => {
    await db.updateSettings({ password: "$2b$10$abc", tunnelEnabled: false, tailscaleEnabled: false });
    const res = await guard.validateSettingsPatch({ requireApiKey: false, requireLogin: false });
    expect(res).toBeNull();
  });
});
