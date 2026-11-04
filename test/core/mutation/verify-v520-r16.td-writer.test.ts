import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes, round 16: supersede now gathers each step's diagnostics, and both T1 and T2
// report the same failed rollup sync, so the warning is listed twice while the summary counts it once.

const INDEX = path.join("docs", "spec", "00.index.md");
const CODE = "INDEX_ROLLUP_SYNC_FAILED";

/** valid-basic with its planned Status Summary row cut, so every follow-up rollup sync fails. */
async function cutPlanned(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const file = path.join(rootPath, INDEX);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  await writeFile(file, text.replace("| planned | 1 |", "| planned \| x | 1 |"), "utf8");
  return rootPath;
}

describe("a supersede whose follow-up rollup syncs fail", () => {
  // @req FR-NODE-045 AC-1
  it("D1 lists the rollup warning as many times as its own diagnosticsSummary counts it", async () => {
    const root = await resolveProjectRoot(await cutPlanned());
    const result = await supersedeRequirement(root, { oldId: "FR-ARCH-001", scope: "ARCH", target: "v1.0.0", title: "Successor", statement: "The system shall succeed.", acceptanceCriteria: ["succeeds"], confirmDiscardVerified: true });
    expect(result.ok).toBe(true);
    const listed = result.diagnostics.filter((item) => item.code === CODE).length;
    expect({ listed, warnings: result.diagnostics.filter((item) => item.severity === "warning").length }).toEqual({ listed: result.diagnosticsSummary.byCode[CODE], warnings: result.diagnosticsSummary.warnings });
  });
});
