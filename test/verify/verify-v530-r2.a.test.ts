import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPreservation, type PreservationReport } from "../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

// Independent verification of FR-NODE-252 (5.3.0), round 2, bundle a. Every test kept here is red:
// it shows a place where the preservation check core does not hold an acceptance criterion. The
// repositories are temporary and removed afterwards.

afterAll(cleanupFixtures);

async function write(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

/** A two-commit temporary repository and the preservation report between its commits. */
async function preservation(baseFiles: Record<string, string>, headFiles: Record<string, string | null>): Promise<PreservationReport> {
  const root = await initRepo("verify-r2a");
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


// Lead decision (round 2, scope boundary): a form absent from this repository's corpus may be
// reported by its row or by sending its file to `unchecked`; either way the check does not pass.
function expectRowOrUnchecked(report: { rows: readonly unknown[]; unchecked: readonly { path: string }[]; passed: boolean }, row: unknown, path: string): void {
  const sentUnchecked = report.unchecked.some((u) => u.path === path) && !report.passed;
  if (!sentUnchecked) expect(report.rows).toContainEqual(row);
}

describe("FR-NODE-252 — preservation check, round 2", { timeout: 120_000 }, () => {
  // @req FR-NODE-252 AC-3 — an exported declaration whose parameter list differs is reported as
  // existing-public-contract-change. The default export is an arrow function.
  it("ts: a parameter change of a default-exported arrow function is reported", async () => {
    const report = await preservation(
      { "src/a.ts": "export default (name: string): string => name;\n" },
      { "src/a.ts": "export default (name: string, age: number): string => name;\n" }
    );
    expect(report.rows).toContainEqual(expect.objectContaining({ kind: "existing-public-contract-change", path: "src/a.ts", symbol: "default" }));
  });

  // @req FR-NODE-252 AC-3 — an exported declaration whose parameter list differs is reported. The
  // default export names a local function (`export default App;`), the common component form.
  it("ts: a parameter change of a local function exported as `export default App` is reported", async () => {
    const report = await preservation(
      { "src/app.ts": "function App(props: { a: string }) {\n  return props.a;\n}\nexport default App;\n" },
      { "src/app.ts": "function App(props: { a: string }, extra: number) {\n  return props.a;\n}\nexport default App;\n" }
    );
    expect(report.rows).toContainEqual(expect.objectContaining({ kind: "existing-public-contract-change", path: "src/app.ts", symbol: "default" }));
  });

  // @req FR-NODE-252 AC-3 — for a .tsx file, an exported name present at base and absent at head is
  // reported. The file also declares a generic function type `<T>(value: T) => T`, valid TSX.
  it("tsx: an export removed from a file that declares a generic function type is reported", async () => {
    const report = await preservation(
      { "src/view.tsx": "export type Pick = <T>(value: T) => T;\nexport function A() {\n  return <div />;\n}\nexport function B() {\n  return null;\n}\n" },
      { "src/view.tsx": "export type Pick = <T>(value: T) => T;\nexport function A() {\n  return <div />;\n}\n" }
    );
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-public-contract-change", path: "src/view.tsx", symbol: "B" }), "src/view.tsx");
  });

  // @req FR-NODE-252 AC-4 — a test case removed by title is reported as existing-test-weakened-or-deleted
  // naming the file and case. The case is a vitest tagged-template table case, `it.each\`…\`(title, fn)`.
  it("test: a removed it.each tagged-template case is reported", async () => {
    const base = [
      'import { expect, it } from "vitest";',
      "it.each`",
      "  a    | b",
      "  ${1} | ${2}",
      '`("adds $a and $b", ({ a, b }) => { expect(a + b).toBeGreaterThan(0); });',
      'it("keeps", () => { expect(1).toBe(1); });',
      ""
    ].join("\n");
    const head = ['import { expect, it } from "vitest";', 'it("keeps", () => { expect(1).toBe(1); });', ""].join("\n");
    const report = await preservation({ "test/sum.test.ts": base }, { "test/sum.test.ts": head });
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/sum.test.ts", case: "adds $a and $b" }), "test/sum.test.ts");
  });

  // @req FR-NODE-252 AC-3 — an exported name present at base and absent at head is reported. The
  // name is a function exported from an exported namespace (`N.g`).
  it("ts: a function removed from an exported namespace is reported", async () => {
    const report = await preservation(
      { "src/n.ts": "export namespace N {\n  export function f(a: string) { return a; }\n  export function g(b: number) { return b; }\n}\n" },
      { "src/n.ts": "export namespace N {\n  export function f(a: string) { return a; }\n}\n" }
    );
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-public-contract-change", path: "src/n.ts" }), "src/n.ts");
  });

  // @req FR-NODE-252 AC-3 — an exported declaration whose parameter list differs is reported. The
  // export is a class expression; its constructor parameter list is what `new Box(...)` takes.
  it("ts: a constructor parameter change of an exported class expression is reported", async () => {
    const report = await preservation(
      { "src/box.ts": "export const Box = class {\n  constructor(value: string) {}\n};\n" },
      { "src/box.ts": "export const Box = class {\n  constructor(value: number, extra: number) {}\n};\n" }
    );
    expectRowOrUnchecked(report, expect.objectContaining({ kind: "existing-public-contract-change", path: "src/box.ts", symbol: "Box" }), "src/box.ts");
  });
});
