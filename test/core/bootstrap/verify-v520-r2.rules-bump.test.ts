import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { BUNDLED_RULES_VERSION } from "../../../src/core/bootstrap/templates.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

const NEW = BUNDLED_RULES_VERSION;

async function walk(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function go(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if ([".git", ".speckiwi", ".kiwi", "kiwi", ".claude", ".codex", ".agents"].includes(e.name) || e.name.endsWith(".lock")) continue;
      if (e.isDirectory()) await go(full);
      else if (e.name.endsWith(".md")) out[path.relative(root, full).replace(/\\/g, "/")] = await readFile(full, "utf8");
    }
  }
  await go(root);
  return out;
}

/** A project exactly as the current init writes it, then rewritten to an older rules version. */
async function projectOn(version: string, opts: { crlf?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-r2-rules-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  const init = await initProject(await resolveProjectRoot(root), {});
  expect(init.ok).toBe(true);
  // A scope document carrying a Rules row, as this repository's own scope documents do.
  const files = await walk(root);
  for (const [rel, text] of Object.entries(files)) {
    let next = text
      .replace(new RegExp(`SRS-MD-Rules-v${NEW.replace(/\./g, "\\.")}\\.md`, "g"), `SRS-MD-Rules-v${version}.md`)
      .replace(new RegExp(`SRS-MD Authoring Rules v${NEW.replace(/\./g, "\\.")}`, "g"), `SRS-MD Authoring Rules v${version}`);
    if (opts.crlf) next = next.replace(/\r?\n/g, "\r\n");
    await writeFile(path.join(root, rel), next, "utf8");
  }
  await rename(path.join(root, "docs", "rule", `SRS-MD-Rules-v${NEW}.md`), path.join(root, "docs", "rule", `SRS-MD-Rules-v${version}.md`));
  return root;
}

async function addScopeWithRulesRow(root: string, version: string, crlf = false): Promise<string> {
  const rel = "docs/spec/01.alpha.srs.md";
  const doc = [
    "# Alpha SRS",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Document Type | scope-srs |",
    `| Rules | [SRS-MD Authoring Rules v${version}](../rule/SRS-MD-Rules-v${version}.md) |`,
    "",
    "## 1. Scope",
    "",
    "Alpha.",
    ""
  ].join(crlf ? "\r\n" : "\n");
  await writeFile(path.join(root, rel), doc, "utf8");
  return rel;
}

async function upgrade(root: string, apply = true) {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply, installSkills: false, registerMcp: false });
  expect(result.ok).toBe(true);
  return result.value!;
}

async function doctorRules(root: string) {
  const report = await diagnoseHealth(await parseWorkspace({ root }));
  return report.checks.filter((c) => /Rules|rules/.test(c.label));
}

/** Every markdown link in the project that names a rules document and does not resolve. */
async function danglingRulesLinks(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const [rel, text] of Object.entries(await walk(root))) {
    for (const m of text.matchAll(/\]\(([^)]*(?:SRS|SDS)-MD-Rules-v[^)]*)\)/g)) {
      if (!existsSync(path.resolve(path.dirname(path.join(root, rel)), m[1]!))) out.push(`${rel} -> ${m[1]}`);
    }
  }
  return out;
}

describe("verify FR-PARSE-044 AC-6 rules 2.6.0 bump, round 2", () => {
  // A plain init is what doctor's SDS-rules and bundled-reference remediations name. It prunes the 2.5.0
  // file (FR-NODE-085) and raises only the index Rules row (AC-5), so the index's Reference Documents
  // entry and every scope Rules row now point at a deleted file. Doctor must not call that healthy.
  it("after a plain init of a 2.5.0 project, doctor's rules checks do not all say ok while rules links dangle", async () => {
    const root = await projectOn("2.5.0");
    await addScopeWithRulesRow(root, "2.5.0");
    expect((await initProject(await resolveProjectRoot(root), {})).ok).toBe(true);
    const dangling = await danglingRulesLinks(root);
    expect(dangling.length).toBeGreaterThan(0);
    const rulesChecks = (await doctorRules(root)).map((c) => `${c.label}: ${c.state}`);
    expect(rulesChecks.every((c) => c.endsWith(": ok")), `${rulesChecks.join("; ")} with dangling ${dangling.join(", ")}`).toBe(false);
  });

  it("upgrade's stated boundary names every docs/spec file it writes", async () => {
    const root = await projectOn("2.5.0");
    const scope = await addScopeWithRulesRow(root, "2.5.0");
    const before = await walk(root);
    const out = await upgrade(root, true);
    const after = await walk(root);
    const changedSpec = Object.keys(after).filter((rel) => rel.startsWith("docs/spec/") && before[rel] !== undefined && before[rel] !== after[rel]);
    expect(changedSpec).toContain(scope);
    const boundary = out.boundaries.find((b) => b.includes("docs/spec/")) ?? "";
    // The boundary says what upgrade writes under docs/spec/; a scope document's Rules row must be in it.
    expect(boundary).toMatch(/scope|every SRS document|each SRS document/i);
  });

});
