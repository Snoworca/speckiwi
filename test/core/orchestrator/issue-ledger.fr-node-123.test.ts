// FR-NODE-123 — the wave-issue ledger's five predicates (05 §8, §10.1, §22.14 AF-20).
//
// `resolution` is the injected set a `resolution_ref` is resolved against. Without it the
// "resolvable evidence pointer" degrades to a shape check that any forty-hex string satisfies, and
// the `issue:{id}` discharge a duplication-audit row depends on rests on the proof forcing the
// consolidation rather than on its spelling.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as journalSchema from "../../../src/core/orchestrator/journal-schema.js";
import * as ledgerModule from "../../../src/core/orchestrator/issue-ledger.js";
import {
  closeWave,
  deferIssue,
  openIssue,
  planIssue,
  resolveIssue,
  DEFERRAL_REASON_CLASSES,
  ISSUE_CLASSES,
  RESOLUTION_KINDS,
  type IssueRow,
  type LedgerResult,
  type ResolutionSet
} from "../../../src/core/orchestrator/issue-ledger.js";

const MODULE_SOURCE = "src/core/orchestrator/issue-ledger.ts";

function row(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    issueId: "I-001",
    wave: 2,
    class: "local-defect",
    source: "loop-P residual",
    resolutionKind: "commit-sha",
    resolutionRef: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c",
    userDecisionRef: null,
    designLockDigest: null,
    deferralReason: null,
    ...overrides
  };
}

function resolution(overrides: Partial<ResolutionSet> = {}): ResolutionSet {
  return {
    existingPaths: ["src/core/orchestrator/lane-plan.ts"],
    lineCounts: { "src/core/orchestrator/lane-plan.ts": 120 },
    testIds: ["test/core/orchestrator/lane-plan.test.ts::assigns every task to exactly one lane"],
    commitShas: ["0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c"],
    ...overrides
  };
}

function isLedgerResult(value: LedgerResult): boolean {
  return typeof value.ok === "boolean" && Array.isArray(value.violations) && Object.keys(value).sort().join(",") === "ok,violations";
}

describe("FR-NODE-123 AC-1 — exactly five predicates, one return shape", () => {
  it("exports exactly the five named predicates and no sixth function", () => {
    const functions = Object.entries(ledgerModule)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    expect(functions).toEqual(["closeWave", "deferIssue", "openIssue", "planIssue", "resolveIssue"]);
  });

  it("returns {ok, violations[]} from every one of them", () => {
    const ledger = [row()];
    expect(isLedgerResult(openIssue(ledger, row({ issueId: "I-002" })))).toBe(true);
    expect(isLedgerResult(planIssue(ledger, "I-001", "local-defect"))).toBe(true);
    expect(isLedgerResult(resolveIssue(ledger, "I-001", { kind: "commit-sha", ref: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c" }, resolution()))).toBe(true);
    expect(isLedgerResult(deferIssue(ledger, "I-001", "scope-boundary-deferred"))).toBe(true);
    expect(isLedgerResult(closeWave(ledger, 2, resolution()))).toBe(true);
  });
});

describe("FR-NODE-123 AC-2 — a resolution reference is resolved against the injected set", () => {
  const ledger = [row()];

  it("names one injected member per resolution kind", () => {
    expect([...RESOLUTION_KINDS]).toEqual(["path", "file-line", "test-id", "commit-sha"]);
  });

  it("refuses a path absent from existingPaths and accepts one present", () => {
    expect(resolveIssue(ledger, "I-001", { kind: "path", ref: "src/core/orchestrator/absent.ts" }, resolution()).ok).toBe(false);
    expect(resolveIssue(ledger, "I-001", { kind: "path", ref: "src/core/orchestrator/lane-plan.ts" }, resolution()).ok).toBe(true);
  });

  it("refuses a file:line beyond the injected line count and accepts one inside it", () => {
    expect(resolveIssue(ledger, "I-001", { kind: "file-line", ref: "src/core/orchestrator/lane-plan.ts:121" }, resolution()).ok).toBe(false);
    expect(resolveIssue(ledger, "I-001", { kind: "file-line", ref: "src/core/orchestrator/lane-plan.ts:120" }, resolution()).ok).toBe(true);
  });

  it("refuses a test id absent from testIds and accepts one present", () => {
    expect(resolveIssue(ledger, "I-001", { kind: "test-id", ref: "test/core/orchestrator/lane-plan.test.ts::a case nobody wrote" }, resolution()).ok).toBe(false);
    expect(resolveIssue(ledger, "I-001", { kind: "test-id", ref: resolution().testIds[0] }, resolution()).ok).toBe(true);
  });

  it("refuses a commit sha absent from commitShas and accepts one present", () => {
    expect(resolveIssue(ledger, "I-001", { kind: "commit-sha", ref: "1111111111111111111111111111111111111111" }, resolution()).ok).toBe(false);
    expect(resolveIssue(ledger, "I-001", { kind: "commit-sha", ref: resolution().commitShas[0] }, resolution()).ok).toBe(true);
  });
});

describe("FR-NODE-123 AC-3 — the predicate is not satisfiable by the reference's shape alone", () => {
  it("refuses a well-formed forty-hex sha that is not an injected member", () => {
    const wellFormed = "abcdef0123456789abcdef0123456789abcdef01";
    expect(wellFormed).toMatch(/^[0-9a-f]{40}$/);
    expect(resolveIssue([row()], "I-001", { kind: "commit-sha", ref: wellFormed }, resolution({ commitShas: [] })).ok).toBe(false);
  });
});

describe("FR-NODE-123 AC-4 — deferral reasons come from the closed reason_class vocabulary", () => {
  it("carries waves-event.md v1.4.0's eight values, including the two the orchestrator's own stops write", () => {
    expect([...DEFERRAL_REASON_CLASSES]).toEqual([
      "draft-stability-skip",
      "task-failure-skip",
      "scope-boundary-deferred",
      "srs-level-unclosable",
      "design-gap",
      "cross-wave-carry-forward",
      "oscillation",
      "budget-exhausted"
    ]);
  });

  it("is the array journal-schema.ts registers, by import and not by restatement", () => {
    expect(journalSchema.REASON_CLASSES).toBe(DEFERRAL_REASON_CLASSES);
  });

  it("refuses a reason outside the vocabulary", () => {
    expect(deferIssue([row()], "I-001", "we-will-get-to-it").ok).toBe(false);
  });

  it.each(DEFERRAL_REASON_CLASSES.map((reason) => [reason]))("accepts the member %s", (reason) => {
    expect(deferIssue([row()], "I-001", reason).ok).toBe(true);
  });
});

describe("FR-NODE-123 AC-5 — openIssue accepts exactly the six classifications", () => {
  it("declares the six", () => {
    expect([...ISSUE_CLASSES]).toEqual(["local-defect", "missing-task", "design-gap", "new-wave-required", "design-contradiction", "out-of-run"]);
  });

  it("is the array journal-schema.ts registers, by import and not by restatement", () => {
    expect(journalSchema.ISSUE_CLASSES).toBe(ISSUE_CLASSES);
  });

  it.each(ISSUE_CLASSES.map((issueClass) => [issueClass]))("accepts %s", (issueClass) => {
    expect(openIssue([], row({ class: issueClass })).ok).toBe(true);
  });

  it.each([["needs-triage"], ["local defect"], [""], ["LOCAL-DEFECT"]])("refuses %s", (issueClass) => {
    expect(openIssue([], row({ class: issueClass })).ok).toBe(false);
  });
});

describe("FR-NODE-123 AC-6 — closeWave holds P-WAVE-ISSUES-CLOSED", () => {
  const closedLedger: IssueRow[] = [
    row({ issueId: "I-001", class: "local-defect", resolutionKind: "commit-sha", resolutionRef: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c" }),
    row({ issueId: "I-002", class: "missing-task", resolutionKind: "test-id", resolutionRef: "test/core/orchestrator/lane-plan.test.ts::assigns every task to exactly one lane" }),
    row({ issueId: "I-003", class: "design-gap", resolutionKind: null, resolutionRef: null, designLockDigest: "sha256:9f2b" }),
    row({ issueId: "I-004", class: "out-of-run", resolutionKind: null, resolutionRef: null, userDecisionRef: "kiwi/waves.jsonl#L42" }),
    row({ issueId: "I-005", class: "new-wave-required", resolutionKind: null, resolutionRef: null, userDecisionRef: "kiwi/waves.jsonl#L43" })
  ];

  it("closes a ledger in which all four conditions hold", () => {
    const result = closeWave(closedLedger, 2, resolution());
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("refuses an issue with no terminal classification", () => {
    const result = closeWave([...closedLedger, row({ issueId: "I-006", class: null })], 2, resolution());
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain("P-WAVE-ISSUES-CLOSED");
  });

  it("refuses a local-defect with no resolution proof", () => {
    const result = closeWave([...closedLedger, row({ issueId: "I-006", class: "local-defect", resolutionKind: null, resolutionRef: null })], 2, resolution());
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain("P-WAVE-ISSUES-CLOSED");
  });

  it("refuses a design-gap naming no new design lock digest", () => {
    const result = closeWave([...closedLedger, row({ issueId: "I-006", class: "design-gap", resolutionKind: null, resolutionRef: null, designLockDigest: null })], 2, resolution());
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain("P-WAVE-ISSUES-CLOSED");
  });

  it("refuses an out-of-run with no recorded user decision", () => {
    const result = closeWave([...closedLedger, row({ issueId: "I-006", class: "out-of-run", resolutionKind: null, resolutionRef: null, userDecisionRef: null })], 2, resolution());
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain("P-WAVE-ISSUES-CLOSED");
  });

  it("refuses a local-defect whose proof does not resolve against the injected set", () => {
    const unresolvable = row({ issueId: "I-006", class: "local-defect", resolutionKind: "commit-sha", resolutionRef: "1111111111111111111111111111111111111111" });
    expect(closeWave([...closedLedger, unresolvable], 2, resolution()).ok).toBe(false);
  });

  it("evaluates only the named wave's rows", () => {
    const otherWave = row({ issueId: "I-009", wave: 3, class: null });
    expect(closeWave([...closedLedger, otherWave], 2, resolution()).ok).toBe(true);
  });
});

describe("FR-NODE-123 AC-7 — deferral is a user decision, not a free escape under --auto", () => {
  it("still refuses an out-of-run with no recorded decision when the run is unattended", () => {
    const ledger = [row({ issueId: "I-001", class: "out-of-run", resolutionKind: null, resolutionRef: null, userDecisionRef: null })];
    expect(closeWave(ledger, 2, resolution()).ok).toBe(false);
  });

  it("exposes no parameter by which an unattended run could grant it", async () => {
    expect(closeWave.length).toBe(3);
    expect(Object.keys(resolution()).sort()).toEqual(["commitShas", "existingPaths", "lineCounts", "testIds"]);

    // The three declared arguments are the ledger, the wave and the resolution set; a run mode is
    // not among them, so no call site can pass one.
    const source = await readFile(MODULE_SOURCE, "utf8");
    const signature = source.slice(source.indexOf("export function closeWave"));
    expect(signature.slice(0, signature.indexOf("{"))).not.toContain("auto");
  });
});
