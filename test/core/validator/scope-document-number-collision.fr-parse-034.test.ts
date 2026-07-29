import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_DEFINITIONS } from "../../../src/core/diagnostic-registry.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-034 — validation reports scope SRS documents that share a leading ordering number.
//
// Users reported document sets in which every scope document carried the number 10. Nothing in the
// validator noticed, so the collapse persisted silently. This suite pins the detection: a colliding
// pair is reported, a distinct set is not, and the severity stays a warning so an already-collided
// project can still validate while it is repaired.

const CODE = "SRS-W070";
const SPEC_DIR = ["docs", "spec"] as const;

function specPath(rootPath: string, fileName: string): string {
  return path.join(rootPath, ...SPEC_DIR, fileName);
}

async function diagnosticsFor(rootPath: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return validateWorkspace(workspace).diagnostics;
}

/**
 * A scope document that holds no requirement, so adding one to a fixture changes the document set
 * without introducing duplicate requirement ids that would confuse the assertions below.
 */
function emptyScopeDocument(name: string, prefix: string): string {
  return [
    `# ${name}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    `| Scope | ${prefix} |`,
    `| Scope Name | ${name} |`,
    "",
    "## 1. Scope Overview",
    "",
    "Describe the scope.",
    "",
    "## 4. Requirements",
    ""
  ].join("\n");
}

/**
 * Adds a second scope document that claims the number the fixture's existing document already uses,
 * reproducing the reported state in which two documents share one leading number.
 */
async function addCollidingDocument(rootPath: string): Promise<void> {
  await writeFile(specPath(rootPath, "10.reporting.srs.md"), emptyScopeDocument("Reporting", "RPT"), "utf8");
}

describe("FR-PARSE-034 AC-1 — a shared leading number is reported", () => {
  it("reports the collision and names the shared number and both documents", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addCollidingDocument(rootPath);

    const collision = (await diagnosticsFor(rootPath)).find((diagnostic) => diagnostic.code === CODE);

    expect(collision).toBeDefined();
    expect(collision?.message).toContain("10");
    expect(collision?.message).toContain("10.product-architecture.srs.md");
    expect(collision?.message).toContain("10.reporting.srs.md");
  });

  it("reports one diagnostic per colliding number rather than one per document", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addCollidingDocument(rootPath);
    // A third document on the same number: still one number in collision, so still one diagnostic.
    await copyFile(specPath(rootPath, "10.reporting.srs.md"), specPath(rootPath, "10.billing.srs.md"));

    const collisions = (await diagnosticsFor(rootPath)).filter((diagnostic) => diagnostic.code === CODE);

    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.message).toContain("10.billing.srs.md");
  });
});

describe("FR-PARSE-034 AC-2 — the severity is warning, not error", () => {
  it("keeps the collided project validating, so a repair is not blocked by its own diagnostic", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addCollidingDocument(rootPath);

    const diagnostics = await diagnosticsFor(rootPath);
    const collision = diagnostics.find((diagnostic) => diagnostic.code === CODE);

    expect(collision?.severity).toBe("warning");
    // The collision itself contributes no error, so `validate` without failOnWarning still passes.
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0);
  });
});

describe("FR-PARSE-034 AC-3 — a distinct set produces no diagnostic", () => {
  it("reports nothing when every scope document carries its own number", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");

    const collisions = (await diagnosticsFor(rootPath)).filter((diagnostic) => diagnostic.code === CODE);

    expect(collisions).toHaveLength(0);
  });

  it("does not treat a leading zero as a different number from its unpadded form", async () => {
    // `01.` and `1.` are the same ordering position written two ways. Reading them as distinct
    // would let a genuine collision pass unreported.
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "01.alpha.srs.md"), emptyScopeDocument("Alpha", "ALPHA"), "utf8");
    await writeFile(specPath(rootPath, "1.beta.srs.md"), emptyScopeDocument("Beta", "BETA"), "utf8");

    const collisions = (await diagnosticsFor(rootPath)).filter((diagnostic) => diagnostic.code === CODE);

    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.message).toContain("01.alpha.srs.md");
    expect(collisions[0]?.message).toContain("1.beta.srs.md");
  });
});

describe("FR-PARSE-034 AC-4 — the diagnostic is registered", () => {
  it("defines the code in the diagnostic registry with warning severity", () => {
    const entry = DIAGNOSTIC_DEFINITIONS.find((candidate) => candidate.code === CODE);

    expect(entry).toBeDefined();
    expect(entry?.severity).toBe("warning");
    expect(entry?.sourceRule).toBe("FR-PARSE-034");
    expect(entry?.remediation.length).toBeGreaterThan(0);
  });
});
