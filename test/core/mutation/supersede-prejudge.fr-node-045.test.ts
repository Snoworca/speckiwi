import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-045 — supersede runs T1 (mint the successor), T2 (discard the old requirement) and the
// compatibility revocations in order. Every refusal any of them has is judged before the first write,
// so a refused supersede leaves every document as it was (no successor minted), and its dry run
// reports the same refusal as the real run.

const SPEC = path.join("docs", "spec");
const SCOPE = path.join(SPEC, "10.product-architecture.srs.md");
const INPUT = { oldId: "FR-ARCH-001", scope: "ARCH", target: "v1.0.0", title: "Next", statement: "The system shall next.", acceptanceCriteria: ["next"] };

async function specSnapshot(rootPath: string): Promise<Record<string, string>> {
  const entries = await readdir(path.join(rootPath, SPEC), { recursive: true, withFileTypes: true });
  const snapshot: Record<string, string> = {};
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const file = path.join(entry.parentPath, entry.name);
    snapshot[path.relative(rootPath, file)] = await readFile(file, "utf8");
  }
  return snapshot;
}

/** FR-ARCH-001 holding two checked_compatible rows for one peer: its revocation is refused as ambiguous. */
async function withAmbiguousCompatibility(rootPath: string): Promise<void> {
  const file = path.join(rootPath, SCOPE);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const header = "#### Trace Links\n\n| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n";
  const row = "| Requirement | FR-ARCH-009 | checked_compatible | fpv: 1 |\n";
  expect(text).toContain(header);
  await writeFile(file, text.replace(header, header + row + row), "utf8");
}

const REFUSALS = [
  { name: "the discard guard (stable requirement, no confirmation)", setup: async () => {}, input: {}, message: /Cannot discard protected requirement FR-ARCH-001/ },
  { name: "an ambiguous compatibility row", setup: withAmbiguousCompatibility, input: { confirmDiscardVerified: true }, message: /Ambiguous compatibility check/ }
] as const;

describe("FR-NODE-045 supersede judges every step's refusal before it writes", () => {
  // @req FR-NODE-045 AC-3
  it.each(REFUSALS)("refused by $name: nothing written, and the dry run reports the same refusal", async ({ setup, input, message }) => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await setup(rootPath);
    const root = await resolveProjectRoot(rootPath);
    const before = await specSnapshot(rootPath);

    const dry = await supersedeRequirement(root, { ...INPUT, ...input, dryRun: true });
    const real = await supersedeRequirement(root, { ...INPUT, ...input });

    expect(real.ok).toBe(false);
    expect(real.error?.message).toMatch(message);
    expect({ ok: dry.ok, code: dry.error?.code, message: dry.error?.message }).toEqual({ ok: real.ok, code: real.error?.code, message: real.error?.message });
    expect(await specSnapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-045 AC-1
  it("a supersede no step refuses still mints the successor and discards the old requirement", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await supersedeRequirement(root, { ...INPUT, confirmDiscardVerified: true });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const records = (await parseWorkspace(root)).records;
    expect(records.find((record) => record.id === "FR-ARCH-001")?.status).toBe("discarded");
    expect(records.filter((record) => record.traceLinks.some((link) => link.relation === "supersedes" && link.reference === "FR-ARCH-001")).map((record) => record.id)).toEqual([result.value?.newId]);
  });
});

describe("FR-NODE-045 supersede reports what its steps report", () => {
  // @req FR-NODE-045 AC-1
  it("carries each step's failed-rollup warning and the rollupSync failure into its own result", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const index = path.join(rootPath, SPEC, "00.index.md");
    const text = (await readFile(index, "utf8")).replace(/\r\n/g, "\n");
    expect(text).toContain("| planned | 1 |");
    // The planned row read cut: the sync after T1 (a new planned requirement) and after T2 (one fewer) both fail.
    await writeFile(index, text.replace("| planned | 1 |", "| planned \| x | 1 |"), "utf8");
    const result = await supersedeRequirement(await resolveProjectRoot(rootPath), { ...INPUT, confirmDiscardVerified: true });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.written).toBe(true);
    expect(result.rollupSync).toMatchObject({ ok: false, code: "MUTATION_DENIED" });
    // Both steps report the same warning; it is listed once, as the summary counts it.
    expect(result.diagnostics.filter((item) => item.code === "INDEX_ROLLUP_SYNC_FAILED")).toHaveLength(1);
    expect(result.diagnosticsSummary.byCode["INDEX_ROLLUP_SYNC_FAILED"]).toBe(1);
  });
});

describe("FR-NODE-045 supersede keeps each step's own warning", () => {
  // @req FR-NODE-045 AC-1
  it("lists T1's and T2's different rollup warnings, and reports T1's failure as rollupSync", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const index = path.join(rootPath, SPEC, "00.index.md");
    const text = (await readFile(index, "utf8")).replace(/\r\n/g, "\n");
    expect(text).toContain("| planned | 1 |");
    expect(text).toContain("| functional | FR | 1 |");
    // Cut rows: functional changes only in T1 (a new requirement); discarded only in T2 (the old one).
    await writeFile(index, text.replace("| planned | 1 |", "| planned | 1 |\n| discarded | 0 | note |").replace("| functional | FR | 1 |", "| functional | FR | 1 | note |"), "utf8");
    const result = await supersedeRequirement(await resolveProjectRoot(rootPath), { ...INPUT, confirmDiscardVerified: true });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const warnings = result.diagnostics.filter((item) => item.code === "INDEX_ROLLUP_SYNC_FAILED").map((item) => item.message);
    expect(warnings).toEqual([expect.stringMatching(/Requirement Type Summary/), expect.stringMatching(/Status Summary/)]);
    expect(result.rollupSync?.message).toMatch(/Requirement Type Summary/);
  });
});
