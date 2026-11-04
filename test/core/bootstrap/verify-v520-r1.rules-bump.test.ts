import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanSpecRulesPointers } from "../../../src/core/bootstrap/rules-references.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { renderAgentInstructionSnippet } from "../../../src/core/bootstrap/templates.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const OLD = "SRS-MD-Rules-v2.5.0.md";
const NEW = "SRS-MD-Rules-v2.6.0.md";
const OLD_ROW = `| Rules | [SRS-MD Authoring Rules v2.5.0](../rule/${OLD}) |`;
const NEW_ROW = `| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/${NEW}) |`;
const SCOPE = "10.product-architecture.srs.md";

async function projectOn(version: string, opts: { rulesFile?: boolean; scopeRow?: string | null; crlf?: boolean } = {}): Promise<string> {
  const file = `SRS-MD-Rules-v${version}.md`;
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  if (opts.rulesFile !== false) await writeFile(path.join(root, "docs", "rule", file), `# SRS-MD Authoring Rules v${version}\n`, "utf8");
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  let index = (await readFile(indexPath, "utf8")).replace(/SRS-MD Authoring Rules v\d+\.\d+\.\d+/g, `SRS-MD Authoring Rules v${version}`).replace(/SRS-MD-Rules-v\d+\.\d+\.\d+\.md/g, file);
  const scopePath = path.join(root, "docs", "spec", SCOPE);
  let scope = await readFile(scopePath, "utf8");
  const row = opts.scopeRow === undefined ? `| Rules | [SRS-MD Authoring Rules v${version}](../rule/${file}) |` : opts.scopeRow;
  if (row !== null) scope = scope.replace("| Scope Name | Product Architecture |", `| Scope Name | Product Architecture |\n${row}`);
  const block = renderAgentInstructionSnippet().replace(/SRS-MD-Rules-v\d+\.\d+\.\d+\.md/g, file);
  let claude = `# Consumer notes\n\n${block}\n`;
  if (opts.crlf) {
    const crlf = (t: string) => t.replace(/\r?\n/g, "\r\n");
    index = crlf(index);
    scope = crlf(scope);
    claude = crlf(claude);
  }
  await writeFile(indexPath, index, "utf8");
  await writeFile(scopePath, scope, "utf8");
  await writeFile(path.join(root, "CLAUDE.md"), claude, "utf8");
  return root;
}

async function upgrade(root: string) {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
  if (!result.ok) throw new Error(result.error?.message ?? "upgrade failed");
  return result.value!;
}

async function staleRulesDiagnostics(root: string): Promise<string[]> {
  return validateWorkspace(await parseWorkspace({ root }))
    .diagnostics.filter((d) => d.code === "SRS-W073" || /Rules-v\d/.test(d.message))
    .map((d) => `${d.code} ${d.filePath}:${d.line} ${d.message}`);
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if ([".git", ".speckiwi", ".kiwi", "kiwi"].includes(e.name) || e.name.endsWith(".lock") || e.name.includes("lock")) continue;
      if (e.isDirectory()) await walk(full);
      else out[path.relative(root, full)] = await readFile(full, "utf8");
    }
  }
  await walk(root);
  return out;
}

describe("verify FR-PARSE-044 AC-6 rules 2.6.0 bump", () => {
  it("following doctor's remediation for a 2.5.0 project leaves no stale rules reference", async () => {
    const root = await projectOn("2.5.0");
    const report = await diagnoseHealth(await parseWorkspace({ root }));
    const check = report.checks.find((c) => c.label === "Rules version drift");
    expect(check?.state).toBe("warn");
    // Do exactly what the remediation says.
    if (/speckiwi init`/.test(check!.remediation) && !/upgrade/.test(check!.remediation)) {
      const r = await initProject(await resolveProjectRoot(root), {});
      expect(r.ok).toBe(true);
    } else {
      await upgrade(root);
    }
    expect(await staleRulesDiagnostics(root)).toEqual([]);
  });

  it("a nested SRS document's Rules row keeps a resolvable link after upgrade", async () => {
    const root = await projectOn("2.5.0");
    const nestedDir = path.join(root, "docs", "spec", "archive");
    await mkdir(nestedDir, { recursive: true });
    const nested = ["# Archive", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", `| Rules | [SRS-MD Authoring Rules v2.5.0](../../rule/${OLD}) |`, ""].join("\n");
    // A `.srs.md` file below docs/spec is one the parser reads as an SRS scope document (discover.ts:
    // every *.srs.md outside steps/<task>/), which is what makes its Rules row a tool-owned pointer.
    await writeFile(path.join(nestedDir, "old.srs.md"), nested, "utf8");
    const parsed = await parseWorkspace(await resolveProjectRoot(root));
    expect(parsed.files.map((file) => file.relativePath)).toContain("docs/spec/archive/old.srs.md");
    expect(scanSpecRulesPointers(parsed.files).filter((pointer) => pointer.filePath === "docs/spec/archive/old.srs.md").map((pointer) => pointer.kind)).toEqual(["metadata-row"]);
    await upgrade(root);
    const after = await readFile(path.join(nestedDir, "old.srs.md"), "utf8");
    const link = /\]\(([^)]*Rules-v[^)]*)\)/.exec(after)?.[1];
    expect(link).toBeDefined();
    expect(existsSync(path.resolve(nestedDir, link!)), `link ${link} resolves`).toBe(true);
  });
});
