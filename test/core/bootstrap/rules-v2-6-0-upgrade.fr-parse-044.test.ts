import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { renderAgentInstructionSnippet } from "../../../src/core/bootstrap/templates.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import type { DoctorCheck } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-044 AC-6 — the rules that carry the expired-criterion grammar ship as SRS-MD rules 2.6.0.
//
// The version is raised instead of editing 2.5.0 in place because doctor compares versions, not
// content: a project that installed 2.5.0 is told to upgrade only when the bundled version differs.
// Every literal below is written out rather than derived from the bundled constants, so the suite
// fails when the bump is reverted instead of following the constant back to 2.5.0.

const OLD_RULES = "SRS-MD-Rules-v2.5.0.md";
const NEW_RULES = "SRS-MD-Rules-v2.6.0.md";
const OLD_ROW = `| Rules | [SRS-MD Authoring Rules v2.5.0](../rule/${OLD_RULES}) |`;
const NEW_INDEX_ROW = `| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/${NEW_RULES}) |`;
const OLD_LIST_ENTRY = `- [SRS-MD Authoring Rules v2.5.0](../rule/${OLD_RULES})`;
const NEW_LIST_ENTRY = `- [SRS-MD Authoring Rules v2.6.0](../rule/${NEW_RULES})`;
const SCOPE_DOCUMENT = "10.product-architecture.srs.md";

/** A project exactly as speckiwi 5.1.0 left it: the 2.5.0 rules document, index row and agent block. */
async function projectOn250(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(path.join(root, "docs", "rule", OLD_RULES), "# SRS-MD Authoring Rules v2.5.0\n", "utf8");
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  // The fixture is current; take its index Rules row back to the 2.5.0 one 5.1.0 wrote.
  const current = await readFile(indexPath, "utf8");
  const index = current.replace(NEW_INDEX_ROW, OLD_ROW);
  expect(index, "the fixture's index Rules row must be replaceable").not.toBe(current);
  // The index's reference list entry the init template writes beside the metadata row.
  await writeFile(indexPath, `${index.trimEnd()}\n\n## 10. Reference Documents\n\n${OLD_LIST_ENTRY}\n`, "utf8");
  // A scope document carrying its own metadata Rules row, as this repository's scope documents do.
  const scopePath = path.join(root, "docs", "spec", SCOPE_DOCUMENT);
  const scope = await readFile(scopePath, "utf8");
  await writeFile(scopePath, scope.replace("| Scope Name | Product Architecture |", `| Scope Name | Product Architecture |\n${OLD_ROW}`), "utf8");
  const block = renderAgentInstructionSnippet().replace(/SRS-MD-Rules-v\d+\.\d+\.\d+\.md/g, OLD_RULES);
  expect(block, "the old block must cite the 2.5.0 rules file").toContain(`docs/rule/${OLD_RULES}`);
  await writeFile(path.join(root, "CLAUDE.md"), `# Consumer notes\n\n${block}\n`, "utf8");
  return root;
}

async function rulesCheck(root: string): Promise<DoctorCheck | undefined> {
  const report = await diagnoseHealth(await parseWorkspace({ root }));
  return report.checks.find((entry) => entry.label === "Rules version drift");
}

async function upgrade(root: string): Promise<void> {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
  if (!result.ok) throw new Error(result.error?.message ?? "upgrade failed");
}

describe("FR-PARSE-044 AC-6 — the bundled SRS rules ship as 2.6.0 and upgrade moves a 2.5.0 project onto them", () => {
  // @req FR-PARSE-044 AC-6
  it("doctor reports an installed 2.5.0 as differing from the bundled 2.6.0 before the upgrade", async () => {
    const root = await projectOn250();

    const check = await rulesCheck(root);

    expect(check?.state).toBe("warn");
    expect(check?.message).toBe("installed rules v2.5.0 differs from bundled rules v2.6.0");
  });

  // @req FR-PARSE-044 AC-6
  it("upgrade installs the 2.6.0 document, prunes 2.5.0, and points the index row and the agent block at 2.6.0", async () => {
    const root = await projectOn250();

    await upgrade(root);

    const ruleDir = path.join(root, "docs", "rule");
    expect(await readdir(ruleDir)).not.toContain(OLD_RULES);
    const installed = await readFile(path.join(ruleDir, NEW_RULES), "utf8");
    expect(installed.split(/\r?\n/)[0]).toBe("# SRS-MD Authoring Rules v2.6.0");
    // The shipped document is the one that carries the expiry grammar, not a placeholder.
    expect(installed).toContain("[EXPIRED");

    const index = await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8");
    expect(index.split(/\r?\n/).filter((line) => line.startsWith("| Rules |"))).toEqual([NEW_INDEX_ROW]);

    const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
    expect(claude).toContain(`docs/rule/${NEW_RULES}`);
    expect(claude).not.toContain(OLD_RULES);
    expect((await stat(path.join(ruleDir, NEW_RULES))).isFile()).toBe(true);
  });

  // @req FR-PARSE-044 AC-6
  it("upgrade points every SRS document's Rules row and the index reference entry at 2.6.0, leaving validate with no stale rules reference", async () => {
    const root = await projectOn250();

    await upgrade(root);

    const scope = await readFile(path.join(root, "docs", "spec", SCOPE_DOCUMENT), "utf8");
    expect(scope.split(/\r?\n/).filter((line) => line.startsWith("| Rules |"))).toEqual([NEW_INDEX_ROW]);
    const index = await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8");
    expect(index.split(/\r?\n/)).toContain(NEW_LIST_ENTRY);
    expect(index).not.toContain(OLD_RULES);

    const stale = validateWorkspace(await parseWorkspace({ root })).diagnostics.filter((entry) => entry.code === "SRS-W073");
    expect(stale.map((entry) => `${entry.filePath}:${entry.line} ${entry.message}`)).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  it("upgrade rewrites only the Rules row of a scope document and leaves a body citation of the old file to its author", async () => {
    const root = await projectOn250();
    const scopePath = path.join(root, "docs", "spec", SCOPE_DOCUMENT);
    const prose = `Fixture architecture scope, first written against ${OLD_RULES}.`;
    const before = (await readFile(scopePath, "utf8")).replace("Fixture architecture scope.", prose);
    await writeFile(scopePath, before, "utf8");

    const result = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });

    // Exactly one line differs: the Rules row. The citation is a record the author amends.
    const after = await readFile(scopePath, "utf8");
    expect(after).toBe(before.replace(OLD_ROW, NEW_INDEX_ROW));
    const findings = result.value!.references.filter((finding) => finding.filePath === `docs/spec/${SCOPE_DOCUMENT}`);
    const rowLine = before.split(/\r?\n/).indexOf(OLD_ROW) + 1;
    expect(findings).toEqual([
      {
        filePath: `docs/spec/${SCOPE_DOCUMENT}`,
        line: rowLine,
        location: `docs/spec/${SCOPE_DOCUMENT}:${rowLine}`,
        from: OLD_ROW,
        to: NEW_INDEX_ROW,
        action: "repair"
      }
    ]);
  });

  // Lead decision (round 11): a reference-style Rules row is author text. Upgrade leaves it and its
  // definition byte for byte, doctor does not warn, and validate sends the stale definition to a hand
  // edit. (Earlier rounds rendered the row inline and removed a definition only it used.)
  for (const [variant, body] of [
    ["at the end of the document", (scope: string) => `${scope.trimEnd()}\n\n[rules]: ../rule/${OLD_RULES}\n`],
    ["between two blank lines", (scope: string) => scope.replace("## 1. Scope Overview", `[rules]: ../rule/${OLD_RULES}\n\n## 1. Scope Overview`)],
    [
      "shared with an author line",
      (scope: string) =>
        `${scope.replace("Fixture architecture scope.", "Fixture architecture scope, first written against [the old rules][  RULES ].").trimEnd()}\n\n[rules]: ../rule/${OLD_RULES}\n`
    ]
  ] as const) {
    // @req FR-PARSE-044 AC-6
    it(`leaves a stale reference-style Rules row and its definition ${variant} as they are, and validate sends the definition to a hand edit`, async () => {
      const root = await projectOn250();
      const scopePath = path.join(root, "docs", "spec", SCOPE_DOCUMENT);
      const before = body((await readFile(scopePath, "utf8")).replace(OLD_ROW, "| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |"));
      await writeFile(scopePath, before, "utf8");

      await upgrade(root);

      expect(await readFile(scopePath, "utf8")).toBe(before);
      expect((await rulesCheck(root))?.state).toBe("ok");
      const definitionLine = before.split(/\r?\n/).indexOf(`[rules]: ../rule/${OLD_RULES}`) + 1;
      const guidance = validateWorkspace(await parseWorkspace({ root }))
        .diagnostics.filter((entry) => entry.code === "SRS-W073" && entry.filePath === `docs/spec/${SCOPE_DOCUMENT}` && entry.line === definitionLine)
        .map((entry) => entry.message);
      // A definition after the requirement blocks sits in a section validate treats as history and does
      // not report; where validate does report it, it sends it to a hand edit.
      if (variant === "between two blank lines") expect(guidance).toHaveLength(1);
      expect(guidance.every((message) => /by hand/.test(message))).toBe(true);
    });
  }

  // @req FR-PARSE-044 AC-6
  it("reads a current Rules row whose link escapes or percent-encodes the bundled file name as current", async () => {
    for (const destination of [`../rule/SRS\\-MD\\-Rules\\-v2.6.0.md`, "../rule/SRS-MD-Rules-v2%2E6%2E0.md"]) {
      const root = await projectOn250();
      await upgrade(root);
      const scopePath = path.join(root, "docs", "spec", SCOPE_DOCUMENT);
      const row = `| Rules | [SRS-MD Authoring Rules v2.6.0](${destination}) |`;
      const before = (await readFile(scopePath, "utf8")).replace(NEW_INDEX_ROW, row);
      expect(before, destination).toContain(row);
      await writeFile(scopePath, before, "utf8");

      expect((await rulesCheck(root))?.state, destination).toBe("ok");
      await upgrade(root);
      expect(await readFile(scopePath, "utf8"), destination).toBe(before);
    }
  });

  // @req FR-PARSE-044 AC-6
  it("one upgrade of a project with no index repoints its scope documents too", async () => {
    const root = await projectOn250();
    const { rm } = await import("node:fs/promises");
    await rm(path.join(root, "docs", "spec", "00.index.md"));

    await upgrade(root);

    const scope = await readFile(path.join(root, "docs", "spec", SCOPE_DOCUMENT), "utf8");
    expect(scope.split(/\r?\n/)).toContain(NEW_INDEX_ROW);
    expect((await rulesCheck(root))?.state).toBe("ok");
  });

  // @req FR-PARSE-044 AC-6
  it("doctor reports the upgraded project as matching the bundled 2.6.0", async () => {
    const root = await projectOn250();
    await upgrade(root);

    const check = await rulesCheck(root);

    expect(check?.state).toBe("ok");
    expect(check?.message).toBe(`installed rules v2.6.0 matches bundled rules v2.6.0 (docs/rule/${NEW_RULES})`);
  });
});

/** Every markdown file under docs/spec, at any depth. */
async function specDocuments(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".md")) found.push(full);
    }
  }
  await walk(path.join(root, "docs", "spec"));
  return found;
}

describe("FR-PARSE-044 AC-6 — the pointers upgrade writes resolve, and doctor sends a 2.5.0 project there", () => {
  // @req FR-PARSE-044 AC-6
  it("every SRS-rules link under docs/spec, at every depth, names 2.6.0 and resolves to the installed file after upgrade", async () => {
    const root = await projectOn250();
    // A metadata Rules row one and two directories below docs/spec, each written with the
    // link that resolved from its own directory before the upgrade.
    for (const [relative, up] of [["archive/old.srs.md", "../../"], ["archive/2025/older.srs.md", "../../../"]] as const) {
      const target = path.join(root, "docs", "spec", ...relative.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      const body = [
        "# Archived",
        "",
        "| Field | Value |",
        "|---|---|",
        "| Document Type | note |",
        `| Rules | [SRS-MD Authoring Rules v2.5.0](${up}rule/${OLD_RULES}) |`,
        ""
      ].join("\n");
      await writeFile(target, body, "utf8");
    }

    await upgrade(root);

    const links: string[] = [];
    for (const document of await specDocuments(root)) {
      const text = await readFile(document, "utf8");
      for (const match of text.matchAll(/\]\(([^)]*SRS-MD-Rules-v[^)]*)\)/g)) {
        const link = match[1]!;
        const at = path.relative(root, document).replace(/\\/g, "/");
        links.push(at);
        expect(link, `${at} names the bundled rules`).toMatch(/SRS-MD-Rules-v2\.6\.0\.md$/);
        expect((await stat(path.resolve(path.dirname(document), link)).catch(() => undefined))?.isFile(), `${at}: ${link} resolves`).toBe(true);
      }
    }
    // Index row and entry, the scope row, and the row of each nested document.
    expect(links.length).toBe(5);
  });

  // @req FR-PARSE-044 AC-6 @req FR-NODE-085 AC-7
  it("doctor's remediation for a 2.5.0 project names the command that repoints every SRS document", async () => {
    const root = await projectOn250();

    const check = await rulesCheck(root);

    // A plain init may only touch the index's own Rules row (FR-NODE-085 AC-4/AC-5), so it cannot be
    // the remedy: the scope documents' Rules rows would stay on 2.5.0.
    expect(check?.remediation).toMatch(/`speckiwi upgrade`/);
    expect(check?.remediation).not.toMatch(/speckiwi init|--force/);
  });

  // @req FR-NODE-085 AC-4 @req FR-NODE-085 AC-5
  it("a plain init on a 2.5.0 project changes the index's Rules row alone and no scope document", async () => {
    const root = await projectOn250();
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const scopePath = path.join(root, "docs", "spec", SCOPE_DOCUMENT);
    const [indexBefore, scopeBefore] = [await readFile(indexPath, "utf8"), await readFile(scopePath, "utf8")];

    const result = await initProject(await resolveProjectRoot(root), { installSkills: false, registerMcp: false });
    expect(result.ok).toBe(true);

    expect(await readFile(indexPath, "utf8")).toBe(indexBefore.replace(OLD_ROW, NEW_INDEX_ROW));
    expect(await readFile(scopePath, "utf8")).toBe(scopeBefore);
  });
});

describe("FR-PARSE-044 AC-6 — doctor compares every SRS document's rules pointer, and upgrade states what it writes", () => {
  // @req FR-PARSE-044 AC-6
  it("after a plain init of a 2.5.0 project, the rules-drift check warns on the pointers init left behind and names upgrade", async () => {
    const root = await projectOn250();
    expect((await initProject(await resolveProjectRoot(root), { installSkills: false, registerMcp: false })).ok).toBe(true);

    const check = await rulesCheck(root);

    // The index row is current now (FR-NODE-085 AC-5); the scope row and the reference entry are not.
    expect(check?.state).toBe("warn");
    expect(check?.message).toContain(`docs/spec/${SCOPE_DOCUMENT}:`);
    expect(check?.message).toContain("docs/spec/00.index.md:");
    expect(check?.message).toContain("v2.5.0");
    expect(check?.remediation).toMatch(/`speckiwi upgrade`/);
  });

  // @req FR-PARSE-044 AC-6
  it("warns on a pointer that names the bundled version but does not resolve from its document", async () => {
    const root = await projectOn250();
    await upgrade(root);
    const nested = path.join(root, "docs", "spec", "archive", "old.srs.md");
    await mkdir(path.dirname(nested), { recursive: true });
    // `../rule/` from docs/spec/archive points at docs/spec/rule, which does not exist.
    await writeFile(nested, ["# Archived", "", "| Field | Value |", "|---|---|", NEW_INDEX_ROW, ""].join("\n"), "utf8");

    const check = await rulesCheck(root);

    expect(check?.state).toBe("warn");
    expect(check?.message).toContain("docs/spec/archive/old.srs.md:5");
  });

  // @req FR-PARSE-044 AC-6
  it("names, in its stated boundaries, every kind of docs/spec line the apply actually changed", async () => {
    const root = await projectOn250();
    const specDir = path.join(root, "docs", "spec");
    const before = new Map<string, string>();
    for (const document of await specDocuments(root)) before.set(document, await readFile(document, "utf8"));

    const result = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });

    const kinds = new Set<string>();
    for (const [document, text] of before) {
      const old = text.split(/\r?\n/);
      const now = (await readFile(document, "utf8")).split(/\r?\n/);
      expect(now.length, `${document} keeps its line count`).toBe(old.length);
      now.forEach((line, index) => {
        if (line === old[index]) return;
        const isIndex = path.relative(specDir, document) === "00.index.md";
        kinds.add(line.startsWith("| Rules |") ? (isIndex ? "index Rules row" : "SRS document Rules row") : line.startsWith("- [") ? "Reference Documents entry" : `other: ${line}`);
      });
    }
    expect([...kinds].sort()).toEqual(["Reference Documents entry", "SRS document Rules row", "index Rules row"]);
    const stated = result.value!.boundaries.join(" ");
    expect(stated).toMatch(/Rules row of every SRS document/);
    expect(stated).toMatch(/Reference Documents entry/);
  });
});

describe("FR-PARSE-044 AC-6 — doctor and upgrade agree on which lines are tool-owned rules pointers", () => {
  /** A project already on 2.6.0, so each case starts from doctor ok and plants one state. */
  async function currentProject(): Promise<string> {
    const root = await projectOn250();
    await upgrade(root);
    expect((await rulesCheck(root))?.state).toBe("ok");
    return root;
  }

  async function replaceLine(file: string, from: string, to: string): Promise<void> {
    const text = await readFile(file, "utf8");
    expect(text, `${file} holds the line to replace`).toContain(from);
    await writeFile(file, text.replace(from, to), "utf8");
  }

  async function writeNested(root: string, relative: string, lines: readonly string[]): Promise<string> {
    const target = path.join(root, "docs", "spec", ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, lines.join("\n"), "utf8");
    return target;
  }

  const scopePath = (root: string) => path.join(root, "docs", "spec", SCOPE_DOCUMENT);
  const indexPath = (root: string) => path.join(root, "docs", "spec", "00.index.md");

  // Every pointer state the rules-drift check warns about.
  const warnedStates: ReadonlyArray<readonly [string, (root: string) => Promise<void>]> = [
    ["a scope document's Rules row on the old version", (root) => replaceLine(scopePath(root), NEW_INDEX_ROW, OLD_ROW)],
    ["a scope document's Rules row of prose with no version", (root) => replaceLine(scopePath(root), NEW_INDEX_ROW, "| Rules | see the team rules page |")],
    ["the index Reference Documents entry on the old version", (root) => replaceLine(indexPath(root), NEW_LIST_ENTRY, OLD_LIST_ENTRY)],
    [
      "a nested document's Rules row on the old version",
      async (root) => {
        await writeNested(root, "archive/old.srs.md", ["# Old", "", "| Field | Value |", "|---|---|", `| Rules | [SRS-MD Authoring Rules v2.5.0](../../rule/${OLD_RULES}) |`, ""]);
      }
    ],
    [
      "a nested document's Rules row naming the bundled file through a link that does not resolve",
      async (root) => {
        await writeNested(root, "archive/old.srs.md", ["# Old", "", "| Field | Value |", "|---|---|", NEW_INDEX_ROW, ""]);
      }
    ]
  ];

  for (const [state, plant] of warnedStates) {
    // @req FR-PARSE-044 AC-6
    it(`doctor warns on ${state}, and after upgrade reports ok`, async () => {
      const root = await currentProject();
      await plant(root);

      const before = await rulesCheck(root);
      expect(before?.state).toBe("warn");
      expect(before?.remediation).toMatch(/`speckiwi upgrade`/);

      await upgrade(root);

      const after = await rulesCheck(root);
      expect({ state: after?.state, message: after?.message }).toEqual({
        state: "ok",
        message: `installed rules v2.6.0 matches bundled rules v2.6.0 (docs/rule/${NEW_RULES})`
      });
    });
  }

  // Citations an author wrote. None of them is a pointer the tool owns.
  const authorCitations: ReadonlyArray<readonly [string, (root: string) => Promise<string>]> = [
    [
      "a fenced example of the old index entry in a scope document",
      async (root) => {
        await replaceLine(scopePath(root), "## 1. Scope Overview", ["The index used to list:", "", "```md", OLD_LIST_ENTRY, "```", "", "## 1. Scope Overview"].join("\n"));
        return scopePath(root);
      }
    ],
    [
      "a fenced example inside the index's own Reference Documents section",
      async (root) => {
        await replaceLine(indexPath(root), NEW_LIST_ENTRY, [NEW_LIST_ENTRY, "", "~~~md", OLD_LIST_ENTRY, "~~~"].join("\n"));
        return indexPath(root);
      }
    ],
    [
      "an old-style entry in the index outside its Reference Documents section",
      async (root) => {
        await replaceLine(indexPath(root), "## 10. Reference Documents", ["## 9. History", "", "Until 2026-11 the index listed:", "", OLD_LIST_ENTRY, "", "## 10. Reference Documents"].join("\n"));
        return indexPath(root);
      }
    ],
    [
      "a history note under docs/spec listing the old rules as a bullet",
      (root) => writeNested(root, "archive/2026-10.migration-notes.md", ["# Migration notes", "", "Before the bump the project followed:", "", `- [SRS-MD Authoring Rules v2.5.0](../../rule/${OLD_RULES})`, ""])
    ],
    [
      "an old-style entry in a scope document's own Reference Documents section",
      async (root) => {
        await replaceLine(scopePath(root), "## 1. Scope Overview", ["## 10. Reference Documents", "", OLD_LIST_ENTRY, "", "## 1. Scope Overview"].join("\n"));
        return scopePath(root);
      }
    ],
    [
      "a requirement-body sentence citing the old rules file",
      async (root) => {
        await replaceLine(scopePath(root), "Fixture architecture scope.", `Fixture architecture scope, first written against ${OLD_RULES}.`);
        return scopePath(root);
      }
    ],
    [
      "a Change Notes row citing the old rules file",
      async (root) => {
        await replaceLine(scopePath(root), "## 1. Scope Overview", ["## 1. Scope Overview", "", "| Date | Change | Reason |", "|---|---|---|", `| 2026-10-01 | Moved off ${OLD_RULES} | rules bump |`, ""].join("\n"));
        return scopePath(root);
      }
    ]
  ];

  for (const [citation, plant] of authorCitations) {
    // @req FR-PARSE-044 AC-6
    it(`doctor ignores ${citation}, and upgrade leaves it byte-identical`, async () => {
      const root = await currentProject();
      const file = await plant(root);
      const planted = await readFile(file, "utf8");

      expect((await rulesCheck(root))?.state).toBe("ok");
      await upgrade(root);

      expect(await readFile(file, "utf8")).toBe(planted);
    });
  }

  // The variant matrix: for each planted line, doctor's warning and upgrade's rewrite must both happen
  // or both not happen, and which one is the stated criterion (pointerNeedsRefresh).
  const row = (label: string, link: string) => `| Rules | [SRS-MD Authoring Rules v${label}](${link}) |`;
  const entry = (label: string, link: string) => `- [SRS-MD Authoring Rules v${label}](${link})`;
  const oldLink = `../rule/${OLD_RULES}`;
  const newLink = `../rule/${NEW_RULES}`;
  const variants: ReadonlyArray<readonly [string, boolean, (root: string) => Promise<string>]> = [
    ["scope row: old label, old link", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, row("2.5.0", oldLink)); return scopePath(root); }],
    ["scope row: old label, new link", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, row("2.5.0", newLink)); return scopePath(root); }],
    ["scope row: new label, old link", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, row("2.6.0", oldLink)); return scopePath(root); }],
    ["scope row: spacing variant of the current row", false, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `|Rules|[SRS-MD Authoring Rules v2.6.0](${newLink})|`); return scopePath(root); }],
    ["scope row: spacing variant of a stale row", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `|Rules|[SRS-MD Authoring Rules v2.5.0](${oldLink})|`); return scopePath(root); }],
    ["scope row: prose without a version", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, "| Rules | see the team rules page |"); return scopePath(root); }],
    ["scope row: current link and label, with the old file name later in the line", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `| Rules | [SRS-MD Authoring Rules v2.6.0](${newLink}) (was ${OLD_RULES}) |`); return scopePath(root); }],
    [
      "scope row: current reference-style link resolved by its definition",
      false,
      async (root) => {
        await replaceLine(scopePath(root), NEW_INDEX_ROW, "| Rules | [SRS-MD Authoring Rules v2.6.0][rules] |");
        await writeFile(scopePath(root), `${(await readFile(scopePath(root), "utf8")).trimEnd()}\n\n[rules]: ${newLink}\n`, "utf8");
        return scopePath(root);
      }
    ],
    [
      // Lead decision (round 11): a reference-style row is author text — no warning, no rewrite.
      "scope row: reference-style link whose definition names the old file",
      false,
      async (root) => {
        await replaceLine(scopePath(root), NEW_INDEX_ROW, "| Rules | [SRS-MD Authoring Rules v2.6.0][rules] |");
        await writeFile(scopePath(root), `${(await readFile(scopePath(root), "utf8")).trimEnd()}\n\n[rules]: ${oldLink}\n`, "utf8");
        return scopePath(root);
      }
    ],
    [
      // Lead decision (round 11): a reference-style row is author text — no warning, no rewrite.
      "scope row: reference-style link, old label and a definition naming the old file",
      false,
      async (root) => {
        await replaceLine(scopePath(root), NEW_INDEX_ROW, "| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |");
        await writeFile(scopePath(root), `${(await readFile(scopePath(root), "utf8")).trimEnd()}\n\n[rules]: ${oldLink}\n`, "utf8");
        return scopePath(root);
      }
    ],
    ["scope row: old label written with runs of spaces", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `| Rules | [SRS-MD  Authoring   Rules v2.5.0](${newLink}) |`); return scopePath(root); }],
    ["scope row: current link carrying a title", false, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `| Rules | [SRS-MD Authoring Rules v2.6.0](${newLink} "SRS rules") |`); return scopePath(root); }],
    ["scope row: current link in angle brackets", false, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `| Rules | [SRS-MD Authoring Rules v2.6.0](<${newLink}>) |`); return scopePath(root); }],
    ["scope row: current link with a fragment", false, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `| Rules | [SRS-MD Authoring Rules v2.6.0](${newLink}#21-7-expired-acceptance-criteria) |`); return scopePath(root); }],
    ["scope row: current link in angle brackets from the wrong depth", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `| Rules | [SRS-MD Authoring Rules v2.6.0](<../../rule/${NEW_RULES}>) |`); return scopePath(root); }],
    ["scope row: current link, with an old label later in the line", true, async (root) => { await replaceLine(scopePath(root), NEW_INDEX_ROW, `| Rules | [SRS-MD Authoring Rules v2.6.0](${newLink}), formerly SRS-MD Authoring Rules v2.5.0 |`); return scopePath(root); }],
    [
      "scope row: stale, below a fenced example metadata table",
      true,
      async (root) => {
        const text = await readFile(scopePath(root), "utf8");
        await writeFile(scopePath(root), text.replace("# Product Architecture", ["# Product Architecture", "", "```md", "| Field | Value |", "|---|---|", "| Rules | example |", "```"].join("\n")).replace(NEW_INDEX_ROW, row("2.5.0", oldLink)), "utf8");
        return scopePath(root);
      }
    ],
    [
      "scope row: current, with a stale row only inside a fence after it",
      false,
      async (root) => { await replaceLine(scopePath(root), "## 1. Scope Overview", ["```md", "| Field | Value |", "|---|---|", row("2.5.0", oldLink), "```", "", "## 1. Scope Overview"].join("\n")); return scopePath(root); }
    ],
    ["nested SRS row: new label and file, link from the wrong depth", true, (root) => writeNested(root, "archive/old.srs.md", ["# Old", "", "| Field | Value |", "|---|---|", NEW_INDEX_ROW, ""])],
    ["nested SRS row: current link from its own depth", false, (root) => writeNested(root, "archive/old.srs.md", ["# Old", "", "| Field | Value |", "|---|---|", row("2.6.0", `../../rule/${NEW_RULES}`), ""])],
    ["index entry: old label, old link", true, async (root) => { await replaceLine(indexPath(root), NEW_LIST_ENTRY, entry("2.5.0", oldLink)); return indexPath(root); }],
    ["index entry: old label, new link", true, async (root) => { await replaceLine(indexPath(root), NEW_LIST_ENTRY, entry("2.5.0", newLink)); return indexPath(root); }],
    [
      "index entry: stale, after a fenced copy of the section heading",
      true,
      async (root) => {
        const text = await readFile(indexPath(root), "utf8");
        await writeFile(indexPath(root), text.replace("## 1. Purpose", ["## 1. Purpose", "", "```md", "## 10. Reference Documents", "```", ""].join("\n")).replace(NEW_LIST_ENTRY, entry("2.5.0", oldLink)), "utf8");
        return indexPath(root);
      }
    ],
    [
      "step SDS: its own SDS rules row",
      false,
      (root) => writeNested(root, "steps/alpha/design.md", ["# Alpha design", "", "| Field | Value |", "|---|---|", "| Document Type | sds |", "| Rules | [SDS-MD Authoring Rules v2.5.0](../../../rule/SDS-MD-Rules-v2.5.0.md) |", ""])
    ],
    [
      "step document: a stale SRS rules row outside the SRS set the parser reads",
      false,
      (root) => writeNested(root, "steps/alpha/notes.md", ["# Alpha notes", "", "| Field | Value |", "|---|---|", row("2.5.0", `../../../rule/${OLD_RULES}`), ""])
    ]
  ];

  for (const [variant, needsRefresh, plant] of variants) {
    // @req FR-PARSE-044 AC-6
    it(`${variant}: doctor warns ${needsRefresh ? "and" : "neither, nor does"} upgrade rewrite${needsRefresh ? "s it" : " it"}`, async () => {
      const root = await currentProject();
      const file = await plant(root);
      const planted = await readFile(file, "utf8");

      const doctorWarned = (await rulesCheck(root))?.state === "warn";
      // SRS-W073 fires only where a stale value is quoted; where it does, its guidance must agree too.
      const relative = path.relative(root, file).replace(/\\/g, "/");
      const w073Guidance = validateWorkspace(await parseWorkspace({ root }))
        .diagnostics.filter((entry) => entry.code === "SRS-W073" && entry.filePath === relative && entry.message.includes("BUNDLED_SRS_RULES_FILENAME"))
        .map((entry) => entry.message.includes("run `speckiwi upgrade`"));
      await upgrade(root);
      const upgradeRewrote = (await readFile(file, "utf8")) !== planted;

      expect({ doctorWarned, upgradeRewrote }).toEqual({ doctorWarned: needsRefresh, upgradeRewrote: needsRefresh });
      expect(w073Guidance.every((guidesToUpgrade) => guidesToUpgrade === needsRefresh), `W073 guidance ${JSON.stringify(w073Guidance)}`).toBe(true);
      if (needsRefresh) {
        expect((await rulesCheck(root))?.state).toBe("ok");
        // Nothing the tool owned is left for validate to send the author to: no stale rules file name
        // remains in the repaired document.
        const leftover = validateWorkspace(await parseWorkspace({ root }))
          .diagnostics.filter((entry) => entry.code === "SRS-W073" && entry.filePath === relative && entry.message.includes("BUNDLED_SRS_RULES_FILENAME"))
          .map((entry) => `${entry.line}: ${entry.message}`);
        expect(leftover).toEqual([]);
      }
    });
  }
});
