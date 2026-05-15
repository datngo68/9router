import { describe, it, expect } from "vitest";
import { generateApiKeyWithMachine, parseApiKey, isNewFormatKey, verifyApiKeyCrc } from "@/shared/utils/apiKey";

describe("API key generation (Phase 1.4)", () => {
  it("generates 32-character base64url suffix", () => {
    const { key, keyId } = generateApiKeyWithMachine("any-machine");
    expect(key.startsWith("sk_")).toBe(true);
    expect(keyId).toHaveLength(32);
    expect(/^[A-Za-z0-9_-]+$/.test(keyId)).toBe(true);
  });

  it("does not embed machineId in the key", () => {
    const machineId = "F00DCAFE12345678";
    const { key } = generateApiKeyWithMachine(machineId);
    expect(key.includes(machineId)).toBe(false);
  });

  it("two keys generated in a row are different", () => {
    const a = generateApiKeyWithMachine("m1").key;
    const b = generateApiKeyWithMachine("m1").key;
    expect(a).not.toBe(b);
  });

  it("parseApiKey identifies new format", () => {
    const { key } = generateApiKeyWithMachine("m");
    const parsed = parseApiKey(key);
    expect(parsed?.isNewFormat).toBe(true);
    expect(parsed?.machineId).toBe(null);
  });

  it("parseApiKey still understands legacy 4-part format", () => {
    const parsed = parseApiKey("sk-abcdef0123456789-abcdef-12345678");
    expect(parsed?.isNewFormat).toBe(false);
    expect(parsed?.machineId).toBe("abcdef0123456789");
  });

  it("returns null for malformed input", () => {
    expect(parseApiKey("")).toBeNull();
    expect(parseApiKey(null)).toBeNull();
    expect(parseApiKey("garbage")).toBeNull();
    expect(parseApiKey("sk_")).toBeNull();
  });

  it("isNewFormatKey/verifyApiKeyCrc agree with parseApiKey", () => {
    const { key } = generateApiKeyWithMachine("m");
    expect(isNewFormatKey(key)).toBe(true);
    expect(verifyApiKeyCrc(key)).toBe(true);
    expect(verifyApiKeyCrc("garbage")).toBe(false);
  });
});
