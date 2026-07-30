import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import {
  BUNDLED_RULES_VERSION,
  BUNDLED_SDS_RULES_FILENAME,
  BUNDLED_SRS_RULES_FILENAME,
  renderIndexRulesRow
} from "../../../src/core/bootstrap/templates.js";
// The CRLF refresh case exercises init's own Rules-pointer refresh through the migration.
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-091 — `speckiwi upgrade` closes the two migration gaps a plain init leaves to the author.
//
// Both gaps were measured against a simulated old-version project, not reasoned about: a reference to
// a rules document this release prunes is left dangling (this repository's own CLAUDE.md and AGENTS.md
// carried exactly that line and were fixed by hand), and an index with no `| Rules |` row never gets
// one because the pointer refresh only ever replaces an existing row.
//
// Both repairs touch author-owned content. Init not touching author content is the contract that closed
// the `--force` data-loss defect, so the repairs live in an explicit migration that plans by default.

const STALE_SRS_RULES = "SRS-MD-Rules-v1.0.0.md";
const STALE_SRS_PROSE = "SRS-MD Authoring Rules v1.0.0";

/** An index metadata table with no `| Rules |` row, plus authored body content that must survive. */
function indexWithoutRulesRow(): string {
  return [
    "# Demo SRS Index",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | srs_index |",
    "| Product | Demo |",
    "| Active Target | v1.0.0 |",
    "",
    "## 1. Purpose",
    "",
    "Authored prose that no migration may touch.",
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    "| Billing | [01.billing.srs.md](./01.billing.srs.md) | BILL | Billing rules |",
    ""
  ].join("\n");
}

/**
 * A project as an older speckiwi left it: v1.0.0 rules documents on disk, agent files pointing at
 * them in both spellings, a guide outside docs/spec that mentions the retired version in passing,
 * and a requirement body that cites it.
 */
async function legacyProject(options: { withRulesRow?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-upgrade-"));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await mkdir(path.join(root, "docs", "guide"), { recursive: true });

  const index = options.withRulesRow === true
    ? indexWithoutRulesRow().replace(
        "| Active Target | v1.0.0 |",
        `| Active Target | v1.0.0 |\n| Rules | [${STALE_SRS_PROSE}](../rule/${STALE_SRS_RULES}) |`
      )
    : indexWithoutRulesRow();
  await writeFile(path.join(root, "docs", "spec", "00.index.md"), index, "utf8");
  await writeFile(
    path.join(root, "docs", "spec", "01.billing.srs.md"),
    `# Billing\n\nThe billing scope follows ${STALE_SRS_PROSE}.\n`,
    "utf8"
  );
  for (const name of [STALE_SRS_RULES, "SDS-MD-Rules-v1.0.0.md"]) {
    await writeFile(path.join(root, "docs", "rule", name), "# Old rules\n", "utf8");
  }
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    await writeFile(
      path.join(root, name),
      [
        "# Consumer Agent Notes",
        "",
        `For rules read [${STALE_SRS_PROSE}](docs/rule/${STALE_SRS_RULES}).`,
        `Author every requirement under the ${STALE_SRS_PROSE}.`,
        "",
        "Keep this consumer line.",
        ""
      ].join("\n"),
      "utf8"
    );
  }
  await writeFile(
    path.join(root, "docs", "guide", "authoring.md"),
    `# Authoring guide\n\nUntil last year this project followed ${STALE_SRS_PROSE}.\n`,
    "utf8"
  );
  return root;
}

async function upgrade(rootPath: string, options: { apply?: boolean } = {}) {
  const result = await upgradeProject(await resolveProjectRoot(rootPath), {
    ...(options.apply === true ? { apply: true } : {}),
    // The skills + MCP steps are init's, exercised by init's own suite; keeping them off holds these
    // cases to the two gaps under test.
    installSkills: false,
    registerMcp: false
  });
  if (!result.ok) throw new Error(result.error?.message ?? "upgrade failed");
  return result.value!;
}

/** Every file's workspace-relative path → contents, for byte-identity assertions. */
async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.set(path.relative(root, full).replace(/\\/g, "/"), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return files;
}

/** The metadata table of an index: the first run of table lines under the H1. */
function metadataTable(index: string): string[] {
  const lines = index.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("|"));
  if (start === -1) return [];
  const end = lines.findIndex((line, at) => at > start && !line.startsWith("|"));
  return lines.slice(start, end === -1 ? undefined : end);
}

describe("FR-NODE-091 AC-1 — a plan writes nothing and still says everything", () => {
  it("leaves the workspace byte-identical while reporting the repairs it would perform", async () => {
    const rootPath = await legacyProject();
    const before = await snapshot(rootPath);

    const output = await upgrade(rootPath);

    const after = await snapshot(rootPath);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, content] of after) expect(content, `plan must not modify ${rel}`).toBe(before.get(rel));

    // A silent plan would satisfy the byte-identity assertion above and be useless, so the plan must
    // carry both gap repairs it intends: the missing Rules row and the dangling agent references.
    expect(output.applied).toBe(false);
    expect(output.rulesRowInsertion?.filePath).toBe("docs/spec/00.index.md");
    expect(output.references.filter((finding) => finding.action === "repair").length).toBeGreaterThan(0);
    // "every change it would have made" includes the findings it intends only to report, which are
    // otherwise asserted solely on the apply path.
    expect(output.references.some((finding) => finding.action === "report")).toBe(true);
  });
});

describe("FR-NODE-091 AC-2 — a missing index Rules row is inserted exactly once", () => {
  it("adds the bundled pointer inside the metadata table and preserves the authored body", async () => {
    const rootPath = await legacyProject();
    const before = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");

    const output = await upgrade(rootPath, { apply: true });

    const after = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    const rows = after.split(/\r?\n/).filter((line) => line.startsWith("| Rules |"));
    expect(rows).toEqual([renderIndexRulesRow()]);

    // Pin the pointer's content independently of the renderer. Comparing `renderIndexRulesRow()` to
    // itself on both sides would pass even if the row named the wrong document.
    expect(rows[0]).toContain(BUNDLED_SRS_RULES_FILENAME);
    expect(rows[0]).toContain(`v${BUNDLED_RULES_VERSION}`);

    // The row belongs to the metadata table, not appended somewhere later in the document.
    expect(metadataTable(after)).toContain(renderIndexRulesRow());

    // Every line the index already had survives, in order — the insertion is the only difference.
    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/).filter((line) => line !== renderIndexRulesRow());
    expect(afterLines).toEqual(beforeLines);

    expect(output.rulesRowInsertion).toEqual({
      filePath: "docs/spec/00.index.md",
      line: metadataTable(after).length + 2, // 1-based: the H1 and the blank line precede the table
      row: renderIndexRulesRow()
    });
    // The inserted pointer, pinned without going through the renderer: comparing the row to
    // `renderIndexRulesRow()` on both sides passes even if the row names the wrong document, and the
    // on-disk check cannot catch it either, since init's own refresh would repair a wrong row.
    expect(output.rulesRowInsertion!.row).toContain(BUNDLED_SRS_RULES_FILENAME);
    expect(output.rulesRowInsertion!.row).toContain(`v${BUNDLED_RULES_VERSION}`);
  });
});

describe("FR-NODE-091 AC-3 — an index that already has a Rules row gains no second one", () => {
  it("reports no insertion and leaves the single row for init to refresh in place", async () => {
    const rootPath = await legacyProject({ withRulesRow: true });

    const output = await upgrade(rootPath, { apply: true });

    const after = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    const rows = after.split(/\r?\n/).filter((line) => line.startsWith("| Rules |"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(renderIndexRulesRow());
    expect(output.rulesRowInsertion).toBeUndefined();
  });
});

describe("FR-NODE-091 AC-4 — a dangling path-form reference is repaired and located", () => {
  it("rewrites the link in both agent files and reports each change as file and line", async () => {
    const rootPath = await legacyProject();

    const output = await upgrade(rootPath, { apply: true });

    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const content = await readFile(path.join(rootPath, name), "utf8");
      expect(content, name).not.toContain(STALE_SRS_RULES);
      expect(content, name).toContain(BUNDLED_SRS_RULES_FILENAME);
      // The repair is surgical: consumer prose around the reference is untouched.
      expect(content, name).toContain("Keep this consumer line.");
    }

    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const finding = output.references.find(
        (candidate) => candidate.filePath === name && candidate.from.includes(STALE_SRS_RULES)
      );
      expect(finding, `${name} path-form repair must be reported`).toBeDefined();
      expect(finding!.action).toBe("repair");
      expect(finding!.line).toBe(3); // the link sits on the third line of the seeded file
      expect(finding!.location).toBe(`${name}:3`);
      expect(finding!.to).toContain(BUNDLED_SRS_RULES_FILENAME);
    }
  });
});

describe("FR-NODE-091 AC-5 — the prose spelling is repaired by the same pass", () => {
  it("rewrites `SRS-MD Authoring Rules v<old>`, so matching only the path form is not enough", async () => {
    const rootPath = await legacyProject();

    const output = await upgrade(rootPath, { apply: true });

    // The seeded fourth line carries the prose citation and no path at all. Matching only the path
    // form is the exact defect this repository shipped and had to fix in a follow-up commit.
    const content = await readFile(path.join(rootPath, "CLAUDE.md"), "utf8");
    expect(content).not.toContain(STALE_SRS_PROSE);
    expect(content).toContain(`SRS-MD Authoring Rules v${BUNDLED_RULES_VERSION}`);

    const prose = output.references.find(
      (finding) => finding.filePath === "CLAUDE.md" && finding.line === 4
    );
    expect(prose, "prose-form repair must be reported on its own line").toBeDefined();
    expect(prose!.action).toBe("repair");
    expect(prose!.from).toContain(STALE_SRS_PROSE);
    expect(prose!.from).not.toContain(".md");
  });
});

describe("FR-NODE-091 AC-6 — presence is judged against the post-refresh rules directory", () => {
  it("leaves a reference to a document the refresh keeps, and plans exactly what an apply performs", async () => {
    // A reference to the bundled document is live and must survive untouched.
    const keeper = await legacyProject();
    await writeFile(
      path.join(keeper, "CLAUDE.md"),
      `# Notes\n\nRead [rules](docs/rule/${BUNDLED_SRS_RULES_FILENAME}).\n`,
      "utf8"
    );

    const kept = await upgrade(keeper, { apply: true });

    expect(await readFile(path.join(keeper, "CLAUDE.md"), "utf8")).toContain(BUNDLED_SRS_RULES_FILENAME);
    expect(kept.references.filter((finding) => finding.filePath === "CLAUDE.md")).toEqual([]);

    // The subtle half: the stale document is still on disk when a plan runs and gone once init has
    // pruned it. Judging presence before the refresh would make the plan report nothing while the
    // apply repaired two files — a plan that lies about what the apply does.
    const planned = await upgrade(await legacyProject());
    const applied = await upgrade(await legacyProject(), { apply: true });
    const shape = (findings: typeof planned.references) =>
      findings.map(({ location, from, to, action }) => ({ location, from, to, action })).sort((a, b) => a.location.localeCompare(b.location));
    expect(shape(planned.references)).toEqual(shape(applied.references));
    expect(planned.references.length).toBeGreaterThan(0);
  });
});

describe("FR-NODE-091 AC-7 — outside the agent files the migration reports and stops", () => {
  it("reports a docs mention without rewriting it and never inspects docs/spec", async () => {
    const rootPath = await legacyProject();
    const guidePath = path.join(rootPath, "docs", "guide", "authoring.md");
    const specPath = path.join(rootPath, "docs", "spec", "01.billing.srs.md");
    const guideBefore = await readFile(guidePath, "utf8");
    const specBefore = await readFile(specPath, "utf8");

    const output = await upgrade(rootPath, { apply: true });

    // A note recording which rules version a project used to follow is a record, not a defect.
    expect(await readFile(guidePath, "utf8")).toBe(guideBefore);
    const guide = output.references.find((finding) => finding.filePath === "docs/guide/authoring.md");
    expect(guide, "a dangling mention outside the agent files must still be reported").toBeDefined();
    expect(guide!.action).toBe("report");

    // A requirement body is governance, edited through a mutation and never by a migration. It is not
    // rewritten and it is not even reported, so nobody mistakes it for pending work.
    expect(await readFile(specPath, "utf8")).toBe(specBefore);
    expect(output.references.filter((finding) => finding.filePath.startsWith("docs/spec/"))).toEqual([]);
  });
});

describe("FR-NODE-091 AC-8 — an existing hook is reported, never overwritten", () => {
  it("keeps a consumer pre-commit hook byte-identical and names it in the report", async () => {
    const rootPath = await legacyProject();
    const hookPath = path.join(rootPath, ".git", "hooks", "pre-commit");
    await mkdir(path.dirname(hookPath), { recursive: true });
    const hook = "#!/bin/sh\necho consumer hook\n";
    await writeFile(hookPath, hook, "utf8");

    const output = await upgrade(rootPath, { apply: true });

    expect(await readFile(hookPath, "utf8")).toBe(hook);
    const reported = output.hooks.find((entry) => entry.filePath === ".git/hooks/pre-commit");
    expect(reported, "the hook the migration refuses to touch must be visible in the report").toBeDefined();
    expect(reported!.state).toBe("pre-existing");
  });

  it("does not call a hook it just created pre-existing, so the report carries information", async () => {
    // Read after the refresh, a hook init had created is indistinguishable from a consumer hook the
    // migration refused to touch — every entry would say the same thing whatever the project held.
    const rootPath = await legacyProject();

    const output = await upgrade(rootPath, { apply: true });

    for (const entry of output.hooks) expect(entry.state, entry.filePath).toBe("absent");
    // ...and init did in fact create them in the same run, which is what makes the distinction matter.
    expect(output.init.created.some((entry) => entry.endsWith(path.join(".git", "hooks", "pre-commit")))).toBe(true);
  });
});

describe("FR-NODE-091 AC-6 — a pre-existing managed agent block does not desynchronise plan and apply", () => {
  it("reports the same repairs whether or not the refresh has rewritten the block", async () => {
    // The population this command targets is "projects an older speckiwi initialised", so a managed
    // block is the normal case — and the block cites the rules documents itself. With the refresh
    // running first, an apply scans an already-rewritten file: two of four planned repairs never happen
    // and the other two land dozens of lines away from where the plan said they would.
    const legacyBlock = [
      "# Consumer Agent Notes",
      "",
      "# SpecKiwi SRS workflow v1.5",
      "",
      `Read [rules](docs/rule/${STALE_SRS_RULES}).`,
      "",
      "<!-- /SpecKiwi SRS workflow -->",
      "",
      `Consumer prose citing ${STALE_SRS_PROSE}.`,
      ""
    ].join("\n");

    const planned = await legacyProject();
    const applied = await legacyProject();
    for (const rootPath of [planned, applied]) {
      for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        await writeFile(path.join(rootPath, name), legacyBlock, "utf8");
      }
    }

    const plan = await upgrade(planned);
    const apply = await upgrade(applied, { apply: true });

    const shape = (findings: typeof plan.references) =>
      findings
        .map(({ location, from, to, action }) => ({ location, from, to, action }))
        .sort((left, right) => `${left.location}${left.from}`.localeCompare(`${right.location}${right.from}`));
    expect(shape(plan.references)).toEqual(shape(apply.references));
    expect(plan.references.filter((finding) => finding.action === "repair").length).toBeGreaterThan(0);

    // And the consumer prose outside the block really is repaired on disk.
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const content = await readFile(path.join(applied, name), "utf8");
      expect(content, name).not.toContain(STALE_SRS_PROSE);
    }
  });
});

describe("FR-NODE-091 AC-10 — the Rules-row repair stays inside the metadata table", () => {
  it("leaves the SRS Documents and Scope Map rows of a scope named Rules intact", async () => {
    // `| Rules |` is also the prefix a scope named Rules produces in both index tables. A prefix test
    // replaced those author rows with the metadata pointer, unregistering the scope document in both
    // sections while validation stayed clean.
    const rootPath = await legacyProject();
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const scopeRow = "| Rules | [01.rules.srs.md](./01.rules.srs.md) | RULE | Business rules |";
    await writeFile(
      indexPath,
      `${indexWithoutRulesRow()}${scopeRow}\n\n## 3. Scope Map\n\n| Scope | Prefix |\n|---|---|\n${scopeRow}\n`,
      "utf8"
    );

    await upgrade(rootPath, { apply: true });

    const after = await readFile(indexPath, "utf8");
    expect(after.split(/\r?\n/).filter((line) => line === scopeRow)).toHaveLength(2);
    expect(after).toContain(renderIndexRulesRow());
  });

  it("inserts into the metadata table even when another table comes first", async () => {
    const rootPath = await legacyProject();
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    await writeFile(
      indexPath,
      ["# Demo SRS Index", "", "| Overview | Count |", "|---|---|", "| Scopes | 2 |", "", "| Field | Value |", "|---|---|", "| Product | Demo |", ""].join("\n"),
      "utf8"
    );

    const output = await upgrade(rootPath, { apply: true });

    const lines = (await readFile(indexPath, "utf8")).split(/\r?\n/);
    // The row must follow the metadata table's last row, not the summary table that happens to come first.
    expect(lines.indexOf(renderIndexRulesRow())).toBe(lines.indexOf("| Product | Demo |") + 1);
    expect(output.rulesRowInsertion?.line).toBe(lines.indexOf(renderIndexRulesRow()) + 1);
  });

  it("still inserts when an unrelated `| Rules |` row exists elsewhere, and leaves that row intact", async () => {
    const rootPath = await legacyProject();
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const glossaryRow = "| Rules | the authoring rules the team follows |";
    await writeFile(indexPath, `${indexWithoutRulesRow()}\n## 9. Glossary\n\n| Term | Meaning |\n|---|---|\n${glossaryRow}\n`, "utf8");

    const output = await upgrade(rootPath, { apply: true });

    const after = await readFile(indexPath, "utf8");
    expect(output.rulesRowInsertion, "a glossary row must not suppress the repair").toBeDefined();
    expect(after).toContain(renderIndexRulesRow());
    // And the author's row survives. A two-cell `| Rules | … |` row is what a glossary entry looks
    // like, so a shape-only test replaced it with the pointer — silently, with validation clean and
    // two identical pointer rows left in the index.
    expect(after, "an author's two-cell Rules row must not be overwritten").toContain(glossaryRow);
    expect(after.split(/\r?\n/).filter((line) => line === renderIndexRulesRow())).toHaveLength(1);
  });

  it("inserts correctly when the metadata table is the end of the file with no trailing newline", async () => {
    const rootPath = await legacyProject();
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    // No final terminator: appending `row + eol` welds the new row onto the previous one, producing a
    // four-cell Active Target row and no Rules row at all, so doctor keeps warning forever.
    await writeFile(indexPath, "# Demo\r\n\r\n| Field | Value |\r\n|---|---|\r\n| Active Target | v1.0.0 |", "utf8");

    await upgrade(rootPath, { apply: true });

    const after = await readFile(indexPath, "utf8");
    const lines = after.split("\r\n");
    expect(lines).toContain("| Active Target | v1.0.0 |");
    expect(lines).toContain(renderIndexRulesRow());
    expect(after.endsWith(renderIndexRulesRow()), "the file must keep having no trailing newline").toBe(true);
    expect(after).not.toContain("\n\n");
  });

  it("refreshes an existing row written without the template's spacing instead of duplicating it", async () => {
    const rootPath = await legacyProject();
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    await writeFile(
      indexPath,
      indexWithoutRulesRow().replace(
        "| Active Target | v1.0.0 |",
        `| Active Target | v1.0.0 |\n|Rules|[${STALE_SRS_PROSE}](../rule/${STALE_SRS_RULES})|`
      ),
      "utf8"
    );

    const output = await upgrade(rootPath, { apply: true });

    const rows = (await readFile(indexPath, "utf8")).split(/\r?\n/).filter((line) => /^\|\s*Rules\s*\|/.test(line));
    expect(rows).toEqual([renderIndexRulesRow()]);
    expect(output.rulesRowInsertion).toBeUndefined();
  });
});

describe("FR-NODE-091 AC-11 — a repair preserves the file's line endings", () => {
  it("rewrites one token in a mixed-ending file without renormalising the rest", async () => {
    const rootPath = await legacyProject();
    const agentPath = path.join(rootPath, "CLAUDE.md");
    // LF-dominant with a single CRLF: joining on one chosen terminator turns a one-token repair into a
    // whole-file diff, which is the trap the agent-block comparison already documents.
    const mixed = `# Notes\r\nplain\nRead [rules](docs/rule/${STALE_SRS_RULES}).\ntail\n`;
    await writeFile(agentPath, mixed, "utf8");

    await upgrade(rootPath, { apply: true });

    // The refresh appends the managed block to a file that has none, so the assertion is on the
    // consumer's own text: it must survive with the one token replaced and not a byte else changed.
    const after = await readFile(agentPath, "utf8");
    expect(after.startsWith(mixed.replace(STALE_SRS_RULES, BUNDLED_SRS_RULES_FILENAME))).toBe(true);
  });

  it("keeps a CRLF index CRLF when refreshing an existing stale Rules row", async () => {
    // The refresh path, not the insertion path. It replaces the row wholesale, and the split it uses
    // is on "\n" alone — so a CRLF line carries its CR as trailing content and dropping it leaves
    // exactly one LF-terminated line in an otherwise CRLF file. The insertion cases cannot see this:
    // an inserted row already names the bundled document, so the refresh skips it.
    const rootPath = await legacyProject({ withRulesRow: true });
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");
    await writeFile(indexPath, before.replace(/\r?\n/g, "\r\n"), "utf8");

    await upgrade(rootPath, { apply: true });

    const after = await readFile(indexPath, "utf8");
    expect(after).toContain(`${renderIndexRulesRow()}\r\n`);
    expect(
      after.split("\n").filter((line) => line.length > 0 && !line.endsWith("\r")),
      "no line may be left LF-terminated in a CRLF index"
    ).toEqual([]);
  });

  it("keeps a CRLF index CRLF when inserting the Rules row", async () => {
    const rootPath = await legacyProject();
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    await writeFile(indexPath, indexWithoutRulesRow().replace(/\n/g, "\r\n"), "utf8");

    await upgrade(rootPath, { apply: true });

    const after = await readFile(indexPath, "utf8");
    expect(after).toContain(`${renderIndexRulesRow()}\r\n`);
    expect(after.split("\n").filter((line) => line.length > 0 && !line.endsWith("\r"))).toEqual([]);
  });
});

describe("FR-NODE-091 — one reference reported once", () => {
  it("does not report a markdown link whose text is the file name twice", async () => {
    // This is how the repository's own agent files are written, and the token matches twice on the line.
    const rootPath = await legacyProject();
    await writeFile(
      path.join(rootPath, "CLAUDE.md"),
      `# Notes\n\nRead [${STALE_SRS_RULES}](docs/rule/${STALE_SRS_RULES}).\n`,
      "utf8"
    );

    const output = await upgrade(rootPath, { apply: true });

    expect(output.references.filter((finding) => finding.filePath === "CLAUDE.md")).toHaveLength(1);
    expect(await readFile(path.join(rootPath, "CLAUDE.md"), "utf8")).not.toContain(STALE_SRS_RULES);
  });
});

describe("FR-NODE-091 AC-9 — the tool-owned refresh is init's own", () => {
  it("installs both bundled rules documents, prunes the stale pair, and reports the removals", async () => {
    const rootPath = await legacyProject();

    const output = await upgrade(rootPath, { apply: true });

    const installed = (await readdir(path.join(rootPath, "docs", "rule"))).sort();
    expect(installed).toEqual([BUNDLED_SDS_RULES_FILENAME, BUNDLED_SRS_RULES_FILENAME].sort());
    const removed = output.init.removed.map((entry) => path.basename(entry)).sort();
    expect(removed).toEqual(["SDS-MD-Rules-v1.0.0.md", STALE_SRS_RULES].sort());
  });
});
