import { describe, it, expect } from "vitest";

import {
  buildBareModelIndex,
  resolveBareModelId,
} from "../../open-sse/services/model.js";

const CATALOG = {
  cc: [
    { id: "claude-sonnet-4-6" },
    { id: "claude-opus-4-7" },
  ],
  cx: [
    { id: "gpt-5.5" },
    { id: "gpt-5.4" },
    { id: "gpt-5.5-image", type: "image" },
  ],
  ag: [
    { id: "claude-sonnet-4-6" },
    { id: "gemini-3-flash" },
  ],
  qw: [
    { id: "claude-sonnet-4-6" },
    { id: "qwen3-coder-plus" },
  ],
};

describe("buildBareModelIndex / resolveBareModelId", () => {
  it("resolves a bare id that lives on exactly one active provider", () => {
    const idx = buildBareModelIndex(CATALOG, ["cx", "cc"]);
    const res = resolveBareModelId("gpt-5.5", idx);
    expect(res).toMatchObject({
      provider: "codex",
      providerAlias: "cx",
      model: "gpt-5.5",
    });
  });

  it("resolves an image-type catalog entry the same way as llm", () => {
    const idx = buildBareModelIndex(CATALOG, ["cx"]);
    const res = resolveBareModelId("gpt-5.5-image", idx);
    expect(res?.provider).toBe("codex");
  });

  it("flags ambiguous when the bare id appears under multiple active aliases", () => {
    const idx = buildBareModelIndex(CATALOG, ["cc", "ag", "qw"]);
    const res = resolveBareModelId("claude-sonnet-4-6", idx);
    expect(res).toMatchObject({ ambiguous: true, model: "claude-sonnet-4-6" });
    expect(res.candidates).toEqual(["ag", "cc", "qw"]);
  });

  it("ignores aliases without an active connection", () => {
    // cx is the only candidate that has gpt-5.5, but it is not active
    const idx = buildBareModelIndex(CATALOG, ["cc"]);
    const res = resolveBareModelId("gpt-5.5", idx);
    expect(res).toBeNull();
  });

  it("merges custom models keyed by providerAlias", () => {
    const idx = buildBareModelIndex(
      CATALOG,
      ["cx"],
      [{ id: "gpt-custom-1", providerAlias: "cx" }]
    );
    const res = resolveBareModelId("gpt-custom-1", idx);
    expect(res?.provider).toBe("codex");
  });

  it("ignores custom models that point at inactive aliases", () => {
    const idx = buildBareModelIndex(
      CATALOG,
      ["cx"],
      [{ id: "gpt-custom-1", providerAlias: "cc" }]
    );
    expect(resolveBareModelId("gpt-custom-1", idx)).toBeNull();
  });

  it("skips non-llm custom models", () => {
    const idx = buildBareModelIndex(
      CATALOG,
      ["cx"],
      [{ id: "tts-foo", providerAlias: "cx", type: "tts" }]
    );
    expect(resolveBareModelId("tts-foo", idx)).toBeNull();
  });

  it("returns null for unknown ids and never throws on bad inputs", () => {
    const idx = buildBareModelIndex(CATALOG, ["cx"]);
    expect(resolveBareModelId("nope", idx)).toBeNull();
    expect(resolveBareModelId("", idx)).toBeNull();
    expect(resolveBareModelId("gpt-5.5", null)).toBeNull();
  });
});
