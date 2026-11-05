import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPreservation, type PreservationReport } from "../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

// Independent verification of FR-NODE-252 (5.3.0), round 4, bundle a. Every test kept here is red:
// it shows a place where the preservation check does not hold an acceptance criterion for a form
// this repository's own tests use. The repositories are temporary and removed afterwards.

afterAll(cleanupFixtures);

async function write(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

/** A two-commit temporary repository and the preservation report between its commits. */
async function preservation(baseFiles: Record<string, string>, headFiles: Record<string, string | null>): Promise<PreservationReport> {
  const root = await initRepo("verify-r4a");
  for (const [file, text] of Object.entries(baseFiles)) await write(root, file, text);
  const base = await commitAll(root, "base");
  for (const [file, text] of Object.entries(headFiles)) {
    if (text === null) await rm(path.join(root, file));
    else await write(root, file, text);
  }
  const head = await commitAll(root, "head");
  const result = await checkPreservation({ root, base, head });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const lines = (...text: string[]): string => `${text.join("\n")}\n`;

// The platform-bound alias the corpus writes (test/core/lock/transient-sentinel-read.fr-node-203.test.ts):
// `const onFencedPlatform = process.platform === "win32" ? it : it.skip;` then `onFencedPlatform.each(rows)(title, fn)`.
const ALIAS = 'const onFencedPlatform = process.platform === "win32" ? it : it.skip;';

describe("FR-NODE-252 — preservation check, round 4", { timeout: 120_000 }, () => {
  // @req FR-NODE-252 AC-4 — a `.skip` added SHALL be reported as existing-test-weakened-or-deleted
  // naming the file and case. The case runs through the corpus's platform alias; head writes `.skip`
  // on that call, so it no longer runs on the platform it ran on.
  it("alias: adding .skip to an onFencedPlatform.each(rows) case is reported as a skip added", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      ALIAS,
      'describe("d", () => {',
      '  onFencedPlatform.each(["EPERM", "EACCES"])("answers held on %s", (code) => { expect(code).toBeTruthy(); });',
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      ALIAS,
      'describe("d", () => {',
      '  onFencedPlatform.skip.each(["EPERM", "EACCES"])("answers held on %s", (code) => { expect(code).toBeTruthy(); });',
      "});"
    );
    const report = await preservation({ "test/fence.test.ts": base }, { "test/fence.test.ts": head });
    expect(report.passed).toBe(false);
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/fence.test.ts", case: "d > answers held on %s", change: "skip-added" })
    );
  });

  // @req FR-NODE-252 AC-4 — a `.skip` added SHALL be reported naming the file and case. The case
  // moves from the corpus's platform alias (runs on win32) to `it.skip` (runs nowhere); head writes
  // `.skip` on a call that had none.
  it("alias: replacing onFencedPlatform.each(rows) with it.skip.each(rows) is reported as a skip added", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      ALIAS,
      'describe("d", () => {',
      '  onFencedPlatform.each(["EPERM"])("answers held on %s", (code) => { expect(code).toBeTruthy(); });',
      '  onFencedPlatform("keeps the alias used", () => { expect(1).toBe(1); });',
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      ALIAS,
      'describe("d", () => {',
      '  it.skip.each(["EPERM"])("answers held on %s", (code) => { expect(code).toBeTruthy(); });',
      '  onFencedPlatform("keeps the alias used", () => { expect(1).toBe(1); });',
      "});"
    );
    const report = await preservation({ "test/fence.test.ts": base }, { "test/fence.test.ts": head });
    expect(report.passed).toBe(false);
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/fence.test.ts", case: "d > answers held on %s", change: "skip-added" })
    );
  });

  // @req FR-NODE-252 AC-4 — a test case removed by title SHALL be reported naming the file and case.
  // The file uses `expect.not.objectContaining(…)`, as test/cli/orchestrate-wave-show.ir-cli-114.test.ts does.
  it("test: removing a case from a file that uses expect.not.objectContaining names that case", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      'describe("d", () => {',
      '  it("first", () => { expect([{ a: 1 }]).toEqual([expect.not.objectContaining({ b: expect.anything() })]); });',
      '  it("second", () => { expect(2).toBe(2); });',
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      'describe("d", () => {',
      '  it("first", () => { expect([{ a: 1 }]).toEqual([expect.not.objectContaining({ b: expect.anything() })]); });',
      "});"
    );
    const report = await preservation({ "test/not.test.ts": base }, { "test/not.test.ts": head });
    expect(report.unchecked).toEqual([]);
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/not.test.ts", case: "d > second", change: "case-removed" })
    );
  });

  // @req FR-NODE-252 AC-4 — a test case removed by title SHALL be reported naming the file and case.
  // The file names an arrow parameter `test` (`assertionResults.filter((test) => test.status …)`),
  // as test/verify/verify-v530-r4.d1.test.ts and verify-v530-r5.d1.test.ts do.
  it("test: removing a case from a file with a `(test) =>` parameter names that case", async () => {
    const helper = "const failed = (results: Array<{ status: string }>) => results.filter((test) => test.status === \"failed\");";
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      helper,
      'describe("d", () => {',
      '  it("first", () => { expect(failed([])).toEqual([]); });',
      '  it("second", () => { expect(2).toBe(2); });',
      "});"
    );
    const head = lines('import { describe, expect, it } from "vitest";', helper, 'describe("d", () => {', '  it("first", () => { expect(failed([])).toEqual([]); });', "});");
    const report = await preservation({ "test/param.test.ts": base }, { "test/param.test.ts": head });
    expect(report.unchecked).toEqual([]);
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/param.test.ts", case: "d > second", change: "case-removed" })
    );
  });
});
