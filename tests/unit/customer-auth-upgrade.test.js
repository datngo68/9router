import { describe, it, expect } from "vitest";
import { validateRegistrationPayload } from "@/lib/auth/customerRegistration.js";
import { generateTotpSecret, verifyTotpCode } from "@/lib/auth/customerTotp.js";

describe("customer auth upgrade helpers", () => {
  it("rejects registration when password confirmation does not match", () => {
    const result = validateRegistrationPayload({
      email: "test@example.com",
      password: "passw0rd!",
      confirmPassword: "different",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/match/i);
  });

  it("accepts registration when password confirmation matches", () => {
    const result = validateRegistrationPayload({
      email: "test@example.com",
      password: "passw0rd!",
      confirmPassword: "passw0rd!",
    });

    expect(result.ok).toBe(true);
    expect(result.value.email).toBe("test@example.com");
  });

  it("verifies a valid TOTP code and rejects an invalid one", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = verifyTotpCode.createCodeForTest(secret, now);

    expect(verifyTotpCode(secret, code, { now })).toBe(true);
    expect(verifyTotpCode(secret, "000000", { now })).toBe(code === "000000");
  });
});
