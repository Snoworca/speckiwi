// Fixture builders for the resume card and for `computeResumeState`'s injected facts.
import { computeInvariantDigest, type ResumeCard } from "../../../src/core/orchestrator/resume-card.js";
import type { DriftInputs, GitFacts } from "../../../src/core/orchestrator/resume.js";

export type Json = Record<string, unknown>;

export const DESIGN_LOCK = "design/00.design.lock.json@sha256:4ab0";
export const WAVES_LOCK = "waves/waves.lock.json@sha256:c17e";
export const LANE_LOCK = "waves/wave-1/lanes.lock.json@sha256:5b3a";

export function frozenBlock(overrides: Json = {}): ResumeCard["frozen"] {
  return {
    engine: "kiwi-orchestrator",
    work_root: "docs/research/v260-orchestrator/",
    journal: "kiwi/waves.jsonl",
    run_root: { git_toplevel: "C:/Work/git/_Snoworca/speckiwi", mcp_workspace_root: "C:/Work/git/_Snoworca/speckiwi" },
    isolation_profile: "none-serial",
    proof_strength: "strong",
    base_branch: "feat/2.3.0.1",
    integration_branch: "kiwi/orch/run-a/integration",
    design_lock: DESIGN_LOCK,
    waves_lock: WAVES_LOCK,
    lane_lock: { "wave-1": LANE_LOCK },
    ...overrides
  } as ResumeCard["frozen"];
}

/** A card that passes every §4.1 rule; each fixture below mutates exactly one thing. */
export function minimalCard(overrides: Partial<ResumeCard> = {}): ResumeCard {
  const frozen = (overrides.frozen ?? frozenBlock()) as ResumeCard["frozen"];
  return {
    schema_version: "1.0.0",
    run_id: "run-a",
    run_contract: "docs/research/v260-orchestrator/00.run-contract.md@sha256:9f1c",
    position: { wave: 1, stage: 1, phase: "execute" },
    next_action: {
      verb: "execute-unit",
      args: { wave: 1, stage: 1, lane: "lane-1" },
      preconditions: [
        "P-DESIGN-FROZEN",
        "P-LANE-PLAN-FROZEN",
        "P-HANDOFF-VERIFIED",
        "P-WAVE-ISSUES-CLOSED",
        "P-PRIOR-STAGES-INTEGRATED"
      ]
    },
    frozen,
    done: [{ key: "intake", proof: { kind: "digest", ref: DESIGN_LOCK } }],
    open: [],
    blocked_on: null,
    invariant_digest: computeInvariantDigest(frozen),
    written_at: "2026-08-02T09:12:44.201Z",
    ...overrides
  };
}

export function emptyGitFacts(overrides: Partial<GitFacts> = {}): GitFacts {
  return {
    branches: [],
    worktrees: [],
    heartbeats: [],
    integrationHead: "9a01f3c",
    hostStatusPaths: [],
    ...overrides
  };
}

export function emptyDriftInputs(overrides: Partial<DriftInputs> = {}): DriftInputs {
  const recorded = {
    sidecarDigest: "sha256:sidecar",
    registryDigest: "sha256:registry",
    existingPathsDigest: "sha256:paths",
    designItemMapDigest: "sha256:map",
    priorPostmortemDigests: ["sha256:pm1"],
    laneCap: 8,
    codeRoots: ["src/**"],
    testRoots: ["test/**"]
  };
  return {
    lockDigests: {
      design: DESIGN_LOCK,
      waves: WAVES_LOCK,
      lanes: LANE_LOCK,
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
      priorPostmortemDigests: [...recorded.priorPostmortemDigests]
    },
    freshIntentDigests: {},
    handoffProseDigests: {},
    ...overrides
  };
}
