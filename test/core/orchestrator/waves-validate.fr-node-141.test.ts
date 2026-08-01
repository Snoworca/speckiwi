import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOURNAL_RULES,
  VIOLATION_CODES,
  VIOLATION_RULES,
  WAVES_EVENT_NON_VIOLATION_BULLETS,
  type Engine,
  type WavesRule
} from "../../../src/core/orchestrator/journal-schema.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { evaluateRound, type Round } from "../../../src/core/orchestrator/verification-gate.js";
import { complete, finalVerify, intent, journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// FR-NODE-141 — every mechanical round invariant as a named violation code, both directions,
// enumerated over the validator's two rule tables by measurement.

const WAVES_EVENT_PATH = path.join(process.cwd(), "skills", "claude", "_shared", "kiwi", "waves-event.md");

async function codesFor(lines: Json[], engine: Engine = "kiwi-wave-master", runId = "run-a"): Promise<string[]> {
  const root = await journalRoot(lines);
  const view = await parseWavesJournal(root, { runId, engine });
  return validateWavesJournal(view).map((item) => item.code);
}

/**
 * The legal baseline every composite fixture mutates: a one-wave run that satisfies every rule in
 * both tables. `verification` is internally consistent, the gate's prerequisite wave-verify pass
 * precedes the `complete`, and the run-scope final verification passes.
 */
function legalJournal(): Json[] {
  return [waveVerify(), complete(), finalVerify()];
}

/** Replaces one line of the legal baseline, leaving every other line legal. */
function mutate(index: 0 | 1 | 2, overrides: Json): Json[] {
  const builders = [waveVerify, complete, finalVerify] as const;
  const lines = legalJournal();
  lines[index] = builders[index](overrides);
  return lines;
}

/** The v1.4.0 lane-terminality fixtures are orchestrator lines, so every line carries the engine. */
const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;

const legalRound: Round = {
  loop: "P",
  scope: "wave-1",
  roundIndex: 2,
  mode: "normal",
  cap: 5,
  streakBefore: 0,
  frozenDenominator: 3,
  rows: [
    { id: "R1", verdict: "pass", severity: "LOW" },
    { id: "R2", verdict: "match", severity: "LOW" },
    { id: "R3", verdict: "intended-improvement", severity: "LOW" }
  ],
  fixAppliedThisRound: false,
  regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
  residual: []
};

type RuleCase =
  | { kind: "journal"; engine?: Engine; violating: Json[]; legal?: Json[] }
  | { kind: "round"; violating: Round; legal?: Round }
  | { kind: "by-construction"; assert: () => Promise<void> };

// One entry per row of the two rule tables, keyed by code, so the enumeration below asserts the case
// set equals the measured table rows rather than a hard-coded count.
const CASES: Record<string, RuleCase> = {
  "unmapped-design-item": {
    kind: "journal",
    violating: mutate(0, { verification: { design_layer: { expected: 6, mapped: 5, unmapped: [{ id: "D-007" }] } } })
  },
  "constraint-violation": {
    kind: "journal",
    violating: mutate(0, { verification: { constraint_layer: { expected: 3, checked: 3, violations: [{ id: "C-1" }] } } })
  },
  "unapproved-damage": {
    kind: "journal",
    violating: mutate(0, {
      verification: {
        preservation_layer: { expected: 3, checked: 3, rows: [{ item: "x", verdict: "unapproved-damage", evidence: "FR-X-1" }] }
      }
    })
  },
  "new-regression": {
    kind: "journal",
    violating: mutate(0, {
      verification: {
        regression: { command: "npm test", exit_code: 1, failing_tests: ["t/new.test.ts"], baseline_failing_tests: [] }
      }
    })
  },
  "no-baseline-nonzero-exit": {
    kind: "journal",
    violating: mutate(0, {
      verification: {
        regression: { command: "npm test", exit_code: 1, failing_tests: ["t/a.test.ts"], baseline_failing_tests: null }
      }
    })
  },
  "denominator-mismatch": {
    kind: "journal",
    violating: mutate(0, { verification: { axis_a: { roll_up: "ALL_MATCH", expected: 8, checked: 7 } } })
  },
  "truncated-residual": {
    kind: "journal",
    violating: mutate(0, {
      verification: {
        axis_a: { roll_up: "GAPS", expected: 8, checked: 8 },
        design_layer: { expected: 6, mapped: 4, unmapped: [{ id: "D-007" }] }
      }
    })
  },
  "complete-without-verification": {
    kind: "journal",
    violating: [waveVerify(), complete({ verification: undefined }), finalVerify()]
  },
  "verification-without-status": {
    kind: "journal",
    violating: mutate(0, { status: undefined })
  },
  "cap-exhausted": {
    kind: "journal",
    violating: mutate(0, { verification: { rounds: 6, cap: 5 } })
  },
  "fix-in-clean-round": {
    kind: "round",
    violating: { ...legalRound, fixAppliedThisRound: true }
  },
  "complete-without-latest-pass": {
    kind: "journal",
    violating: [complete(), finalVerify()]
  },
  "cross-run-complete": {
    kind: "by-construction",
    // Run scoping is enforced by the parser's run filter, so there is no diagnostic to assert: the
    // property is that another run's `complete` never reaches this run's view at all.
    assert: async () => {
      const root = await journalRoot([waveVerify({ run_id: "run-z" }), complete({ run_id: "run-z" })]);
      const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });
      expect(view.lines).toEqual([]);
      expect(view.latestPerWave.get(1)).toBeUndefined();
    }
  },
  "final-verify-not-passed-complete": {
    kind: "journal",
    violating: [waveVerify(), complete(), finalVerify({ verification: { verdict: "fail-residual" } })]
  },
  "reason-class-outside-vocabulary": {
    kind: "journal",
    violating: mutate(0, {
      // Normal's early exit is a legal `pass` carrying a MEDIUM residual, so the only rule this
      // composite breaks is the reason_class vocabulary.
      verification: {
        axis_b: { substantive_clean: true, open: { critical: 0, high: 0, medium: 1, low: 0 } },
        residual: [
          { id: "F-1", severity: "MEDIUM", summary: "s", reason_class: "made-up-class", cross_wave: false, carried_into: null }
        ]
      }
    })
  },
  "exclusion-class-outside-vocabulary": {
    kind: "journal",
    violating: mutate(0, {
      design_baseline: { path: "docs/analysis/db.json", out_of_scope: [{ heading: "H", reason: "r", exclusion_class: "made-up" }] }
    })
  },
  "unstamped-writer": {
    kind: "journal",
    engine: "kiwi-orchestrator",
    violating: [result("execute-unit", { writer: undefined, stage: 1, lane: "lane-1" })],
    legal: [result("execute-unit", { stage: 1, lane: "lane-1" })]
  },
  "journal-version-downgrade": {
    kind: "journal",
    engine: "kiwi-orchestrator",
    violating: [
      intent("execute-unit", { stage: 1, lane: "lane-1" }),
      result("execute-unit", { schema_version: "1.3.0", stage: 1, lane: "lane-1" })
    ],
    legal: [intent("execute-unit", { stage: 1, lane: "lane-1" }), result("execute-unit", { stage: 1, lane: "lane-1" })]
  },
  "lane-not-terminal": {
    kind: "journal",
    engine: "kiwi-orchestrator",
    violating: [
      waveVerify(V14),
      complete({ ...V14, lane_plan: { lock_path: "l.json", digest: "sha256:1", lane_count: 2, stage_count: 1 } }),
      finalVerify(V14)
    ],
    legal: [
      waveVerify(V14),
      result("integrate-lane", { stage: 1, lane: "lane-1", isolation: { profile: "none-serial", merge_sha: "aaa" } }),
      result("execute-unit", {
        stage: 1,
        lane: "lane-2",
        lane_disposition: { kind: "refuted", reason: "r", at: "2026-08-02T00:00:00Z" }
      }),
      complete({ ...V14, lane_plan: { lock_path: "l.json", digest: "sha256:1", lane_count: 2, stage_count: 1 } }),
      finalVerify(V14)
    ]
  },
  "integrated-lane-without-merge-sha": {
    kind: "journal",
    engine: "kiwi-orchestrator",
    violating: [
      waveVerify(V14),
      result("integrate-lane", { stage: 1, lane: "lane-1", isolation: { profile: "none-serial" } }),
      complete({ ...V14, lane_plan: { lock_path: "l.json", digest: "sha256:1", lane_count: 1, stage_count: 1 } }),
      finalVerify(V14)
    ],
    legal: [
      waveVerify(V14),
      result("integrate-lane", { stage: 1, lane: "lane-1", isolation: { profile: "none-serial", merge_sha: "aaa" } }),
      complete({ ...V14, lane_plan: { lock_path: "l.json", digest: "sha256:1", lane_count: 1, stage_count: 1 } }),
      finalVerify(V14)
    ]
  },
  "journal-only-verdict": {
    kind: "journal",
    violating: mutate(1, { proof: { kind: "journal", ref: "waves.jsonl#L1" } })
  }
};

describe("FR-NODE-141 validateWavesJournal violation codes", () => {
  it("declares exactly the eleven round-invariant violation codes", () => {
    expect([...VIOLATION_CODES]).toEqual([
      "unmapped-design-item",
      "constraint-violation",
      "unapproved-damage",
      "new-regression",
      "no-baseline-nonzero-exit",
      "denominator-mismatch",
      "truncated-residual",
      "complete-without-verification",
      "verification-without-status",
      "fix-in-clean-round",
      "cap-exhausted"
    ]);
    expect(VIOLATION_RULES.map((rule) => rule.code)).toEqual([...VIOLATION_CODES]);
  });

  it("AC-2 covers every row of both rule tables, enumerated by measurement", () => {
    const measured: WavesRule[] = [...VIOLATION_RULES, ...JOURNAL_RULES];
    expect(measured.length).toBeGreaterThan(0);
    // A row added to either table with no fixture pair fails here, which is the point: the
    // denominator is the tables, never a literal count.
    expect(Object.keys(CASES).sort()).toEqual(measured.map((rule) => rule.code).sort());
  });

  it("AC-1/AC-2 refuses each composite that violates exactly one rule and accepts its legal baseline", async () => {
    const measured: WavesRule[] = [...VIOLATION_RULES, ...JOURNAL_RULES];
    for (const rule of measured) {
      const testCase = CASES[rule.code];
      if (!testCase) throw new Error(`no fixture for ${rule.code}`);

      if (testCase.kind === "by-construction") {
        await testCase.assert();
        continue;
      }

      if (testCase.kind === "round") {
        expect(evaluateRound(testCase.violating).violations, `${rule.code} violating round`).toContain(rule.code);
        expect(evaluateRound(testCase.legal ?? legalRound).violations, `${rule.code} legal round`).toEqual([]);
        continue;
      }

      const engine = testCase.engine ?? "kiwi-wave-master";
      expect(await codesFor(testCase.violating, engine), `${rule.code} violating journal`).toContain(rule.code);
      expect(await codesFor(testCase.legal ?? legalJournal(), engine), `${rule.code} legal journal`).toEqual([]);
    }
  });

  it("AC-1 refuses each composite with that code and no other", async () => {
    for (const [code, testCase] of Object.entries(CASES)) {
      if (testCase.kind !== "journal") continue;
      const engine = testCase.engine ?? "kiwi-wave-master";
      // "violates exactly one" is the point of the composite: a second code means the fixture is
      // testing two rules at once and neither assertion isolates its rule.
      expect(await codesFor(testCase.violating, engine), `${code} isolation`).toEqual([code]);
    }
  });

  it("AC-3 reports a complete with no verification as unverified without failing hard", async () => {
    const root = await journalRoot([waveVerify(), complete({ verification: undefined }), finalVerify()]);
    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });

    const diagnostics = validateWavesJournal(view);
    const unverified = diagnostics.filter((item) => item.code === "complete-without-verification");

    expect(unverified).toHaveLength(1);
    expect(unverified[0]?.severity).toBe("warning");
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("AC-4 refuses a verification-bearing line that carries no completion signal", async () => {
    expect(await codesFor([waveVerify({ status: undefined }), complete(), finalVerify()])).toContain(
      "verification-without-status"
    );
  });

  it("AC-5 pairs every violation code with a measured waves-event.md bullet", async () => {
    const text = await readFile(WAVES_EVENT_PATH, "utf8");
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.startsWith("### 2.3"));
    expect(start).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((line, index) => index > start && line.startsWith("### "));
    expect(end).toBeGreaterThan(start);

    const bullets = lines.slice(start, end).filter((line) => line.startsWith("- "));
    // A zero-bullet denominator would make every assertion below vacuously true.
    expect(bullets.length).toBeGreaterThan(0);

    const cited = [...VIOLATION_RULES, ...JOURNAL_RULES].flatMap((rule) => [...(rule.sourceBullets ?? [])]);
    expect(cited.length).toBeGreaterThan(0);
    const anchors = [...cited, ...WAVES_EVENT_NON_VIOLATION_BULLETS];

    // Every anchor resolves to exactly one bullet: an anchor that stops matching is red.
    for (const anchor of anchors) {
      expect(bullets.filter((bullet) => bullet.includes(anchor)), `anchor ${anchor}`).toHaveLength(1);
    }

    // Every measured bullet is claimed by a violation code or explicitly declared a non-source. A
    // bullet added to waves-event.md with no matching violation code lands in neither and fails.
    const uncovered = bullets.filter((bullet) => !anchors.some((anchor) => bullet.includes(anchor)));
    expect(uncovered).toEqual([]);
  });
});
