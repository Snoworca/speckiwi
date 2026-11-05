import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPreservation, type PreservationReport } from "../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

// Independent verification of FR-NODE-252 (5.3.0), round 7, bundle a. This round weakened real
// corpus test files and replayed real commit pairs; no red was found, so the file keeps two green
// checks of the same kind. The repositories are temporary and removed afterwards.

afterAll(cleanupFixtures);

const REPO = path.resolve(__dirname, "../..");

/** Base = the corpus file as it is; head = the same file after `weaken`. */
async function weakened(corpusFile: string, weaken: (text: string) => string): Promise<PreservationReport> {
  const text = await readFile(path.join(REPO, corpusFile), "utf8");
  const head = weaken(text);
  expect(head).not.toBe(text);
  const root = await initRepo("verify-r7a");
  const file = path.join(root, "case.test.ts");
  await writeFile(file, text, "utf8");
  const base = await commitAll(root, "base");
  await rm(file);
  await writeFile(file, head, "utf8");
  const headCommit = await commitAll(root, "head");
  const result = await checkPreservation({ root, base, head: headCommit });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("FR-NODE-252 — preservation check on weakened corpus files, round 7", { timeout: 120_000 }, () => {
  // @req FR-NODE-252 AC-4 — a `.skip` added SHALL be reported naming the file and case.
  // Corpus: test/cli/mode-task.ir-cli-107.test.ts (an `it.each(rows)("…", …)` case).
  it("a .skip added to a corpus it.each case is one skip-added row naming it", async () => {
    const report = await weakened("test/cli/mode-task.ir-cli-107.test.ts", (text) =>
      text.replace('it.each([["vibe"], ["tdd"]])', 'it.skip.each([["vibe"], ["tdd"]])')
    );
    expect(report.passed).toBe(false);
    expect(report.unchecked).toEqual([]);
    expect(report.rows).toEqual([
      {
        kind: "existing-test-weakened-or-deleted",
        path: "case.test.ts",
        case: "IR-CLI-107 speckiwi mode --task > IR-CLI-107 AC-1: `mode %s --task` writes the Active Task and a read reports it",
        change: "skip-added",
        marker: ".skip"
      }
    ]);
  });

  // @req FR-NODE-252 AC-4 — an `expect(` assertion removed from a case that still exists SHALL be
  // reported naming the file and case. Corpus: test/cli/mode-task.ir-cli-107.test.ts.
  it("an expect statement deleted from a corpus case is one assertion-removed row naming it", async () => {
    const report = await weakened("test/cli/mode-task.ir-cli-107.test.ts", (text) => {
      const start = text.indexOf('it("IR-CLI-107 AC-4');
      const at = text.indexOf("expect(", start);
      const end = text.indexOf("\n", at);
      return text.slice(0, at) + text.slice(end + 1);
    });
    expect(report.unchecked).toEqual([]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ kind: "existing-test-weakened-or-deleted", change: "assertion-removed" });
    expect((report.rows[0] as { case: string }).case).toContain("IR-CLI-107 AC-4");
  });
});
