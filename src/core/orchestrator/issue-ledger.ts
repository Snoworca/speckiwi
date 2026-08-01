// @req FR-NODE-123 — the wave-boundary issue ledger (05 §8).
//
// The charter's rule is that issues "must not be carried silently into the next stage"; §8 turns it
// into `P-WAVE-ISSUES-CLOSED`, the precondition on the next wave's Phase 3.a. All five predicates
// return the same `{ok, violations[]}` shape `validateHandoff` uses, and the two that verify a
// resolution take the injected set the reference is resolved *against* — without it a "resolvable
// evidence pointer" degrades to a shape check that any forty-hex string satisfies, which would void
// the duplication audit's `issue:{id}` discharge.

/** §8's closed classification list. Every issue receives exactly one. */
export const ISSUE_CLASSES = ["local-defect", "missing-task", "design-gap", "new-wave-required", "design-contradiction", "out-of-run"] as const;

export type IssueClass = (typeof ISSUE_CLASSES)[number];

/**
 * The closed `reason_class` vocabulary (`waves-event.md:92`, plus v1.4.0's two additive values).
 *
 * A deferral records *why* an issue was held as a classification rather than as free text.
 */
export const DEFERRAL_REASON_CLASSES = [
  "draft-stability-skip",
  "task-failure-skip",
  "scope-boundary-deferred",
  "srs-level-unclosable",
  "design-gap",
  "cross-wave-carry-forward",
  "oscillation",
  "budget-exhausted"
] as const;

export type DeferralReasonClass = (typeof DEFERRAL_REASON_CLASSES)[number];

/** One kind per member of the injected resolution set. */
export const RESOLUTION_KINDS = ["path", "file-line", "test-id", "commit-sha"] as const;

export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

/** A parsed `issues.md` row, in the shape `issues.lock.json` records (§3.3a). */
export interface IssueRow {
  issueId: string;
  wave: number;
  class: string | null;
  source: string;
  resolutionKind: string | null;
  resolutionRef: string | null;
  /** §8's recorded user decision, required by `out-of-run` and `new-wave-required`. */
  userDecisionRef: string | null;
  /** §8's `design-gap` proof: the digest of the new design lock the amendment produced. */
  designLockDigest: string | null;
  deferralReason: string | null;
}

export interface ResolutionProof {
  kind: string;
  ref: string;
}

/**
 * The facts a `resolution_ref` is checked against, one member per {@link RESOLUTION_KINDS} value.
 *
 * Injected because the ledger is pure: the impure collection stays in the CLI, exactly as it does
 * for `groundFiles` and `validateHandoff`.
 */
export interface ResolutionSet {
  existingPaths: string[];
  lineCounts: Record<string, number>;
  testIds: string[];
  commitShas: string[];
}

export interface LedgerViolation {
  code: string;
  issueId: string;
  detail: string;
}

export interface LedgerResult {
  ok: boolean;
  violations: LedgerViolation[];
}

const WAVE_ISSUES_CLOSED = "P-WAVE-ISSUES-CLOSED";

function result(violations: LedgerViolation[]): LedgerResult {
  return { ok: violations.length === 0, violations };
}

function isIssueClass(value: string | null): value is IssueClass {
  return value !== null && (ISSUE_CLASSES as readonly string[]).includes(value);
}

/** Whether a reference resolves against the injected set, by kind. */
function resolves(proof: ResolutionProof, resolution: ResolutionSet): boolean {
  switch (proof.kind) {
    case "path":
      return resolution.existingPaths.includes(proof.ref);
    case "file-line": {
      const separator = proof.ref.lastIndexOf(":");
      if (separator < 0) return false;
      const filePath = proof.ref.slice(0, separator);
      const line = Number(proof.ref.slice(separator + 1));
      if (!Number.isInteger(line) || line < 1) return false;
      const count = resolution.lineCounts[filePath];
      return count !== undefined && line <= count;
    }
    case "test-id":
      return resolution.testIds.includes(proof.ref);
    case "commit-sha":
      return resolution.commitShas.includes(proof.ref);
    default:
      return false;
  }
}

/** @req FR-NODE-123 AC-5 — the classification comes from the closed six-value list. */
export function openIssue(ledger: IssueRow[], row: IssueRow): LedgerResult {
  const violations: LedgerViolation[] = [];
  if (!isIssueClass(row.class)) violations.push({ code: "issue-class-invalid", issueId: row.issueId, detail: `classification ${row.class ?? "(none)"} is outside the closed list` });
  if (ledger.some((existing) => existing.issueId === row.issueId)) violations.push({ code: "issue-id-duplicate", issueId: row.issueId, detail: "the ledger already carries this issue id" });
  return result(violations);
}

/** Re-classification of an issue already in the ledger, into the same closed list. */
export function planIssue(ledger: IssueRow[], id: string, issueClass: string): LedgerResult {
  const violations: LedgerViolation[] = [];
  if (!ledger.some((row) => row.issueId === id)) violations.push({ code: "issue-not-found", issueId: id, detail: "no such issue in the ledger" });
  if (!isIssueClass(issueClass)) violations.push({ code: "issue-class-invalid", issueId: id, detail: `classification ${issueClass} is outside the closed list` });
  return result(violations);
}

/**
 * @req FR-NODE-123 AC-2, AC-3 — the reference must resolve, not merely be well-shaped. A
 * syntactically perfect forty-hex sha that names no commit in the injected set is refused.
 */
export function resolveIssue(ledger: IssueRow[], id: string, proof: ResolutionProof, resolution: ResolutionSet): LedgerResult {
  const violations: LedgerViolation[] = [];
  if (!ledger.some((row) => row.issueId === id)) violations.push({ code: "issue-not-found", issueId: id, detail: "no such issue in the ledger" });
  if (!(RESOLUTION_KINDS as readonly string[]).includes(proof.kind)) {
    violations.push({ code: "resolution-kind-invalid", issueId: id, detail: `resolution kind ${proof.kind} is outside the closed list` });
  } else if (!resolves(proof, resolution)) {
    violations.push({ code: "resolution-unresolvable", issueId: id, detail: `${proof.kind} reference ${proof.ref} does not resolve against the injected resolution set` });
  }
  return result(violations);
}

/** @req FR-NODE-123 AC-4 — a deferral names a member of the closed `reason_class` vocabulary. */
export function deferIssue(ledger: IssueRow[], id: string, reason: string): LedgerResult {
  const violations: LedgerViolation[] = [];
  if (!ledger.some((row) => row.issueId === id)) violations.push({ code: "issue-not-found", issueId: id, detail: "no such issue in the ledger" });
  if (!(DEFERRAL_REASON_CLASSES as readonly string[]).includes(reason)) {
    violations.push({ code: "deferral-reason-invalid", issueId: id, detail: `deferral reason ${reason} is outside the closed reason_class vocabulary` });
  }
  return result(violations);
}

/**
 * @req FR-NODE-123 AC-6, AC-7 — `P-WAVE-ISSUES-CLOSED`, evaluated over exactly the named wave's rows.
 *
 * There is no run-mode argument, and that is the mechanism rather than the omission: `out-of-run`
 * requires a recorded user decision **even under `--auto`**, on the same rule that governs
 * `out_of_scope` at the coverage gate, so no call site can grant it by passing a flag.
 */
export function closeWave(ledger: IssueRow[], wave: number, resolution: ResolutionSet): LedgerResult {
  const violations: LedgerViolation[] = [];

  for (const row of ledger.filter((entry) => entry.wave === wave)) {
    if (!isIssueClass(row.class)) {
      violations.push({ code: WAVE_ISSUES_CLOSED, issueId: row.issueId, detail: "issue carries no terminal classification" });
      continue;
    }

    if (row.class === "local-defect" || row.class === "missing-task") {
      if (row.resolutionKind === null || row.resolutionRef === null) {
        violations.push({ code: WAVE_ISSUES_CLOSED, issueId: row.issueId, detail: `${row.class} carries no resolution proof` });
      } else if (!resolveIssue(ledger, row.issueId, { kind: row.resolutionKind, ref: row.resolutionRef }, resolution).ok) {
        violations.push({ code: WAVE_ISSUES_CLOSED, issueId: row.issueId, detail: `${row.class} carries a resolution proof that does not resolve` });
      }
    }

    if (row.class === "design-gap" && (row.designLockDigest === null || row.designLockDigest.trim() === "")) {
      violations.push({ code: WAVE_ISSUES_CLOSED, issueId: row.issueId, detail: "design-gap names no new design lock digest" });
    }

    if ((row.class === "out-of-run" || row.class === "new-wave-required") && (row.userDecisionRef === null || row.userDecisionRef.trim() === "")) {
      violations.push({ code: WAVE_ISSUES_CLOSED, issueId: row.issueId, detail: `${row.class} carries no recorded user decision` });
    }
  }

  return result(violations);
}
