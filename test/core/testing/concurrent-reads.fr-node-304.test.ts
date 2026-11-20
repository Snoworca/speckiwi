import type * as FsPromises from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { findTestFiles } from "../../../src/core/testing/test-citations.js";
import { checkTestSufficiency } from "../../../src/core/testing/test-sufficiency.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-304 — coverage --tests read its test files one at a time; on this repository that was
// 258 ms of a call whose search took 186 ms, against 47 ms read 16 at a time.

/** Reads of files under a `test/` directory: how many are in flight, the most seen, and the switches the cases set. */
const reads = vi.hoisted(() => ({ inFlight: 0, most: 0, serial: false, chain: Promise.resolve() as Promise<unknown>, failOn: "", failFast: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const tracked = async (...args: Parameters<typeof actual.readFile>) => {
    reads.inFlight += 1;
    reads.most = Math.max(reads.most, reads.inFlight);
    try {
      const file = String(args[0]).replace(/\\/g, "/");
      // A short wait makes reads that are started together overlap measurably; the file named by
      // failFast fails without it, so it fails before an earlier file that was started first.
      if (reads.failFast === "" || !file.endsWith(reads.failFast)) await new Promise((resolve) => setTimeout(resolve, 20));
      if (reads.failFast !== "" && file.endsWith(reads.failFast)) {
        throw Object.assign(new Error(`EACCES: permission denied, open '${String(args[0])}'`), { code: "EACCES" });
      }
      if (reads.failOn !== "" && file.endsWith(reads.failOn)) {
        throw Object.assign(new Error(`EACCES: permission denied, open '${String(args[0])}'`), { code: "EACCES" });
      }
      return await actual.readFile(...args);
    } finally {
      reads.inFlight -= 1;
    }
  };
  return {
    ...actual,
    readFile: ((...args: Parameters<typeof actual.readFile>) => {
      if (!String(args[0]).replace(/\\/g, "/").includes("/test/")) return actual.readFile(...args);
      if (!reads.serial) return tracked(...args);
      // The one-by-one baseline: each read waits for the one before it.
      const next = reads.chain.then(() => tracked(...args));
      reads.chain = next.catch(() => undefined);
      return next;
    }) as typeof actual.readFile
  };
});

async function put(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

const SDS = [
  "# SDS: demo",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | sds |",
  "| Profile | lite |",
  "| Target | v1.0.0 |",
  "| Status | agreed |",
  "| Date | 2026-11-20 |",
  "",
  "## Interfaces",
  "",
  "### Files",
  "",
  "- `src/demo.ts` — demo @req FR-ARCH-001",
  "  - `list(): string[]` — lists ← cli",
  "",
  "## Acceptance Contracts",
  "",
  "- SDS-AC-1 (FR-ARCH-001 AC-1): WHEN one requirement exists THE SYSTEM SHALL list it → `list`",
  "- SDS-AC-2 (FR-ARCH-001 AC-1): WHEN asked THE SYSTEM SHALL show it → `list`",
  "- SDS-AC-3 (FR-ARCH-001 AC-1): WHEN asked twice THE SYSTEM SHALL show it once → `list`",
  "",
  "## Test Plan",
  "",
  "| SDS-AC | Test file | Case summary |",
  "|---|---|---|",
  "| SDS-AC-1 | `test/m5.test.ts` | lists |",
  "| SDS-AC-2 | `test/missing.test.ts` | shows |",
  "| SDS-AC-3 | `test/folder.test.ts` | shows once |",
  ""
].join("\n");

/** valid-basic with 40 test files citing FR-ARCH-001, an SDS whose plan names a missing file and a directory. */
async function workspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  for (let index = 0; index < 40; index += 1) {
    const cites = index % 3 === 0 ? "FR-ARCH-001 AC-1" : index % 3 === 1 ? "FR-ARCH-001 AC-2" : "nothing";
    await put(root, `test/m${index}.test.ts`, `it('${cites} case ${index}', () => {}); // SDS-AC-${(index % 3) + 1}\n`);
  }
  await mkdir(path.join(root, "test", "folder.test.ts"), { recursive: true });
  await put(root, "docs/sds/demo.sds.md", SDS);
  return root;
}

async function sufficiency(root: string) {
  const result = await checkTestSufficiency(await parseWorkspace(await resolveProjectRoot(root, root)), { target: "v1.0.0", sds: "docs/sds/demo.sds.md" });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  return result.value!;
}

function reset(serial: boolean): void {
  reads.inFlight = 0;
  reads.most = 0;
  reads.serial = serial;
  reads.chain = Promise.resolve();
  reads.failOn = "";
  reads.failFast = "";
}

describe("FR-NODE-304 — the test files are read concurrently, with the same result", () => {
  // @req FR-NODE-304 AC-1
  it("keeps more than one and at most 16 reads in flight", async () => {
    const root = await workspace();
    reset(false);
    await sufficiency(root);
    expect(reads.most).toBeGreaterThan(1);
    expect(reads.most).toBeLessThanOrEqual(16);
  });

  // @req FR-NODE-304 AC-2
  it("reports what reading one by one reports, missing and directory plan files included", async () => {
    const root = await workspace();
    reset(true);
    const oneByOne = await sufficiency(root);
    expect(reads.most).toBe(1);
    reset(false);
    const concurrent = await sufficiency(root);
    expect(concurrent).toEqual(oneByOne);
    const planned = concurrent.sdsContracts.map((item) => [item.sdsAcId, item.testFiles.map((file) => [file.path, file.exists])]);
    expect(planned).toEqual([
      ["SDS-AC-1", [["test/m5.test.ts", true]]],
      ["SDS-AC-2", [["test/missing.test.ts", false]]],
      ["SDS-AC-3", [["test/folder.test.ts", false]]]
    ]);
  });

  // @req FR-NODE-304 AC-2
  it("the CLI reports the same coverage as the core call", async () => {
    const root = await workspace();
    reset(false);
    const core = await sufficiency(root);
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", root, "coverage", "--tests", "--json", "--target", "v1.0.0", "--sds", "docs/sds/demo.sds.md"], streams);
    const cli = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Record<string, unknown>;
    expect(cli.requirements).toEqual(JSON.parse(JSON.stringify(core.requirements)));
    expect(cli.gaps).toEqual(JSON.parse(JSON.stringify(core.gaps)));
  });

  // @req FR-NODE-304 AC-3
  it("takes its candidate files from the FR-NODE-292 search unchanged", async () => {
    const root = await workspace();
    reset(false);
    const report = await sufficiency(root);
    const search = await findTestFiles(root);
    expect(report.testFileCount).toBe(search.files.length);
    expect(report.testFileCount).toBe(40);
    expect(report.ignoredTestFileCount).toBe(search.ignoredCount);
    expect(report.ignoreRules).toBe(search.ignoreRules);
    expect(report.ignoreRulesReason).toEqual(search.ignoreRulesReason);
  });

  // @req FR-NODE-304 AC-4
  it("with two unreadable files, names the one reading one by one names, even when the later one fails first", async () => {
    const root = await workspace();
    const named: string[] = [];
    for (const serial of [true, false]) {
      reset(serial);
      // In file order m30 comes before m31; m31 fails at once while m30 is still being read.
      reads.failOn = "test/m30.test.ts";
      reads.failFast = "test/m31.test.ts";
      const error = await checkTestSufficiency(await parseWorkspace(await resolveProjectRoot(root, root)), { target: "v1.0.0" }).then(
        () => new Error("no failure"),
        (thrown: unknown) => thrown as Error
      );
      named.push(error.message.replace(/\\/g, "/").replace(/^.*\/(test\/m\d+\.test\.ts).*$/, "$1"));
    }
    expect(named).toEqual(["test/m30.test.ts", "test/m30.test.ts"]);
  });

  // @req FR-NODE-304 AC-4
  it("fails as reading one by one does when a test file cannot be read, with no read left running", async () => {
    const root = await workspace();
    for (const serial of [true, false]) {
      reset(serial);
      reads.failOn = "test/m7.test.ts";
      let atAnswer = -1;
      const call = checkTestSufficiency(await parseWorkspace(await resolveProjectRoot(root, root)), { target: "v1.0.0" }).catch((error: unknown) => {
        atAnswer = reads.inFlight;
        throw error;
      });
      await expect(call).rejects.toThrow(/EACCES/);
      expect(atAnswer, `serial ${serial}`).toBe(0);
    }
  });
});
