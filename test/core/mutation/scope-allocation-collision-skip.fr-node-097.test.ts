import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scaffoldScope } from "../../../src/core/mutation/scaffold-scope.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-097 — allocation and the collision diagnostics have to agree. Before this, a project whose
// highest scope document was 04 beside the legacy 05.completed-work.md received 05 for its next scope
// document: the tool's own scaffold produced a document its own validation warns about.
//
// Skipping only on collision is deliberate. Treating a sidecar as the highest number would push a
// project whose only scope document is 01 to 92, which is the outcome the recorded numbering decision
// exists to prevent — AC-3 pins that.

const SPEC = ["docs", "spec"] as const;

function specPath(rootPath: string, fileName: string): string {
  return path.join(rootPath, ...SPEC, fileName);
}

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

async function allocate(rootPath: string, name: string, prefix: string, apply = false) {
  return scaffoldScope(await resolveProjectRoot(rootPath), { name, prefix, ...(apply ? { apply: true } : {}) });
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

/**
 * Replaces the fixture's single `10.` scope document with documents numbered `01`..`04`, so the next
 * candidate is `05` — the number the legacy completed-work sidecar occupies.
 */
async function renumberFixtureToFour(rootPath: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(specPath(rootPath, "10.product-architecture.srs.md"));
  for (const [index, name] of ["Alpha", "Beta", "Gamma", "Delta"].entries()) {
    const number = String(index + 1).padStart(2, "0");
    await writeFile(specPath(rootPath, `${number}.${name.toLowerCase()}.srs.md`), emptyScopeDocument(name, name.slice(0, 3).toUpperCase()), "utf8");
  }
}

describe("FR-NODE-097 AC-1 — a candidate the legacy sidecar occupies is skipped", () => {
  it("allocates 06 when 04 is the highest scope document and 05.completed-work.md exists", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await renumberFixtureToFour(rootPath);
    await writeFile(specPath(rootPath, "05.completed-work.md"), "# Completed Work\n", "utf8");

    const result = await allocate(rootPath, "Reporting", "RPT");

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.document).toBe("06.reporting.srs.md");
  });

  it("creates the file at the skipped number when applied", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await renumberFixtureToFour(rootPath);
    await writeFile(specPath(rootPath, "05.completed-work.md"), "# Completed Work\n", "utf8");

    const result = await allocate(rootPath, "Reporting", "RPT", true);

    expect(result.ok).toBe(true);
    expect(await exists(specPath(rootPath, "06.reporting.srs.md"))).toBe(true);
    expect(await exists(specPath(rootPath, "05.reporting.srs.md"))).toBe(false);
  });
});

describe("FR-NODE-097 AC-2/AC-3 — a free candidate is unchanged and a sidecar does not raise it", () => {
  it("keeps the candidate when no document holds it", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await renumberFixtureToFour(rootPath);

    const result = await allocate(rootPath, "Reporting", "RPT");

    expect(result.ok && result.value.document).toBe("05.reporting.srs.md");
  });

  it("allocates 02 for a project whose only scope document is 01, despite the high-band sidecars", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const { rm } = await import("node:fs/promises");
    await rm(specPath(rootPath, "10.product-architecture.srs.md"));
    await writeFile(specPath(rootPath, "01.alpha.srs.md"), emptyScopeDocument("Alpha", "ALP"), "utf8");
    await writeFile(specPath(rootPath, "91.completed-work-log.md"), "# Completed Work Log\n", "utf8");

    const result = await allocate(rootPath, "Reporting", "RPT");

    // 90.appendix.md ships with the fixture and 91 was just added; neither may raise the candidate.
    expect(result.ok && result.value.document).toBe("02.reporting.srs.md");
  });
});

describe("FR-NODE-097 AC-4 — allocation advances to the lowest free number", () => {
  it("skips a run of occupied numbers rather than jumping past the highest of them", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await renumberFixtureToFour(rootPath);
    await writeFile(specPath(rootPath, "05.completed-work.md"), "# Completed Work\n", "utf8");
    await writeFile(specPath(rootPath, "06.glossary.md"), "# Glossary\n", "utf8");
    await writeFile(specPath(rootPath, "08.notes.md"), "# Notes\n", "utf8");

    const result = await allocate(rootPath, "Reporting", "RPT");

    // 05 and 06 are taken, 07 is free: the answer is 07, not 09.
    expect(result.ok && result.value.document).toBe("07.reporting.srs.md");
  });
});

describe("FR-NODE-097 AC-5 — the scaffold and the collision diagnostics agree", () => {
  it("produces a document that yields neither SRS-W070 nor SRS-W072", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await renumberFixtureToFour(rootPath);
    await writeFile(specPath(rootPath, "05.completed-work.md"), "# Completed Work\n", "utf8");

    const result = await allocate(rootPath, "Reporting", "RPT", true);
    expect(result.ok).toBe(true);

    const diagnostics = validateWorkspace(await parseWorkspace(await resolveProjectRoot(rootPath))).diagnostics;

    expect(diagnostics.filter((entry) => entry.code === "SRS-W070")).toHaveLength(0);
    expect(diagnostics.filter((entry) => entry.code === "SRS-W072")).toHaveLength(0);
  });
});
