import { describe, expect, it } from "vitest";
import { checkReviewRound, type ReviewRoundSources } from "../../../src/core/review/review-round.js";

// FR-NODE-274 — the read-only review-round check, judged here over recorded state and a fake git so
// every verdict is visible without a repository. The one real-git run is in the CLI test.

const RUN = "run-1";
const STATE = `.kiwi/sessions/${RUN}/state.json`;
const TREES = ["1", "2", "3", "4", "5"].map((digit) => digit.repeat(40));

interface Finding {
  id: string;
  tier: string;
  family: string;
  introduced_by_round: number | null;
}

function block(id: string, introducedBy: number | null = null): Finding {
  return { id, tier: "block", family: "f", introduced_by_round: introducedBy };
}

function record(id: string, introducedBy: number | null = null): Finding {
  return { id, tier: "record", family: "f", introduced_by_round: introducedBy };
}

function round(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    round: n,
    tree_sha: TREES[n - 1],
    scope: n === 1 ? "full" : "since-prev",
    scope_widen_reason: null,
    files: [],
    tokens_used: 100,
    residual_count: 0,
    coverage_passed: true,
    findings: [],
    ...over
  };
}

function state(rounds: unknown[], limits: Record<string, unknown> = {}): Record<string, unknown> {
  return { skill: "kiwi-review-fix-loop", phase: "review", limits: { round_cap: 5, token_budget: null, ...limits }, rounds };
}

/** Sources over a state value (serialised unless already text) and diffs keyed `<from>..<to>`. */
function sources(value: unknown, diffs: Record<string, string[]> = {}, trees: readonly string[] = TREES): ReviewRoundSources {
  return {
    readState: async (relativePath) => {
      expect(relativePath).toBe(STATE);
      return value === undefined ? undefined : typeof value === "string" ? value : JSON.stringify(value);
    },
    isTree: async (sha) => trees.includes(sha),
    changedPaths: async (from, to) => diffs[`${from}..${to}`] ?? [],
    firstLine: async () => undefined
  };
}

async function verdictOf(value: unknown, diffs: Record<string, string[]> = {}) {
  const result = await checkReviewRound(RUN, sources(value, diffs));
  if (!result.ok) throw new Error(`expected a verdict, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function errorOf(value: unknown, trees: readonly string[] = TREES, runId = RUN) {
  const result = await checkReviewRound(runId, sources(value, {}, trees));
  if (result.ok) throw new Error(`expected an error, got verdict ${result.value.verdict}`);
  return result.error;
}

describe("FR-NODE-274 AC-1 — the limits and rounds[] record", () => {
  // @req FR-NODE-274 AC-1
  it("answers a verdict for a state holding limits and rounds[] with every AC-1 field, beside the run's other keys", async () => {
    const report = await verdictOf(state([round(1, { files: ["src/a.ts"], findings: [record("R-1")] })], { round_cap: 3, token_budget: 5000 }));
    expect(report).toMatchObject({ statePath: STATE, round: 1, verdict: "PASS" });
    expect(report.counts).toMatchObject({ roundCap: 3, tokenBudget: 5000, tokensUsed: 100, block: 0, record: 1, residual: 0 });
  });
});

describe("FR-NODE-274 AC-2 — the round-N scope", () => {
  const diff = { [`${TREES[0]}..${TREES[1]}`]: ["src/a.ts", "test/a.test.ts", "package.json", "docs/notes.md", "README.md", "skills/claude/x/SKILL.md", ".kiwi/sessions/run-1/fix.ts"] };

  // @req FR-NODE-274 AC-2
  it("fails a since-prev round naming every code file of the filtered diff missing from its files[]", async () => {
    const report = await verdictOf(state([round(1), round(2, { files: ["src/a.ts"] })]), diff);
    expect(report.scope).toMatchObject({ failed: true, missingFiles: ["package.json", "test/a.test.ts"] });
    expect(report.verdict).toBe("CONTINUE");
    expect(report.reasons).toEqual(["scope"]);
  });

  // @req FR-NODE-274 AC-2
  it("continues on a scope failure even where the round would otherwise pass or stop on a residual", async () => {
    for (const over of [{}, { residual_count: 1 }]) {
      const report = await verdictOf(state([round(1), round(2, { files: [], ...over })]), diff);
      expect(report.verdict).toBe("CONTINUE");
      expect(report.reasons).toEqual(["scope"]);
    }
  });

  // @req FR-NODE-274 AC-2
  it("stops NEEDS_USER on a scope failure when the round cap or the token budget stop applies", async () => {
    const capped = await verdictOf(state([round(1), round(2, { files: [] })], { round_cap: 2 }), diff);
    expect(capped.verdict).toBe("NEEDS_USER");
    expect(capped.reasons).toEqual(["scope", "round-cap"]);
    const spent = await verdictOf(state([round(1), round(2, { files: [] })], { token_budget: 150 }), diff);
    expect(spent.verdict).toBe("NEEDS_USER");
    expect(spent.reasons).toEqual(["scope", "token-budget"]);
  });

  // @req FR-NODE-274 AC-2
  it("drops prose and every .kiwi/ path from the diff, and does not fail a round for listing further files", async () => {
    const report = await verdictOf(state([round(1), round(2, { files: ["./src/a.ts", "test\\a.test.ts", "package.json", "src/touched.ts"] })]), diff);
    expect(report.scope).toMatchObject({ failed: false, missingFiles: [] });
    expect(report.verdict).toBe("PASS");
  });

  // @req FR-NODE-274 AC-2
  it("diffs the snapshots of rounds N-1 and N, not round 1 and N", async () => {
    const diffs = { [`${TREES[0]}..${TREES[2]}`]: ["src/old.ts"], [`${TREES[1]}..${TREES[2]}`]: ["src/new.ts"] };
    const report = await verdictOf(state([round(1), round(2), round(3)]), diffs);
    expect(report.scope.missingFiles).toEqual(["src/new.ts"]);
  });

  // @req FR-NODE-274 AC-2
  it("fails a full-scope round N >= 2 whose widen reason is null or empty, and passes one that records a reason", async () => {
    for (const reason of [null, "", "  "]) {
      const report = await verdictOf(state([round(1), round(2, { scope: "full", scope_widen_reason: reason })]), diff);
      expect(report.scope).toMatchObject({ failed: true, widenReasonMissing: true });
      expect(report.verdict).toBe("CONTINUE");
      expect(report.reasons).toEqual(["scope"]);
    }
    const widened = await verdictOf(state([round(1), round(2, { scope: "full", scope_widen_reason: "fix rewrote the parser" })]), diff);
    expect(widened.scope).toMatchObject({ failed: false, widenReasonMissing: false, missingFiles: [] });
    expect(widened.verdict).toBe("PASS");
  });

  // @req FR-NODE-274 AC-2
  it("classes an extensionless file by its first line in round N's snapshot", async () => {
    const lines: Record<string, string> = { [`${TREES[1]}:bin/now-script`]: "#!/usr/bin/env node", [`${TREES[0]}:bin/was-script`]: "#!/bin/sh" };
    const source = {
      ...sources(state([round(1), round(2)]), { [`${TREES[0]}..${TREES[1]}`]: ["bin/now-script", "bin/was-script", "LICENSE"] }),
      firstLine: async (tree: string, file: string) => lines[`${tree}:${file}`]
    };
    const result = await checkReviewRound(RUN, source);
    expect(result.ok && result.value.scope.missingFiles).toEqual(["bin/now-script"]);
  });

  // @req FR-NODE-274 AC-2
  it("does not check the scope of round 1", async () => {
    const report = await verdictOf(state([round(1, { scope: "full", scope_widen_reason: null })]), diff);
    expect(report.scope).toMatchObject({ checked: false, failed: false });
    expect(report.verdict).toBe("PASS");
  });
});

describe("FR-NODE-274 AC-3 — the earlier-round-fix majority", () => {
  // @req FR-NODE-274 AC-3
  it("stops NEEDS_USER when blocking findings introduced by a round below N are more than half, and reports both counts", async () => {
    const report = await verdictOf(state([round(1), round(2), round(3, { findings: [block("B-1", 1), block("B-2", 2), block("B-3")] })]));
    expect(report.verdict).toBe("NEEDS_USER");
    expect(report.reasons).toContain("earlier-fix-majority");
    expect(report.counts).toMatchObject({ block: 3, blockIntroducedEarlier: 2 });
  });

  // @req FR-NODE-274 AC-3
  it("does not stop at exactly half, and counts neither round N itself nor record findings as earlier", async () => {
    const half = await verdictOf(state([round(1), round(2, { findings: [block("B-1", 1), block("B-2")] })]));
    expect(half.reasons).not.toContain("earlier-fix-majority");
    expect(half.verdict).toBe("CONTINUE");
    const own = await verdictOf(state([round(1), round(2, { findings: [block("B-1", 2), block("B-2", 2), record("R-1", 1), record("R-2", 1)] })]));
    expect(own.counts.blockIntroducedEarlier).toBe(0);
    expect(own.verdict).toBe("CONTINUE");
  });
});

describe("FR-NODE-274 AC-4 — pass, residual, cap, budget, continue", () => {
  // @req FR-NODE-274 AC-4
  it("passes with zero blocking findings, zero residuals and coverage passed, whatever the record findings", async () => {
    const report = await verdictOf(state([round(1, { findings: [record("R-1"), record("R-2")] })]));
    expect(report.verdict).toBe("PASS");
    expect(report.reasons).toEqual([]);
  });

  // @req FR-NODE-274 AC-4
  it("stops NEEDS_USER on a residual when nothing blocks and coverage passed", async () => {
    const report = await verdictOf(state([round(1, { residual_count: 2 })]));
    expect(report.verdict).toBe("NEEDS_USER");
    expect(report.reasons).toEqual(["residual"]);
  });

  // @req FR-NODE-274 AC-4
  it("continues under the cap while a blocking finding remains or coverage failed, and stops NEEDS_USER once the latest round reaches the cap", async () => {
    expect((await verdictOf(state([round(1, { findings: [block("B-1")] })]))).verdict).toBe("CONTINUE");
    expect((await verdictOf(state([round(1, { coverage_passed: false })]))).verdict).toBe("CONTINUE");
    const capped = await verdictOf(state([round(1), round(2, { findings: [block("B-1")] })], { round_cap: 2 }));
    expect(capped.verdict).toBe("NEEDS_USER");
    expect(capped.reasons).toEqual(["round-cap"]);
  });

  // @req FR-NODE-274 AC-4
  it("stops NEEDS_USER when the rounds' tokens_used sum to more than the budget, not at the budget, and never on a null budget", async () => {
    const over = await verdictOf(state([round(1, { tokens_used: 100 }), round(2, { tokens_used: 201, findings: [block("B-1")] })], { token_budget: 300 }));
    expect(over.verdict).toBe("NEEDS_USER");
    expect(over.reasons).toEqual(["token-budget"]);
    expect(over.counts).toMatchObject({ tokensUsed: 301, tokenBudget: 300 });
    const at = await verdictOf(state([round(1, { tokens_used: 100 }), round(2, { tokens_used: 200, findings: [block("B-1")] })], { token_budget: 300 }));
    expect(at.verdict).toBe("CONTINUE");
    const unbounded = await verdictOf(state([round(1, { tokens_used: 10_000_000, findings: [block("B-1")] })], { token_budget: null }));
    expect(unbounded.verdict).toBe("CONTINUE");
  });
});

describe("FR-NODE-274 AC-5 — an invalid state is an error naming the file and the field, with no verdict", () => {
  const cases: Array<[string, unknown, string, string]> = [
    ["a missing state file", undefined, "NOT_FOUND", STATE],
    ["text that is not JSON", "{ rounds: [", "PARSE", STATE],
    ["absent limits", { rounds: [round(1)] }, "VALIDATION", "limits"],
    ["absent rounds[]", { limits: { round_cap: 5, token_budget: null } }, "VALIDATION", "rounds"],
    ["an empty rounds[]", state([]), "VALIDATION", "rounds"],
    ["a round_cap that is not a positive integer", state([round(1)], { round_cap: 0 }), "VALIDATION", "limits.round_cap"],
    ["a token_budget that is neither a positive integer nor null", state([round(1)], { token_budget: "lots" }), "VALIDATION", "limits.token_budget"],
    ["an entry lacking tree_sha", state([{ ...round(1), tree_sha: undefined }]), "VALIDATION", "rounds[0].tree_sha"],
    ["a scope outside its set", state([round(1, { scope: "partial" })]), "VALIDATION", "rounds[0].scope"],
    ["a negative tokens_used", state([round(1, { tokens_used: -1 })]), "VALIDATION", "rounds[0].tokens_used"],
    ["a non-boolean coverage_passed", state([round(1, { coverage_passed: "yes" })]), "VALIDATION", "rounds[0].coverage_passed"],
    ["a file that is not a string", state([round(1, { files: [3] })]), "VALIDATION", "rounds[0].files"],
    ["a tier outside its set", state([round(1, { findings: [{ ...block("B-1"), tier: "major" }] })]), "VALIDATION", "rounds[0].findings[0].tier"],
    ["an introduced_by_round that is not a round number", state([round(1, { findings: [block("B-1", 0)] })]), "VALIDATION", "rounds[0].findings[0].introduced_by_round"],
    ["round numbers out of order", state([round(1), round(3)]), "VALIDATION", "rounds[1].round"]
  ];

  for (const [name, value, code, field] of cases) {
    // @req FR-NODE-274 AC-5
    it(`refuses ${name}`, async () => {
      const error = await errorOf(value);
      expect(error.code).toBe(code);
      expect(error.message).toContain(STATE);
      expect(error.message).toContain(field);
    });
  }

  // @req FR-NODE-274 AC-5
  it("refuses a tree_sha that names no tree object in the repository", async () => {
    const error = await errorOf(state([round(1), round(2)]), [TREES[0] as string]);
    expect(error.code).toBe("VALIDATION");
    expect(error.message).toContain(STATE);
    expect(error.message).toContain("rounds[1].tree_sha");
  });

  // @req FR-NODE-274 AC-5
  it("refuses a run ID that is not one path segment", async () => {
    const error = await errorOf(state([round(1)]), TREES, "../escape");
    expect(error.code).toBe("USAGE");
  });
});

describe("FR-NODE-274 AC-7 — recorded judgements are read, never made", () => {
  // @req FR-NODE-274 AC-7
  it("takes tier, coverage_passed, residual_count and tokens_used as recorded and reports no family grouping", async () => {
    const report = await verdictOf(state([round(1, { tokens_used: 7, findings: [record("SECURITY-auth-bypass", 1), { ...record("R-2"), family: "auth" }] })]));
    expect(report.verdict).toBe("PASS");
    expect(report.counts).toMatchObject({ block: 0, record: 2, tokensUsed: 7 });
    expect(JSON.stringify(report)).not.toMatch(/famil/);
    expect(Object.keys(report).sort()).toEqual(["counts", "reasons", "round", "scope", "statePath", "verdict"]);
    const failedCoverage = await verdictOf(state([round(1, { coverage_passed: false })]));
    expect(failedCoverage.verdict).not.toBe("PASS");
  });
});
