import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPreservation, type PreservationReport } from "../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

// Independent verification of FR-NODE-252 (5.3.0), round 5, bundle a. Every test kept here is red:
// it shows a place where the preservation check does not hold an acceptance criterion. The
// repositories are temporary and removed afterwards.

afterAll(cleanupFixtures);

async function write(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

/** A two-commit temporary repository and the preservation report between its commits. */
async function preservation(baseFiles: Record<string, string>, headFiles: Record<string, string | null>): Promise<PreservationReport> {
  const root = await initRepo("verify-r5a");
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

describe("FR-NODE-252 — preservation check, round 5", { timeout: 120_000 }, () => {
  // @req FR-NODE-252 AC-4 — a `.skip` added SHALL be reported as existing-test-weakened-or-deleted
  // naming the file and case. The corpus skips a case from inside its body through the test
  // context (`if (!linked) ctx.skip();` in test/core/bootstrap/codex-global-roots.fr-node-228.test.ts,
  // `context.skip();` in test/core/health/doctor-project-root.fr-node-179.test.ts). Head adds that
  // `.skip` to a case that had none, so the case no longer runs.
  it("context skip: adding ctx.skip() to an existing case is reported or the file is unchecked", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      'describe("d", () => {',
      '  it("links the home", async (ctx) => {',
      "    expect(1).toBe(1);",
      "  });",
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      'describe("d", () => {',
      '  it("links the home", async (ctx) => {',
      "    ctx.skip();",
      "    expect(1).toBe(1);",
      "  });",
      "});"
    );
    const report = await preservation({ "test/ctx.test.ts": base }, { "test/ctx.test.ts": head });
    expect(report.passed).toBe(false);
  });

  // @req FR-NODE-252 AC-4 — a test case removed or a `.skip` added SHALL be reported naming the file
  // and case. `String(it)` is a use of the test API the reader does not know; the file must not read
  // as preserved. Because `String(it)` is followed by `:`, the reader takes `it` for a parameter of
  // the next function body and stops seeing the cases inside it.
  it("parameter scope: a call holding `it` before a ternary `:` hides the following cases", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      'const label = process.env.CI ? String(it) : "local";',
      'describe("d", () => {',
      '  it("first", () => { expect(label).toBeTruthy(); });',
      '  it("second", () => { expect(2).toBe(2); });',
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      'const label = process.env.CI ? String(it) : "local";',
      'describe("d", () => {',
      '  it("first", () => { expect(label).toBeTruthy(); });',
      '  it.skip("second", () => { expect(2).toBe(2); });',
      "});"
    );
    const report = await preservation({ "test/scope.test.ts": base }, { "test/scope.test.ts": head });
    expect(report.passed).toBe(false);
  });
});
