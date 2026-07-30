import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";

// FR-NODE-097 — `speckiwi init` allocates its default scope document through the same rule as
// `scaffold-scope`, so it cannot land on a number a non-scope document already holds.
//
// Found by the pre-promotion audit of FR-NODE-097: init hardcoded the number 1 and was the one caller
// that never went through the allocator. A project holding its own `docs/spec/01.glossary.md` got
// `01.product-architecture.srs.md` from init, and the tool's own validator immediately reported
// SRS-W072 — the exact outcome the requirement exists to prevent.

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-collision-"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  return root;
}

async function init(rootPath: string): Promise<void> {
  const result = await initProject(await resolveProjectRoot(rootPath, rootPath), {
    installSkills: false,
    registerMcp: false
  });
  expect(result.ok, "init must succeed").toBe(true);
}

async function specNames(rootPath: string): Promise<string[]> {
  return (await readdir(path.join(rootPath, "docs", "spec"))).sort();
}

async function scopeDocuments(rootPath: string): Promise<string[]> {
  return (await specNames(rootPath)).filter((name) => name.endsWith(".srs.md"));
}

async function diagnosticCodes(rootPath: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath, rootPath));
  return validateWorkspace(workspace).diagnostics.map((entry) => entry.code);
}

describe("FR-NODE-097 — init does not claim a number a non-scope document holds", () => {
  it("allocates 02 when the project already carries its own 01 document", async () => {
    const rootPath = await emptyRepo();
    await writeFile(path.join(rootPath, "docs", "spec", "01.glossary.md"), "# Glossary\n", "utf8");

    await init(rootPath);

    expect(await scopeDocuments(rootPath)).toEqual(["02.product-architecture.srs.md"]);
  });

  it("leaves the project with no collision diagnostic", async () => {
    const rootPath = await emptyRepo();
    await writeFile(path.join(rootPath, "docs", "spec", "01.glossary.md"), "# Glossary\n", "utf8");

    await init(rootPath);

    const codes = await diagnosticCodes(rootPath);
    expect(codes.filter((code) => code === "SRS-W072")).toHaveLength(0);
    expect(codes.filter((code) => code === "SRS-W070")).toHaveLength(0);
  });

  it("advances past a run of occupied numbers to the lowest free one", async () => {
    const rootPath = await emptyRepo();
    for (const name of ["01.glossary.md", "02.notes.md", "04.other.md"]) {
      await writeFile(path.join(rootPath, "docs", "spec", name), `# ${name}\n`, "utf8");
    }

    await init(rootPath);

    expect(await scopeDocuments(rootPath)).toEqual(["03.product-architecture.srs.md"]);
  });

  it("still allocates 01 for a project that carries no numbered document of its own", async () => {
    const rootPath = await emptyRepo();

    await init(rootPath);

    // The tool writes 00.index.md and 90.appendix.md during this same init, and neither may push the
    // first scope document off 01 — that is the outcome the numbering decision exists to prevent.
    expect(await scopeDocuments(rootPath)).toEqual(["01.product-architecture.srs.md"]);
  });

  it("leaves no call site naming a scope document with a fixed number of its own", async () => {
    // The audit found init through exactly this shape: `scopeDocumentName(scope.slug, 1)`. A literal
    // second argument means that caller bypasses allocation, which is how a collision gets created.
    const sources = ["src/core/bootstrap/init-project.ts", "src/core/bootstrap/templates.ts", "src/core/mutation/scaffold-scope.ts"];
    for (const source of sources) {
      const text = await readFile(source, "utf8");
      const literalNumberArgument = /scopeDocumentName\([^)]*,\s*\d/.exec(text);
      expect(literalNumberArgument?.[0], `${source} must allocate rather than hardcode a number`).toBeUndefined();
    }
  });

  it("registers the allocated document in the index under the number it actually received", async () => {
    const rootPath = await emptyRepo();
    await writeFile(path.join(rootPath, "docs", "spec", "01.glossary.md"), "# Glossary\n", "utf8");

    await init(rootPath);

    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath, rootPath));
    const documents = workspace.index.scopes.map((entry) => entry.document);
    expect(documents.some((document) => document?.includes("02.product-architecture.srs.md"))).toBe(true);
    expect(documents.some((document) => document?.includes("01.product-architecture.srs.md"))).toBe(false);
  });
});
