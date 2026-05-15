import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-settings-export-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
}

beforeAll(async () => { await loadFresh(); });

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("settings export sanitization (Phase 4.2)", () => {
  it("exportSettings strips password and oidcClientSecret by default", async () => {
    await db.updateSettings({
      password: "$2b$10$abc",
      oidcClientSecret: "secret-xyz",
      tunnelEnabled: true,
    });
    const out = await db.exportSettings();
    expect(out.password).toBeUndefined();
    expect(out.oidcClientSecret).toBeUndefined();
    expect(out.tunnelEnabled).toBe(true);
  });

  it("exportDb excludes secrets in nested settings payload", async () => {
    await db.updateSettings({ password: "$2b$10$abc", oidcClientSecret: "shh" });
    const dump = await db.exportDb();
    expect(dump.settings.password).toBeUndefined();
    expect(dump.settings.oidcClientSecret).toBeUndefined();
  });
});
