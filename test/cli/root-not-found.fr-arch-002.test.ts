import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";

const sandbox = vi.hoisted(() => ({ dir: "" }));

/**
 * The upward search would otherwise reach real directories above the temporary one (on this machine
 * the home directory holds a stray docs/spec/00.index.md). Above the sandbox, `.git` and the index
 * are made to look absent, so the search runs to the filesystem root and finds nothing.
 */
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    access: (async (file: Parameters<typeof actual.access>[0], mode?: number) => {
      const target = path.resolve(String(file));
      const outside = sandbox.dir !== "" && !target.startsWith(`${sandbox.dir}${path.sep}`);
      if (outside && (target.endsWith(`${path.sep}.git`) || target.endsWith(path.join("docs", "spec", "00.index.md")))) {
        throw Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" });
      }
      return actual.access(file, mode);
    }) as typeof actual.access
  };
});

/** FR-ARCH-002 AC-3 — a CLI read or mutation that cannot find a root exits 2 with a clear message. */

const originalCwd = process.cwd();
afterEach(() => {
  process.chdir(originalCwd);
  sandbox.dir = "";
});

async function rootless(): Promise<string> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "speckiwi-rootless-")));
  const cwd = path.join(base, "no", "project", "here");
  await mkdir(cwd, { recursive: true });
  sandbox.dir = path.join(base, "no");
  return cwd;
}

describe("FR-ARCH-002 AC-3 — no root found", () => {
  for (const argv of [["list"], ["update-status", "FR-ARCH-001", "blocked"]]) {
    it(`FR-ARCH-002 AC-3: \`speckiwi ${argv.join(" ")}\` with no root above the working directory exits 2 and says why`, async () => {
      const cwd = await rootless();
      process.chdir(cwd);
      const io = { stdout: new PassThrough(), stderr: new PassThrough() };
      const code = await main(argv, io);
      expect(code).toBe(2);
      const stderr = String(io.stderr.read() ?? "");
      expect(stderr).toContain("Could not resolve SpecKiwi project root");
      expect(stderr).toContain(cwd);
    });
  }

  it("FR-ARCH-002 AC-3: `speckiwi list --json` with no root exits 2 too, with an error envelope that names the missing root", async () => {
    const cwd = await rootless();
    process.chdir(cwd);
    const io = { stdout: new PassThrough(), stderr: new PassThrough() };
    const code = await main(["list", "--json"], io);
    expect(code).toBe(2);
    expect(JSON.parse(String(io.stdout.read() ?? ""))).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ROOT_NOT_FOUND", message: expect.stringContaining(cwd) },
      recovery: { command: "init" }
    });
  });
});
