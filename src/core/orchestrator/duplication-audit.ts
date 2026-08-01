// @req FR-NODE-135 — the cross-lane duplication auditor (05 §7.9 (b)).
//
// §1.1's boundary rule splits this in two: the tool constructs candidates mechanically, and the
// subagent judges them. Near-duplicate classification is judgment, so nothing here classifies — the
// verdict and the resolution arrive already recorded, and the gate checks only that a verdict from
// the closed enum is present and that a `duplicate` row's resolution is one that has actually forced
// the consolidation. A note is not a resolution.

import type { GateId } from "./auto-gate.js";

/** The verdict vocabulary a subagent records onto a candidate row. */
export const AUDIT_VERDICTS = ["duplicate", "parallel-evolution", "acceptable"] as const;

export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

export interface LaneDiff {
  laneId: string;
  paths: string[];
  base: string;
  head: string;
  addedBlocks: Array<{ path: string; normalizedHash: string; declName: string | null }>;
}

/**
 * One row of `duplication-audit.md`.
 *
 * `verdict` is nullable because `planDuplicationAudit` emits the row *before* the judgment exists;
 * §10.1 declares the artifact row's verdict as the three-value enum, and null is the state between
 * construction at 3.k and the subagent's recorded verdict.
 */
export interface AuditRow {
  symbolOrBlock: string;
  lanes: string[];
  paths: string[];
  verdict: AuditVerdict | null;
  resolutionTaskId: string | null;
}

export interface DuplicationGateContext {
  /** This wave's frozen `serial_epilogue ∪ unassigned ∪ demoted` set, fixed in `lanes.lock.json` at 3.e. */
  frozenEpilogueTaskIds: string[];
  /** The members of that set 3.k activity (0) has already executed, before the audit runs. */
  ranEpilogueTaskIds: string[];
}

export interface DuplicationViolation {
  gate: GateId;
  symbolOrBlock: string;
  detail: string;
}

export interface DuplicationGateResult {
  ok: boolean;
  violations: DuplicationViolation[];
}

const GATE: GateId = "cross-lane-duplication-unresolved";

/** The one verdict the gate acts on. Naming it here keeps the candidate constructor free of verdicts. */
const DUPLICATE: AuditVerdict = "duplicate";

/** `issue:{id}` — a `local-defect` row opened in this wave's ledger, whose proof is a commit sha. */
const ISSUE_REFERENCE = /^issue:\S+$/;

function normaliseDeclName(declName: string | null): string | null {
  const trimmed = declName?.trim() ?? "";
  return trimmed === "" ? null : trimmed.toLowerCase();
}

function candidate(key: string, contributions: Array<{ laneId: string; path: string }>): AuditRow | null {
  const lanes = [...new Set(contributions.map((entry) => entry.laneId))].sort();
  if (lanes.length < 2) return null;
  const paths = [...new Set(contributions.map((entry) => entry.path))].sort();
  return { symbolOrBlock: key, lanes, paths, verdict: null, resolutionTaskId: null };
}

/**
 * @req FR-NODE-135 — a pure candidate constructor over the union of a wave's diffs.
 *
 * Two lanes contributing an added block with the same `normalizedHash` is one candidate; two lanes
 * contributing an added top-level declaration sharing a normalised `declName` is one candidate;
 * nothing else is a candidate. `writeSets` restricts the input to the union of every lane's declared
 * write set, which is the input §7.9 (b) names for both phases.
 */
export function planDuplicationAudit(laneDiffs: LaneDiff[], writeSets: Record<string, string[]>): AuditRow[] {
  const byHash = new Map<string, Array<{ laneId: string; path: string }>>();
  const byDeclName = new Map<string, Array<{ laneId: string; path: string }>>();

  for (const diff of laneDiffs) {
    const declared = new Set(writeSets[diff.laneId] ?? []);
    for (const block of diff.addedBlocks) {
      if (!declared.has(block.path)) continue;
      const contribution = { laneId: diff.laneId, path: block.path };

      const hashGroup = byHash.get(block.normalizedHash) ?? [];
      hashGroup.push(contribution);
      byHash.set(block.normalizedHash, hashGroup);

      const declName = normaliseDeclName(block.declName);
      if (declName === null) continue;
      const declGroup = byDeclName.get(declName) ?? [];
      declGroup.push(contribution);
      byDeclName.set(declName, declGroup);
    }
  }

  const rows: AuditRow[] = [];
  for (const [key, contributions] of [...byHash.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const row = candidate(key, contributions);
    if (row) rows.push(row);
  }
  for (const [key, contributions] of [...byDeclName.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const row = candidate(key, contributions);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * @req FR-NODE-135 — the gate `cross-lane-duplication-unresolved`.
 *
 * Because 3.k executes the epilogue task set at activity (0) *before* this audit runs, and there is
 * no second epilogue pass afterwards, a `duplicate` row cannot name a member of this wave's frozen
 * epilogue set that has yet to run. It takes either the id of an epilogue task that already ran, or
 * an `issue:{id}` reference, whose `P-WAVE-ISSUES-CLOSED` proof is a commit sha and therefore forces
 * the consolidation before the next wave's 3.a.
 */
export function checkDuplicationResolved(rows: AuditRow[], context: DuplicationGateContext): DuplicationGateResult {
  const violations: DuplicationViolation[] = [];
  const ran = new Set(context.ranEpilogueTaskIds);
  const frozen = new Set(context.frozenEpilogueTaskIds);

  for (const row of rows) {
    if (row.verdict === null || !(AUDIT_VERDICTS as readonly string[]).includes(row.verdict)) {
      violations.push({ gate: GATE, symbolOrBlock: row.symbolOrBlock, detail: "candidate carries no verdict from the closed enum" });
      continue;
    }
    if (row.verdict !== DUPLICATE) continue;

    const resolution = row.resolutionTaskId;
    if (resolution === null || resolution.trim() === "") {
      violations.push({ gate: GATE, symbolOrBlock: row.symbolOrBlock, detail: "duplicate row carries no resolution" });
      continue;
    }
    if (ISSUE_REFERENCE.test(resolution) || ran.has(resolution)) continue;

    const detail = frozen.has(resolution)
      ? `resolution ${resolution} is an epilogue task of this wave that has not run`
      : `resolution ${resolution} is neither an executed epilogue task id nor an issue reference`;
    violations.push({ gate: GATE, symbolOrBlock: row.symbolOrBlock, detail });
  }

  return { ok: violations.length === 0, violations };
}
