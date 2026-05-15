import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeSecretFile, tightenFileMode } from "@/lib/security/filePerms.js";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fileperms-"));
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("filePerms (Phase 4.3)", () => {
  it("writeSecretFile creates the file", () => {
    const file = path.join(tempDir, "secret");
    expect(writeSecretFile(file, "shh")).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("shh");
  });

  it("tightenFileMode returns true on existing file, false on missing", () => {
    const file = path.join(tempDir, "existing");
    fs.writeFileSync(file, "x");
    expect(tightenFileMode(file)).toBe(true);
    expect(tightenFileMode(path.join(tempDir, "missing"))).toBe(false);
  });

  it("on POSIX, the resulting mode is 0600 (skipped on Windows)", () => {
    const file = path.join(tempDir, "secret");
    writeSecretFile(file, "shh");
    if (process.platform === "win32") return; // ACLs handle perms on Windows
    const stat = fs.statSync(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
