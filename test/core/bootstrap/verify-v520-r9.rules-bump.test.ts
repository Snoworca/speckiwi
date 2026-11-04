import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { findRulesPointers, pointerNeedsRefresh, refreshRulesPointers } from "../../../src/core/bootstrap/rules-references.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { findMarkdownLinksInDocument, referenceKey } from "../../../src/core/parser/markdown-links.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

const OLD = "SRS-MD-Rules-v2.5.0.md";
const SCOPE = "docs/spec/01.alpha.srs.md";

function scopeDoc(rulesRow: string, ...tail: string[]): string {
  return ["# Alpha SRS", "", "| Field | Value |", "| --- | --- |", "| Document Type | scope-srs |", rulesRow, "", "## 1. Scope", "", ...tail].join("\n");
}

/** The destination every reference link of a document resolves to, keyed by line, or "UNDEFINED". */
function referenceTargets(text: string): Array<{ line: number; key: string; target: string }> {
  const lines = text.split(/\r?\n/);
  const links = findMarkdownLinksInDocument(lines);
  const definitions = new Map<string, string>();
  links.flat().forEach((link) => {
    if (link.kind === "definition" && !definitions.has(referenceKey(link.label.value))) {
      definitions.set(referenceKey(link.label.value), link.destination.value);
    }
  });
  const out: Array<{ line: number; key: string; target: string }> = [];
  links.forEach((lineLinks, index) => {
    for (const link of lineLinks) {
      if (link.kind !== "reference") continue;
      const key = referenceKey((link.label ?? link.text).value);
      out.push({ line: index + 1, key, target: definitions.get(key) ?? "UNDEFINED" });
    }
  });
  return out;
}

describe("verify FR-PARSE-044 AC-6 reference-style pointer, round 9", () => {
  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row is author text, not a tool-owned pointer;
  // upgrade and the refresh leave it and its definition, and validate sends the stale definition to a
  // hand edit.
  it("a shortcut-reference Rules row is left as it is by the refresh, so its definition still serves it", () => {
    const text = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.5.0] |", `[SRS-MD Authoring Rules v2.5.0]: ../rule/${OLD}`, "");
    const next = refreshRulesPointers(text, SCOPE).next;
    expect(next).toBe(text);
    expect(findRulesPointers(next, "srs")).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row is author text, not a tool-owned pointer;
  // upgrade and the refresh leave it and its definition, and validate sends the stale definition to a
  // hand edit.
  it("a collapsed-reference Rules row is left as it is by the refresh", () => {
    const text = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.5.0][] |", `[SRS-MD Authoring Rules v2.5.0]: ../rule/${OLD}`, "");
    const next = refreshRulesPointers(text, SCOPE).next;
    expect(next).toBe(text);
    expect(findRulesPointers(next, "srs")).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row is author text, not a tool-owned pointer;
  // upgrade and the refresh leave it and its definition, and validate sends the stale definition to a
  // hand edit.
  it("a full-reference Rules row whose label is the rules file name is left as it is by the refresh", () => {
    const text = scopeDoc(`| Rules | [SRS-MD Authoring Rules v2.5.0][${OLD}] |`, `[${OLD}]: ../rule/${OLD}`, "");
    const next = refreshRulesPointers(text, SCOPE).next;
    expect(next).toBe(text);
    expect(findRulesPointers(next, "srs")).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  it("after one upgrade a shortcut-reference Rules row no longer needs a refresh (upgrade converges in one run)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-r9-rules-"));
    await mkdir(path.join(root, ".git"), { recursive: true });
    expect((await initProject(await resolveProjectRoot(root), {})).ok).toBe(true);
    const file = path.join(root, ...SCOPE.split("/"));
    await writeFile(file, scopeDoc("| Rules | [SRS-MD Authoring Rules v2.5.0] |", `[SRS-MD Authoring Rules v2.5.0]: ../rule/${OLD}`, ""), "utf8");
    const upgraded = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
    expect(upgraded.ok).toBe(true);
    const after = await readFile(file, "utf8");
    const stale = findRulesPointers(after, "srs").filter((pointer) => pointerNeedsRefresh(pointer, SCOPE));
    expect(stale.map((pointer) => pointer.text)).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  it("refreshing a Rules row does not repoint an author line that shares its link definition", () => {
    const text = scopeDoc(
      "| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |",
      "Requirements before 2026-11 were written against [the old rules][rules].",
      "",
      `[rules]: ../rule/${OLD}`,
      ""
    );
    const authorLine = 10;
    const before = referenceTargets(text).find((entry) => entry.line === authorLine);
    const after = referenceTargets(refreshRulesPointers(text, SCOPE).next).find((entry) => entry.line === authorLine);
    expect(before?.target).toBe(`../rule/${OLD}`);
    expect(after?.target).toBe(`../rule/${OLD}`);
  });
});
