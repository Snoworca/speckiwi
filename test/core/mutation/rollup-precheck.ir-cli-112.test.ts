import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addRequirement, promoteStepRequirement } from "../../../src/core/mutation/add-requirement.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import type { MutationResult } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-112 — the mutations that run the index rollup sync after their own write (add_requirement,
// promote_step_requirement, update_status) never write and then report failure, since a retry would
// then mint a duplicate requirement. What makes the sync refuse whatever the counts are (a rollup table
// without its key or Count column) is settled before anything is written: they refuse with every file
// untouched, in dry run as in apply. What depends on the counts (a cut row the sync has to rewrite) is
// left to the sync after the write; when it fails there, the change stays written, the result is ok,
// and `rollupSync` plus a warning say the rollups were not updated and how to catch up.

const SPEC = path.join("docs", "spec");
const INDEX = path.join(SPEC, "00.index.md");

const STATUS_TABLE = "| Status | Count |\n|---|---:|\n| planned | 1 |";
const TYPE_TABLE = "| Type | Prefix | Count |\n|---|---|---:|\n| functional | FR | 1 |";

/** Index edits that leave a rollup table the sync cannot write, and the table each one names. */
const UNWRITABLE = [
  { name: "Status Summary without a Count column", from: STATUS_TABLE, to: "| Status | count |\n|---|---:|\n| planned | 1 |", names: /Status Summary.*Count/ },
  { name: "Status Summary without its Status column", from: STATUS_TABLE, to: "| State | Count |\n|---|---:|\n| planned | 1 |", names: /Status Summary.*Status/ },
  { name: "Type Summary without a Count column", from: TYPE_TABLE, to: "| Type | Prefix | Total |\n|---|---|---:|\n| functional | FR | 1 |", names: /Requirement Type Summary.*Count/ },
] as const;

/** A Status Summary whose planned row is read cut: every caller changes the planned count, so the sync must rewrite it. */
const CUT_PLANNED = "| Status | Count |\n|---|---:|\n| planned \\| x | 1 |";
/** A cut row whose count no caller changes: the sync leaves it alone. */
const CUT_UNTOUCHED = "| Status | Count |\n|---|---:|\n| planned | 1 |\n| verified | 0 | note |";

async function readLf(file: string): Promise<string> {
  return (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
}

async function editIndex(rootPath: string, from: string, to: string): Promise<void> {
  const file = path.join(rootPath, INDEX);
  const text = await readLf(file);
  expect(text).toContain(from);
  await writeFile(file, text.replace(from, to), "utf8");
}

/** Every file under docs/spec, by relative path, so "nothing was written" covers each of them. */
async function specSnapshot(rootPath: string): Promise<Record<string, string>> {
  const entries = await readdir(path.join(rootPath, SPEC), { recursive: true, withFileTypes: true });
  const snapshot: Record<string, string> = {};
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const file = path.join(entry.parentPath, entry.name);
    snapshot[path.relative(rootPath, file)] = await readFile(file, "utf8");
  }
  return snapshot;
}

async function writeStep(rootPath: string, id: string): Promise<void> {
  const dir = path.join(rootPath, SPEC, "steps", "feature-x");
  await mkdir(dir, { recursive: true });
  const block = [
    `### ${id} — Step requirement`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "| Priority | high |",
    "| Stability | evolving |",
    "| Verification Method | test |",
    "",
    "#### Requirement",
    "",
    `Step-scoped requirement ${id}.`,
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Step criterion.",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-11-04 | Created | Fixture |"
  ];
  const header = ["# Step Architecture", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", "| Scope | ARCH |", "| Scope Name | Product Architecture |", "", "## 4. Requirements", ""];
  await writeFile(path.join(dir, "10.product-architecture.srs.md"), [...header, ...block].join("\n"), "utf8");
}

const STEP_ID = "FR-ARCH-611";

/** The three callers, each run against a prepared copy, in dry run or apply. */
const CALLERS = {
  add_requirement: (rootPath: string, dryRun: boolean) =>
    resolveProjectRoot(rootPath).then((root) =>
      addRequirement(root, { type: "functional", scope: "ARCH", target: "v1.0.0", title: "Probe", statement: "The system shall probe.", acceptanceCriteria: ["probe"], dryRun })
    ),
  promote_step_requirement: (rootPath: string, dryRun: boolean) =>
    resolveProjectRoot(rootPath).then((root) => promoteStepRequirement(root, { id: STEP_ID, fromStep: "feature-x", toScope: "ARCH", dryRun })),
  update_status: (rootPath: string, dryRun: boolean) =>
    resolveProjectRoot(rootPath).then((root) => updateStatus(root, { id: "FR-ARCH-001", status: "in_progress", dryRun }))
} satisfies Record<string, (rootPath: string, dryRun: boolean) => Promise<MutationResult<unknown>>>;

async function prepared(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  await writeStep(rootPath, STEP_ID);
  return rootPath;
}

describe("IR-CLI-112 a mutation followed by the rollup sync refuses before it writes", () => {
  const cases = Object.keys(CALLERS).flatMap((caller) => UNWRITABLE.flatMap((index) => [false, true].map((dryRun) => ({ caller, index, dryRun }))));

  // @req IR-CLI-112 AC-1
  it.each(cases)("$caller refuses on an index with $index.name (dryRun $dryRun), with nothing written", async ({ caller, index, dryRun }) => {
    const rootPath = await prepared();
    await editIndex(rootPath, index.from, index.to);
    const before = await specSnapshot(rootPath);

    const result = await CALLERS[caller as keyof typeof CALLERS](rootPath, dryRun);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_DENIED");
    expect(result.error?.message).toMatch(index.names);
    expect(await specSnapshot(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-1
  it.each(Object.keys(CALLERS))("%s still writes, and syncs, when the Type Summary leaves out its optional Prefix column", async (caller) => {
    const rootPath = await prepared();
    await editIndex(rootPath, TYPE_TABLE, "| Type | Count |\n|---|---:|\n| functional | 1 |");

    const result = await CALLERS[caller as keyof typeof CALLERS](rootPath, false);

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
    const statusCount = (status: string) => workspace.records.filter((record) => record.status === status).length;
    const index = await readLf(path.join(rootPath, INDEX));
    for (const status of ["planned", "in_progress"]) {
      if (statusCount(status) > 0) expect(index).toContain(`| ${status} | ${statusCount(status)} |`);
    }
    expect(index).toContain(`| functional | ${workspace.records.length} |`);
  });
});

describe("IR-CLI-112 a rollup sync that fails after the write is reported, not turned into a failure", () => {
  // @req IR-CLI-112 AC-1
  it.each(Object.keys(CALLERS))("%s keeps its written change, reports ok, and says the rollups need a sync-index", async (caller) => {
    const rootPath = await prepared();
    await editIndex(rootPath, STATUS_TABLE, CUT_PLANNED);
    const before = await specSnapshot(rootPath);

    const result = await CALLERS[caller as keyof typeof CALLERS](rootPath, false);

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.rollupSync).toMatchObject({ ok: false, code: "MUTATION_DENIED", message: expect.stringMatching(/Status Summary/) });
    expect(result.indexSync).toBeUndefined();
    const warning = result.diagnostics.find((item) => item.code === "INDEX_ROLLUP_SYNC_FAILED");
    expect(warning).toMatchObject({ severity: "warning", message: expect.stringMatching(/was written.*speckiwi sync-index/) });
    const after = await specSnapshot(rootPath);
    const changed = Object.keys(after).filter((file) => after[file] !== before[file]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed).not.toContain(INDEX);
  });

  // @req IR-CLI-112 AC-1
  it.each(Object.keys(CALLERS))("%s in dry run reports ok with nothing written and no sync attempted", async (caller) => {
    const rootPath = await prepared();
    await editIndex(rootPath, STATUS_TABLE, CUT_PLANNED);
    const before = await specSnapshot(rootPath);

    const result = await CALLERS[caller as keyof typeof CALLERS](rootPath, true);

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.rollupSync).toBeUndefined();
    expect(await specSnapshot(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-1
  it.each(Object.keys(CALLERS))("%s is not refused for a cut row the sync never has to rewrite", async (caller) => {
    const rootPath = await prepared();
    await editIndex(rootPath, STATUS_TABLE, CUT_UNTOUCHED);

    const result = await CALLERS[caller as keyof typeof CALLERS](rootPath, false);

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.rollupSync).toBeUndefined();
    expect(result.indexSync).toBeDefined();
    expect(await readLf(path.join(rootPath, INDEX))).toContain("| verified | 0 | note |");
  });
});

describe("IR-CLI-112 a status change that changes nothing", () => {
  // @req IR-CLI-112 AC-1
  it("update_status to the current status writes nothing and runs no rollup sync", async () => {
    const rootPath = await prepared();
    // A stale count the sync would rewrite, if it ran.
    await editIndex(rootPath, STATUS_TABLE, "| Status | Count |\n|---|---:|\n| planned | 7 |");
    const before = await specSnapshot(rootPath);

    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", status: "planned" });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((result.value as { written?: boolean }).written).toBe(false);
    expect(result.indexSync).toBeUndefined();
    expect(await specSnapshot(rootPath)).toEqual(before);
  });
});
