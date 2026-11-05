import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-248 — a Verification Evidence `Covers` cell names `all` or criteria one by one; a range
// is refused when written and reported when found.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const RANGES = ["AC-1..AC-11", "AC-1-AC-2", "AC-1~AC-2", "AC-1–AC-2", "AC-1—AC-2", "AC-1 .. AC-2", "AC-3, AC-1..AC-2", "ac-1..ac-2"];

async function specText(root: string): Promise<string> {
  return readFile(path.join(root, SPEC), "utf8");
}

describe("FR-NODE-248 AC-1 — add_verification_evidence refuses a range in covers", () => {
  // @req FR-NODE-248 AC-1
  it("FR-NODE-248 AC-1: refuses each range form without writing and names the accepted forms", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await specText(root);
    for (const covers of RANGES) {
      const result = await addVerificationEvidence(await resolveProjectRoot(root), { id: "FR-ARCH-001", type: "test", reference: "test/x.test.ts", covers });
      expect(result.ok, covers).toBe(false);
      const message = JSON.stringify(result);
      expect(message, covers).toContain("`all`");
      expect(message, covers).toContain("AC-<n>");
      expect(await specText(root), covers).toBe(before);
    }
  });

  // @req FR-NODE-248 AC-1
  it("FR-NODE-248 AC-1: accepts all and a comma-separated list of AC ids", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    for (const covers of ["all", "AC-1, AC-2", "AC-2"]) {
      const result = await addVerificationEvidence(await resolveProjectRoot(root), { id: "FR-ARCH-001", type: "test", reference: "test/x.test.ts", covers });
      expect(result.ok, covers).toBe(true);
    }
    expect(await specText(root)).toContain("| AC-1, AC-2 |");
  });

  // @req FR-NODE-248 AC-1
  it("FR-NODE-248 AC-1: the CLI add-evidence refuses a range the same way", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await specText(root);
    const stdout = new PassThrough();
    const exit = await main(["--root", root, "add-evidence", "FR-ARCH-001", "--type", "test", "--reference", "test/x.test.ts", "--covers", "AC-1..AC-2", "--json"], {
      stdout,
      stderr: new PassThrough()
    });
    expect(exit).not.toBe(0);
    expect(stdout.read()?.toString() ?? "").toContain("AC-<n>");
    expect(await specText(root)).toBe(before);
  });
});

describe("FR-NODE-248 AC-2 — the validator reports an existing range row", () => {
  async function withEvidenceRow(covers: string): Promise<string> {
    const root = await copyFixtureWorkspace("valid-basic");
    const specPath = path.join(root, SPEC);
    const text = await readFile(specPath, "utf8");
    const header = "| --- | --- | --- | --- | --- |\n\n#### Trace Links";
    if (!text.includes(header)) throw new Error("fixture evidence table not found");
    await writeFile(specPath, text.replace(header, `| --- | --- | --- | --- | --- |\n| VE-7 | test | test/x.test.ts | ${covers} | - |\n\n#### Trace Links`), "utf8");
    return root;
  }

  async function warnings(root: string) {
    return validateWorkspace(await parseWorkspace(await resolveProjectRoot(root))).diagnostics.filter((entry) => entry.code === "SRS-W077");
  }

  // @req FR-NODE-248 AC-2
  it("FR-NODE-248 AC-2: warns under SRS-W077 naming the requirement and the evidence ID", async () => {
    for (const covers of ["AC-1..AC-2", "AC-1–AC-2"]) {
      const found = await warnings(await withEvidenceRow(covers));
      expect(found, covers).toHaveLength(1);
      expect(found[0]?.severity).toBe("warning");
      expect(found[0]?.message).toContain("FR-ARCH-001");
      expect(found[0]?.message).toContain("VE-7");
    }
  });

  // @req FR-NODE-248 AC-2
  it("FR-NODE-248 AC-2: a cell listing criteria one by one or all raises no warning", async () => {
    for (const covers of ["AC-1, AC-2", "all"]) {
      expect(await warnings(await withEvidenceRow(covers)), covers).toEqual([]);
    }
  });
});
