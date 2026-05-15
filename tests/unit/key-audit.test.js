import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-audit-"));
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

describe("keyAuditLog (Phase 3.3)", () => {
  it("appends entries and reads them back in newest-first order", async () => {
    await db.logKeyAudit({ keyId: "k1", action: "create", actorIp: "1.1.1.1", metadata: { name: "first" } });
    await db.logKeyAudit({ keyId: "k1", action: "update", actorIp: "1.1.1.1", metadata: { changes: ["dailyTokenLimit"] } });
    await db.logKeyAudit({ keyId: "k2", action: "create", actorIp: "2.2.2.2" });

    const all = await db.getKeyAuditLog({ limit: 10 });
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all[0].action).toBe("create"); // most recent
    expect(all[0].keyId).toBe("k2");
  });

  it("filters by keyId", async () => {
    const k1Only = await db.getKeyAuditLog({ keyId: "k1", limit: 100 });
    for (const e of k1Only) expect(e.keyId).toBe("k1");
    expect(k1Only.length).toBeGreaterThanOrEqual(2);
  });

  it("metadata is round-tripped as JSON", async () => {
    await db.logKeyAudit({ keyId: "k3", action: "delete", metadata: { reason: "rotated", count: 5 } });
    const list = await db.getKeyAuditLog({ keyId: "k3" });
    expect(list[0].metadata).toEqual({ reason: "rotated", count: 5 });
  });
});
