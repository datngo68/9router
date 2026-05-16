import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock cloudflared spawn so we don't actually launch any binary.
vi.mock("@/lib/tunnel/cloudflared.js", () => {
  const childProcs = [];
  const spawnIsolatedQuickTunnel = vi.fn(async (target, onUrlUpdate, onExit) => {
    const child = {
      pid: 100000 + childProcs.length + 1,
      _onExit: onExit,
      _alive: true,
      kill: vi.fn(function () {
        if (!this._alive) return;
        this._alive = false;
        if (typeof this._onExit === "function") {
          // Async to mimic real exit event.
          setTimeout(() => this._onExit({ code: 0, signal: null }), 0);
        }
      }),
    };
    childProcs.push(child);
    return { child, tunnelUrl: `https://test-${child.pid}.trycloudflare.com` };
  });
  const isPidAlive = vi.fn((pid) => {
    if (!pid) return false;
    const c = childProcs.find((x) => x.pid === pid);
    return !!(c && c._alive);
  });
  const killIsolatedTunnel = vi.fn((pid) => {
    const c = childProcs.find((x) => x.pid === pid);
    if (c && c._alive) {
      c._alive = false;
      if (typeof c._onExit === "function") setTimeout(() => c._onExit({ code: 0, signal: null }), 0);
    }
  });
  return {
    spawnIsolatedQuickTunnel,
    killIsolatedTunnel,
    isPidAlive,
    __getChildProcs: () => childProcs,
    __reset: () => { childProcs.length = 0; },
  };
});

// Default network probe stubs — overridden per test as needed.
vi.mock("@/lib/tunnel/networkProbe.js", () => ({
  probeUrlAlive: vi.fn(async () => true),
  checkInternet: vi.fn(async () => true),
}));

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalFetch = globalThis.fetch;
let forwards;
let cloudflaredMock;
let probeMock;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fwd-watchdog-"));
  process.env.DATA_DIR = tempDir;
  process.env.TUNNEL_WORKER_URL = "https://stub.local";
  vi.resetModules();
  cloudflaredMock = await import("@/lib/tunnel/cloudflared.js");
  cloudflaredMock.__reset();
  probeMock = await import("@/lib/tunnel/networkProbe.js");
  probeMock.probeUrlAlive.mockReset();
  probeMock.probeUrlAlive.mockResolvedValue(true);
  probeMock.checkInternet.mockReset();
  probeMock.checkInternet.mockResolvedValue(true);
  forwards = await import("@/lib/tunnel/forwards.js");
}

beforeEach(async () => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  await loadFresh();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("forwards watchdog", () => {
  it("registers worker with retry/backoff and reports success", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 2) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const fwd = forwards.createForward({ target: "7000" });
    await forwards.enableForward(fwd.id);
    expect(calls).toBeGreaterThanOrEqual(2);
    const view = forwards.getForward(fwd.id);
    expect(view.enabled).toBe(true);
    expect(view.running).toBe(true);
  });

  it("respawns automatically when cloudflared exits unexpectedly", async () => {
    const fwd = forwards.createForward({ target: "7000" });
    await forwards.enableForward(fwd.id);
    const procsBefore = cloudflaredMock.__getChildProcs().length;

    // Simulate process crash (not user disable).
    const child = forwards._internals().childProcs.get(fwd.id);
    expect(child).toBeTruthy();
    child.kill();

    // Wait long enough for the 3s debounce + restart.
    await new Promise((r) => setTimeout(r, 3500));

    const procsAfter = cloudflaredMock.__getChildProcs().length;
    expect(procsAfter).toBeGreaterThan(procsBefore);
    expect(forwards.getForward(fwd.id).enabled).toBe(true);
  }, 10000);

  it("does NOT respawn after user disable", async () => {
    const fwd = forwards.createForward({ target: "7000" });
    await forwards.enableForward(fwd.id);
    const procsBefore = cloudflaredMock.__getChildProcs().length;

    await forwards.disableForward(fwd.id);
    await new Promise((r) => setTimeout(r, 3500));

    const procsAfter = cloudflaredMock.__getChildProcs().length;
    expect(procsAfter).toBe(procsBefore);
    expect(forwards.getForward(fwd.id).enabled).toBe(false);
  }, 10000);

  it("tickForwardsHealth re-registers when probe succeeds", async () => {
    const fwd = forwards.createForward({ target: "7000" });
    await forwards.enableForward(fwd.id);

    const callsBefore = globalThis.fetch.mock.calls.length;
    await forwards.tickForwardsHealth();
    const callsAfter = globalThis.fetch.mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("tickForwardsHealth restarts forward after MISS_THRESHOLD failed probes", async () => {
    const fwd = forwards.createForward({ target: "7000" });
    await forwards.enableForward(fwd.id);

    // Simulate worker mapping rejecting re-register too, so it can't heal via re-register.
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    probeMock.probeUrlAlive.mockResolvedValue(false);

    const procsBefore = cloudflaredMock.__getChildProcs().length;

    // First tick increments miss count.
    await forwards.tickForwardsHealth();
    // Second tick crosses threshold → tries re-register (fails) → hard restart.
    await forwards.tickForwardsHealth();
    // Give the async restart time to spawn a new child.
    await new Promise((r) => setTimeout(r, 200));

    const procsAfter = cloudflaredMock.__getChildProcs().length;
    expect(procsAfter).toBeGreaterThan(procsBefore);
  }, 10000);

  it("tickForwardsHealth no-ops when offline", async () => {
    const fwd = forwards.createForward({ target: "7000" });
    await forwards.enableForward(fwd.id);
    const fetchCallsBefore = globalThis.fetch.mock.calls.length;

    probeMock.checkInternet.mockResolvedValue(false);
    await forwards.tickForwardsHealth();

    expect(globalThis.fetch.mock.calls.length).toBe(fetchCallsBefore);
  });

  it("restartAllForwards bypasses cooldown and restarts all enabled entries", async () => {
    const a = forwards.createForward({ target: "7001" });
    const b = forwards.createForward({ target: "7002" });
    await forwards.enableForward(a.id);
    await forwards.enableForward(b.id);

    // Set cooldown so a normal _hardRestart would skip.
    forwards._internals().lastRestartAt.set(a.id, Date.now());
    forwards._internals().lastRestartAt.set(b.id, Date.now());

    const procsBefore = cloudflaredMock.__getChildProcs().length;
    await forwards.restartAllForwards("test");
    await new Promise((r) => setTimeout(r, 200));
    const procsAfter = cloudflaredMock.__getChildProcs().length;

    expect(procsAfter).toBeGreaterThan(procsBefore);
  }, 10000);
});
