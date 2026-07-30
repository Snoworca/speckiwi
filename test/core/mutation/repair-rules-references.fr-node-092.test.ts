import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repairRulesReferences } from "../../../src/core/mutation/repair-rules-references.js";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-092 — repairing a `Related Docs` link to a rules document the tool renamed.
//
// Five verified requirements in this repository have carried a broken link to
// `../rule/SRS-MD-Rules-v1.0.0.md` since the v2.5.0 rename, and nothing could fix them:
// `edit_requirement_fields` refuses granular edits on a verified requirement, and `speckiwi upgrade`
// excludes docs/spec by contract. Demoting five verified requirements to correct a path is the wrong
// trade, so a path-only correction is modelled as a repair — the same shape the requirement-id
// collision repair already uses. `add_related_doc` already writes this row at any status, so the
// verified gate was never what protected it.

const STALE_LINK = "[SRS-MD-Rules-v1.0.0.md](../rule/SRS-MD-Rules-v1.0.0.md)";
const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

/**
 * A workspace whose single requirement is `verified` and whose `Related Docs` row carries a live
 * reference plus a dangling one. The bundled rules document is installed, so only the stale link is
 * broken.
 */
async function workspaceWithDanglingReference(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(path.join(root, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");

  const specPath = path.join(root, SPEC_FILE);
  const body = (await readFile(specPath, "utf8"))
    .replace("| Status | planned |", "| Status | verified |")
    .replace("| Related Docs | [Index](./00.index.md) |", `| Related Docs | [Index](./00.index.md), ${STALE_LINK} |`);
  await writeFile(specPath, body, "utf8");
  return root;
}

async function repair(rootPath: string, options: { apply?: boolean } = {}) {
  const result = await repairRulesReferences(await resolveProjectRoot(rootPath), {
    ...(options.apply === true ? { apply: true } : {})
  });
  if (!result.ok) throw new Error(result.error?.message ?? "repair failed");
  return result.value!;
}

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

/** The lines of one requirement block, from its heading to the next `### ` heading or EOF. */
function requirementBlock(text: string, id: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`### ${id} `));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [lines[start]!, ...(end === -1 ? rest : rest.slice(0, end))];
}

describe("FR-NODE-092 AC-1 — diagnose locates every dangling reference", () => {
  it("names the requirement, the file, the line and the reference", async () => {
    const rootPath = await workspaceWithDanglingReference();

    const output = await repair(rootPath);

    expect(output.findings).toHaveLength(1);
    const finding = output.findings[0]!;
    expect(finding.requirementId).toBe("FR-ARCH-001");
    expect(finding.filePath.replace(/\\/g, "/")).toBe("docs/spec/10.product-architecture.srs.md");
    expect(finding.from).toBe("SRS-MD-Rules-v1.0.0.md");
    expect(finding.to).toBe(BUNDLED_SRS_RULES_FILENAME);

    // The line must be the Related Docs row itself, not the block heading.
    const lines = (await readFile(path.join(rootPath, SPEC_FILE), "utf8")).split(/\r?\n/);
    expect(lines[finding.line - 1]).toContain("| Related Docs |");
  });
});

describe("FR-NODE-092 AC-2 — diagnose writes nothing", () => {
  it("leaves the workspace byte-identical", async () => {
    const rootPath = await workspaceWithDanglingReference();
    const before = await snapshot(rootPath);

    const output = await repair(rootPath);

    expect(output.applied).toBe(false);
    const after = await snapshot(rootPath);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, content] of after) expect(content, `diagnose must not modify ${rel}`).toBe(before.get(rel));
  });
});

describe("FR-NODE-092 AC-3 — an apply rewrites only the reference", () => {
  it("keeps the row's other reference, its link text and its formatting", async () => {
    const rootPath = await workspaceWithDanglingReference();

    await repair(rootPath, { apply: true });

    const row = (await readFile(path.join(rootPath, SPEC_FILE), "utf8"))
      .split(/\r?\n/)
      .find((line) => line.startsWith("| Related Docs |"));
    expect(row).toBe(
      `| Related Docs | [Index](./00.index.md), [${BUNDLED_SRS_RULES_FILENAME}](../rule/${BUNDLED_SRS_RULES_FILENAME}) |`
    );
  });
});

describe("FR-NODE-092 AC-4 — a verified requirement is repairable and the edit is auditable", () => {
  it("succeeds at Status=verified and appends a Change Note", async () => {
    const rootPath = await workspaceWithDanglingReference();
    const specPath = path.join(rootPath, SPEC_FILE);
    const notesBefore = (await readFile(specPath, "utf8")).split(/\r?\n/).filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line));

    const output = await repair(rootPath, { apply: true });

    expect(output.applied).toBe(true);
    const after = await readFile(specPath, "utf8");
    expect(after).toContain("| Status | verified |"); // the status is untouched by the repair
    const notesAfter = after.split(/\r?\n/).filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line));
    expect(notesAfter.length).toBe(notesBefore.length + 1);
    // A silent edit to a verified requirement is what makes this dangerous; the note is the record.
    expect(notesAfter.at(-1)).toMatch(/Related Docs/);
  });
});

describe("FR-NODE-092 AC-5 — nothing else in the requirement changes", () => {
  it("differs only in the Related Docs row and the appended Change Note", async () => {
    const rootPath = await workspaceWithDanglingReference();
    const specPath = path.join(rootPath, SPEC_FILE);
    const before = requirementBlock(await readFile(specPath, "utf8"), "FR-ARCH-001");

    await repair(rootPath, { apply: true });

    const after = requirementBlock(await readFile(specPath, "utf8"), "FR-ARCH-001");
    const removed = before.filter((line) => !after.includes(line));
    const added = after.filter((line) => !before.includes(line));
    expect(removed.every((line) => line.startsWith("| Related Docs |")), removed.join("\n")).toBe(true);
    expect(
      added.every((line) => line.startsWith("| Related Docs |") || /^\| \d{4}-\d{2}-\d{2} \|/.test(line)),
      added.join("\n")
    ).toBe(true);
  });
});

describe("FR-NODE-092 AC-6 — a live reference is left alone", () => {
  it("reports and rewrites nothing when the cited document is installed", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
    await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
    const specPath = path.join(rootPath, SPEC_FILE);
    await writeFile(
      specPath,
      (await readFile(specPath, "utf8")).replace(
        "| Related Docs | [Index](./00.index.md) |",
        `| Related Docs | [rules](../rule/${BUNDLED_SRS_RULES_FILENAME}) |`
      ),
      "utf8"
    );
    const before = await readFile(specPath, "utf8");

    const output = await repair(rootPath, { apply: true });

    expect(output.findings).toEqual([]);
    expect(await readFile(specPath, "utf8")).toBe(before);
  });
});

describe("FR-NODE-092 AC-7 — the diagnosis reports exactly what an apply performs", () => {
  it("produces the same findings in both modes", async () => {
    const planned = await repair(await workspaceWithDanglingReference());
    const applied = await repair(await workspaceWithDanglingReference(), { apply: true });

    const shape = (findings: typeof planned.findings) =>
      findings.map(({ requirementId, from, to }) => ({ requirementId, from, to }));
    expect(shape(planned.findings)).toEqual(shape(applied.findings));
    expect(planned.findings.length).toBeGreaterThan(0);
  });
});

describe("FR-NODE-092 AC-8 — after an apply the link checker is clean", () => {
  it("reports no broken rules-document reference", async () => {
    const rootPath = await workspaceWithDanglingReference();
    const brokenBefore = (await checkLinks(await parseWorkspace({ root: rootPath }))).broken;
    expect(brokenBefore.some((entry) => entry.reference.includes("SRS-MD-Rules-v1.0.0.md"))).toBe(true);

    await repair(rootPath, { apply: true });

    const brokenAfter = (await checkLinks(await parseWorkspace({ root: rootPath }))).broken;
    expect(brokenAfter.filter((entry) => /-MD-Rules-v/.test(entry.reference))).toEqual([]);
  });
});
