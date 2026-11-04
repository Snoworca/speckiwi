import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { findMetadataLine } from "../../../src/core/mutation/internal.js";
import { addRelatedDoc } from "../../../src/core/mutation/add-related-doc.js";
import { setSupersede } from "../../../src/core/mutation/add-trace.js";
import { updateRequirementFields } from "../../../src/core/mutation/edit-requirement.js";
import { repairRulesReferences } from "../../../src/core/mutation/repair-rules-references.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { updateField } from "../../../src/core/mutation/update-field.js";
import { updateStability } from "../../../src/core/mutation/update-stability.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import type { ProjectRoot } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { METADATA_VALUE_CASES, STALE_RULES_LINK } from "./metadata-value-cases.ir-cli-112.js";

// IR-CLI-112 AC-3 — retarget finds the Target row through the shared findMetadataLine helper, which
// must find any metadata row the parser reads. The parser trims cells, so a Field cell with extra
// spaces is a row it reads; the helper used to match only the literal `| Field |` prefix.
//
// Denominator: every field label a src/core/mutation caller passes to findMetadataLine or to the
// shared writer (planMetadataWrite, or the row-text pair planMetadataRowEdit and metadataRowText). The census test below fails when a new call site appears, so this
// list cannot silently fall behind.
const CALLER_FIELDS: Record<string, readonly string[]> = {
  "add-related-doc.ts": ["Related Docs"],
  "add-trace.ts": ["Supersedes", "Superseded By"],
  "edit-requirement.ts": ["Priority", "Risk", "Tags", "Related Docs"],
  "rename-target.ts": ["Target"],
  "repair-rules-references.ts": ["Related Docs"],
  "retarget.ts": ["Target"],
  "update-field.ts": ["Priority", "Risk", "Target", "Verification Method", "Type"],
  "update-stability.ts": ["Stability"],
  "update-status.ts": ["Status"]
};
const CALL_SITES_PER_FILE: Record<string, number> = {
  "add-related-doc.ts": 1,
  "add-trace.ts": 1,
  "edit-requirement.ts": 1,
  "rename-target.ts": 1,
  "repair-rules-references.ts": 4,
  "retarget.ts": 1,
  "update-field.ts": 2,
  "update-stability.ts": 1,
  "update-status.ts": 1
};
const FIELDS = [...new Set(Object.values(CALLER_FIELDS).flat())];
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

describe("IR-CLI-112 findMetadataLine reads metadata rows as the parser does", () => {
  it("the caller census matches every findMetadataLine and planMetadataWrite call site under src/core/mutation", async () => {
    const dir = path.resolve("src", "core", "mutation");
    const counts: Record<string, number> = {};
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".ts") || name === "internal.ts") continue;
      const hits = (await readFile(path.join(dir, name), "utf8")).match(/(?:findMetadataLine|planMetadataWrite|planMetadataRowEdit|metadataRowText)\(/g)?.length ?? 0;
      if (hits > 0) counts[name] = hits;
    }
    expect(counts).toEqual(CALL_SITES_PER_FILE);
    expect(Object.keys(CALLER_FIELDS).sort()).toEqual(Object.keys(CALL_SITES_PER_FILE).sort());
  });

  // @req IR-CLI-112 AC-3
  it.each(FIELDS)("finds the %s row when its Field cell carries extra spaces", async (field) => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, SPEC);
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    // Give the fixture the two optional rows the add-trace caller looks up, then pad every Field cell.
    const withOptional = text.replace("| Related Docs | - |", "| Related Docs | - |\n| Supersedes | - |\n| Superseded By | - |");
    const padded = withOptional.replace(/^\| ([A-Za-z ]+?) \| /gm, (_match, name: string) => `|   ${name}   | `);
    await writeFile(file, padded, "utf8");

    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
    const record = workspace.records.find((candidate) => candidate.id === "FR-ARCH-001");
    const textFile = workspace.files.find((candidate) => candidate.relativePath.endsWith("10.product-architecture.srs.md"));
    if (!record || !textFile) throw new Error("fixture requirement missing");
    // The parser reads the padded row, so the helper must find it.
    expect(Object.keys(record.metadata)).toContain(field);
    const line = findMetadataLine(textFile, record, field);
    expect(line).toBeDefined();
    expect(textFile.lines[(line ?? 0) - 1]).toMatch(new RegExp(`^\\|\\s+${field}\\s+\\|`));
  });

  // @req IR-CLI-112 AC-3 — the helper reads only the metadata table, so a prose line that happens
  // to read exactly like a Field name is never mistaken for the row.
  it.each(FIELDS)("never matches a prose line reading %s when the metadata row is absent", async (field) => {
    const rootPath = await proseFixture(field);
    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
    const record = workspace.records.find((candidate) => candidate.id === "FR-ARCH-001");
    const textFile = workspace.files.find((candidate) => candidate.relativePath.endsWith("10.product-architecture.srs.md"));
    if (!record || !textFile) throw new Error("fixture requirement missing");
    expect(textFile.lines).toContain(field);
    expect(findMetadataLine(textFile, record, field)).toBeUndefined();
  });

  it("the caller cases cover every caller in the census", () => {
    expect([...new Set(CALLER_CASES.map((item) => item.caller))].sort()).toEqual(Object.keys(CALLER_FIELDS).sort());
  });

  // @req IR-CLI-112 AC-3 — every caller, with its row absent and a prose line named like it: the prose
  // line survives, and the caller does what it did before (setSupersede inserts the row; the rest
  // refuse, or, for the repair scan, find nothing to repair).
  it.each(CALLER_CASES)("$caller with $field absent keeps the prose line and its absent-row behaviour", async ({ field, run, expected }) => {
    const rootPath = await proseFixture(field);
    const outcome = await run(await resolveProjectRoot(rootPath));
    const after = (await readFile(path.join(rootPath, SPEC), "utf8")).replace(/\r\n/g, "\n");
    expect(after).toContain(`#### Rationale\n\n${field}\n`);
    expect(outcome).toBe(expected);
    if (expected === "inserted") expect(after).toMatch(new RegExp(`^\\| ${field} \\| FR-ARCH-002 \\|$`, "m"));
  });

  it("the duplicate-row cases cover every caller in the census", () => {
    expect([...new Set(METADATA_VALUE_CASES.map((item) => item.caller))].sort()).toEqual(Object.keys(CALLER_FIELDS).sort());
  });

  // @req IR-CLI-112 AC-3 — with a Field row written twice the parser keeps the last one, so the row a
  // caller edits must be that one: otherwise the call reports success and the parser reads no change.
  it.each(METADATA_VALUE_CASES)("$caller with $field written twice changes the value the parser reads", async ({ field, value, run }) => {
    const rootPath = await duplicateFixture(field);
    const root = await resolveProjectRoot(rootPath);
    const before = (await parseWorkspace(root)).records.find((record) => record.id === "FR-ARCH-001")?.metadata[field];
    expect(before).not.toContain(value);
    await run(root);
    const after = (await parseWorkspace(root)).records.find((record) => record.id === "FR-ARCH-001")?.metadata[field];
    expect(after).toContain(value);
  });
});

/**
 * The fixture with the field's metadata row written twice. Rows the fixture lacks (Supersedes,
 * Superseded By) are added twice with `-`. For the rules repair the second Related Docs row carries a
 * stale rules link and the installed rules document exists, so there is something to repair.
 */
async function duplicateFixture(field: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SPEC);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const existing = new RegExp(`^\\| ${field} \\| [^\\n]*$`, "m").exec(text)?.[0];
  const duplicated = existing
    ? text.replace(existing, `${existing}\n${existing}`)
    : text.replace("| Related Docs | - |", `| Related Docs | - |\n| ${field} | - |\n| ${field} | - |`);
  const seeded =
    field === "Related Docs" ? duplicated.replace("| Related Docs | - |\n| Related Docs | - |", `| Related Docs | - |\n| Related Docs | ${STALE_RULES_LINK} |`) : duplicated;
  await writeFile(file, seeded, "utf8");
  await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
  await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
  return rootPath;
}

type Outcome = "inserted" | "refused" | "nothing-to-repair";
const refusal = (result: { ok: boolean; error?: { code?: string } }): Outcome | string =>
  result.ok ? "ok" : result.error?.code === "MUTATION_DENIED" ? "refused" : String(result.error?.code);

const CALLER_CASES: { caller: string; field: string; expected: Outcome; run: (root: ProjectRoot) => Promise<string> }[] = [
  { caller: "add-related-doc.ts", field: "Related Docs", expected: "refused", run: async (root) => refusal(await addRelatedDoc(root, { id: "FR-ARCH-001", reference: "docs/x.md", dryRun: false })) },
  { caller: "add-trace.ts", field: "Supersedes", expected: "inserted", run: async (root) => ((await setSupersede(root, { id: "FR-ARCH-001", supersedes: "FR-ARCH-002", dryRun: false })).ok ? "inserted" : "failed") },
  { caller: "add-trace.ts", field: "Superseded By", expected: "inserted", run: async (root) => ((await setSupersede(root, { id: "FR-ARCH-001", supersededBy: "FR-ARCH-002", dryRun: false })).ok ? "inserted" : "failed") },
  { caller: "edit-requirement.ts", field: "Priority", expected: "refused", run: async (root) => refusal(await updateRequirementFields(root, { id: "FR-ARCH-001", priority: "low", dryRun: false })) },
  { caller: "edit-requirement.ts", field: "Risk", expected: "refused", run: async (root) => refusal(await updateRequirementFields(root, { id: "FR-ARCH-001", risk: "high", dryRun: false })) },
  { caller: "edit-requirement.ts", field: "Tags", expected: "refused", run: async (root) => refusal(await updateRequirementFields(root, { id: "FR-ARCH-001", tags: ["x"], dryRun: false })) },
  { caller: "edit-requirement.ts", field: "Related Docs", expected: "refused", run: async (root) => refusal(await updateRequirementFields(root, { id: "FR-ARCH-001", relatedDocs: ["docs/x.md"], dryRun: false })) },
  {
    caller: "repair-rules-references.ts",
    field: "Related Docs",
    expected: "nothing-to-repair",
    run: async (root) => {
      const result = await repairRulesReferences(root, { apply: true });
      return result.ok && JSON.stringify(result.value ?? {}).includes("FR-ARCH-001") === false ? "nothing-to-repair" : "touched";
    }
  },
  {
    caller: "rename-target.ts",
    field: "Target",
    expected: "nothing-to-repair",
    run: async (root) => {
      // With no Target row the requirement names no target, so a rename finds no requirement row to write.
      const result = await renameTarget(root, { from: "v1.0.0", to: "v9.0.0", dryRun: false });
      return result.ok && !result.value?.locations.some((item) => item.kind === "requirement-target") ? "nothing-to-repair" : "touched";
    }
  },
  { caller: "retarget.ts", field: "Target", expected: "refused", run: async (root) => refusal(await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false })) },
  { caller: "update-field.ts", field: "Priority", expected: "refused", run: async (root) => refusal(await updateField(root, { id: "FR-ARCH-001", field: "priority", value: "low" })) },
  { caller: "update-field.ts", field: "Risk", expected: "refused", run: async (root) => refusal(await updateField(root, { id: "FR-ARCH-001", field: "risk", value: "high" })) },
  { caller: "update-field.ts", field: "Target", expected: "refused", run: async (root) => refusal(await updateField(root, { id: "FR-ARCH-001", field: "target", value: "v1.1.0" })) },
  { caller: "update-field.ts", field: "Verification Method", expected: "refused", run: async (root) => refusal(await updateField(root, { id: "FR-ARCH-001", field: "verification-method", value: "review" })) },
  { caller: "update-stability.ts", field: "Stability", expected: "refused", run: async (root) => refusal(await updateStability(root, { id: "FR-ARCH-001", stability: "evolving", reason: "probe", dryRun: false })) },
  { caller: "update-status.ts", field: "Status", expected: "refused", run: async (root) => refusal(await updateStatus(root, { id: "FR-ARCH-001", status: "in_progress", dryRun: false })) }
];

/** The fixture with the field's metadata row removed and a Rationale paragraph reading exactly the field name. */
async function proseFixture(field: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SPEC);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const withoutRow = text.replace(new RegExp(`^\\| ${field} \\| [^\\n]*\\n`, "m"), "");
  await writeFile(file, withoutRow.replace("Mutation tests need a stable target.", field), "utf8");
  return rootPath;
}
