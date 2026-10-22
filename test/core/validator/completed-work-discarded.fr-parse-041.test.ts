import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// valid-basic logs FR-ARCH-001 in its Completed Work Log; only the logged requirement's status changes here.
async function fixtureWithLoggedStatus(status: string): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const original = await readFile(specPath, "utf8");
  if (!original.includes("| Status | planned |")) throw new Error("fixture status row not found");
  await writeFile(specPath, original.replace("| Status | planned |", `| Status | ${status} |`), "utf8");
  // Keep the index Status Summary in step so the only possible warning is the one under test.
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const index = await readFile(indexPath, "utf8");
  if (!index.includes("| planned | 1 |")) throw new Error("fixture status summary row not found");
  await writeFile(indexPath, index.replace("| planned | 1 |", `| ${status} | 1 |`), "utf8");
  return root;
}

async function codesFor(root: string): Promise<string[]> {
  return validateWorkspace(await parseWorkspace(await resolveProjectRoot(root))).diagnostics.map((d) => d.code);
}

describe("FR-PARSE-041 Completed Work Log rows naming a discarded requirement", () => {
  it("FR-PARSE-041 AC-1 raises no SRS-W015 for a logged requirement whose status is discarded", async () => {
    expect(await codesFor(await fixtureWithLoggedStatus("discarded"))).not.toContain("SRS-W015");
  });

  it("FR-PARSE-041 AC-2 keeps SRS-W015 for planned, in_progress and blocked, and SRS-W014 for a missing ID", async () => {
    for (const status of ["planned", "in_progress", "blocked"]) {
      expect(await codesFor(await fixtureWithLoggedStatus(status)), status).toContain("SRS-W015");
    }

    const root = await fixtureWithLoggedStatus("discarded");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const index = await readFile(indexPath, "utf8");
    await writeFile(indexPath, index.replace("| ARCH | FR-ARCH-001 |", "| ARCH | FR-ARCH-001, FR-ARCH-999 |"), "utf8");
    const codes = await codesFor(root);
    expect(codes).toContain("SRS-W014");
    expect(codes).not.toContain("SRS-W015");
  });

  it("FR-PARSE-041 AC-3 lets validate --fail-on-warning exit 0 when the only logged incomplete requirement is discarded", async () => {
    const root = await fixtureWithLoggedStatus("discarded");
    const stdout = new PassThrough();
    const exitCode = await main(["--root", root, "validate", "--fail-on-warning", "--json"], { stdout, stderr: new PassThrough() });
    const output = JSON.parse(stdout.read()?.toString() ?? "") as { summary: { warnings: number; errors: number } };
    expect(output.summary).toMatchObject({ errors: 0, warnings: 0 });
    expect(exitCode).toBe(0);
  });
});
