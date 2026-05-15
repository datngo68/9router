import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let cors;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cors-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  cors = await import("@/sse/utils/cors.js");
}

beforeAll(async () => {
  await loadFresh();
});

beforeEach(async () => {
  await db.updateSettings({ corsAllowedOrigins: [] });
});

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function makeReq({ origin, method = "POST" } = {}) {
  return {
    method,
    headers: { get: (k) => (k.toLowerCase() === "origin" ? (origin || null) : null) },
  };
}

describe("CORS allowlist (Phase 2.4)", () => {
  it("returns no CORS headers when origin is missing (server-to-server)", async () => {
    const headers = await cors.buildCorsHeaders(makeReq({ origin: null }));
    expect(headers).toEqual({});
  });

  it("returns no CORS headers when origin is not in the allowlist", async () => {
    await db.updateSettings({ corsAllowedOrigins: ["https://app.example.com"] });
    // Clear the in-module cache by re-importing the module fresh
    vi.resetModules();
    cors = await import("@/sse/utils/cors.js");
    const headers = await cors.buildCorsHeaders(makeReq({ origin: "https://evil.tld" }));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("reflects the request origin when allowlisted", async () => {
    await db.updateSettings({ corsAllowedOrigins: ["https://app.example.com"] });
    vi.resetModules();
    cors = await import("@/sse/utils/cors.js");
    const headers = await cors.buildCorsHeaders(makeReq({ origin: "https://app.example.com" }));
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(headers["Vary"]).toBe("Origin");
  });

  it("wildcard '*' permits any origin", async () => {
    await db.updateSettings({ corsAllowedOrigins: ["*"] });
    vi.resetModules();
    cors = await import("@/sse/utils/cors.js");
    const headers = await cors.buildCorsHeaders(makeReq({ origin: "https://anywhere.tld" }));
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://anywhere.tld");
  });

  it("preflight returns 204 with no headers when origin is missing", async () => {
    const res = await cors.handleCorsPreflight(makeReq({ method: "OPTIONS", origin: null }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("preflight returns 204 with reflective header for allowlisted origin", async () => {
    await db.updateSettings({ corsAllowedOrigins: ["https://allowed.tld"] });
    vi.resetModules();
    cors = await import("@/sse/utils/cors.js");
    const res = await cors.handleCorsPreflight(makeReq({ method: "OPTIONS", origin: "https://allowed.tld" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.tld");
  });

  it("preflight returns null for non-OPTIONS method (caller falls through)", async () => {
    const res = await cors.handleCorsPreflight(makeReq({ method: "POST", origin: "https://x.tld" }));
    expect(res).toBeNull();
  });
});
