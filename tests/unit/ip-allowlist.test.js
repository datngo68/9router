import { describe, it, expect } from "vitest";
import { ipMatches, checkIpAllowlist } from "@/sse/services/ipAllowlist.js";

describe("ipAllowlist (Phase 3.2)", () => {
  it("matches single IPv4 address exactly", () => {
    expect(ipMatches("1.2.3.4", "1.2.3.4")).toBe(true);
    expect(ipMatches("1.2.3.5", "1.2.3.4")).toBe(false);
  });

  it("matches IPv4 CIDR block", () => {
    expect(ipMatches("192.168.1.50", "192.168.1.0/24")).toBe(true);
    expect(ipMatches("192.168.2.50", "192.168.1.0/24")).toBe(false);
    expect(ipMatches("10.0.0.1", "10.0.0.0/8")).toBe(true);
    expect(ipMatches("11.0.0.1", "10.0.0.0/8")).toBe(false);
  });

  it("/0 matches anything", () => {
    expect(ipMatches("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(ipMatches("::1", "::/0")).toBe(true);
  });

  it("matches IPv6 single address", () => {
    expect(ipMatches("::1", "::1")).toBe(true);
    expect(ipMatches("2001:db8::1", "2001:db8::1")).toBe(true);
  });

  it("matches IPv6 CIDR", () => {
    expect(ipMatches("2001:db8:abcd:0012::1", "2001:db8::/32")).toBe(true);
    expect(ipMatches("2001:dead:abcd:0012::1", "2001:db8::/32")).toBe(false);
  });

  it("rejects malformed CIDR safely", () => {
    expect(ipMatches("1.2.3.4", "not-an-ip")).toBe(false);
    expect(ipMatches("1.2.3.4", "1.2.3.4/99")).toBe(false);
    expect(ipMatches("garbage", "1.2.3.4")).toBe(false);
  });

  it("checkIpAllowlist treats empty list as unrestricted", () => {
    expect(checkIpAllowlist("8.8.8.8", [])).toBe(true);
    expect(checkIpAllowlist("8.8.8.8", null)).toBe(true);
  });

  it("checkIpAllowlist returns true if any entry matches", () => {
    expect(checkIpAllowlist("203.0.113.42", ["10.0.0.0/8", "203.0.113.0/24"])).toBe(true);
    expect(checkIpAllowlist("8.8.8.8", ["10.0.0.0/8", "203.0.113.0/24"])).toBe(false);
  });
});
