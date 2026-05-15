import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let secretBox;

async function loadFreshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-encrypt-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  secretBox = await import("@/lib/crypto/secretBox.js");
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

beforeEach(() => {
  // Reset module-level cache so each test re-reads the secret-key file from
  // the same temp dir (avoids cross-suite pollution).
  secretBox._resetKeyCache();
});

describe("secretBox AES-256-GCM round trip", () => {
  it("encrypts and decrypts back to the same plaintext", () => {
    const ct = secretBox.encryptString("super-secret-token");
    expect(ct.startsWith("enc:v1:")).toBe(true);
    expect(secretBox.decryptString(ct)).toBe("super-secret-token");
  });

  it("is idempotent: encrypting an already-encrypted value is a no-op", () => {
    const a = secretBox.encryptString("x");
    const b = secretBox.encryptString(a);
    expect(a).toBe(b);
  });

  it("treats null/undefined/empty/non-string as passthrough", () => {
    expect(secretBox.encryptString(null)).toBeNull();
    expect(secretBox.encryptString(undefined)).toBeUndefined();
    expect(secretBox.encryptString("")).toBe("");
    expect(secretBox.encryptString(123)).toBe(123);

    expect(secretBox.decryptString(null)).toBeNull();
    expect(secretBox.decryptString("plaintext")).toBe("plaintext");
  });

  it("rejects tampered ciphertext", () => {
    const ct = secretBox.encryptString("secret");
    const tampered = ct.slice(0, -2) + "AA";
    expect(() => secretBox.decryptString(tampered)).toThrow();
  });

  it("isEncrypted recognizes only the v1 envelope", () => {
    expect(secretBox.isEncrypted("enc:v1:foo:bar:baz")).toBe(true);
    expect(secretBox.isEncrypted("plaintext")).toBe(false);
  });
});

describe("connectionsRepo encryption (Phase 2.1)", () => {
  it("persists provider apiKey/accessToken encrypted but reads them back as plaintext", async () => {
    const created = await db.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "Prod",
      apiKey: "sk-real-openai-secret-12345",
      accessToken: "oauth-access-token-xyz",
      refreshToken: "oauth-refresh-token-abc",
    });

    expect(created.apiKey).toBe("sk-real-openai-secret-12345"); // returned in cleartext to caller

    // Inspect raw row → fields must be encrypted on disk.
    const adapter = db.getAdapterSync();
    const row = adapter.get(`SELECT data FROM providerConnections WHERE id = ?`, [created.id]);
    const stored = JSON.parse(row.data);
    expect(stored.apiKey.startsWith("enc:v1:")).toBe(true);
    expect(stored.accessToken.startsWith("enc:v1:")).toBe(true);
    expect(stored.refreshToken.startsWith("enc:v1:")).toBe(true);
    expect(stored.apiKey.includes("sk-real-openai-secret")).toBe(false);

    // Read path decrypts.
    const fetched = await db.getProviderConnectionById(created.id);
    expect(fetched.apiKey).toBe("sk-real-openai-secret-12345");
    expect(fetched.accessToken).toBe("oauth-access-token-xyz");
    expect(fetched.refreshToken).toBe("oauth-refresh-token-abc");
  });

  it("encrypts known providerSpecificData sub-fields", async () => {
    const created = await db.createProviderConnection({
      provider: "copilot",
      authType: "oauth",
      name: "GH",
      providerSpecificData: { copilotToken: "ghs_secret_token", randomMeta: "kept-plain" },
    });

    const adapter = db.getAdapterSync();
    const row = adapter.get(`SELECT data FROM providerConnections WHERE id = ?`, [created.id]);
    const stored = JSON.parse(row.data);
    expect(stored.providerSpecificData.copilotToken.startsWith("enc:v1:")).toBe(true);
    expect(stored.providerSpecificData.randomMeta).toBe("kept-plain");

    const fetched = await db.getProviderConnectionById(created.id);
    expect(fetched.providerSpecificData.copilotToken).toBe("ghs_secret_token");
  });

  it("updateProviderConnection re-encrypts changed credentials", async () => {
    const created = await db.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "Rotate",
      apiKey: "old-key",
    });
    await db.updateProviderConnection(created.id, { apiKey: "new-key" });

    const adapter = db.getAdapterSync();
    const row = adapter.get(`SELECT data FROM providerConnections WHERE id = ?`, [created.id]);
    const stored = JSON.parse(row.data);
    expect(stored.apiKey.startsWith("enc:v1:")).toBe(true);

    const fetched = await db.getProviderConnectionById(created.id);
    expect(fetched.apiKey).toBe("new-key");
  });
});
