import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { EXTERNAL_PROOF_KINDS, WAVE_PHASES } from "../../src/core/orchestrator/journal-schema.js";
import type { Round } from "../../src/core/orchestrator/verification-gate.js";

// @req FR-NODE-169 — `orchestrate round record` writes a line that describes the round it was given.
// @req FR-NODE-170 AC-5 — and declares the round void on exactly the rounds the kernel voided.
//
// Before this, one payload literal carried four defects at once: no status, no phase, `verb`
// hard-coded `verify-design` for all six loops, and `payload.wave` read while `Round` declares
// `scope` and no `wave`, so every line fell back to `wave: "all"`.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
  readonly root: string;
}

const PROOF = { kind: "digest", ref: "sha256:0123456789abcdef" };

function round(overrides: Partial<Round> = {}): Round {
  return {
    loop: "P",
    scope: "wave-1-post",
    roundIndex: 1,
    mode: "normal",
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 2,
    rows: [
      { id: "R-1", verdict: "pass", severity: "MEDIUM" },
      { id: "R-2", verdict: "pass", severity: "MEDIUM" }
    ],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: [],
    ...overrides
  };
}

async function tempRoot(seed = ""): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-round-record-"));
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, "kiwi/waves.jsonl"), seed, "utf8");
  return root;
}

async function record(payload: Round, options: { root?: string; proof?: unknown } = {}): Promise<Run> {
  const root = options.root ?? (await tempRoot());
  const pipes = io();
  const exit = await main(
    [
      "--root", root, "orchestrate", "round", "record",
      "--run-id", "run-a",
      "--payload", JSON.stringify(payload),
      "--proof", JSON.stringify(options.proof ?? PROOF),
      "--json"
    ],
    pipes
  );
  const text = drain(pipes.stdout);
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {}, root };
}

async function lines(root: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The last line written, which for these fixtures is the round record under test. */
async function written(root: string): Promise<Record<string, unknown>> {
  const all = await lines(root);
  expect(all.length, "the record must have written a line to read").toBeGreaterThan(0);
  return all[all.length - 1] as Record<string, unknown>;
}

/** The six legal `{scope}` forms of 05 §5.1, one per loop. */
const LOOPS: Array<{ loop: Round["loop"]; scope: string; phase: string; verb: string; wave: string; order: number }> = [
  { loop: "D", scope: "design", phase: "design", verb: "verify-design", wave: "all", order: 0 },
  { loop: "W", scope: "wave-1", phase: "wave-design", verb: "verify-wave-design", wave: "wave-1", order: 1 },
  { loop: "L", scope: "wave-2-lane-3", phase: "lane", verb: "verify-lane", wave: "wave-2", order: 2 },
  { loop: "P", scope: "wave-3-post", phase: "wave-verify", verb: "post-merge-verify", wave: "wave-3", order: 3 },
  { loop: "H", scope: "wave-4-lane-1-handoff", phase: "handoff", verb: "verify-handoff", wave: "wave-4", order: 4 },
  { loop: "F", scope: "run", phase: "final-verify", verb: "final-verify", wave: "all", order: 0 }
];

describe("FR-NODE-169 AC-1 / AC-2 — the scope vocabulary is closed", () => {
  it("refuses an out-of-vocabulary scope and writes nothing", async () => {
    const root = await tempRoot();
    const before = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");

    const refused = await record(round({ scope: "wave-1-postt" }), { root });

    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(refused.payload.gate).toBe("invalid-run-scope-option");
    expect(await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).toBe(before);
  });

  it("refuses a scope whose loop disagrees with the declared loop", async () => {
    const refused = await record(round({ loop: "F", scope: "wave-1-post" }));
    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(refused.payload.gate).toBe("invalid-run-scope-option");
  });
});

describe("FR-NODE-169 AC-3 / AC-4 / AC-5 — phase, verb and the wave triple are derived", () => {
  it.each(LOOPS)("loop $loop over $scope", async (entry) => {
    const result = await record(round({ loop: entry.loop, scope: entry.scope, roundIndex: 1 }));
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);

    const line = await written(result.root);
    expect(line.phase, "phase is derived from the loop").toBe(entry.phase);
    expect(line.verb, "verb is derived from the loop").toBe(entry.verb);
    expect(line.wave, "wave is reduced from the scope").toBe(entry.wave);
    expect(line.order).toBe(entry.order);
    expect(line.target).toBe(entry.wave === "all" ? "all" : entry.wave);
  });

  it("derives six DISTINCT verbs, so a hard-coded one cannot pass", async () => {
    const verbs = new Set<unknown>();
    const phases = new Set<unknown>();
    for (const entry of LOOPS) {
      const result = await record(round({ loop: entry.loop, scope: entry.scope }));
      const line = await written(result.root);
      verbs.add(line.verb);
      phases.add(line.phase);
    }
    expect(verbs.size, "one verb per loop").toBe(6);
    expect(phases.size, "one phase per loop").toBe(6);
    for (const phase of phases) expect(WAVE_PHASES as readonly string[]).toContain(phase as string);
  });
});

describe("FR-NODE-169 AC-6 — the line carries what the contract and the readers need", () => {
  it("carries ts, summary, status and the 1-based round index", async () => {
    const result = await record(round({ roundIndex: 3 }));
    const line = await written(result.root);

    expect(typeof line.ts).toBe("string");
    expect(new Date(line.ts as string).toISOString()).toBe(line.ts);
    expect(typeof line.summary).toBe("string");
    expect((line.summary as string).length).toBeGreaterThan(0);
    expect(line.status).toBe("in_progress");
    expect(line.round, "FR-NODE-168 makes both run-state readers depend on this").toBe(3);
  });

  it("leaves a completed wave complete", async () => {
    const envelope = {
      ts: "2026-08-02T00:00:00Z",
      schema_version: "1.4.0",
      run_id: "run-a",
      engine: "kiwi-orchestrator",
      writer: "speckiwi-orchestrate/test",
      wave: "wave-1",
      order: 1,
      target: "wave-1"
    };
    // A `complete` needs its own passing wave-verify record ahead of it, or the seed is itself
    // invalid and the append is refused for a reason that has nothing to do with this criterion.
    const seed = [
      JSON.stringify({ ...envelope, status: "in_progress", phase: "wave-verify", summary: "verify", verification: { verdict: "pass" } }),
      JSON.stringify({ ...envelope, status: "complete", summary: "wave done", verification: { verdict: "pass" } })
    ].join("\n");
    const root = await tempRoot(`${seed}\n`);
    const result = await record(round({ loop: "P", scope: "wave-1-post" }), { root });

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    const all = await lines(root);
    expect(all).toHaveLength(3);
    expect(all[1]?.status, "the completion must still be on disk").toBe("complete");
  });
});

describe("FR-NODE-169 AC-7 — the line carries an externally recomputable proof", () => {
  it("writes the supplied proof", async () => {
    const result = await record(round());
    const line = await written(result.root);
    const proof = line.proof as { kind?: string };
    expect(EXTERNAL_PROOF_KINDS as readonly string[]).toContain(proof?.kind ?? "");
  });

  it("is refused by the existing journal-only-verdict rule on a journal-only kind", async () => {
    const refused = await record(round(), { proof: { kind: "journal", ref: "waves.jsonl#L1" } });
    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(JSON.stringify(refused.payload)).toContain("journal-only-verdict");
  });
});

describe("FR-NODE-169 AC-8 — verification is an explicit snake_case projection", () => {
  it("carries the mapped verdict, rounds, cap, residual and axis_b.open in snake_case", async () => {
    const result = await record(
      round({
        roundIndex: 2,
        cap: 4,
        rows: [
          { id: "R-1", verdict: "pass", severity: "MEDIUM" },
          { id: "R-2", verdict: "mismatch", severity: "LOW" }
        ],
        residual: [{ id: "F-1", reasonClass: "design-gap" }]
      })
    );
    const verification = (await written(result.root)).verification as Record<string, unknown>;

    expect(verification.rounds).toBe(2);
    expect(verification.cap).toBe(4);
    expect(verification.residual).toEqual([{ id: "F-1", reason_class: "design-gap" }]);
    expect((verification.axis_b as { open?: unknown }).open).toEqual({ critical: 0, high: 0, medium: 0, low: 1 });
    expect(verification.frozen_denominator).toEqual({ round: 2, req_ac: 2 });
    // The camelCase keys of `Round` must not survive into the projection: the validator reads
    // snake_case, and a whole-object dump validates vacuously.
    for (const key of ["frozenDenominator", "roundIndex", "streakBefore", "fixAppliedThisRound", "rows"]) {
      expect(Object.keys(verification), `camelCase ${key} leaked into the projection`).not.toContain(key);
    }
  });
});

describe("FR-NODE-169 AC-9 / FR-NODE-170 AC-5 — the verdict map, and the void declaration", () => {
  it("maps pass and pass-with-residual to pass", async () => {
    const clean = await record(round({ mode: "normal", streakBefore: 0, roundIndex: 1 }));
    const cleanLine = (await written(clean.root)).verification as Record<string, unknown>;
    expect(cleanLine.verdict).toBe("pass");
    expect(cleanLine.invalid_round, "a valid round declares nothing").toBeUndefined();

    // A terminal verdict is the case `truncated-residual` is live on, so the residual list must
    // enumerate the open rows — one open MEDIUM row, which `normal` mode does not treat as blocking,
    // so the gate is still met and the verdict is `pass-with-residual`.
    const withResidual = await record(
      round({
        rows: [
          { id: "R-1", verdict: "pass", severity: "MEDIUM" },
          { id: "R-2", verdict: "mismatch", severity: "MEDIUM" }
        ],
        residual: [{ id: "F-1", reasonClass: "design-gap" }]
      })
    );
    const residualLine = (await written(withResidual.root)).verification as Record<string, unknown>;
    expect(residualLine.verdict, "pass-with-residual maps to pass").toBe("pass");
    expect(residualLine.residual).toEqual([{ id: "F-1", reason_class: "design-gap" }]);
  });

  it("maps fail-residual to in-progress", async () => {
    const result = await record(
      round({
        mode: "max",
        cap: 8,
        roundIndex: 1,
        rows: [
          { id: "R-1", verdict: "mismatch", severity: "HIGH" },
          { id: "R-2", verdict: "pass", severity: "LOW" }
        ]
      })
    );
    const verification = (await written(result.root)).verification as Record<string, unknown>;
    expect(verification.verdict).toBe("in-progress");
  });

  it("maps fail-cap to fail-cap", async () => {
    // `fail-cap` is terminal, so the residual must enumerate the one open row.
    const result = await record(
      round({
        mode: "normal",
        cap: 1,
        roundIndex: 1,
        rows: [
          { id: "R-1", verdict: "mismatch", severity: "HIGH" },
          { id: "R-2", verdict: "pass", severity: "LOW" }
        ],
        residual: [{ id: "R-1", reasonClass: "design-gap" }]
      })
    );
    const verification = (await written(result.root)).verification as Record<string, unknown>;
    expect(verification.verdict).toBe("fail-cap");
  });

  it("splits invalid on unreachable: fail-cap when unreachable, in-progress when not", async () => {
    // mode=max needs a streak of 2; at roundIndex 4 of cap 5 only one round remains.
    const unreachable = await record(round({ mode: "max", cap: 5, roundIndex: 4, frozenDenominator: 3 }));
    const unreachableLine = (await written(unreachable.root)).verification as Record<string, unknown>;
    expect(unreachableLine.verdict, "an arithmetically unpassable void round is not 'still running'").toBe("fail-cap");
    expect(unreachableLine.invalid_round, "and it still declares itself void").toBe(true);

    const reachable = await record(round({ mode: "normal", cap: 9, roundIndex: 1, frozenDenominator: 3 }));
    const reachableLine = (await written(reachable.root)).verification as Record<string, unknown>;
    expect(reachableLine.verdict).toBe("in-progress");
    expect(reachableLine.invalid_round).toBe(true);
  });
});

describe("FR-NODE-169 AC-10 — a recorded round leaves the journal valid", () => {
  it("appends one record per loop into one journal with no error diagnostic", async () => {
    const root = await tempRoot();
    for (const entry of LOOPS) {
      const result = await record(round({ loop: entry.loop, scope: entry.scope, roundIndex: 1 }), { root });
      expect(result.exit, `${entry.loop}: ${JSON.stringify(result.payload)}`).toBe(0);
    }
    expect(await lines(root)).toHaveLength(LOOPS.length);
  });
});
