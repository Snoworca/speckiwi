import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { loadStepDesign } from "../../../src/core/validator/validate-scoped.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-033 AC-5 — loadStepDesign unsafe step name guard. RED suite: the
// traversal and "." cases read a design.md outside/at the steps root today
// (present=true) until the loader rejects non-single-segment step names.
//
// Contract under test (docs/spec/20.parser-validation.srs.md FR-PARSE-033):
//   - AC-5: WHEN loadStepDesign receives an unsafe step name (empty, containing a
//           path separator, or `.`/`..`) THE loader SHALL return present=false
//           without resolving any path outside docs/spec/steps.

async function seededRoot() {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  // A design.md OUTSIDE docs/spec/steps that "../evil" would traverse into.
  await mkdir(path.join(rootPath, "docs", "spec", "evil"), { recursive: true });
  await writeFile(path.join(rootPath, "docs", "spec", "evil", "design.md"), "# outside\n", "utf8");
  // A design.md directly at the steps root that "." would resolve onto.
  await mkdir(path.join(rootPath, "docs", "spec", "steps"), { recursive: true });
  await writeFile(path.join(rootPath, "docs", "spec", "steps", "design.md"), "# steps-root\n", "utf8");
  // A legitimate step design.md for the regression case.
  await mkdir(path.join(rootPath, "docs", "spec", "steps", "good"), { recursive: true });
  await writeFile(path.join(rootPath, "docs", "spec", "steps", "good", "design.md"), "# good\n", "utf8");
  return resolveProjectRoot(rootPath);
}

describe("FR-PARSE-033 AC-5 — loadStepDesign rejects unsafe step names", () => {
  it("returns present=false for a traversal step name instead of reading outside steps", async () => {
    const root = await seededRoot();
    const design = await loadStepDesign(root, "../evil");
    expect(design).toEqual({ present: false, lines: [] });
  });

  it("returns present=false for '.' instead of reading the steps root", async () => {
    const root = await seededRoot();
    const design = await loadStepDesign(root, ".");
    expect(design).toEqual({ present: false, lines: [] });
  });

  it("returns present=false for separators, '..' and empty names", async () => {
    const root = await seededRoot();
    for (const name of ["a/b", "a\\b", "..", "", "   "]) {
      expect(await loadStepDesign(root, name)).toEqual({ present: false, lines: [] });
    }
  });

  it("still loads a legitimate single-segment step design.md", async () => {
    const root = await seededRoot();
    const design = await loadStepDesign(root, "good");
    expect(design.present).toBe(true);
    expect(design.lines[0]).toBe("# good");
  });
});
