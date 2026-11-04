import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findRulesPointers, refreshRulesPointers } from "../../../src/core/bootstrap/rules-references.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const OLD = "SRS-MD-Rules-v2.5.0.md";
const SCOPE = "docs/spec/01.alpha.srs.md";
const INDEX = "docs/spec/00.index.md";

function scopeDoc(rulesRows: string[], ...tail: string[]): string {
  return ["# Alpha SRS", "", "| Field | Value |", "| --- | --- |", "| Document Type | scope-srs |", ...rulesRows, "", "## 1. Scope", "", ...tail].join("\n");
}

async function staleW073(root: string): Promise<string[]> {
  return validateWorkspace(await parseWorkspace({ root }))
    .diagnostics.filter((d) => d.code === "SRS-W073" && d.message.includes("BUNDLED_SRS_RULES_FILENAME"))
    .map((d) => `${d.filePath}:${d.line} ${d.message}`);
}

async function upgrade(root: string, apply: boolean) {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply, installSkills: false, registerMcp: false });
  if (!result.ok || !result.value) throw new Error(result.error?.message ?? "upgrade failed");
  return result.value;
}

async function project(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, ".git"), { recursive: true });
  return root;
}
describe("verify FR-PARSE-044 AC-6 rules pointers, round 10", () => {
  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row or index entry is author text, not a
  // tool-owned pointer; upgrade leaves it and its definitions, doctor does not warn, and validate sends
  // a stale definition to a hand edit.
  it("an index Reference Documents rules entry written as a reference-style link is not a tool-owned pointer", () => {
    const text = [
      "# Index",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/SRS-MD-Rules-v2.6.0.md) |",
      "",
      "## 10. Reference Documents",
      "",
      "- [SRS-MD Authoring Rules v2.5.0][rules]",
      "",
      `[rules]: ../rule/${OLD}`,
      ""
    ].join("\n");
    const pointers = findRulesPointers(text, "index");
    expect(pointers.map((p) => [p.line, p.kind])).toEqual([[5, "metadata-row"]]);
  });

  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row or index entry is author text, not a
  // tool-owned pointer; upgrade leaves it and its definitions, doctor does not warn, and validate sends
  // a stale definition to a hand edit.
  it("two reference-style Rules rows sharing one definition: upgrade leaves them, and W073 sends the definition to a hand edit", async () => {
    const root = await project();
    const planted = scopeDoc(
        ["| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |", "| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |"],
        "Body.",
        "",
        `[rules]: ../rule/${OLD}`,
        ""
      );
    await writeFile(path.join(root, ...SCOPE.split("/")), planted, "utf8");
    await upgrade(root, true);
    expect(await readFile(path.join(root, ...SCOPE.split("/")), "utf8")).toBe(planted);
    const warnings = await staleW073(root);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((warning) => /by hand/.test(warning))).toBe(true);
  });

  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row or index entry is author text, not a
  // tool-owned pointer; upgrade leaves it and its definitions, doctor does not warn, and validate sends
  // a stale definition to a hand edit.
  it("one reference-style Rules row that uses its definition twice: the refresh leaves the document as it is", () => {
    const text = scopeDoc(["| Rules | [SRS-MD Authoring Rules v2.5.0][rules] ([file][rules]) |"], "Body.", "", `[rules]: ../rule/${OLD}`, "");
    expect(refreshRulesPointers(text, SCOPE).next).toBe(text);
  });

  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row or index entry is author text, not a
  // tool-owned pointer; upgrade leaves it and its definitions, doctor does not warn, and validate sends
  // a stale definition to a hand edit.
  it("a reference-style Rules row whose definition's title sits on the next line: the refresh leaves the definition whole", () => {
    const text = scopeDoc(["| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |"], "Body.", "", `[rules]: ../rule/${OLD}`, '  "SRS rules"', "");
    expect(refreshRulesPointers(text, SCOPE).next).toBe(text);
  });

  // @req FR-PARSE-044 AC-6
  // Lead decision (round 10, R5 rejected): the second definition of a label is void in CommonMark from
  // the start, so no pointer uses it and it is author text. Upgrade leaves it alone, and SRS-W073 tells the
  // author to fix that line by hand.
  // Lead decision (round 11): the reference-style row and its first definition are author text too, so
  // both definitions stay.
  it("a duplicate definition of the Rules row's label: upgrade leaves the void second definition and W073 sends it to a hand edit", async () => {
    const text = scopeDoc(["| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |"], "Body.", "", `[rules]: ../rule/${OLD}`, `[rules]: ../rule/${OLD}`, "");
    const refreshed = refreshRulesPointers(text, SCOPE).next;
    expect(refreshed).toBe(text);

    const root = await project();
    await writeFile(path.join(root, ...SCOPE.split("/")), text, "utf8");
    await upgrade(root, true);
    const after = (await readFile(path.join(root, ...SCOPE.split("/")), "utf8")).split("\n");
    const duplicateLine = after.indexOf(`[rules]: ../rule/${OLD}`) + 1;
    expect(duplicateLine).toBeGreaterThan(0);
    const warnings = (await staleW073(root)).filter((entry) => entry.startsWith(`${SCOPE}:${duplicateLine} `));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/by hand/);
  });

  // @req FR-PARSE-044 AC-6
  it("an index without a Rules row and with a stale rules entry: the plan reports the entry at the line the apply reports", async () => {
    const root = await project();
    const indexPath = path.join(root, ...INDEX.split("/"));
    const idx = (await readFile(indexPath, "utf8")).split("\n").filter((l) => !l.startsWith("| Rules |")).join("\n");
    await writeFile(indexPath, `${idx.trimEnd()}\n\n## 10. Reference Documents\n\n- [SRS-MD Authoring Rules v2.5.0](../rule/${OLD})\n`, "utf8");
    const plan = await upgrade(root, false);
    const applied = await upgrade(root, true);
    expect(plan.references.map((r) => r.location)).toEqual(applied.references.map((r) => r.location));
  });
});
