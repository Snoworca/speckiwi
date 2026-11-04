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

const OLD = "SRS-MD-Rules-v2.5.0.md";
const NEW = "SRS-MD-Rules-v2.6.0.md";

async function freshProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-r5-rules-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  const init = await initProject(await resolveProjectRoot(root), {});
  expect(init.ok).toBe(true);
  return root;
}

async function staleRules(root: string) {
  return validateWorkspace(await parseWorkspace({ root }))
    .diagnostics.filter((d) => d.code === "SRS-W073" && d.message.includes("BUNDLED_SRS_RULES_FILENAME"))
    .map((d) => ({ filePath: d.filePath as string, line: d.line as number, message: d.message }));
}

async function upgrade(root: string, apply = true) {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply, installSkills: false, registerMcp: false });
  expect(result.ok).toBe(true);
  return result.value!;
}

async function rulesDrift(root: string) {
  const report = await diagnoseHealth(await parseWorkspace({ root }));
  return report.checks.find((c) => c.label === "Rules version drift")!;
}

function scopeDoc(rulesRow: string, body: string[] = []): string {
  return ["# Alpha SRS", "", "| Field | Value |", "| --- | --- |", "| Document Type | scope-srs |", rulesRow, "", "## 1. Scope", "", ...body, ""].join("\n");
}

/** Follows the W073 guidance literally: `speckiwi upgrade` for an owned line, a hand edit otherwise. */
async function followGuidance(root: string): Promise<void> {
  const warnings = await staleRules(root);
  if (warnings.some((w) => /run `speckiwi upgrade`/.test(w.message))) await upgrade(root);
  for (const w of warnings.filter((entry) => /by hand/.test(entry.message))) {
    const file = path.join(root, ...w.filePath.split("/"));
    const lines = (await readFile(file, "utf8")).split("\n");
    lines[w.line - 1] = lines[w.line - 1]!.split(OLD).join(NEW);
    await writeFile(file, lines.join("\n"), "utf8");
  }
}

describe("verify FR-PARSE-044 AC-6 / FR-PARSE-039 SRS-W073 guidance, round 5", () => {
  // @req FR-PARSE-044 AC-6
  it("a Rules row that already links the bundled file but still names the old file: following W073's guidance clears it", async () => {
    const root = await freshProject();
    const rel = "docs/spec/01.alpha.srs.md";
    await writeFile(
      path.join(root, rel),
      scopeDoc(`| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/${NEW}) (was ${OLD}) |`),
      "utf8"
    );
    const before = await staleRules(root);
    expect(before.map((w) => w.filePath)).toContain(rel);
    await followGuidance(root);
    expect(await staleRules(root)).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  it("doctor and validate agree on a tool-owned Rules row that still names the old file", async () => {
    const root = await freshProject();
    await writeFile(path.join(root, "docs/spec/01.alpha.srs.md"), scopeDoc(`| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/${NEW}) (was ${OLD}) |`), "utf8");
    const validateSaysUpgrade = (await staleRules(root)).some((w) => /run `speckiwi upgrade`/.test(w.message));
    const doctorWarns = (await rulesDrift(root)).state === "warn";
    expect({ validateSaysUpgrade, doctorWarns }).toEqual({ validateSaysUpgrade, doctorWarns: validateSaysUpgrade });
  });
});
