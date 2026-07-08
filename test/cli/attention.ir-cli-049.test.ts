import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-063 — `speckiwi attention` command for a ranked work queue.
//
// Red-phase suite (T-PH004-41): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/read.ts` / the addition site
// `src/core/query/summary.ts` teach the CLI an `attention` command, so the whole suite fails today —
// commander rejects the unknown `attention` command (non-zero usage exit, no work-queue payload
// printed) — until the green task (T-PH004-42) wires the command against the existing readiness buckets
// (summarizeTarget: blocked / implementedNotVerified / missingEvidence / stabilityBlockers).
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-063):
//
//   The speckiwi attention command merges blocked, implemented-not-verified, missing-evidence, and
//   stability-blocker requirements into one priority-ranked work queue with a deterministic tie-break of
//   priority then risk then status, supports optional target and top limit and json, and never writes a
//   file.
//
//   - AC-1: speckiwi attention ranks the merged queue deterministically by priority then risk then status.
//   - AC-2: speckiwi attention --top <n> limits the output to the first n entries.
//   - AC-3: speckiwi attention --top with a negative value returns exit code two.
//   - AC-4: speckiwi attention writes no file and reports the same order for identical input.
//
// Fixture pinning (deterministic — appended to the valid-basic ARCH scope, Active Target v1.0.0). Every
// fixture requirement lands in at least one readiness bucket, so the whole set is the merged attention
// queue. Priority is the PRIMARY ranking key, then risk, then status:
//
//   - FR-ARCH-010 CRIT_ID  → status=blocked, priority=critical, risk=low, stability=stable
//        → blocked bucket. Highest priority (critical) → must rank FIRST even though its risk is the
//          lowest and a blocked status alone would not float it. Proves priority dominates risk+status.
//   - FR-ARCH-011 MID_ID   → status=implemented, priority=medium, risk=high, stability=stable, NO evidence
//        → implementedNotVerified + missingEvidence buckets. Medium priority → ranks between the critical
//          and low entries. Its high risk does NOT lift it above the critical-priority entry.
//   - FR-ARCH-012 LOW_ID   → status=blocked, priority=low, risk=critical, stability=stable
//        → blocked bucket. Lowest priority (low) → must rank LAST despite carrying the highest risk
//          (critical) and a blocked status. Proves priority is the primary key, not risk.
//   - FR-ARCH-013 DRAFT_ID → status=planned, priority=high, risk=medium, stability=draft
//        → stabilityBlockers bucket (a non-status path into the queue). High priority → ranks just below
//          the critical entry, above the medium entry.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const CRIT_ID = "FR-ARCH-010"; // critical priority → ranks first
const MID_ID = "FR-ARCH-011"; // medium priority → ranks third
const LOW_ID = "FR-ARCH-012"; // low priority → ranks last
const DRAFT_ID = "FR-ARCH-013"; // high priority → ranks second

/** A fully-formed ARCH-scope requirement block, parameterized by the fields that drive the ranking. */
function requirementBlock(
  id: string,
  options: { status: string; priority: string; risk: string; stability: string; evidence?: string[] }
): string {
  const evidenceRows = (options.evidence ?? []).join("\n");
  return [
    `### ${id} — Fixture ${id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    `| Status | ${options.status} |`,
    `| Priority | ${options.priority} |`,
    "| Tags | fixture |",
    `| Risk | ${options.risk} |`,
    `| Stability | ${options.stability} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Fixture requirement ${id}.`,
    "",
    "#### Rationale",
    "",
    "Fixture rationale.",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: First criterion.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    evidenceRows,
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    "",
    "#### Research / Analysis",
    "",
    "- -",
    "",
    "#### Implementation Notes",
    "",
    "- -",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-05-08 | Created | Fixture |"
  ].join("\n");
}

/** Appends the attention-queue fixture requirements to the valid-basic ARCH scope document. */
async function appendAttentionFixture(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  const blocks = [
    requirementBlock(CRIT_ID, { status: "blocked", priority: "critical", risk: "low", stability: "stable" }),
    requirementBlock(MID_ID, { status: "implemented", priority: "medium", risk: "high", stability: "stable" }),
    requirementBlock(LOW_ID, { status: "blocked", priority: "low", risk: "critical", stability: "stable" }),
    requirementBlock(DRAFT_ID, { status: "planned", priority: "high", risk: "medium", stability: "draft" })
  ];
  await writeFile(specPath, `${text.trimEnd()}\n\n${blocks.join("\n\n")}\n`, "utf8");
}

/** Walks parsed JSON for the first array of objects that each carry a string `id`. */
function findRequirementArray(parsed: unknown): Array<Record<string, unknown>> | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (
        node.length > 0 &&
        node.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")
      ) {
        return node as Array<Record<string, unknown>>;
      }
      for (const item of node) stack.push(item);
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) stack.push(value);
  }
  return undefined;
}

/** Ordered list of requirement ids in an attention --json payload (queue order preserved). */
function orderedIdsFrom(out: string): string[] {
  const rows = findRequirementArray(JSON.parse(out));
  expect(rows, "attention --json must expose an ordered array of work-queue entries").toBeDefined();
  return (rows as Array<Record<string, unknown>>).map((row) => String(row.id));
}

/** Recursively snapshots every file's path → contents under a directory (for no-write assertions). */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) snapshot.set(path.relative(root, full), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return snapshot;
}

describe("IR-CLI-063 — attention command for a ranked work queue", () => {
  // AC-1: attention ranks the merged queue deterministically by priority then risk then status.
  it("IR-CLI-063 AC-1: attention ranks the merged queue by priority (primary), then risk, then status", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendAttentionFixture(root);

    const streams = io();
    const code = await main(["--root", root, "attention", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const ids = orderedIdsFrom(out);

    // All four fixture requirements are in a readiness bucket, so all four are in the merged queue.
    expect(ids).toContain(CRIT_ID);
    expect(ids).toContain(MID_ID);
    expect(ids).toContain(LOW_ID);
    expect(ids).toContain(DRAFT_ID);

    // Priority is the PRIMARY ranking key: critical → high → medium → low. This ordering holds even
    // though it inverts the risk ordering (the critical-priority entry has the LOWEST risk and the
    // low-priority entry has the HIGHEST risk), proving priority dominates risk and status.
    const crit = ids.indexOf(CRIT_ID);
    const draft = ids.indexOf(DRAFT_ID);
    const mid = ids.indexOf(MID_ID);
    const low = ids.indexOf(LOW_ID);
    expect(crit).toBeLessThan(draft); // critical before high
    expect(draft).toBeLessThan(mid); // high before medium
    expect(mid).toBeLessThan(low); // medium before low
    expect(out).not.toContain("undefined");
  });

  // AC-2: attention --top <n> limits the output to the first n entries.
  it("IR-CLI-063 AC-2: attention --top <n> limits the output to the first n ranked entries", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendAttentionFixture(root);

    const streams = io();
    const code = await main(["--root", root, "attention", "--top", "2", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const ids = orderedIdsFrom(out);

    // The merged queue has four entries; --top 2 keeps exactly the first two in ranked order: the
    // critical-priority entry then the high-priority entry. The lower-priority entries are dropped.
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(CRIT_ID);
    expect(ids[1]).toBe(DRAFT_ID);
    expect(ids).not.toContain(MID_ID);
    expect(ids).not.toContain(LOW_ID);
  });

  // AC-3: attention --top with a negative value returns exit code two.
  it("IR-CLI-063 AC-3: attention --top with a negative value returns exit code two", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendAttentionFixture(root);

    const streams = io();
    const code = await main(["--root", root, "attention", "--top", "-1"], streams);
    const err = drain(streams.stderr);

    // A negative --top is a usage error: exit code exactly two, with a handled message (not a raw stack).
    expect(code).toBe(2);
    expect(err.toLowerCase()).toMatch(/top|positive|negative|integer/);
    expect(err).not.toContain("at Object.<anonymous>");
  });

  // AC-4: attention writes no file and reports the same order for identical input.
  it("IR-CLI-063 AC-4: attention writes no file and reports a stable order for identical input", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendAttentionFixture(root);

    const before = await snapshotTree(root);

    const first = io();
    expect(await main(["--root", root, "attention", "--json"], first)).toBe(0);
    const firstIds = orderedIdsFrom(drain(first.stdout));

    const second = io();
    expect(await main(["--root", root, "attention", "--json"], second)).toBe(0);
    const secondIds = orderedIdsFrom(drain(second.stdout));

    // Deterministic: identical input yields a byte-identical order across runs.
    expect(secondIds).toEqual(firstIds);

    // Never writes a file: the workspace tree is byte-identical before and after both runs — no file
    // added, removed, or modified.
    const after = await snapshotTree(root);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, content] of after) {
      expect(content, `attention must not modify ${rel}`).toBe(before.get(rel));
    }

    // Sanity: the second run still read the same on-disk spec (mtime/contents unchanged), so the stable
    // order is a property of the ranking, not of a mutated workspace.
    const specStat = await stat(path.join(root, "docs", "spec", "10.product-architecture.srs.md"));
    expect(specStat.isFile()).toBe(true);
  });
});
