import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-036 — the validation half: SRS-W001 for a requirement with no Rationale section, and the
// promise that turning the dormant codes on adds nothing to a package that already conforms.
//
// The link-check half of the requirement lives in test/core/query/links-diagnostic-codes.fr-parse-036.

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function diagnosticsFor(rootPath: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return validateWorkspace(workspace).diagnostics;
}

/** Removes the Rationale heading and its paragraph, leaving every other section intact. */
async function dropRationaleSection(rootPath: string): Promise<void> {
  const file = path.join(rootPath, ARCH_DOC);
  const text = await readFile(file, "utf8");
  const without = text.replace("#### Rationale\n\nThe parser needs a small valid workspace.\n\n", "");
  if (without === text) throw new Error("fixture changed: the Rationale section was not removed");
  await writeFile(file, without, "utf8");
}

describe("FR-PARSE-036 AC-1 — a requirement with no Rationale section is reported", () => {
  it("reports SRS-W001 at the requirement heading line and names the requirement", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await dropRationaleSection(rootPath);

    const found = (await diagnosticsFor(rootPath)).filter((entry) => entry.code === "SRS-W001");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("FR-ARCH-001");
    expect(found[0]?.filePath).toBe("docs/spec/10.product-architecture.srs.md");
    // The heading line, not the missing section's line — the section is what is absent.
    expect(found[0]?.line).toBe(29);
  });

  it("reports nothing for a requirement that has a Rationale section", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");

    const found = (await diagnosticsFor(rootPath)).filter((entry) => entry.code === "SRS-W001");

    expect(found).toHaveLength(0);
  });

  it("does not turn the missing section into an error, so an existing project still validates", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await dropRationaleSection(rootPath);

    const diagnostics = await diagnosticsFor(rootPath);

    expect(diagnostics.filter((entry) => entry.severity === "error")).toHaveLength(0);
  });
});

describe("FR-PARSE-036 AC-4 — a conforming package sees no new finding", () => {
  it("produces none of the three codes over this repository's own specification", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd()));
    const diagnostics = validateWorkspace(workspace).diagnostics;
    const links = await checkLinks(workspace);

    const codes = new Set(diagnostics.map((entry) => entry.code));
    expect(codes.has("SRS-W001")).toBe(false);
    expect(links.broken.filter((entry) => entry.code === "SRS-W003")).toHaveLength(0);
    expect(links.broken.filter((entry) => entry.code === "SRS-W004")).toHaveLength(0);
  });
});
