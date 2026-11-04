import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { PRD_PATH, prdWorkspace } from "./prd-surface-fixture.js";

// FR-NODE-242 AC-1 — `links check` reports a `docs/prd/<file>.prd.md#PRD-<n>` reference, in a Trace
// `Doc` row or a Rationale, whose file or item does not exist. valid-basic holds FR-ARCH-001; its
// Rationale and Trace Links are rewritten here.

interface Broken {
  requirementId: string;
  reference: string;
  reason: string;
  code: string;
}

const SCOPE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function rewrite(root: string, rationale: string, traceRow: string): Promise<void> {
  const file = path.join(root, SCOPE);
  const text = await readFile(file, "utf8");
  await writeFile(
    file,
    text
      .replace("The parser needs a small valid workspace.", rationale)
      .replace("| Requirement | FR-ARCH-001 | self | Fixture self link |", `| Requirement | FR-ARCH-001 | self | Fixture self link |\n${traceRow}`),
    "utf8"
  );
}

async function linksCheck(root: string): Promise<{ checked: number; broken: Broken[] }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", root, "links", "check", "--json"], streams);
  return JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { checked: number; broken: Broken[] };
}

function prdProblems(result: { broken: Broken[] }): Broken[] {
  return result.broken.filter((entry) => entry.reference.includes("docs/prd/"));
}

describe("FR-NODE-242 AC-1 — links check resolves PRD references", () => {
  // @req FR-NODE-242 AC-1
  it("reports a Rationale reference to a missing item and a Trace Doc reference to a missing file, and not a reference that resolves", async () => {
    const root = await prdWorkspace();
    await rewrite(
      root,
      `AC-1 ← ${PRD_PATH}#PRD-2; AC-2 ← ${PRD_PATH}#PRD-9; see docs/prd/2026-01-02.lost.prd.md#PRD-1`,
      `| Doc | docs/prd/2026-01-01.gone.prd.md#PRD-1 | informed_by | - |\n| Doc | ${PRD_PATH}#PRD-7 | informed_by | - |`
    );
    const problems = prdProblems(await linksCheck(root));
    expect(problems.map((entry) => [entry.requirementId, entry.code, entry.reference]).sort()).toEqual(
      [
        ["FR-ARCH-001", "SRS-W079", `${PRD_PATH}#PRD-9`],
        ["FR-ARCH-001", "SRS-W079", "docs/prd/2026-01-02.lost.prd.md#PRD-1"],
        ["FR-ARCH-001", "SRS-W079", `${PRD_PATH}#PRD-7`],
        // The Trace path's missing file is the Trace path check's finding, reported once.
        ["FR-ARCH-001", "SRS-W074", "docs/prd/2026-01-01.gone.prd.md#PRD-1"]
      ].sort()
    );
    expect(problems.find((entry) => entry.reference === `${PRD_PATH}#PRD-9`)?.reason).toMatch(/PRD-9/);
    expect(problems.find((entry) => entry.reference === "docs/prd/2026-01-02.lost.prd.md#PRD-1")?.reason).toMatch(/file/);
  });

  // @req FR-NODE-242 AC-1
  it("reports nothing for PRD references that all resolve", async () => {
    const root = await prdWorkspace();
    await rewrite(root, `AC-1 ← ${PRD_PATH}#PRD-1`, `| Doc | ${PRD_PATH}#PRD-2 | informed_by | - |`);
    expect(prdProblems(await linksCheck(root))).toEqual([]);
  });
});
