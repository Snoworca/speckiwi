import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTO_GATE_ACTIONS, decideAutoGate, type AutoGateInput } from "../../../src/core/orchestrator/auto-gate.js";
import { planDuplicationAudit, type LaneDiff } from "../../../src/core/orchestrator/duplication-audit.js";
import { computeLanePlan, type Lane, type LanePlanInput, type Stage } from "../../../src/core/orchestrator/lane-plan.js";
import type { ConvergencePoint, PriorPostmortemRow } from "../../../src/core/orchestrator/conflict.js";
import { computeResumeState, type DriftInputs, type GitFacts, type LockDigests } from "../../../src/core/orchestrator/resume.js";
import type { ResumeCard } from "../../../src/core/orchestrator/resume-card.js";
import { planStageCoupling, type ParsedHandoff } from "../../../src/core/orchestrator/substrate.js";
import type { TaskCatalogEntry } from "../../../src/core/orchestrator/task-catalog.js";
import { evaluateRound, type Round } from "../../../src/core/orchestrator/verification-gate.js";
import type { WavesJournalView } from "../../../src/core/orchestrator/waves-journal.js";

// @req FR-NODE-108 — every one of the six pure kernels declares an exported input type for every
// argument, and each is complete enough that a fixture is constructible from the DECLARATIONS ALONE.
//
// The proof is this file itself: nothing below reads a kernel's implementation, and every value is
// annotated with the exported type, so a field the declaration omits is a compile error here rather
// than a fixture an author had to reverse-engineer from the body. §10.5 step 1's first instruction is
// "fixtures plus Layer-1 tests, all red", and a red test cannot be authored against an undeclared
// argument type.

// ---------------------------------------------------------------------------------------------
// One value of each of the six input types, constructed from the type declarations
// ---------------------------------------------------------------------------------------------

const round: Round = {
  loop: "D",
  scope: "design",
  roundIndex: 1,
  mode: "normal",
  cap: 5,
  streakBefore: 0,
  frozenDenominator: 1,
  rows: [{ id: "R-1", verdict: "pass", severity: "LOW" }],
  fixAppliedThisRound: false,
  regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
  residual: []
};

const catalogEntry: TaskCatalogEntry = {
  id: "T-PH001-01",
  phase_id: "PH001",
  title: "the red test",
  depends_on_task: [],
  req_ids: ["FR-NODE-001"],
  legacyReqIds: [],
  status: "pending",
  type: "code",
  action: "author the failing test",
  files: [{ path: "src/a.ts", inferred: false }],
  testFiles: [{ path: "test/a.test.ts", inferred: false }],
  coversAc: ["AC-1"],
  tdd: { phase: "red" },
  phaseDependsOn: []
};

/** A second entry sharing the first's `req_id`, so the plan has a lane rather than a folded singleton. */
const pairedCatalogEntry: TaskCatalogEntry = {
  ...catalogEntry,
  id: "T-PH001-02",
  title: "the green implementation",
  action: "make it pass",
  files: [{ path: "src/b.ts", inferred: false }],
  testFiles: [],
  tdd: { phase: "green" }
};

const convergencePoint: ConvergencePoint = {
  id: "CP-01",
  paths: ["src/shared.ts"],
  recipe: { kind: "exclusive-lane" }
};

const priorPostmortem: PriorPostmortemRow = {
  fromTask: "T-PH000-01",
  toTask: "T-PH000-02",
  path: "src/shared.ts",
  detectedAt: "coupling-check",
  resolution: "merge-into-one-lane"
};

const lanePlanInput: LanePlanInput = {
  catalog: [catalogEntry, pairedCatalogEntry],
  registry: [convergencePoint],
  existingModules: ["src/legacy-core.ts"],
  existingPaths: ["src/a.ts"],
  priorPostmortems: [priorPostmortem],
  designItemMap: { "FR-NODE-001": ["D-001"] },
  laneCap: 4,
  codeRoots: ["src/**"],
  testRoots: ["test/**"]
};

const laneDiff: LaneDiff = {
  laneId: "lane-1",
  paths: ["src/a.ts"],
  base: "aaaaaaa",
  head: "bbbbbbb",
  addedBlocks: [{ path: "src/a.ts", normalizedHash: "hash-1", declName: "helper" }]
};

const duplicationWriteSets: Record<string, string[]> = { "lane-1": ["src/a.ts"] };

const parsedHandoff: ParsedHandoff = {
  kind: "lane",
  lane: "lane-1",
  wave: 1,
  stage: 1,
  frontMatter: { write_set: ["src/a.ts"], read_set: [] },
  headings: ["Setup"],
  body: "## Setup\n"
};

const journalView: WavesJournalView = {
  runId: "2026-08-02.speckiwi.v260",
  engine: "kiwi-orchestrator",
  lines: [],
  byVerb: new Map(),
  latestPerWave: new Map(),
  schemaVersions: ["1.4.0"],
  diagnostics: []
};

const resumeCard: ResumeCard = {
  schema_version: "1.4.0",
  run_id: "2026-08-02.speckiwi.v260",
  run_contract: "docs/research/work/00.run-contract.md",
  position: { wave: 1, stage: 1, phase: "lane" },
  next_action: { verb: "execute-unit", args: {}, preconditions: [] },
  frozen: {
    engine: "kiwi-orchestrator",
    work_root: "docs/research/work",
    journal: "kiwi/waves.jsonl",
    run_root: { git_toplevel: "/repo", mcp_workspace_root: "/repo" },
    isolation_profile: "host-serial",
    base_branch: "main",
    integration_branch: "orch/integration",
    lane_lock: { "wave-1": "waves/wave-1/lanes.lock.json" }
  },
  done: [],
  open: [],
  blocked_on: null,
  invariant_digest: "sha-invariant",
  written_at: "2026-08-02T09:00:00.000Z"
};

const gitFacts: GitFacts = {
  branches: [],
  worktrees: [],
  heartbeats: [],
  integrationHead: "cccccccc",
  hostStatusPaths: []
};

const lockDigests: LockDigests = {
  design: "sha-design",
  waves: "sha-waves",
  lanes: "sha-lanes",
  handoff: { "lane-1": "sha-handoff" },
  issues: "sha-issues",
  postmortem: "sha-postmortem"
};

const driftInputs: DriftInputs = {
  lockDigests,
  recordedLaneInputs: {
    sidecarDigest: "sha-sidecar",
    registryDigest: "sha-registry",
    existingPathsDigest: "sha-existing-paths",
    designItemMapDigest: "sha-design-item-map",
    priorPostmortemDigests: ["sha-postmortem-1"],
    laneCap: 4,
    codeRoots: ["src/"],
    testRoots: ["test/"]
  },
  recomputedLaneInputDigests: {
    sidecarDigest: "sha-sidecar",
    registryDigest: "sha-registry",
    existingPathsDigest: "sha-existing-paths",
    designItemMapDigest: "sha-design-item-map",
    priorPostmortemDigests: ["sha-postmortem-1"]
  },
  freshIntentDigests: {},
  handoffProseDigests: {}
};

const autoGateInput: AutoGateInput = {
  gateId: "route-proposal",
  critical: false,
  options: [{ id: "R-ORCH", recommended: true, defaultIfAuto: false }],
  mode: "auto",
  votes: null,
  quorum: { expected: 3, present: 3 },
  tieRung: false
};

// ---------------------------------------------------------------------------------------------

describe("FR-NODE-108 AC-6 — one fixture per input type, and every kernel called with it", () => {
  it("calls all six kernels on fixtures built from the exported declarations alone", () => {
    expect(evaluateRound(round)).toBeDefined();
    expect(computeLanePlan(lanePlanInput)).toBeDefined();
    expect(planDuplicationAudit([laneDiff], duplicationWriteSets)).toBeDefined();
    expect(planStageCoupling([parsedHandoff])).toBeDefined();
    expect(computeResumeState(journalView, resumeCard, gitFacts, driftInputs)).toBeDefined();
    expect(decideAutoGate(autoGateInput)).toBeDefined();
  });

  it("declares six kernels, and every one of them is exercised above", () => {
    const kernels = [evaluateRound, computeLanePlan, planDuplicationAudit, planStageCoupling, computeResumeState, decideAutoGate];
    expect(kernels).toHaveLength(6);
    for (const kernel of kernels) expect(typeof kernel).toBe("function");
  });
});

describe("FR-NODE-108 AC-1 — declared arity, per kernel", () => {
  it("matches the arity §10.1 states for each of the six", () => {
    expect(evaluateRound).toHaveLength(1);
    expect(computeLanePlan).toHaveLength(1);
    expect(planDuplicationAudit).toHaveLength(2);
    expect(planStageCoupling).toHaveLength(1);
    expect(computeResumeState).toHaveLength(4);
    expect(decideAutoGate).toHaveLength(1);
  });
});

// Not AC-2's carrier, and titled so it cannot be mistaken for it: these cases assert the runtime
// SHAPE of fixtures built from the declarations. The criterion is a claim about the type graph, and
// types are erased at runtime, so what carries it is the typecheck project — see the block below.
describe("FR-NODE-108 AC-2 supporting shape — fixtures built from the declarations are complete", () => {
  it("reaches LanePlanInput through TaskCatalogEntry, ConvergencePoint, Lane and Stage", () => {
    // `catalog`, `registry` and `priorPostmortems` are annotated above with their exported element
    // types, so this file would not compile if any of the three were unexported or incomplete.
    expect(lanePlanInput.catalog[0]).toBe(catalogEntry);
    expect(lanePlanInput.registry[0]).toBe(convergencePoint);
    expect(lanePlanInput.priorPostmortems[0]).toBe(priorPostmortem);

    // `Lane` and `Stage` are the output side of the same contract, and E43 names them because a
    // fixture for a *later* kernel is built from a plan this one returns.
    const plan = computeLanePlan(lanePlanInput);
    const lane: Lane | undefined = plan.lanes[0];
    const stage: Stage | undefined = plan.stages[0];
    expect(lane?.laneId).toBeTypeOf("string");
    expect(stage?.laneIds).toBeInstanceOf(Array);
  });

  it("declares all nine LanePlanInput members, so no input reaches the kernel undeclared", () => {
    expect(Object.keys(lanePlanInput).sort()).toEqual(
      ["catalog", "codeRoots", "designItemMap", "existingModules", "existingPaths", "laneCap", "priorPostmortems", "registry", "testRoots"].sort()
    );
    expect(Object.keys(lanePlanInput)).toHaveLength(9);
  });

  it("reaches computeResumeState's fourth argument through DriftInputs and LockDigests", () => {
    expect(driftInputs.lockDigests).toBe(lockDigests);
    expect(Object.keys(lockDigests).sort()).toEqual(["design", "handoff", "issues", "lanes", "postmortem", "waves"]);
    expect(Object.keys(driftInputs.recordedLaneInputs)).toHaveLength(8);
  });
});

describe("FR-NODE-108 AC-3 — planStageCoupling takes exactly one argument", () => {
  it("takes ParsedHandoff[] and nothing else", () => {
    expect(planStageCoupling).toHaveLength(1);
    // `existing_paths` is not among them: `stage-coupling` is write∩read over authored handoffs, and
    // revision 2's path-level `shared-substrate` predicate — the one that needed `existing_paths` —
    // was withdrawn as wholly subsumed (§7.9 a, X-04).
    expect(planStageCoupling([parsedHandoff])).toEqual({ couplings: [] });
  });
});

describe("FR-NODE-108 AC-4 — AutoGateInput's seven fields and the closed action vocabulary", () => {
  it("declares gateId, critical, options[], mode, a nullable votes[], quorum and tieRung", () => {
    expect(Object.keys(autoGateInput).sort()).toEqual(["critical", "gateId", "mode", "options", "quorum", "tieRung", "votes"]);
    expect(Object.keys(autoGateInput)).toHaveLength(7);
    expect(Object.keys(autoGateInput.options[0] as object).sort()).toEqual(["defaultIfAuto", "id", "recommended"]);
    expect(Object.keys(autoGateInput.quorum).sort()).toEqual(["expected", "present"]);
    expect(autoGateInput.votes).toBeNull();
  });

  it("draws the returned action from the closed five-value AutoGateAction vocabulary", () => {
    expect(AUTO_GATE_ACTIONS).toHaveLength(5);
    expect(AUTO_GATE_ACTIONS).toContain(decideAutoGate(autoGateInput).action);
    const withVotes: AutoGateInput = {
      ...autoGateInput,
      options: [
        { id: "R-ORCH", recommended: false, defaultIfAuto: false },
        { id: "R-PLAN", recommended: false, defaultIfAuto: false }
      ],
      votes: [
        { member: "m1", optionId: "R-ORCH", confidence: 0.9 },
        { member: "m2", optionId: "R-ORCH", confidence: 0.8 },
        { member: "m3", optionId: "R-PLAN", confidence: 0.7 }
      ]
    };
    expect(AUTO_GATE_ACTIONS).toContain(decideAutoGate(withVotes).action);
    expect(AUTO_GATE_ACTIONS).toContain(decideAutoGate({ ...autoGateInput, critical: true }).action);
  });
});

describe("FR-NODE-108 AC-5 — computeResumeState takes four arguments and touches nothing impure", () => {
  it("receives every impure fact through GitFacts and DriftInputs", () => {
    expect(computeResumeState).toHaveLength(4);
    expect(Object.keys(gitFacts).sort()).toEqual(["branches", "heartbeats", "hostStatusPaths", "integrationHead", "worktrees"]);
    // The whole fixture is in-memory: no path is opened, no ref is resolved, no clock is read. A
    // module that reached for any of them would need a root or a runner in one of these four
    // arguments, and none of the four declares one.
    const state = computeResumeState(journalView, resumeCard, gitFacts, driftInputs);
    expect(state.classification).toBeInstanceOf(Array);
    expect(state.drift.digests).toHaveLength(4);
  });

  it("is deterministic over the same four arguments", () => {
    const first = computeResumeState(journalView, resumeCard, gitFacts, driftInputs);
    const second = computeResumeState(journalView, resumeCard, gitFacts, driftInputs);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("FR-NODE-108 AC-2 — the type-level claim, and the thing that carries it", () => {
  // AC-2 is a claim about the type graph, and types are erased at runtime: measured, removing
  // `action: string` from `TaskCatalogEntry` leaves every case above at 11 passed while
  // `typecheck:test` fails at the two `action:` lines with TS2353. So the carrier is the project,
  // not this file's assertions — and the carrier only reaches this file because
  // `tsconfig.test.json` globs it in. Nothing asserted that membership, so moving this file to
  // `test/core/` would have removed the protection with no test noticing. This is that assertion.
  it("is inside the typecheck project that carries the criterion", () => {
    const project = JSON.parse(readFileSync(path.join(process.cwd(), "tsconfig.test.json"), "utf8")) as {
      include?: string[];
    };
    const include = project.include ?? [];
    expect(include.length, "the project must declare what it covers").toBeGreaterThan(0);

    const self = path.relative(process.cwd(), fileURLToPath(import.meta.url)).split(path.sep).join("/");

    // Two glob shapes appear in the project. A third would silently match nothing here, so the
    // shapes themselves are asserted rather than assumed.
    const covers = (glob: string): boolean => {
      const recursive = /^(.*)\/\*\*\/\*\.ts$/.exec(glob);
      if (recursive) return self.startsWith(`${recursive[1] as string}/`) && self.endsWith(".ts");
      const flat = /^(.*)\/([^/*]*)\*\.ts$/.exec(glob);
      if (flat) {
        const rest = self.startsWith(`${flat[1] as string}/${flat[2] as string}`)
          ? self.slice((flat[1] as string).length + 1)
          : null;
        return rest !== null && !rest.includes("/") && self.endsWith(".ts");
      }
      throw new Error(`unrecognised include glob shape: ${glob}`);
    };

    expect(include.some(covers), `${self} is not covered by ${JSON.stringify(include)}`).toBe(true);
  });
});
