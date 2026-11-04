import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";

// FR-PARSE-044 AC-6 — "A Rules row or a Reference Documents entry written as a reference-style link is
// author text: upgrade leaves that line and its link definition byte for byte, doctor does not report
// it, and validate tells the author to fix it by hand through SRS-W073."

const OLD = "SRS-MD-Rules-v2.5.0.md";
const NEW_ENTRY = "- [SRS-MD Authoring Rules v2.6.0](../rule/SRS-MD-Rules-v2.6.0.md)";
const SCOPE = "docs/spec/10.product-architecture.srs.md";
const INDEX = "docs/spec/00.index.md";
const ROW = "| Rules | [SRS rules][rules] |";
const DEFINITION = `[rules]: ../rule/${OLD}`;

async function freshProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-reference-author-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  expect((await initProject(await resolveProjectRoot(root), { installSkills: false, registerMcp: false })).ok).toBe(true);
  return root;
}

/**
 * The fixture scope document with a reference-style Rules row; the definition sits in the middle, or at
 * the end — after the last requirement block's Change Notes, a section validate reads as history and
 * does not scan for stale values, so only the row itself can carry the warning there.
 */
async function scopeDocument(where: "middle" | "end"): Promise<string> {
  const fixture = (await readFile(path.join("test", "fixtures", "workspaces", "valid-basic", "docs", "spec", "10.product-architecture.srs.md"), "utf8")).replace(/\r\n/g, "\n");
  const withRow = fixture.replace("| Scope Name | Product Architecture |", `| Scope Name | Product Architecture |\n${ROW}`);
  expect(withRow).not.toBe(fixture);
  return where === "middle"
    ? withRow.replace("## 1. Scope Overview", `${DEFINITION}\n\n## 1. Scope Overview`)
    : `${withRow.trimEnd()}\n\n${DEFINITION}\n`;
}

async function upgrade(root: string): Promise<void> {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
  expect(result.ok).toBe(true);
}

async function rulesWarnings(root: string): Promise<string[]> {
  const report = await diagnoseHealth(await parseWorkspace({ root }));
  return report.checks.filter((check) => /rules/i.test(check.label) && check.state !== "ok").map((check) => `${check.label}: ${check.message}`);
}

async function staleRulesW073(root: string, filePath: string): Promise<Array<{ line: number; message: string }>> {
  return validateWorkspace(await parseWorkspace({ root }))
    .diagnostics.filter((entry) => entry.code === "SRS-W073" && entry.filePath === filePath && entry.message.includes("BUNDLED_SRS_RULES_FILENAME"))
    .map((entry) => ({ line: entry.line as number, message: entry.message }));
}

describe("FR-PARSE-044 AC-6 — a reference-style Rules row is author text", () => {
  for (const where of ["middle", "end"] as const) {
    // @req FR-PARSE-044 AC-6
    it(`definition in the ${where}: upgrade leaves the document byte for byte, doctor reports nothing, validate reports the reference-style row by hand`, async () => {
      const root = await freshProject();
      const file = path.join(root, ...SCOPE.split("/"));
      const planted = await scopeDocument(where);
      await writeFile(file, planted, "utf8");

      await upgrade(root);

      expect(await readFile(file, "utf8")).toBe(planted);
      expect(await rulesWarnings(root)).toEqual([]);
      const rowLine = planted.split("\n").indexOf(ROW) + 1;
      const atRow = (await staleRulesW073(root, SCOPE)).filter((warning) => warning.line === rowLine);
      expect(atRow).toHaveLength(1);
      expect(atRow[0]!.message).toMatch(/by hand/);
    });

    // @req FR-PARSE-044 AC-6
    it(`definition in the ${where}, beside a stale inline entry in the same index: the entry is repointed, the reference-style row and its definition stay byte for byte`, async () => {
      const root = await freshProject();
      const file = path.join(root, ...INDEX.split("/"));
      const lines = (await readFile(file, "utf8")).split("\n");
      const rowAt = lines.findIndex((line) => line.startsWith("| Rules |"));
      const entryAt = lines.indexOf(NEW_ENTRY);
      expect(rowAt).toBeGreaterThan(-1);
      expect(entryAt).toBeGreaterThan(-1);
      lines[rowAt] = ROW;
      lines[entryAt] = `- [SRS-MD Authoring Rules v2.5.0](../rule/${OLD})`;
      if (where === "middle") lines.splice(rowAt + 2, 0, DEFINITION, "");
      const body = where === "middle" ? lines.join("\n") : `${lines.join("\n").trimEnd()}\n\n${DEFINITION}\n`;
      await writeFile(file, body, "utf8");

      await upgrade(root);

      const after = await readFile(file, "utf8");
      expect(after).toBe(body.replace(`- [SRS-MD Authoring Rules v2.5.0](../rule/${OLD})`, NEW_ENTRY));
      expect(await rulesWarnings(root)).toEqual([]);
      const rowLine = after.split("\n").indexOf(ROW) + 1;
      const atRow = (await staleRulesW073(root, INDEX)).filter((warning) => warning.line === rowLine);
      expect(atRow).toHaveLength(1);
      expect(atRow[0]!.message).toMatch(/by hand/);
    });
  }
});
