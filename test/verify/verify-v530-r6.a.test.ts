import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPreservation, type PreservationReport } from "../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

// Independent verification of FR-NODE-252 (5.3.0), round 6, bundle a. Every test kept here is red:
// it shows a place where the preservation check does not hold an acceptance criterion. The
// repositories are temporary and removed afterwards.

afterAll(cleanupFixtures);

async function write(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

/** A two-commit temporary repository and the preservation report between its commits. */
async function preservation(baseFiles: Record<string, string>, headFiles: Record<string, string | null>): Promise<PreservationReport> {
  const root = await initRepo("verify-r6a");
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

/** Whether the report names the case as weakened, or lists the file as unchecked. */
function caseReportedOrUnchecked(report: PreservationReport, file: string, title: string): boolean {
  const named = report.rows.some((row) => row.kind === "existing-test-weakened-or-deleted" && row.path === file && row.case !== null && row.case.includes(title));
  return named || report.unchecked.some((entry) => entry.path === file);
}

describe("FR-NODE-252 — preservation check, round 6", { timeout: 120_000 }, () => {
  // @req FR-NODE-252 AC-4 — a `.skip` added SHALL be reported as existing-test-weakened-or-deleted
  // naming the file and case. The corpus form is test/core/orchestrator/pinning.fr-node-134.test.ts:
  // `it.for(SUBSTITUTION_CLASSES)("AC-3: refuses the re-proof under $name", async ({ substitute }, { skip }) => {`
  // with `skip(…)` called in the body — the `.for` callback receives the test context as its second
  // parameter. Head adds an unconditional `skip(…)` at the top of that case, so it never runs.
  it("context skip: a skip() added through the second (context) parameter of an it.for case is reported", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      'const CLASSES = [{ name: "a", substitute: async () => {} }];',
      'describe("d", () => {',
      '  it.for(CLASSES)("refuses the re-proof under $name", async ({ substitute }, { skip }) => {',
      "    try {",
      "      await substitute();",
      "    } catch {",
      '      skip("needs a privilege");',
      "      return;",
      "    }",
      "    expect(1).toBe(1);",
      "  });",
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      'const CLASSES = [{ name: "a", substitute: async () => {} }];',
      'describe("d", () => {',
      '  it.for(CLASSES)("refuses the re-proof under $name", async ({ substitute }, { skip }) => {',
      '    skip("always");',
      "    try {",
      "      await substitute();",
      "    } catch {",
      '      skip("needs a privilege");',
      "      return;",
      "    }",
      "    expect(1).toBe(1);",
      "  });",
      "});"
    );
    const file = "test/for-ctx.test.ts";
    const report = await preservation({ [file]: base }, { [file]: head });
    expect(report.passed).toBe(false);
    expect(caseReportedOrUnchecked(report, file, "refuses the re-proof under $name")).toBe(true);
  });

  // @req FR-NODE-252 AC-4 — a `.skip` added SHALL be reported naming the file and case. The case
  // form `it("title", { timeout: 120_000 }, () => {` is the corpus's
  // (test/release/typecheck-test-project.fr-node-164.test.ts), and `ctx.skip()` on the context
  // parameter is the corpus's (test/core/bootstrap/codex-global-roots.fr-node-228.test.ts). Head
  // adds `ctx.skip()` to such a case; the reader does not find the context parameter after the
  // options object, yet the report passes.
  it("context skip: ctx.skip() added to a case that takes an options object before its callback is reported", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      'describe("d", () => {',
      '  it("reports zero diagnostics", { timeout: 240_000 }, async (ctx) => {',
      "    expect(1).toBe(1);",
      "  });",
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      'describe("d", () => {',
      '  it("reports zero diagnostics", { timeout: 240_000 }, async (ctx) => {',
      "    ctx.skip();",
      "    expect(1).toBe(1);",
      "  });",
      "});"
    );
    const file = "test/options-ctx.test.ts";
    const report = await preservation({ [file]: base }, { [file]: head });
    expect(report.passed).toBe(false);
    expect(caseReportedOrUnchecked(report, file, "reports zero diagnostics")).toBe(true);
  });

  // @req FR-NODE-252 AC-4 — a `.skip` added SHALL be reported naming the file and case. The title
  // form `it(fixture.name, () => {` is the corpus's (test/core/parser/heading-marker.test.ts).
  // Head adds `ctx.skip()` on the case's context parameter; the reader looks for the callback one
  // token after the title, which a property-path title spans three tokens of, yet the report passes.
  it("context skip: ctx.skip() added to a case titled by a property path is reported", async () => {
    const base = lines(
      'import { describe, expect, it } from "vitest";',
      'const fixtures = [{ name: "one" }];',
      'describe("d", () => {',
      "  for (const fixture of fixtures) {",
      "    it(fixture.name, (ctx) => {",
      "      expect(1).toBe(1);",
      "    });",
      "  }",
      "});"
    );
    const head = lines(
      'import { describe, expect, it } from "vitest";',
      'const fixtures = [{ name: "one" }];',
      'describe("d", () => {',
      "  for (const fixture of fixtures) {",
      "    it(fixture.name, (ctx) => {",
      "      ctx.skip();",
      "      expect(1).toBe(1);",
      "    });",
      "  }",
      "});"
    );
    const file = "test/title-path-ctx.test.ts";
    const report = await preservation({ [file]: base }, { [file]: head });
    expect(report.passed).toBe(false);
    expect(caseReportedOrUnchecked(report, file, "${fixture.name}")).toBe(true);
  });
});
