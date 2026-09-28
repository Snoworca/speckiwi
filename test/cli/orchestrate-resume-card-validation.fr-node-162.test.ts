import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import type { VerbName } from "../../src/core/orchestrator/journal-schema.js";
import { computeInvariantDigest, resumeCardPath, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";
import { pinResumeRunRoot } from "./support/resume-run-root.js";

// @req FR-NODE-162 — a resumed session validates the card it READS.
//
// `validateCard` had zero callers outside its own module: its only call is inside `writeCard`, and
// `orchestrate resume` reads through `readCard`, which does `JSON.parse` plus an object-shape check
// and accepts any object. So nine of ten declared card violations passed on the resume path,
// including the byte cap the shipped gate table names and the closed-verb check the skill body
// promises. Write-time validation cannot cover the three violations that compare the card against
// the journal, because the journal grows after the card is written.

const RUN_ID = "run-a";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): Record<string, unknown> {
  return JSON.parse(stream.read()?.toString() ?? "{}") as Record<string, unknown>;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

const BASE = { schema_version: "1.4.0", run_id: RUN_ID, engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;

const JOURNAL: Record<string, unknown>[] = [
  { ...BASE, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } }
];

function frozenBlock(): ResumeCard["frozen"] {
  return {
    engine: "kiwi-orchestrator",
    work_root: "docs/research/demo/",
    journal: "kiwi/waves.jsonl",
    run_root: { git_toplevel: "C:/repo", mcp_workspace_root: "C:/repo" },
    isolation_profile: "none-serial",
    proof_strength: "strong",
    base_branch: "main",
    integration_branch: `kiwi/orch/${RUN_ID}/integration`,
    design_lock: "design/00.design.lock.json@sha256:4ab0",
    waves_lock: "waves/waves.lock.json@sha256:c17e",
    lane_lock: { "wave-1": "waves/wave-1/lanes.lock.json@sha256:5b3a" }
  } as ResumeCard["frozen"];
}

function card(overrides: Partial<ResumeCard> = {}): ResumeCard {
  const frozen = (overrides.frozen ?? frozenBlock()) as ResumeCard["frozen"];
  return {
    schema_version: "1.0.0",
    run_id: RUN_ID,
    run_contract: "docs/research/demo/00.run-contract.md@sha256:9f1c",
    position: { wave: 1, stage: 1, phase: "execute" },
    next_action: {
      verb: "dispatch-lane",
      args: { wave: 1, stage: 1, lane: "lane-1" },
      preconditions: ["P-DESIGN-FROZEN", "P-LANE-PLAN-FROZEN", "P-WAVE-ISSUES-CLOSED", "P-PRIOR-STAGES-INTEGRATED"]
    },
    frozen,
    done: [{ key: "intake", proof: { kind: "digest", ref: "design/00.design.lock.json@sha256:4ab0" } }],
    open: [],
    blocked_on: null,
    invariant_digest: computeInvariantDigest(frozen),
    written_at: "2026-08-02T09:12:44.201Z",
    ...overrides
  } as ResumeCard;
}

/** The facts bundle; `handoff: false` builds the 4.0.0 shape, which carries no handoff digest at all. */
function facts({ handoff = true }: { handoff?: boolean } = {}): string {
  const recorded = {
    sdsDigests: { "run-wave-1": "sha256:sds-1" },
    depends: {},
    laneCap: 8
  };
  return JSON.stringify({
    gitFacts: { branches: [], worktrees: [], heartbeats: [], integrationHead: "aaaa111", hostStatusPaths: [], integrationCommits: [] },
    driftInputs: {
      lockDigests: {
        design: "design/00.design.lock.json@sha256:4ab0",
        waves: "waves/waves.lock.json@sha256:c17e",
        lanes: "waves/wave-1/lanes.lock.json@sha256:5b3a",
        ...(handoff ? { handoff: {} } : {}),
        issues: "",
        postmortem: ""
      },
      recordedLaneInputs: recorded,
      recomputedLaneInputDigests: { sdsDigests: { ...recorded.sdsDigests }, closedOutWaves: [] },
      freshIntentDigests: {},
      ...(handoff ? { handoffProseDigests: {} } : {})
    }
  });
}

async function resume(
  cardValue: ResumeCard,
  journal: Record<string, unknown>[] = JOURNAL,
  factsText: string = facts()
): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const root = await mkdtemp(path.join(tmpdir(), "resume-card-validation-"));
  await write(root, "kiwi/waves.jsonl", journal.map((line) => JSON.stringify(line)).join("\n") + "\n");
  await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(await pinResumeRunRoot(cardValue, root), null, 2)}\n`);
  await write(root, "facts.json", factsText);
  const pipes = io();
  const exit = await main(["--root", root, "orchestrate", "resume", "--run-id", RUN_ID, "--facts", "facts.json", "--json"], pipes);
  return { exit, payload: drain(pipes.stdout) };
}

describe("FR-NODE-162 — the card is validated on the path that reads it", () => {
  it("AC-5: a clean card still resumes, so the rule adds a refusal rather than closing the verb", async () => {
    const result = await resume(card());
    expect(result.exit, "the baseline must succeed, or every refusal below is uninformative").toBe(0);
  });

  it("AC-3: a card naming a verb outside the closed enum is refused", async () => {
    // The cast is on the verb alone, and it is the assertion: this string is deliberately outside the
    // enum, and narrowing it here rather than casting the whole card keeps every other field checked.
    const result = await resume(card({ next_action: { verb: "totally-made-up" as VerbName, args: {}, preconditions: [] } }));
    expect(result.exit).toBe(2);
    expect(result.payload.gate).toBe("resume-card-missing-or-invalid");
    expect(JSON.stringify(result.payload.violations)).toContain("unknown-verb");
  });

  it("FR-NODE-163 AC-1: a card naming a verb retired in 4.0.0 is refused on the resume path", async () => {
    for (const verb of ["execute-unit", "author-handoff", "verify-handoff", "commit-dispatch-base", "run-serial-epilogue"]) {
      const result = await resume(card({ next_action: { verb: verb as VerbName, args: {}, preconditions: [] } }));
      expect(result.exit, verb).toBe(2);
      expect(result.payload.gate, verb).toBe("resume-card-missing-or-invalid");
      expect(JSON.stringify(result.payload.violations), verb).toContain("unknown-verb");
    }
  });

  it("FR-NODE-163 AC-2: a card naming a worker verb or a formerly deferred verb is not refused on that ground", async () => {
    for (const verb of ["dispatch-lane", "probe-isolation", "replay-deferred-mutations"]) {
      const result = await resume(card({ next_action: { verb: verb as VerbName, args: {}, preconditions: [] } }));
      expect(JSON.stringify(result.payload.violations ?? []), verb).not.toContain("unknown-verb");
    }
  });

  it("AC-2: a card over the declared byte cap is refused, which the gate table names and nothing enforced", async () => {
    // The cap is on the serialised card, so the padding has to live in a field the card declares.
    const fat = card({ open: Array.from({ length: 400 }, (_, index) => ({ key: `padding-${index}-${"x".repeat(40)}` })) } as Partial<ResumeCard>);
    expect(JSON.stringify(fat).length, "the fixture must actually exceed the cap").toBeGreaterThan(8192);
    const result = await resume(fat);
    expect(result.exit).toBe(2);
    expect(JSON.stringify(result.payload.violations)).toContain("resume-card-too-large");
  });

  it("AC-1 and AC-4: a card clean at write time is refused once the journal contradicts it", async () => {
    // `isolation-profile-changed` compares the card's frozen profile against the latest recorded
    // isolation probe. The card below was valid when written; the journal has since moved.
    const contradicted = [...JOURNAL, { ...BASE, wave: "wave-1", verb: "probe-isolation", event: "result", isolation: { profile: "worktree" } }];
    const result = await resume(card(), contradicted);
    expect(result.exit, "write-time validation cannot see a journal that grew afterwards").toBe(2);
    expect(JSON.stringify(result.payload.violations)).toContain("isolation-profile-changed");
  });
});

// @req FR-NODE-213 AC-6 — a run written in the R-PLAN and handoff era is refused by name. Its old lines
// are read under the vocabulary they were written in, and the resume says why it will not go on
// instead of reporting a lane that already left the run as never dispatched.
describe("FR-NODE-213 AC-6 — a pre-4.0.0 run is refused on resume, and says so", () => {
  const V15 = { ...BASE, schema_version: "1.5.0" } as const;
  const predates = (payload: Record<string, unknown>): boolean => JSON.stringify(payload.violations ?? []).includes("run-predates-4.0.0");

  it("FR-NODE-213 AC-6: a journal with a lane demoted on a 1.5.0 line is refused as a pre-4.0.0 run and dispatches nothing", async () => {
    const journal = [...JOURNAL, { ...V15, wave: "wave-1", stage: 1, lane: "lane-1", verb: "collect-lane", event: "result", lane_disposition: { kind: "demoted" } }];
    const result = await resume(card(), journal);
    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("resume-card-missing-or-invalid");
    expect(predates(result.payload)).toBe(true);
    expect(JSON.stringify(result.payload)).not.toContain("\"nextVerb\":\"dispatch-lane\"");
  });

  it("FR-NODE-213 AC-6: a card naming plan-wave or P-HANDOFF-VERIFIED is refused as a pre-4.0.0 run as well as by its violation", async () => {
    const planWave = await resume(card({ next_action: { verb: "plan-wave" as VerbName, args: {}, preconditions: [] } }));
    expect(planWave.exit).toBe(2);
    expect(JSON.stringify(planWave.payload.violations)).toContain("unknown-verb");
    expect(predates(planWave.payload)).toBe(true);

    const handoff = await resume(card({ next_action: { verb: "dispatch-lane", args: {}, preconditions: ["P-HANDOFF-VERIFIED" as never] } }));
    expect(handoff.exit).toBe(2);
    expect(JSON.stringify(handoff.payload.violations)).toContain("unknown-precondition");
    expect(predates(handoff.payload)).toBe(true);
  });

  it("FR-NODE-213 AC-6: a lane demoted on a 2.0.0 line is not dispatched again — the resume halts on the disagreement", async () => {
    const V20 = { ...BASE, schema_version: "2.0.0" } as const;
    const journal = [{ ...V20, wave: "wave-1", stage: 1, lane: "lane-1", verb: "collect-lane", event: "result", lane_disposition: { kind: "demoted" } }];
    const result = await resume(card(), journal);
    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("ledger-reconciliation-divergent");
    expect(JSON.stringify(result.payload)).not.toContain("dispatch-lane");
  });

  it("FR-NODE-213 AC-6: a 1.x run that used no retired vocabulary still resumes", async () => {
    const result = await resume(card());
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(predates(result.payload)).toBe(false);
  });
});

// @req FR-NODE-150 AC-4, FR-NODE-213 AC-6 — nothing in 4.0.0 produces a handoff digest, so a facts
// bundle without one resumes; a run that did use handoffs is refused as a pre-4.0.0 run instead.
describe("FR-NODE-150 AC-4 — resume does not require the retired handoff digests", () => {
  it("FR-NODE-150 AC-4: a 2.0.0 run whose facts carry no handoff digest resumes with digest 4 a match", async () => {
    const V20 = { ...BASE, schema_version: "2.0.0" } as const;
    const journal = [{ ...V20, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } }];
    const result = await resume(card(), journal, facts({ handoff: false }));
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    const digests = (result.payload.resume as { drift: { digests: Array<{ index: number; outcome: string }> } }).drift.digests;
    expect(digests.find((entry) => entry.index === 4)?.outcome).toBe("match");
  });

  it("FR-NODE-150 AC-4 (FR-NODE-213 AC-6): a 1.x run that used no handoff resumes without the handoff digests too", async () => {
    const result = await resume(card(), JOURNAL, facts({ handoff: false }));
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
  });

  it("FR-NODE-213 AC-6: a 1.5.0 run that verified handoffs is refused as a pre-4.0.0 run whatever its facts carry", async () => {
    const journal = [...JOURNAL, { ...BASE, schema_version: "1.5.0", wave: "wave-1", stage: 1, lane: "lane-1", verb: "verify-handoff", event: "result" }];
    for (const handoff of [true, false]) {
      const result = await resume(card(), journal, facts({ handoff }));
      expect(result.exit, JSON.stringify(result.payload)).toBe(2);
      expect(JSON.stringify(result.payload.violations ?? [])).toContain("run-predates-4.0.0");
    }
  });
});

// @req FR-NODE-213 AC-6 — a retired term on a 2.0.0 line that is not the newest is only a warning to
// `journal append`, so a later append is not blocked. Resume must still refuse it: the retired verb
// would otherwise come back as the next action with no gate.
describe("FR-NODE-213 AC-6 — resume refuses a 2.0.0 run whose history carries a retired term", () => {
  it("FR-NODE-213 AC-6: an unmatched execute-unit intent on a 2.0.0 history line refuses resume instead of returning it as the next verb", async () => {
    const V20 = { ...BASE, schema_version: "2.0.0" } as const;
    const journal = [
      { ...V20, wave: "wave-1", stage: 1, lane: "lane-1", verb: "execute-unit", event: "intent", inputs_digest: "sha256:1111" },
      { ...V20, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } }
    ];
    const result = await resume(card(), journal, facts({ handoff: false }));
    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("ledger-reconciliation-divergent");
    expect(JSON.stringify(result.payload.violations ?? [])).toContain("vocabulary-retired-in-4-0-0");
    expect(result.payload).not.toHaveProperty("resume");
  });
});
