// FR-NODE-135 — the duplication auditor's pure candidate constructor, and the gate over the
// verdicts a subagent records onto it (05 §7.9 (b), §1.1's boundary rule).
//
// The tool constructs candidates mechanically; near-duplicate classification is judgment and stays
// with the subagent. The gate checks only that a verdict from the closed enum was recorded, and that
// a `duplicate` row's resolution is one that has actually forced the consolidation.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  checkDuplicationResolved,
  planDuplicationAudit,
  AUDIT_VERDICTS,
  type AuditRow,
  type DuplicationGateContext,
  type LaneDiff
} from "../../../src/core/orchestrator/duplication-audit.js";
import { at } from "../../support/at.js";

const MODULE_SOURCE = "src/core/orchestrator/duplication-audit.ts";

const WRITE_SETS: Record<string, string[]> = {
  "lane-1": ["src/core/orchestrator/a.ts"],
  "lane-2": ["src/core/orchestrator/b.ts"]
};

function diff(laneId: string, blocks: Array<{ path: string; normalizedHash: string; declName: string | null }>): LaneDiff {
  return { laneId, paths: blocks.map((block) => block.path), base: "base", head: `${laneId}-head`, addedBlocks: blocks };
}

describe("FR-NODE-135 AC-1 — two lanes sharing a normalized hash produce one row", () => {
  it("names both lanes and both paths", () => {
    const rows = planDuplicationAudit(
      [diff("lane-1", [{ path: "src/core/orchestrator/a.ts", normalizedHash: "h1", declName: null }]), diff("lane-2", [{ path: "src/core/orchestrator/b.ts", normalizedHash: "h1", declName: null }])],
      WRITE_SETS
    );

    expect(rows).toHaveLength(1);
    expect(at(rows, 0).lanes).toEqual(["lane-1", "lane-2"]);
    expect(at(rows, 0).paths).toEqual(["src/core/orchestrator/a.ts", "src/core/orchestrator/b.ts"]);
    expect(at(rows, 0).verdict).toBeNull();
    expect(at(rows, 0).resolutionTaskId).toBeNull();
  });
});

describe("FR-NODE-135 AC-2 — two lanes sharing a normalized declaration name produce one row", () => {
  it("emits exactly one row", () => {
    const rows = planDuplicationAudit(
      [
        diff("lane-1", [{ path: "src/core/orchestrator/a.ts", normalizedHash: "h1", declName: "normalisePath" }]),
        diff("lane-2", [{ path: "src/core/orchestrator/b.ts", normalizedHash: "h2", declName: "NormalisePath" }])
      ],
      WRITE_SETS
    );

    expect(rows).toHaveLength(1);
    expect(at(rows, 0).symbolOrBlock).toBe("normalisepath");
    expect(at(rows, 0).lanes).toEqual(["lane-1", "lane-2"]);
  });
});

describe("FR-NODE-135 AC-3 — two fixtures produce zero rows", () => {
  it("produces none when one lane duplicates a block against itself", () => {
    const rows = planDuplicationAudit(
      [
        diff("lane-1", [
          { path: "src/core/orchestrator/a.ts", normalizedHash: "h1", declName: "helper" },
          { path: "src/core/orchestrator/a.ts", normalizedHash: "h1", declName: "helper" }
        ])
      ],
      WRITE_SETS
    );
    expect(rows).toEqual([]);
  });

  it("produces none when two lanes' added blocks differ in hash and in declaration name", () => {
    const rows = planDuplicationAudit(
      [
        diff("lane-1", [{ path: "src/core/orchestrator/a.ts", normalizedHash: "h1", declName: "alpha" }]),
        diff("lane-2", [{ path: "src/core/orchestrator/b.ts", normalizedHash: "h2", declName: "beta" }])
      ],
      WRITE_SETS
    );
    expect(rows).toEqual([]);
  });

  it("produces none for a block on a path outside the contributing lane's write set", () => {
    const rows = planDuplicationAudit(
      [diff("lane-1", [{ path: "src/core/orchestrator/a.ts", normalizedHash: "h1", declName: null }]), diff("lane-2", [{ path: "docs/notes/scratch.ts", normalizedHash: "h1", declName: null }])],
      WRITE_SETS
    );
    expect(rows).toEqual([]);
  });
});

describe("FR-NODE-135 AC-4 — the function is pure and deterministic", () => {
  it("returns byte-identical rows on two calls over the same input", () => {
    const laneDiffs = [
      diff("lane-2", [
        { path: "src/core/orchestrator/b.ts", normalizedHash: "h1", declName: "shared" },
        { path: "src/core/orchestrator/b.ts", normalizedHash: "h3", declName: "other" }
      ]),
      diff("lane-1", [{ path: "src/core/orchestrator/a.ts", normalizedHash: "h1", declName: "shared" }])
    ];

    const first = JSON.stringify(planDuplicationAudit(laneDiffs, WRITE_SETS));
    const second = JSON.stringify(planDuplicationAudit(laneDiffs, WRITE_SETS));
    expect(first).toBe(second);
    expect(JSON.parse(first)).not.toEqual([]);
  });
});

describe("FR-NODE-135 AC-5 — no input expresses a classification and no branch selects one", () => {
  it("declares a LaneDiff carrying no verdict field", () => {
    const fields: Record<keyof LaneDiff, true> = { laneId: true, paths: true, base: true, head: true, addedBlocks: true };
    expect(Object.keys(fields).sort()).toEqual(["addedBlocks", "base", "head", "laneId", "paths"]);
  });

  it("names no verdict anywhere inside the candidate constructor", async () => {
    const source = await readFile(MODULE_SOURCE, "utf8");
    const start = source.indexOf("export function planDuplicationAudit");
    const end = source.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const constructor = source.slice(start, end);
    expect(constructor).toContain("planDuplicationAudit");
    for (const verdict of AUDIT_VERDICTS) expect(constructor).not.toContain(verdict);
  });

  it("emits a null verdict for every candidate it constructs", () => {
    const rows = planDuplicationAudit(
      [diff("lane-1", [{ path: "src/core/orchestrator/a.ts", normalizedHash: "h1", declName: null }]), diff("lane-2", [{ path: "src/core/orchestrator/b.ts", normalizedHash: "h1", declName: null }])],
      WRITE_SETS
    );
    expect(rows.every((row) => row.verdict === null)).toBe(true);
  });
});

describe("FR-NODE-135 AC-6 — the gate requires a recorded verdict per candidate", () => {
  const context: DuplicationGateContext = { frozenEpilogueTaskIds: ["T-EP-01", "T-EP-02"], ranEpilogueTaskIds: ["T-EP-01"] };

  function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
    return { symbolOrBlock: "h1", lanes: ["lane-1", "lane-2"], paths: ["a.ts", "b.ts"], verdict: "acceptable", resolutionTaskId: null, ...overrides };
  }

  it("refuses a candidate carrying no verdict", () => {
    const result = checkDuplicationResolved([auditRow({ verdict: null })], context);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.gate)).toContain("cross-lane-duplication-unresolved");
  });

  it("refuses a candidate carrying a verdict outside the closed enum", () => {
    const result = checkDuplicationResolved([auditRow({ verdict: "probably-fine" as AuditRow["verdict"] })], context);
    expect(result.ok).toBe(false);
  });

  it("accepts a ledger in which every candidate carries a verdict from the enum", () => {
    const rows = [auditRow({ verdict: "acceptable" }), auditRow({ symbolOrBlock: "h2", verdict: "parallel-evolution" })];
    expect(checkDuplicationResolved(rows, context)).toEqual({ ok: true, violations: [] });
  });
});

describe("FR-NODE-135 AC-7 — what counts as a resolution for a duplicate row", () => {
  const context: DuplicationGateContext = { frozenEpilogueTaskIds: ["T-EP-01", "T-EP-02"], ranEpilogueTaskIds: ["T-EP-01"] };

  function duplicateRow(resolutionTaskId: string | null): AuditRow {
    return { symbolOrBlock: "h1", lanes: ["lane-1", "lane-2"], paths: ["a.ts", "b.ts"], verdict: "duplicate", resolutionTaskId };
  }

  it("refuses a duplicate row whose resolution task id is null", () => {
    expect(checkDuplicationResolved([duplicateRow(null)], context).ok).toBe(false);
  });

  it("refuses one naming a frozen epilogue task that has not run", () => {
    const result = checkDuplicationResolved([duplicateRow("T-EP-02")], context);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.gate)).toContain("cross-lane-duplication-unresolved");
  });

  it("accepts one naming an epilogue task that already ran", () => {
    expect(checkDuplicationResolved([duplicateRow("T-EP-01")], context).ok).toBe(true);
  });

  it("accepts an issue reference", () => {
    expect(checkDuplicationResolved([duplicateRow("issue:I-004")], context).ok).toBe(true);
  });

  it("refuses a note that is neither", () => {
    expect(checkDuplicationResolved([duplicateRow("we agreed to leave it")], context).ok).toBe(false);
  });
});
