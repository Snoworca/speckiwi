import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPrdCitations, findPrdReferences } from "../../src/core/prd/citations.js";

// FR-NODE-275: the CLI starts and runs on Node.js 22, the lowest release engines.node (>=22) admits.
// 5.3.4 crashed at module load there on a RegExp modifier group, which V8 ships from Node.js 23.

const REPO_ROOT = process.cwd();
// A RegExp modifier group: `(?i:`, `(?-i:`, `(?ims-x:` … but not `(?:`, `(?=`, `(?!`, `(?<`.
const MODIFIER_GROUP = /\(\?[imsx]*(?:-[imsx]+)?:/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("FR-NODE-275 Node.js 22 runtime", () => {
  it("@req FR-NODE-275 AC-3: no source file under src/ uses a RegExp modifier group", () => {
    const offenders = sourceFiles(join(REPO_ROOT, "src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => ([...line.matchAll(MODIFIER_GROUP)].some((m) => m[0] !== "(?:") ? [`${file}:${index + 1}`] : []))
    );
    expect(offenders).toEqual([]);
  });

  // The scanner finds candidates in any case; isPrdFilePath (src/core/prd/paths.ts) then takes the
  // directory in any case and the `.prd.md` suffix as written. The hotfix keeps that result.
  it("@req FR-NODE-275 AC-2: PRD path candidates are found in any case, with the same result as before", () => {
    for (const path of ["docs/prd/a.prd.md", "DOCS/PRD/a.prd.md", "Docs/Prd/a.prd.md"]) {
      const text = `see ${path}#PRD-3 for the basis`;
      expect(findPrdCitations(text, "docs/spec"), path).toEqual([{ itemId: "PRD-3", path }]);
      expect(findPrdReferences(text, "docs/spec").length, path).toBe(1);
    }
    for (const path of ["docs/prd/a.PRD.MD", "docs/prd/a.Prd.Md", "docs/prd/a.prd.mdx"]) {
      expect(findPrdReferences(`see ${path}#PRD-3 for the basis`, "docs/spec"), path).toEqual([]);
    }
  });

  // Runs only where a Node.js 22 binary is named, so the default suite on a newer Node stays hermetic.
  const node22 = process.env.SPECKIWI_NODE22;
  it.runIf(node22 !== undefined && existsSync(node22 ?? ""))(
    "@req FR-NODE-275 AC-1, AC-3: the built CLI runs on Node.js 22 without a startup error",
    () => {
      const run = (...args: string[]) =>
        execFileSync(node22 as string, [join(REPO_ROOT, "bin/speckiwi"), ...args], { cwd: REPO_ROOT, encoding: "utf8" });
      expect(execFileSync(node22 as string, ["--version"], { encoding: "utf8" })).toMatch(/^v22\./);
      expect(run("--version").trim()).toBe(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version);
      expect(JSON.parse(run("validate", "--json")).diagnosticsSummary.errors).toBe(0);
      expect(JSON.parse(run("prd", "coverage", "docs/prd/2026-11-05.review-loop-convergence.prd.md", "--target", "5.3.3", "--json")).target).toBe("5.3.3");
    },
    120_000
  );
});
