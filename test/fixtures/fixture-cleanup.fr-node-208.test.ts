import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "./fixture-utils.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const VITEST_BIN = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");

// @req FR-NODE-208 — a test that makes a temporary directory removes it.
//
// The subject is `copyFixtureWorkspace`, which 169 files import and which produced 139,046 of the
// 275,900 entries measured in `%TEMP%` on 2026-09-07. The fix belongs in the helper rather than in
// its callers: 169 edits are 169 chances for the 170th caller to forget.
//
// WHAT THIS FILE DOES NOT HOLD, stated so it is not read into the green:
//  - the other producers. `waves-fixtures.ts` (22,423 entries), `git-fixture.ts` and the tests that
//    call `mkdtemp` themselves are outside this helper and stay outside this file; AC-2 enumerates
//    them in the requirement rather than closing them here.
//  - the backlog already on disk. This asserts that a run stops adding, not that anything was
//    removed; deleting 275,900 pre-existing entries is a separate act and no test does it.
//  - that residue ever made a verdict wrong or a run slow. Both claims were measured and neither
//    held (AC-4); what is left is disk, and disk is what this closes.

const LEAKS_TODAY = "test/core/parser/discover-completed-work-log.test.ts";
const ALREADY_CLEANS = "test/core/orchestrator/registrations.fr-node-106.test.ts";
// The one file that asks the helper for a workspace in `beforeAll` and shares it across its tests.
// Removing it when the first test finishes would break the rest, so it is the case that separates
// per-test removal from end-of-file removal.
const SHARES_ACROSS_TESTS = "test/mcp/response-dedup.fr-mcp-062.test.ts";

// The hermeticity guard writes its journal under the system temporary folder deliberately — its own
// comment says "outside the repository so the guard cannot become a source of pollution itself" —
// so its directory is the one thing in there this requirement must not count and must not audit.
// AC-3 records that as a judgement; this constant is where the judgement is executable.
const GUARD_JOURNAL_DIR = "speckiwi-hermeticity";

interface IsolatedRun {
  readonly status: number | null;
  readonly entries: string[];
  readonly fixtureResidue: string[];
  readonly output: string;
}

async function runInIsolatedTemp(testFile: string): Promise<IsolatedRun> {
  const isolated = await mkdtemp(path.join(tmpdir(), "fr-node-208-"));
  try {
    const result = spawnSync(process.execPath, [VITEST_BIN, "run", "--root", REPO_ROOT, testFile, "--reporter=dot"], {
      cwd: REPO_ROOT,
      env: { ...process.env, TEMP: isolated, TMP: isolated, TMPDIR: isolated },
      encoding: "utf8",
      windowsHide: true,
      timeout: 600_000
    });
    const entries = await readdir(isolated);
    return {
      status: result.status,
      entries,
      fixtureResidue: entries.filter((name) => name.startsWith("speckiwi-") && name !== GUARD_JOURNAL_DIR),
      output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    };
  } finally {
    await rm(isolated, { recursive: true, force: true, maxRetries: 5 });
  }
}

describe("FR-NODE-208 — the shared fixture helper removes what it created", () => {
  let firstWorkspace = "";

  it("AC-1 hands back a workspace that exists while the test that asked for it runs", async () => {
    firstWorkspace = await copyFixtureWorkspace("valid-basic");
    expect(existsSync(firstWorkspace)).toBe(true);
  });

  it("AC-1 removed the previous test's workspace when that test finished", () => {
    expect(firstWorkspace).not.toBe("");
    expect(existsSync(firstWorkspace)).toBe(false);
  });

  it("AC-1 tolerates a caller that already removed the workspace itself", async () => {
    const workspace = await copyFixtureWorkspace("valid-basic");
    await rm(workspace, { recursive: true, force: true });
    expect(existsSync(workspace)).toBe(false);
    // The helper's own removal runs after this test returns. If a second removal were an error,
    // this file would fail in its hook rather than here — which is the assertion.
  });
});

describe("FR-NODE-208 — a suite run leaves the temporary folder as it found it", () => {
  it(
    "AC-1 a file that leaks today leaves no fixture workspace behind, run in an isolated temporary folder",
    async () => {
      const run = await runInIsolatedTemp(LEAKS_TODAY);

      expect(run.status, run.output).toBe(0);
      expect(run.fixtureResidue).toEqual([]);
    },
    600_000
  );

  it(
    "AC-1 a file that already cleans is unchanged: still green, still leaving nothing",
    async () => {
      const run = await runInIsolatedTemp(ALREADY_CLEANS);

      expect(run.status, run.output).toBe(0);
      expect(run.fixtureResidue).toEqual([]);
    },
    600_000
  );

  it(
    "AC-1 a workspace shared across a file's tests survives to the end of that file and is gone after it",
    async () => {
      const run = await runInIsolatedTemp(SHARES_ACROSS_TESTS);

      expect(run.status, run.output).toBe(0);
      expect(run.fixtureResidue).toEqual([]);
    },
    600_000
  );

  it(
    "AC-3 the guard's own journal is written to the temporary folder and is not policed there",
    async () => {
      const run = await runInIsolatedTemp(LEAKS_TODAY);

      expect(run.status, run.output).toBe(0);
      expect(run.entries).toContain(GUARD_JOURNAL_DIR);
    },
    600_000
  );
});
