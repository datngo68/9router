import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalJwt = process.env.JWT_SECRET;
let tempDir;
let db;
let customerToken;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-customer-auth-"));
  process.env.DATA_DIR = tempDir;
  process.env.JWT_SECRET = "test-jwt-secret-customer-auth";
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  customerToken = await import("@/lib/auth/customerToken.js");
}

beforeAll(async () => { await loadFresh(); });

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwt;
});

describe("customer token (HMAC)", () => {
  it("verifies a valid token for the right purpose", () => {
    const token = customerToken.createCustomerToken("cust-1", "password-reset", 60_000);
    const out = customerToken.verifyCustomerToken(token, "password-reset");
    expect(out?.customerId).toBe("cust-1");
    expect(out?.purpose).toBe("password-reset");
  });

  it("rejects token used with wrong purpose", () => {
    const token = customerToken.createCustomerToken("cust-1", "password-reset");
    expect(customerToken.verifyCustomerToken(token, "email-verify")).toBeNull();
  });

  it("rejects expired token", () => {
    const token = customerToken.createCustomerToken("cust-1", "password-reset", -1000);
    expect(customerToken.verifyCustomerToken(token, "password-reset")).toBeNull();
  });

  it("rejects malformed or tampered tokens", () => {
    expect(customerToken.verifyCustomerToken("garbage", "password-reset")).toBeNull();
    expect(customerToken.verifyCustomerToken("a.b.c", "password-reset")).toBeNull();
    const valid = customerToken.createCustomerToken("cust-1", "password-reset");
    const tampered = valid.slice(0, -3) + "AAA";
    expect(customerToken.verifyCustomerToken(tampered, "password-reset")).toBeNull();
  });
});

describe("customer session lifecycle", () => {
  it("create → find → revoke flow", async () => {
    const cust = await db.createCustomer({ email: "lifecycle@example.com", password: "verysecret" });
    const { token, id } = await db.createCustomerSession({ customerId: cust.id });
    expect(await db.findCustomerSessionByToken(token)).not.toBeNull();
    await db.revokeCustomerSession(id);
    expect(await db.findCustomerSessionByToken(token)).toBeNull();
  });

  it("revokeAllSessionsForCustomer kills every active session", async () => {
    const cust = await db.createCustomer({ email: "multi@example.com", password: "verysecret" });
    const a = await db.createCustomerSession({ customerId: cust.id });
    const b = await db.createCustomerSession({ customerId: cust.id });
    await db.revokeAllSessionsForCustomer(cust.id);
    expect(await db.findCustomerSessionByToken(a.token)).toBeNull();
    expect(await db.findCustomerSessionByToken(b.token)).toBeNull();
  });

  it("expired session is not returned", async () => {
    const cust = await db.createCustomer({ email: "exp@example.com", password: "verysecret" });
    const { token } = await db.createCustomerSession({ customerId: cust.id, ttlMs: -1000 });
    expect(await db.findCustomerSessionByToken(token)).toBeNull();
  });
});
