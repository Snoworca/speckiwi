import { describe, expect, it } from "vitest";
import {
  ROLE_REFUSAL_REASONS,
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
const LANE2 = "C:/Work/repo/.claude/worktrees/agent-2";
const OTHER = "C:/Work/other";
const HOST_COMMON = "C:/Work/repo/.git";
const OTHER_COMMON = "C:/Work/other/.git";

function probes(overrides: Partial<WorktreeProbes> = {}): WorktreeProbes {
  return {
    realpath: (value) => value,
    gitToplevel: (value) => ([HOST, LANE, LANE2, OTHER].includes(value) ? value : undefined),
    gitCommonDir: (value) =>
      [HOST, LANE, LANE2].includes(value) ? HOST_COMMON : value === OTHER ? OTHER_COMMON : undefined,
    registeredWorktrees: (commonDir) => (commonDir === HOST_COMMON ? [HOST, LANE, LANE2] : [OTHER]),
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

  it("AC-8: a host root that is itself a linked worktree passes when the two roots agree", () => {
    // @req FR-NODE-186 AC-8
    // The host session runs from a linked worktree and the MCP server is bound to that same
    // worktree: the roots agree, so the host gate passes.
    const verdict = preflightRunRootForRole({ role: "host", mcpRoot: LANE, gitRoot: LANE }, probes());

    expect(verdict).toMatchObject({ ok: true, reason: null, topology: "same-root" });
  });

  it("AC-8: a host root at the repository top level passes", () => {
    // @req FR-NODE-186 AC-8
    expect(preflightRunRootForRole({ role: "host", mcpRoot: HOST, gitRoot: HOST }, probes())).toMatchObject({
      ok: true,
      reason: null
    });
  });

  it("AC-8: a host root that does not equal the MCP root is refused as host-roots-differ", () => {
    // @req FR-NODE-186 AC-8
    for (const [mcpRoot, gitRoot] of [
      [HOST, LANE],
      [LANE, HOST],
      [LANE, LANE2]
    ] as const) {
      const verdict = preflightRunRootForRole({ role: "host", mcpRoot, gitRoot }, probes());
      expect(verdict, `${mcpRoot} vs ${gitRoot}`).toMatchObject({ ok: false, reason: "host-roots-differ" });
    }
  });

  it("AC-8: host-root-is-a-linked-worktree is no longer a refusal reason", () => {
    // @req FR-NODE-186 AC-8
    expect(ROLE_REFUSAL_REASONS).not.toContain("host-root-is-a-linked-worktree");
  });

  it("AC-8: the host verdict does not depend on the order git lists worktrees in", () => {
    // @req FR-NODE-186 AC-8
    const reversed = probes({ registeredWorktrees: () => [LANE2, LANE, HOST] });
    expect(preflightRunRootForRole({ role: "host", mcpRoot: HOST, gitRoot: HOST }, reversed).ok).toBe(true);
    expect(preflightRunRootForRole({ role: "host", mcpRoot: LANE, gitRoot: LANE }, reversed).ok).toBe(true);
  });

  it("AC-9: relabelling does not satisfy the gate in either direction", () => {
    // @req FR-NODE-186 AC-9
    // A lane root declared as host: refused because the two roots differ.
    expect(preflightRunRootForRole({ role: "host", mcpRoot: HOST, gitRoot: LANE }, probes()).ok).toBe(false);
    // The host is itself a linked worktree now that AC-8 admits one; a sibling lane declared as host
    // is still refused.
    expect(preflightRunRootForRole({ role: "host", mcpRoot: LANE, gitRoot: LANE2 }, probes()).ok).toBe(false);
    // A host root declared as lane: refused because a lane may not be the host root.
    expect(
      preflightRunRootForRole(
        { role: "lane", mcpRoot: HOST, gitRoot: HOST, laneId: "w1-s1-l1", lanePlan: LANE_PLAN },
        probes()
      ).ok
    ).toBe(false);
    // A linked-worktree host root declared as lane: refused for the same reason.
    expect(
      preflightRunRootForRole(
        { role: "lane", mcpRoot: LANE, gitRoot: LANE, laneId: "w1-s1-l1", lanePlan: LANE_PLAN },
        probes()
      ).reason
    ).toBe("lane-root-is-host-root");
  });
});

describe("FR-FLOW-230 — a host in a linked worktree with lanes in sibling worktrees", () => {
  it("AC-1: the host-role gate passes and a sibling worktree passes the lane gate", () => {
    // @req FR-FLOW-230 AC-1
    const host = preflightRunRootForRole({ role: "host", mcpRoot: LANE, gitRoot: LANE }, probes());
    expect(host).toMatchObject({ ok: true, reason: null });

    const lane = preflightRunRootForRole(
      { role: "lane", mcpRoot: LANE, gitRoot: LANE2, laneId: "w1-s1-l1", lanePlan: LANE_PLAN },
      probes()
    );
    expect(lane).toMatchObject({ ok: true, reason: null, topology: "linked-worktree" });

    // The main checkout, seen from a linked-worktree host, is also a registered worktree of the
    // repository, so it classifies the same way.
    expect(classifyRoot(LANE, HOST, probes())).toBe("linked-worktree");
  });
});
