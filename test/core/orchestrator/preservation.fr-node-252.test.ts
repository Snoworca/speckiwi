import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runGit } from "../../../src/core/orchestrator/pinning.js";
import {
  checkPreservation,
  formatPreservationReport,
  PRESERVATION_NOT_CHECKED,
  type PreservationReport
} from "../../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo, rawGit } from "./support/git-fixture.js";

// `speckiwi orchestrate preservation check --base <rev> [--head <rev>]` against real two-commit
// repositories in a temp directory. The CLI and MCP binding is a later batch; this drives the core
// entry the binding will call.

afterAll(cleanupFixtures);

async function write(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

/** Every file under `root` with its sha256, `.git` included: the read verb must leave all of it. */
async function treeDigest(root: string): Promise<Record<string, string>> {
  const digest: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else digest[path.relative(root, full).replaceAll("\\", "/")] = createHash("sha256").update(await readFile(full)).digest("hex");
    }
  };
  await walk(root);
  return digest;
}

async function fixture(): Promise<{ root: string; base: string; head: string }> {
  const root = await initRepo("preservation");
  await write(root, "src/api.ts", "export function run(a: number): number { return a; }\nexport const gone = 1;\n");
  await write(root, "src/moved.ts", "export const stays = 1;\n".repeat(1) + "// a body long enough that git sees the rename\n".repeat(5));
  await write(root, "src/removed.md", "# notes\n");
  await write(root, "tool/run.py", "def run(a):\n    return a\n");
  await write(root, "test/api.test.ts", "import { expect, it } from \"vitest\";\nit(\"runs\", () => { expect(1).toBe(1); });\nit(\"drops\", () => { expect(1).toBe(1); });\n");
  await write(root, "test/old.test.ts", "import { expect, it } from \"vitest\";\nit(\"old\", () => { expect(1).toBe(1); });\n");
  const base = await commitAll(root, "base");
  await write(root, "src/api.ts", "export function run(a: number, b: number): number { return a + b; }\n");
  await rawGit(root, "mv", "src/moved.ts", "src/renamed.ts");
  await rm(path.join(root, "src/removed.md"));
  await write(root, "tool/run.py", "def run(a, b):\n    return a\n");
  await write(root, "test/api.test.ts", "import { expect, it } from \"vitest\";\nit.skip(\"runs\", () => { expect(1).toBe(1); });\n");
  await rm(path.join(root, "test/old.test.ts"));
  await write(root, "src/new.ts", "export const fresh = 1;\n");
  const head = await commitAll(root, "head");
  return { root, base, head };
}

function value(result: Awaited<ReturnType<typeof checkPreservation>>): PreservationReport {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("FR-NODE-252 orchestrate preservation check", { timeout: 120_000 }, () => {
  // @req FR-NODE-252 AC-1
  it("writes nothing, returns the same rows for the same two revisions, and defaults head to HEAD", async () => {
    const { root, base, head } = await fixture();
    const before = await treeDigest(root);
    const first = value(await checkPreservation({ root, base, head }));
    const second = value(await checkPreservation({ root, base: base.slice(0, 12), head: "HEAD" }));
    const defaulted = value(await checkPreservation({ root, base }));
    expect(await treeDigest(root)).toEqual(before);
    expect(second.rows).toEqual(first.rows);
    expect(second.unchecked).toEqual(first.unchecked);
    expect(defaulted.head).toEqual({ rev: "HEAD", commit: head });
    expect(first.base).toEqual({ rev: base, commit: base });
  });

  // @req FR-NODE-252 AC-1
  it("refuses a revision that names no single commit, without running a diff", async () => {
    const { root } = await fixture();
    const seen: string[][] = [];
    const recording = (cwd: string, args: readonly string[], maxBuffer: number): Promise<Buffer> => {
      seen.push([...args]);
      return runGit(cwd, args, maxBuffer);
    };
    for (const bad of ["no-such-branch", "HEAD^{tree}", "--output=x", ""]) {
      const result = await checkPreservation({ root, base: bad }, recording);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PRESERVATION_REVISION_INVALID");
    }
    expect(seen.some((args) => args.includes("diff"))).toBe(false);
  });

  // @req FR-NODE-252 AC-2
  it("reports every file that existed at base and is deleted or renamed at head, with the new path of a rename", async () => {
    const { root, base, head } = await fixture();
    const rows = value(await checkPreservation({ root, base, head })).rows.filter((row) => row.kind === "existing-file-deleted-or-moved");
    expect(rows).toEqual([
      { kind: "existing-file-deleted-or-moved", path: "src/moved.ts", newPath: "src/renamed.ts", change: "renamed" },
      { kind: "existing-file-deleted-or-moved", path: "src/removed.md", change: "deleted" },
      { kind: "existing-file-deleted-or-moved", path: "test/old.test.ts", change: "deleted" }
    ]);
  });

  // @req FR-NODE-252 AC-3
  it("reports changed exports and lists a changed file in another language under unchecked, which fails the check", async () => {
    const { root, base, head } = await fixture();
    const report = value(await checkPreservation({ root, base, head }));
    expect(report.rows.filter((row) => row.kind === "existing-public-contract-change")).toEqual([
      { kind: "existing-public-contract-change", path: "src/api.ts", symbol: "run", change: "signature-changed" },
      { kind: "existing-public-contract-change", path: "src/api.ts", symbol: "gone", change: "removed" }
    ]);
    expect(report.unchecked).toEqual([{ path: "tool/run.py", reason: "language-not-parsed" }]);
    expect(report.passed).toBe(false);
  });

  // @req FR-NODE-252 AC-3
  it("passes only when no row and no unchecked file remain", async () => {
    const root = await initRepo("preservation-clean");
    await write(root, "src/a.ts", "export function a(x: number): number { return x; }\n");
    await write(root, "notes.txt", "one\n");
    await write(root, "run.sh", "echo one\n");
    const base = await commitAll(root, "base");
    await write(root, "src/a.ts", "export function a(x: number): number { return x * 2; }\n");
    await write(root, "notes.txt", "two\n");
    const clean = await commitAll(root, "body and prose only");
    expect(value(await checkPreservation({ root, base, head: clean }))).toMatchObject({ passed: true, rows: [], unchecked: [] });
    await write(root, "run.sh", "echo two\n");
    const script = await commitAll(root, "script");
    expect(value(await checkPreservation({ root, base, head: script }))).toMatchObject({ passed: false, rows: [], unchecked: [{ path: "run.sh" }] });
  });

  // @req FR-NODE-252 AC-4
  it("reports weakened and deleted tests and states which weakenings it does not check", async () => {
    const { root, base, head } = await fixture();
    const report = value(await checkPreservation({ root, base, head }));
    expect(report.rows.filter((row) => row.kind === "existing-test-weakened-or-deleted")).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/api.test.ts", case: "runs", change: "skip-added", marker: ".skip" },
      { kind: "existing-test-weakened-or-deleted", path: "test/api.test.ts", case: "drops", change: "case-removed" },
      { kind: "existing-test-weakened-or-deleted", path: "test/old.test.ts", case: null, change: "test-file-deleted" }
    ]);
    expect(report.notChecked).toBe(PRESERVATION_NOT_CHECKED);
    expect(PRESERVATION_NOT_CHECKED).toMatch(/replaced expected value/);
    expect(PRESERVATION_NOT_CHECKED).toMatch(/loosened assertion predicate/);
    expect(PRESERVATION_NOT_CHECKED).toMatch(/not checked/);
    const text = formatPreservationReport(report);
    expect(text).toContain(PRESERVATION_NOT_CHECKED);
    expect(text).toContain("existing-test-weakened-or-deleted test/api.test.ts runs skip-added");
    expect(text).toContain("unchecked tool/run.py language-not-parsed");
  });
});
