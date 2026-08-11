import { describe, expect, it } from "vitest";
import {
  type WorktreeProbes,
  classifyRoot,
  preflightRunRootForRole
} from "../../../src/core/orchestrator/worktree-topology.js";

// @req FR-NODE-186
//
// The existing run-root gate compares two roots for equality, so it refuses every worktree —
// including the ones the run itself created and planned. That is why worktree isolation is
// unreachable today: the mechanism that would grant it is, to the gate, indistinguishable from the
// accident the gate exists to catch. The discriminator measured on this repository is the git common
// directory: every linked worktree reports the same one while reporting a different top level.

const HOST = "C:/Work/repo";
const LANE = "C:/Work/repo/.claude/worktrees/agent-1";
const OTHER = "C:/Work/other";
const HOST_COMMON = "C:/Work/repo/.git";
const OTHER_COMMON = "C:/Work/other/.git";

function probes(overrides: Partial<WorktreeProbes> = {}): WorktreeProbes {
  return {
    realpath: (value) => value,
    gitToplevel: (value) => (value === HOST ? HOST : value === LANE ? LANE : value === OTHER ? OTHER : undefined),
    gitCommonDir: (value) =>
      value === HOST || value === LANE ? HOST_COMMON : value === OTHER ? OTHER_COMMON : undefined,
    registeredWorktrees: (commonDir) => (commonDir === HOST_COMMON ? [HOST, LANE] : [OTHER]),
    ...overrides
  };
}

describe("FR-NODE-186 — worktree topology classification", () => {
  it("AC-1: two roots that normalise equal are same-root whatever the probes report", () => {
    // Backslashes and a trailing separator, so the answer comes from normalisation and not equality.
    expect(classifyRoot(HOST, "C:\\Work\\repo\\", probes())).toBe("same-root");
  });

  it("AC-2: a registered worktree of the MCP root's repository is linked-worktree", () => {
    expect(classifyRoot(HOST, LANE, probes())).toBe("linked-worktree");
  });

  it("AC-3: the same common directory but unregistered is unregistered-worktree", () => {
    const forged = probes({ registeredWorktrees: () => [HOST] });
    expect(classifyRoot(HOST, LANE, forged)).toBe("unregistered-worktree");
  });

  it("AC-4: a different repository is foreign-repo and a non-repository path is not-a-repo", () => {
    expect(classifyRoot(HOST, OTHER, probes())).toBe("foreign-repo");
    expect(classifyRoot(HOST, "C:/tmp", probes())).toBe("not-a-repo");
  });
});

const LANE_PLAN = {
  "w1-s1-l1": { writeSet: ["src/core/a.ts", "test/core/a.test.ts"] },
  "w1-s1-l2": { writeSet: ["docs/spec/50.nodejs-implementation.srs.md"] }
};

describe("FR-NODE-186 — the role-declared run-root gate", () => {
  it("AC-5: a lane root that is not a linked worktree is refused, naming the classification", () => {
    const verdict = preflightRunRootForRole(
      { role: "lane", mcpRoot: HOST, gitRoot: OTHER, laneId: "w1-s1-l1", lanePlan: LANE_PLAN },
      probes()
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("lane-root-foreign-repo");
    expect(verdict.topology).toBe("foreign-repo");
  });

  it("AC-5: each non-lane classification has its own refusal reason", () => {
    const cases: Array<[string, string]> = [
      [HOST, "lane-root-is-host-root"],
      ["C:/tmp", "lane-root-not-a-repo"]
    ];
    for (const [gitRoot, reason] of cases) {
      const verdict = preflightRunRootForRole(
        { role: "lane", mcpRoot: HOST, gitRoot, laneId: "w1-s1-l1", lanePlan: LANE_PLAN },
        probes()
      );
      expect(verdict.reason, `git root ${gitRoot}`).toBe(reason);
    }
    const forged = preflightRunRootForRole(
      { role: "lane", mcpRoot: HOST, gitRoot: LANE, laneId: "w1-s1-l1", lanePlan: LANE_PLAN },
      probes({ registeredWorktrees: () => [HOST] })
    );
    expect(forged.reason).toBe("lane-root-unregistered");
  });

  it("AC-6: a well-formed worktree whose lane is not in the frozen plan is still refused", () => {
    const verdict = preflightRunRootForRole(
      { role: "lane", mcpRoot: HOST, gitRoot: LANE, laneId: "w9-s9-l9", lanePlan: LANE_PLAN },
      probes()
    );

    expect(verdict.topology).toBe("linked-worktree");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("lane-id-not-in-plan");
  });

  it("AC-7: a lane whose write set names a path under docs/spec/ is refused", () => {
    const verdict = preflightRunRootForRole(
      { role: "lane", mcpRoot: HOST, gitRoot: LANE, laneId: "w1-s1-l2", lanePlan: LANE_PLAN },
      probes()
    );

    expect(verdict.reason).toBe("lane-write-set-touches-srs");
  });

  it("AC-6: a planned lane in a registered worktree passes", () => {
    const verdict = preflightRunRootForRole(
      { role: "lane", mcpRoot: HOST, gitRoot: LANE, laneId: "w1-s1-l1", lanePlan: LANE_PLAN },
      probes()
    );

    expect(verdict).toMatchObject({ ok: true, reason: null, topology: "linked-worktree" });
  });

  it("AC-8: a host root that is itself a linked worktree is refused", () => {
    // The MCP server was started inside a worktree: both roots agree, so the equality gate passes,
    // but SRS written here lands in a checkout that still has to be merged.
    const verdict = preflightRunRootForRole({ role: "host", mcpRoot: LANE, gitRoot: LANE }, probes());

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("host-root-is-a-linked-worktree");
  });

  it("AC-8: a host root at the repository top level passes", () => {
    expect(preflightRunRootForRole({ role: "host", mcpRoot: HOST, gitRoot: HOST }, probes())).toMatchObject({
      ok: true,
      reason: null
    });
  });

  it("AC-8: the host verdict does not depend on the order git lists worktrees in", () => {
    // `git worktree list` reports the main checkout first, and a verdict that read the list
    // positionally would invert the moment that ordering changed. Both orders must agree.
    const reversed = probes({ registeredWorktrees: () => [LANE, HOST] });
    expect(preflightRunRootForRole({ role: "host", mcpRoot: HOST, gitRoot: HOST }, reversed).ok).toBe(true);
    expect(preflightRunRootForRole({ role: "host", mcpRoot: LANE, gitRoot: LANE }, reversed).reason).toBe(
      "host-root-is-a-linked-worktree"
    );
  });

  it("AC-9: relabelling does not satisfy the gate in either direction", () => {
    // A lane root declared as host: refused because the two roots differ.
    expect(preflightRunRootForRole({ role: "host", mcpRoot: HOST, gitRoot: LANE }, probes()).ok).toBe(false);
    // A host root declared as lane: refused because a lane may not be the host root.
    expect(
      preflightRunRootForRole(
        { role: "lane", mcpRoot: HOST, gitRoot: HOST, laneId: "w1-s1-l1", lanePlan: LANE_PLAN },
        probes()
      ).ok
    ).toBe(false);
  });
});
