import { describe, it, expect, beforeEach, vi } from "vitest";

let throttle;

beforeEach(async () => {
  vi.resetModules();
  throttle = await import("@/lib/auth/loginThrottle.js");
  throttle._resetLoginThrottle();
});

describe("loginThrottle (Phase 2.2)", () => {
  it("allows the first 4 failed attempts", () => {
    for (let i = 0; i < 4; i++) {
      const r = throttle.recordFailure("1.2.3.4");
      expect(r.locked).toBe(false);
      expect(r.fails).toBe(i + 1);
    }
    expect(throttle.checkLogin("1.2.3.4").locked).toBe(false);
  });

  it("locks the IP on the 5th failure", () => {
    for (let i = 0; i < 4; i++) throttle.recordFailure("9.9.9.9");
    const r = throttle.recordFailure("9.9.9.9");
    expect(r.locked).toBe(true);
    expect(r.retryAfterMs).toBeGreaterThan(0);

    const status = throttle.checkLogin("9.9.9.9");
    expect(status.locked).toBe(true);
  });

  it("clearFailures resets a locked IP", () => {
    for (let i = 0; i < 5; i++) throttle.recordFailure("ip1");
    expect(throttle.checkLogin("ip1").locked).toBe(true);
    throttle.clearFailures("ip1");
    expect(throttle.checkLogin("ip1").locked).toBe(false);
  });

  it("isolates per-IP", () => {
    for (let i = 0; i < 5; i++) throttle.recordFailure("a");
    expect(throttle.checkLogin("a").locked).toBe(true);
    expect(throttle.checkLogin("b").locked).toBe(false);
  });

  it("getClientIp prefers x-forwarded-for leftmost, falls back to x-real-ip", () => {
    const req1 = { headers: new Map([["x-forwarded-for", "1.1.1.1, 2.2.2.2"]]) };
    req1.headers.get = (k) => req1.headers instanceof Map ? null : null;
    // Use plain object to mimic both Headers and plain objects.
    const r1 = { headers: { get: (k) => k === "x-forwarded-for" ? "1.1.1.1, 2.2.2.2" : null } };
    expect(throttle.getClientIp(r1)).toBe("1.1.1.1");

    const r2 = { headers: { get: (k) => k === "x-real-ip" ? "3.3.3.3" : null } };
    expect(throttle.getClientIp(r2)).toBe("3.3.3.3");

    const r3 = { headers: { get: () => null } };
    expect(throttle.getClientIp(r3)).toBe("unknown");
  });
});
