import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

const OLD = "SRS-MD-Rules-v2.5.0.md";

async function freshProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-r8-rules-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  const init = await initProject(await resolveProjectRoot(root), {});
  expect(init.ok).toBe(true);
  return root;
}

function scopeDoc(rulesRow: string): string {
  return ["# Alpha SRS", "", "| Field | Value |", "| --- | --- |", "| Document Type | scope-srs |", rulesRow, "", "## 1. Scope", ""].join("\n");
}

async function staleRulesWarnings(root: string): Promise<string[]> {
  const result = validateWorkspace(await parseWorkspace({ root }));
  return result.diagnostics.filter((d) => d.code === "SRS-W073").map((d) => `${d.filePath}:${d.line} ${d.message}`);
}

describe("verify FR-PARSE-044 AC-6 reference-style pointer, round 8", () => {
  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row is author text, not a tool-owned pointer;
  // upgrade and the refresh leave it and its definition, and validate sends the stale definition to a
  // hand edit.
  it("after upgrading a scope document whose stale Rules row is a reference-style link, the document is unchanged and validate sends the stale definition to a hand edit", async () => {
    const root = await freshProject();
    const doc = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |") + `\n[rules]: ../rule/${OLD}\n`;
    await writeFile(path.join(root, "docs", "spec", "01.alpha.srs.md"), doc, "utf8");
    const upgraded = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
    expect(upgraded.ok).toBe(true);
    expect(await readFile(path.join(root, "docs", "spec", "01.alpha.srs.md"), "utf8")).toBe(doc);
    const warnings = await staleRulesWarnings(root);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((warning) => /by hand/.test(warning))).toBe(true);
  });
});
