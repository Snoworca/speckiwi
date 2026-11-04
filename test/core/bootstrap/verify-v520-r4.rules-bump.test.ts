import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { BUNDLED_RULES_VERSION } from "../../../src/core/bootstrap/templates.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

const OLD = "2.5.0";
const NEW = BUNDLED_RULES_VERSION;
const NEW_ROW = `| Rules | [SRS-MD Authoring Rules v${NEW}](../rule/SRS-MD-Rules-v${NEW}.md) |`;

async function freshProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-r4-rules-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  const init = await initProject(await resolveProjectRoot(root), {});
  expect(init.ok).toBe(true);
  return root;
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

function scopeDoc(rulesRow: string, prefix: string[] = []): string {
  return [
    "# Alpha SRS",
    "",
    ...prefix,
    "| Field | Value |",
    "| --- | --- |",
    "| Document Type | scope-srs |",
    rulesRow,
    "",
    "## 1. Scope",
    ""
  ].join("\n");
}

describe("verify FR-PARSE-044 AC-6 rules pointer scan, round 4", () => {
  // @req FR-PARSE-044 AC-6
  it("upgrade rewrites a scope Rules row only when doctor warned about it (stale label, current link)", async () => {
    const root = await freshProject();
    const rel = "docs/spec/01.alpha.srs.md";
    const text = scopeDoc(`| Rules | [SRS-MD Authoring Rules v${OLD}](../rule/SRS-MD-Rules-v${NEW}.md) |`);
    await writeFile(path.join(root, rel), text, "utf8");
    const doctorWarned = (await rulesDrift(root)).state === "warn";
    await upgrade(root);
    const upgradeChanged = (await readFile(path.join(root, rel), "utf8")) !== text;
    expect({ doctorWarned, upgradeChanged }).toEqual({ doctorWarned: true, upgradeChanged: true });
  });

  // @req FR-PARSE-044 AC-6
  it("a fenced `| Field | Value |` example above the metadata table does not hide the stale Rules row", async () => {
    const root = await freshProject();
    const rel = "docs/spec/01.alpha.srs.md";
    const text = scopeDoc(`| Rules | [SRS-MD Authoring Rules v${OLD}](../rule/SRS-MD-Rules-v${OLD}.md) |`, [
      "Every requirement block carries a table like:",
      "",
      "```md",
      "| Field | Value |",
      "|---|---|",
      "| Status | planned |",
      "```",
      ""
    ]);
    await writeFile(path.join(root, rel), text, "utf8");
    expect((await rulesDrift(root)).state).toBe("warn");
    await upgrade(root);
    expect((await readFile(path.join(root, rel), "utf8")).split("\n")).toContain(NEW_ROW);
  });

  // @req FR-PARSE-044 AC-6
  it("a fenced Reference Documents heading earlier in the index does not hide the real section's stale entry", async () => {
    const root = await freshProject();
    const indexPath = path.join(root, "docs/spec/00.index.md");
    const index = await readFile(indexPath, "utf8");
    const newEntry = `- [SRS-MD Authoring Rules v${NEW}](../rule/SRS-MD-Rules-v${NEW}.md)`;
    const oldEntry = `- [SRS-MD Authoring Rules v${OLD}](../rule/SRS-MD-Rules-v${OLD}.md)`;
    expect(index).toContain(newEntry);
    const planted = index
      .replace(newEntry, oldEntry)
      .replace("## 1. Purpose", ["## 1. Purpose", "", "A section looks like:", "", "```md", "## 10. Reference Documents", "```", ""].join("\n"));
    await writeFile(indexPath, planted, "utf8");
    expect((await rulesDrift(root)).state).toBe("warn");
    await upgrade(root);
    expect((await readFile(indexPath, "utf8")).split("\n")).toContain(newEntry);
  });

  // @req FR-PARSE-044 AC-6
  it("upgrade leaves a step SDS's own SDS-rules Rules row under docs/spec byte-identical", async () => {
    const root = await freshProject();
    const rel = "docs/spec/steps/alpha/design.md";
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    const text = [
      "# Alpha step design",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Document Type | sds |",
      "| Task | alpha |",
      "| Status | draft |",
      `| Rules | [SDS-MD Authoring Rules v${NEW}](../../../rule/SDS-MD-Rules-v${NEW}.md) |`,
      "",
      "## 1. Context & Scope",
      ""
    ].join("\n");
    await writeFile(path.join(root, rel), text, "utf8");
    await upgrade(root);
    expect(await readFile(path.join(root, rel), "utf8")).toBe(text);
  });
});
