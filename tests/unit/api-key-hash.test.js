import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

async function loadFreshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-hash-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
}

beforeAll(async () => {
  await loadFreshDb();
});

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function hashKey(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

describe("API key hashing (Phase 1.2)", () => {
  it("createApiKey returns raw key once and persists only the hash", async () => {
    const created = await db.createApiKey("hashed-key", "machine-h1");
    expect(created.key).toMatch(/^sk_/);
    expect(created.keyHash).toBe(hashKey(created.key));
    expect(created.keyDisplay).toContain("...");

    const adapter = db.getAdapterSync();
    const row = adapter.get(`SELECT key, keyHash FROM apiKeys WHERE id = ?`, [created.id]);
    expect(row.key).toBeNull();
    expect(row.keyHash).toBe(created.keyHash);
  });

  it("getApiKeys never returns a raw key, only display fields", async () => {
    await db.createApiKey("listed-1", "machine-h2");
    const list = await db.getApiKeys();
    for (const k of list) {
      expect(k.key).toBeUndefined();
      expect(k.keyHash).toBeTruthy();
      expect(k.keyDisplay).toContain("...");
    }
  });

  it("getApiKeyByKey hashes the input and returns the matching record", async () => {
    const created = await db.createApiKey("lookup", "machine-h3");
    const found = await db.getApiKeyByKey(created.key);
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);
    expect(found.key).toBeUndefined();
  });

  it("validateApiKey returns false for a non-existent key without leaking timing differently", async () => {
    expect(await db.validateApiKey("sk-not-real-key-zzzzz-zzzzz")).toBe(false);
    const created = await db.createApiKey("active", "machine-h4");
    expect(await db.validateApiKey(created.key)).toBe(true);
  });

  it("usageHistory stores apiKeyId, not raw key, and getApiKeyDailyTokenUsage queries by id", async () => {
    const created = await db.createApiKey("usage-id", "machine-h5", { dailyTokenLimit: 1000 });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKeyId: created.id,
      endpoint: "/v1/chat/completions",
      status: "ok",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const usage = await db.getApiKeyDailyTokenUsage(created.id);
    expect(usage.totalTokens).toBe(150);

    const adapter = db.getAdapterSync();
    const histRow = adapter.get(
      `SELECT apiKey, apiKeyId FROM usageHistory WHERE apiKeyId = ? ORDER BY id DESC LIMIT 1`,
      [created.id]
    );
    expect(histRow.apiKey).toBeNull();
    expect(histRow.apiKeyId).toBe(created.id);
  });
});
