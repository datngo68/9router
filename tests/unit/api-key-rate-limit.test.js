import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let policy;
let rateLimit;

async function loadFreshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-rate-limit-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  policy = await import("@/sse/services/apiKeyPolicy.js");
  rateLimit = await import("@/sse/services/apiKeyRateLimit.js");
}

beforeAll(async () => {
  await loadFreshDb();
});

beforeEach(() => {
  rateLimit._resetRateLimits();
});

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key rate limit (sliding 60s window)", () => {
  it("allows requests up to the per-minute cap, blocks the rest", () => {
    const apiKey = "sk_test_rate_1";
    const limit = 5;
    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < 10; i++) {
      const r = rateLimit.consumeRequest(apiKey, limit);
      if (r.allowed) allowed++; else blocked++;
    }
    expect(allowed).toBe(5);
    expect(blocked).toBe(5);
  });

  it("returns retryAfterMs based on oldest timestamp in window", () => {
    const apiKey = "sk_test_rate_2";
    rateLimit.consumeRequest(apiKey, 1);
    const blocked = rateLimit.consumeRequest(apiKey, 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("limit <= 0 disables the check", () => {
    const r1 = rateLimit.consumeRequest("k", 0);
    const r2 = rateLimit.consumeRequest("k", -1);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(rateLimit.getRecentRequestCount("k")).toBe(0);
  });

  it("isolates buckets by apiKey", () => {
    rateLimit.consumeRequest("a", 2);
    rateLimit.consumeRequest("a", 2);
    expect(rateLimit.consumeRequest("a", 2).allowed).toBe(false);
    expect(rateLimit.consumeRequest("b", 2).allowed).toBe(true);
  });

  it("100 parallel requests with limit=10 → exactly 10 pass", () => {
    const apiKey = "sk_parallel";
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      if (rateLimit.consumeRequest(apiKey, 10).allowed) allowed++;
    }
    expect(allowed).toBe(10);
  });
});

describe("checkApiKeyMaxTokensPerRequest", () => {
  it("allows when policy cap = 0", () => {
    const r = policy.checkApiKeyMaxTokensPerRequest({ maxTokensPerRequest: 0 }, { max_tokens: 999999 });
    expect(r.allowed).toBe(true);
  });

  it("rejects when client requests more than the cap", () => {
    const r = policy.checkApiKeyMaxTokensPerRequest({ maxTokensPerRequest: 1000 }, { max_tokens: 5000 });
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(400);
    expect(r.cap).toBe(1000);
    expect(r.requested).toBe(5000);
  });

  it("returns enforce hint when client did not specify max_tokens", () => {
    const r = policy.checkApiKeyMaxTokensPerRequest({ maxTokensPerRequest: 1000 }, { messages: [] });
    expect(r.allowed).toBe(true);
    expect(r.enforce).toBe(1000);
  });

  it("accepts gemini-style maxOutputTokens", () => {
    const r = policy.checkApiKeyMaxTokensPerRequest(
      { maxTokensPerRequest: 1000 },
      { generationConfig: { maxOutputTokens: 800 } }
    );
    expect(r.allowed).toBe(true);
  });

  it("rejects gemini-style maxOutputTokens that exceed cap", () => {
    const r = policy.checkApiKeyMaxTokensPerRequest(
      { maxTokensPerRequest: 500 },
      { generationConfig: { maxOutputTokens: 800 } }
    );
    expect(r.allowed).toBe(false);
  });
});
