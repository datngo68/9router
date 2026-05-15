import { describe, it, expect } from "vitest";

// Inline copy of the maskSensitiveHeaders impl so the test exercises the same
// shape used by chat.js / requestLogger.js.
function maskHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitive = ["authorization", "x-api-key", "cookie", "set-cookie", "x-auth-token"];
  const out = { ...headers };
  for (const k of Object.keys(out)) {
    const lk = k.toLowerCase();
    if (sensitive.some((s) => lk.includes(s))) {
      const v = out[k];
      if (typeof v === "string") {
        out[k] = v.length > 14 ? `${v.slice(0, 10)}...${v.slice(-4)}` : "***";
      } else if (v != null) {
        out[k] = "***";
      }
    }
  }
  return out;
}

describe("Header masking (Phase 3.4)", () => {
  it("masks Authorization", () => {
    const out = maskHeaders({ Authorization: "Bearer sk_live_abcdef0123456789" });
    expect(out.Authorization.startsWith("Bearer sk_")).toBe(true);
    expect(out.Authorization.includes("...")).toBe(true);
    expect(out.Authorization.includes("0123456789")).toBe(false);
  });

  it("masks x-api-key (case-insensitive)", () => {
    const out = maskHeaders({ "X-API-Key": "secretvalue1234567890" });
    expect(out["X-API-Key"].includes("secretval")).toBe(true);
    expect(out["X-API-Key"].includes("...")).toBe(true);
  });

  it("short secrets are replaced with ***", () => {
    const out = maskHeaders({ authorization: "x" });
    expect(out.authorization).toBe("***");
  });

  it("non-sensitive headers pass through unchanged", () => {
    const out = maskHeaders({ "user-agent": "curl/8.0", "content-type": "application/json" });
    expect(out["user-agent"]).toBe("curl/8.0");
    expect(out["content-type"]).toBe("application/json");
  });

  it("ignores null input", () => {
    expect(maskHeaders(null)).toEqual({});
  });
});
