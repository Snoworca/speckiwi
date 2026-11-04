import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { BUNDLED_RULES_VERSION } from "../../../src/core/bootstrap/templates.js";
import { scanSpecRulesPointers } from "../../../src/core/bootstrap/rules-references.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

const OLD = "2.5.0";
const NEW = BUNDLED_RULES_VERSION;

async function freshProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-r3-rules-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  const init = await initProject(await resolveProjectRoot(root), {});
  expect(init.ok).toBe(true);
  return root;
}

function scopeDoc(body: string[]): string {
  return [
    "# Alpha SRS",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Document Type | scope-srs |",
    `| Rules | [SRS-MD Authoring Rules v${NEW}](../rule/SRS-MD-Rules-v${NEW}.md) |`,
    "",
    "## 1. Scope",
    "",
    ...body,
    ""
  ].join("\n");
}

async function rulesDrift(root: string) {
  const report = await diagnoseHealth(await parseWorkspace({ root }));
  const check = report.checks.find((c) => c.label === "Rules version drift");
  expect(check).toBeDefined();
  return check!;
}

async function upgrade(root: string) {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
  expect(result.ok).toBe(true);
  return result.value!;
}

describe("verify FR-PARSE-044 AC-6 rules pointer scan, round 3", () => {
  // @req FR-PARSE-044 AC-6
  it("a fenced example of the old reference entry is not a tool-owned pointer: doctor stays ok", async () => {
    const root = await freshProject();
    await writeFile(
      path.join(root, "docs/spec/01.alpha.srs.md"),
      scopeDoc([
        "The index used to list its rules like this:",
        "",
        "```md",
        `- [SRS-MD Authoring Rules v${OLD}](../rule/SRS-MD-Rules-v${OLD}.md)`,
        "```"
      ]),
      "utf8"
    );
    const pointers = scanSpecRulesPointers((await parseWorkspace(await resolveProjectRoot(root))).files).filter((p) => p.filePath === "docs/spec/01.alpha.srs.md");
    expect(pointers.map((p) => p.kind)).toEqual(["metadata-row"]);
    expect((await rulesDrift(root)).state).toBe("ok");
  });

  // @req FR-PARSE-044 AC-6
  it("upgrade leaves a fenced example of the old reference entry byte-identical", async () => {
    const root = await freshProject();
    const rel = "docs/spec/01.alpha.srs.md";
    const text = scopeDoc(["```md", `- [SRS-MD Authoring Rules v${OLD}](../rule/SRS-MD-Rules-v${OLD}.md)`, "```"]);
    await writeFile(path.join(root, rel), text, "utf8");
    await upgrade(root);
    expect(await readFile(path.join(root, rel), "utf8")).toBe(text);
  });

  // @req FR-PARSE-044 AC-6
  it("a history note under docs/spec citing the old rules entry is not a tool-owned pointer", async () => {
    const root = await freshProject();
    await mkdir(path.join(root, "docs/spec/archive"), { recursive: true });
    const rel = "docs/spec/archive/2026-10.migration-notes.md";
    const text = [
      "# Migration notes",
      "",
      "Before the 2.6.0 bump the project followed:",
      "",
      `- [SRS-MD Authoring Rules v${OLD}](../../rule/SRS-MD-Rules-v${OLD}.md)`,
      ""
    ].join("\n");
    await writeFile(path.join(root, rel), text, "utf8");
    expect((await rulesDrift(root)).state).toBe("ok");
    await upgrade(root);
    expect(await readFile(path.join(root, rel), "utf8")).toBe(text);
  });

  // @req FR-PARSE-044 AC-6
  it("following doctor's remediation for a scope Rules row without a version ends at doctor ok", async () => {
    const root = await freshProject();
    await writeFile(
      path.join(root, "docs/spec/01.alpha.srs.md"),
      [
        "# Alpha SRS",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Document Type | scope-srs |",
        "| Rules | see the team rules page |",
        "",
        "## 1. Scope",
        ""
      ].join("\n"),
      "utf8"
    );
    const before = await rulesDrift(root);
    expect(before.state).toBe("warn");
    expect(before.remediation).toContain("speckiwi upgrade");
    await upgrade(root);
    const after = await rulesDrift(root);
    expect({ state: after.state, message: after.message }).toEqual({ state: "ok", message: expect.any(String) });
  });
});
