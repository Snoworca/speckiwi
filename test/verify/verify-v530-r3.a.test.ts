import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPreservation, type PreservationReport } from "../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

// Independent verification of FR-NODE-252 (5.3.0), round 3, bundle a. Every test kept here is red:
// it shows a place where the preservation check core does not hold an acceptance criterion. The
// repositories are temporary and removed afterwards.

afterAll(cleanupFixtures);

async function write(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

/** A two-commit temporary repository and the preservation report between its commits. */
async function preservation(baseFiles: Record<string, string>, headFiles: Record<string, string | null>): Promise<PreservationReport> {
  const root = await initRepo("verify-r3a");
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

// Lead decision (scope boundary): a form absent from this repository's corpus may be reported by its
// row or by sending its file to `unchecked`; either way the check does not pass.
function expectRowOrUnchecked(report: PreservationReport, row: unknown, file: string): void {
  const sentUnchecked = report.unchecked.some((u) => u.path === file) && !report.passed;
  if (!sentUnchecked) expect(report.rows).toContainEqual(row);
}

const lines = (...text: string[]): string => `${text.join("\n")}\n`;

describe("FR-NODE-252 — preservation check, round 3", { timeout: 120_000 }, () => {
  // --- forms written in this repository (test/cli/diagnostics-limit.fr-node-231.test.ts and
  // --- others: `it.each(READERS)("…", fn)`; test/cli/run-lock-refusal-release.ir-cli-105.test.ts:
  // --- `it.runIf(WIN32)("…", fn)`; srs-lock-load.rel-node-009.test.ts: `describe.skipIf(…)(…)`;
  // --- exclusive-lock-post-publication.fr-node-177.test.ts: `expect.soft(…)`) — exact rows.

  // @req FR-NODE-252 AC-4 — a test case removed by title is reported naming the file and case. The
  // case is `it.each(TABLE)(title, fn)` with the table in a variable, as the corpus writes it.
  it("test: removing an it.each(ROWS) case names that case by its title", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      "const ROWS = [{ name: 'a' }, { name: 'b' }];",
      'describe("d", () => {',
      '  it.each(ROWS)("first $name", ({ name }) => { expect(name).toBeTruthy(); });',
      '  it.each(ROWS)("second $name", ({ name }) => { expect(name).toBeTruthy(); });',
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      "const ROWS = [{ name: 'a' }, { name: 'b' }];",
      'describe("d", () => {',
      '  it.each(ROWS)("second $name", ({ name }) => { expect(name).toBeTruthy(); });',
      "});"
    );
    const report = await preservation({ "test/each.test.ts": base }, { "test/each.test.ts": head });
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/each.test.ts", case: "d > first $name", change: "case-removed" })
    );
  });

  // @req FR-NODE-252 AC-4 — an `expect(` assertion removed from a case that still exists is reported
  // naming the file and case. The case is `it.each(TABLE)(title, fn)`.
  it("test: an expect( removed from an it.each(ROWS) case is reported on that case", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      "const ROWS = [{ name: 'a' }];",
      'describe("d", () => {',
      '  it.each(ROWS)("checks $name", ({ name }) => {',
      "    expect(name).toBeTruthy();",
      "    expect(name).toHaveLength(1);",
      "  });",
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      "const ROWS = [{ name: 'a' }];",
      'describe("d", () => {',
      '  it.each(ROWS)("checks $name", ({ name }) => {',
      "    expect(name).toBeTruthy();",
      "  });",
      "});"
    );
    const report = await preservation({ "test/each.test.ts": base }, { "test/each.test.ts": head });
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/each.test.ts", case: "d > checks $name", change: "assertion-removed" })
    );
  });

  // @req FR-NODE-252 AC-4 — an `expect(` assertion removed from a case that still exists is reported.
  // The case is `it.runIf(WIN32)(title, fn)` at the top level, as the corpus writes it.
  it("test: an expect( removed from an it.runIf(WIN32) case is reported, not passed", async () => {
    const base = lines(
      'import { expect, it } from "vitest";',
      'const WIN32 = process.platform === "win32";',
      'it.runIf(WIN32)("holds the fence", () => {',
      "  expect(1).toBe(1);",
      "  expect(2).toBe(2);",
      "});"
    );
    const head = lines(
      'import { expect, it } from "vitest";',
      'const WIN32 = process.platform === "win32";',
      'it.runIf(WIN32)("holds the fence", () => {',
      "  expect(1).toBe(1);",
      "});"
    );
    const report = await preservation({ "test/lock.test.ts": base }, { "test/lock.test.ts": head });
    expect(report.passed).toBe(false);
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/lock.test.ts", case: "holds the fence", change: "assertion-removed" })
    );
  });

  // @req FR-NODE-252 AC-4 — a `.skip` added to a case is reported naming the file and case. The
  // corpus skips cases conditionally with `.skipIf(cond)`; adding it to a running case skips it.
  it("test: adding .skipIf(cond) to an existing case is reported as a skip added", async () => {
    const base = lines('import { expect, it } from "vitest";', 'it("reads the lock", () => { expect(1).toBe(1); });');
    const head = lines('import { expect, it } from "vitest";', 'it.skipIf(process.platform !== "win32")("reads the lock", () => { expect(1).toBe(1); });');
    const report = await preservation({ "test/skip.test.ts": base }, { "test/skip.test.ts": head });
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/skip.test.ts", case: "reads the lock", change: "skip-added" })
    );
  });

  // @req FR-NODE-252 AC-4 — an `expect(` assertion removed from a case that still exists is reported.
  // The assertion is vitest's `expect.soft(`, which the corpus uses.
  it("test: an expect.soft( assertion removed from a case is reported", async () => {
    const base = lines('import { expect, it } from "vitest";', 'it("rolls back", () => {', "  expect.soft(1).toBe(1);", "  expect.soft(2).toBe(2);", "});");
    const head = lines('import { expect, it } from "vitest";', 'it("rolls back", () => {', "  expect.soft(1).toBe(1);", "});");
    const report = await preservation({ "test/soft.test.ts": base }, { "test/soft.test.ts": head });
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/soft.test.ts", case: "rolls back", change: "assertion-removed" })
    );
  });

  // --- forms absent from the corpus — a row, or `unchecked` with passed:false; never a silent pass.

  // @req FR-NODE-252 AC-4 — a test case removed by title is reported. The case function is imported
  // under another name (`import { it as spec } from "vitest"`).
  it("test: a removed case registered through an import alias does not pass silently", async () => {
    const base = lines('import { expect, it as spec } from "vitest";', 'spec("one", () => { expect(1).toBe(1); });', 'spec("two", () => { expect(2).toBe(2); });');
    const head = lines('import { expect, it as spec } from "vitest";', 'spec("one", () => { expect(1).toBe(1); });');
    const report = await preservation({ "test/alias.test.ts": base }, { "test/alias.test.ts": head });
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/alias.test.ts", case: "two" }), "test/alias.test.ts");
  });

  // @req FR-NODE-252 AC-4 — a test case removed by title is reported. The case function is reached
  // through a namespace import (`import * as v from "vitest"; v.it(…)`).
  it("test: a removed case written v.it(…) does not pass silently", async () => {
    const base = lines('import * as v from "vitest";', 'v.it("one", () => { v.expect(1).toBe(1); });', 'v.it("two", () => { v.expect(2).toBe(2); });');
    const head = lines('import * as v from "vitest";', 'v.it("one", () => { v.expect(1).toBe(1); });');
    const report = await preservation({ "test/ns.test.ts": base }, { "test/ns.test.ts": head });
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/ns.test.ts", case: "two" }), "test/ns.test.ts");
  });

  // @req FR-NODE-252 AC-4 — a `.skip` added is reported. The case group is vitest's `suite`, the
  // alias of `describe`.
  it("test: suite → suite.skip does not pass silently", async () => {
    const base = lines('import { expect, it, suite } from "vitest";', 'suite("s", () => {', '  it("x", () => { expect(1).toBe(1); });', "});");
    const head = lines('import { expect, it, suite } from "vitest";', 'suite.skip("s", () => {', '  it("x", () => { expect(1).toBe(1); });', "});");
    const report = await preservation({ "test/suite.test.ts": base }, { "test/suite.test.ts": head });
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/suite.test.ts", change: "skip-added" }), "test/suite.test.ts");
  });

  // @req FR-NODE-252 AC-3 — an exported declaration whose type text differs is reported. The export
  // is `export default interface`.
  it("ts: a body change of `export default interface` does not pass silently", async () => {
    const report = await preservation(
      { "src/props.ts": "export default interface Props {\n  a: string;\n}\n" },
      { "src/props.ts": "export default interface Props {\n  a: number;\n}\n" }
    );
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-public-contract-change", path: "src/props.ts", symbol: "default" }), "src/props.ts");
  });

  // @req FR-NODE-252 AC-3 — an exported name present at base and absent at head is reported. The
  // CommonJS export object is written `module["exports"] = { … }`.
  it("cjs: a name removed from module[\"exports\"] does not pass silently", async () => {
    const report = await preservation(
      { "src/lib.cjs": 'function a(x) { return x; }\nfunction b(y) { return y; }\nmodule["exports"] = { a, b };\n' },
      { "src/lib.cjs": 'function a(x) { return x; }\nfunction b(y) { return y; }\nmodule["exports"] = { a };\n' }
    );
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-public-contract-change", path: "src/lib.cjs", symbol: "b" }), "src/lib.cjs");
  });
});
