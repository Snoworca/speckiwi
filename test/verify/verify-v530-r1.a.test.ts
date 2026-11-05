import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPreservation, type PreservationReport } from "../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

// Independent verification of FR-NODE-244/245/248/250/252 and FR-PARSE-045 (5.3.0), round 1, bundle a.
// Every test here is red: it shows a place where the preservation check core does not hold an
// acceptance criterion. The repositories are temporary and removed afterwards.

afterAll(cleanupFixtures);

async function write(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

/** A two-commit temporary repository and the preservation report between its commits. */
async function preservation(baseFiles: Record<string, string>, headFiles: Record<string, string | null>): Promise<PreservationReport> {
  const root = await initRepo("verify-a");
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

describe("FR-NODE-252 — preservation check on .tsx/.jsx files and class contracts", { timeout: 120_000 }, () => {
  // @req FR-NODE-252 AC-3 — for a .tsx file, an exported name present at base and absent at head is
  // reported as existing-public-contract-change. A component file whose body holds a closing JSX tag.
  it("tsx: an export removed from a component file with a closing JSX tag is reported", async () => {
    const report = await preservation(
      { "src/view.tsx": "export function A(name: string) {\n  return <div>hi</div>;\n}\nexport function B() {\n  return <span>x</span>;\n}\n" },
      { "src/view.tsx": "export function A(name: string) {\n  return <div>hi</div>;\n}\n" }
    );
    expect(report.rows).toContainEqual(expect.objectContaining({ kind: "existing-public-contract-change", path: "src/view.tsx", symbol: "B" }));
  });

  // @req FR-NODE-252 AC-3 — for a .jsx file, an exported declaration whose parameter list differs is
  // reported as existing-public-contract-change.
  it("jsx: a parameter change of an exported component is reported", async () => {
    const report = await preservation(
      { "src/view.jsx": "export function A(name) {\n  return <p>{name}</p>;\n}\n" },
      { "src/view.jsx": "export function A(name, age) {\n  return <p>{name}</p>;\n}\n" }
    );
    expect(report.rows).toContainEqual(expect.objectContaining({ kind: "existing-public-contract-change", path: "src/view.jsx", symbol: "A" }));
  });

  // @req FR-NODE-252 AC-3 — an exported declaration whose parameter list or type text differs is
  // reported; an exported class's constructor parameter list is the parameter list `new Box(...)` takes.
  it("ts: an exported class whose constructor parameter list changes is reported", async () => {
    const report = await preservation(
      { "src/a.ts": "export class Box {\n  constructor(value: string) {}\n}\n" },
      { "src/a.ts": "export class Box {\n  constructor(value: number, extra: number) {}\n}\n" }
    );
    expect(report.rows).toContainEqual(expect.objectContaining({ kind: "existing-public-contract-change", symbol: "Box" }));
  });

  // @req FR-NODE-252 AC-4 — for a test file under the test-file rule, a test case removed by title is
  // reported as existing-test-weakened-or-deleted naming the file and case. A .tsx test file.
  it("tsx test: a removed case in a test file whose assertion renders JSX is reported", async () => {
    const base = 'import { expect, it } from "vitest";\nit("renders", () => { expect(<div>hi</div>).toBeTruthy(); });\nit("keeps", () => { expect(1).toBe(1); });\n';
    const head = 'import { expect, it } from "vitest";\nit("keeps", () => { expect(1).toBe(1); });\n';
    const report = await preservation({ "test/view.test.tsx": base }, { "test/view.test.tsx": head });
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "existing-test-weakened-or-deleted", path: "test/view.test.tsx", case: "renders", change: "case-removed" })
    );
  });
});
