import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { computeInvariantDigest, resumeCardPath, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";

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
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): Record<string, unknown> {
  return JSON.parse((stream as unknown as PassThrough).read()?.toString() ?? "{}") as Record<string, unknown>;
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
      verb: "execute-unit",
      args: { wave: 1, stage: 1, lane: "lane-1" },
      preconditions: ["P-DESIGN-FROZEN", "P-LANE-PLAN-FROZEN", "P-HANDOFF-VERIFIED", "P-WAVE-ISSUES-CLOSED", "P-PRIOR-STAGES-INTEGRATED"]
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

function facts(): string {
  const recorded = {
    sidecarDigest: "sha256:sidecar",
    registryDigest: "sha256:registry",
    existingPathsDigest: "sha256:paths",
    designItemMapDigest: "sha256:map",
    priorPostmortemDigests: [],
    laneCap: 8,
    codeRoots: ["src/**"],
    testRoots: ["test/**"]
  };
  return JSON.stringify({
    gitFacts: { branches: [], worktrees: [], heartbeats: [], integrationHead: "aaaa111", hostStatusPaths: [], integrationCommits: [] },
    driftInputs: {
      lockDigests: {
        design: "design/00.design.lock.json@sha256:4ab0",
        waves: "waves/waves.lock.json@sha256:c17e",
        lanes: "waves/wave-1/lanes.lock.json@sha256:5b3a",
        handoff: {},
        issues: "",
        postmortem: ""
      },
      recordedLaneInputs: recorded,
      recomputedLaneInputDigests: {
        sidecarDigest: recorded.sidecarDigest,
        registryDigest: recorded.registryDigest,
        existingPathsDigest: recorded.existingPathsDigest,
        designItemMapDigest: recorded.designItemMapDigest,
        priorPostmortemDigests: []
      },
      freshIntentDigests: {},
      handoffProseDigests: {}
    }
  });
}

async function resume(cardValue: ResumeCard, journal: Record<string, unknown>[] = JOURNAL): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const root = await mkdtemp(path.join(tmpdir(), "resume-card-validation-"));
  await write(root, "kiwi/waves.jsonl", journal.map((line) => JSON.stringify(line)).join("\n") + "\n");
  await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(cardValue, null, 2)}\n`);
  await write(root, "facts.json", facts());
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
    const result = await resume(card({ next_action: { verb: "totally-made-up", args: {}, preconditions: [] } } as Partial<ResumeCard>));
    expect(result.exit).toBe(2);
    expect(result.payload.gate).toBe("resume-card-missing-or-invalid");
    expect(JSON.stringify(result.payload.violations)).toContain("unknown-verb");
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
