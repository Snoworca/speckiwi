import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_ARTIFACT_KINDS,
  resolveWorkflowArtifacts,
  type WorkflowArtifactKind
} from "../../../src/core/workflow/artifacts.js";

// @req FR-NODE-126 — three orchestrator artifact kinds plus the lanes/{lane} session layout.

/** The kinds the resolver carried before this requirement; the baseline AC-1 measures against. */
const PRE_EXISTING_KINDS = [
  "plan",
  "sidecar",
  "validator",
  "analysis",
  "pipeline",
  "pm-state",
  "coder-state",
  "task-state",
  "worklog",
  "lock",
  "legacy",
  "unknown"
] as const;

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrator-artifacts-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

/** Resolves one explicit path and returns the selected candidate, failing loudly when none is. */
async function resolveOne(
  root: string,
  relativePath: string,
  options: { runId?: string } = {}
): Promise<{ relativePath: string; kind: WorkflowArtifactKind; runId?: string; score: number }> {
  const resolution = await resolveWorkflowArtifacts({ root } as never, { explicitPath: relativePath, ...options });
  const selected = resolution.selected;
  expect(selected, `no candidate resolved for ${relativePath}`).not.toBeNull();
  return selected as NonNullable<typeof selected>;
}

describe("FR-NODE-126 AC-1 — the kind vocabulary gains exactly waves, resume-card and handoff", () => {
  it("adds three members and does not add lane-manifest", () => {
    const added = WORKFLOW_ARTIFACT_KINDS.filter((kind) => !PRE_EXISTING_KINDS.includes(kind as never));

    expect([...added].sort()).toEqual(["handoff", "resume-card", "waves"]);
    expect(added).toHaveLength(3);
    expect(WORKFLOW_ARTIFACT_KINDS).not.toContain("lane-manifest");
    // Nothing was dropped while three were added.
    for (const kind of PRE_EXISTING_KINDS) expect(WORKFLOW_ARTIFACT_KINDS).toContain(kind);
    expect(WORKFLOW_ARTIFACT_KINDS).toHaveLength(PRE_EXISTING_KINDS.length + 3);
  });
});

describe("FR-NODE-126 AC-2 — the resolver names the three orchestrator artifacts", () => {
  it("returns waves for the journal, resume-card for the card and handoff for a lane handoff document", async () => {
    const root = await tempRoot();
    await write(root, "kiwi/waves.jsonl", `${JSON.stringify({ schema_version: "1.4.0", run_id: "run-a" })}\n`);
    await write(root, "kiwi/orchestrator/run-a/resume-card.json", JSON.stringify({ run_id: "run-a" }));
    await write(root, "docs/research/demo/waves/wave-2/lanes/lane-3.md", "# Lane 3\n");

    expect((await resolveOne(root, "kiwi/waves.jsonl")).kind).toBe("waves");
    expect((await resolveOne(root, "kiwi/orchestrator/run-a/resume-card.json")).kind).toBe("resume-card");
    expect((await resolveOne(root, "docs/research/demo/waves/wave-2/lanes/lane-3.md")).kind).toBe("handoff");
  });
});

describe("FR-NODE-126 AC-3 — run-id derivation over the lane-suffixed session layout", () => {
  it("derives the plan_run_id, never the literal lanes segment and never the lane id", async () => {
    const root = await tempRoot();
    // No run_id inside the file: the derivation under test is the one that reads the path.
    await write(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l3/pm-state.json", JSON.stringify({ tasks: [] }));

    const selected = await resolveOne(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l3/pm-state.json");

    expect(selected.runId).toBe("plan-run-7");
    expect(selected.runId).not.toBe("lanes");
    expect(selected.runId).not.toBe("w2s1l3");
  });
});

describe("FR-NODE-126 AC-4 — the lane-suffixed layout earns the same canonical-path bonus", () => {
  it("scores a lanes/{lane}/pm-state.json equal to the unsuffixed pm-state.json of the same run", async () => {
    const root = await tempRoot();
    await write(root, ".kiwi/sessions/plan-run-7/pm-state.json", JSON.stringify({ tasks: [] }));
    await write(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l3/pm-state.json", JSON.stringify({ tasks: [] }));

    const unsuffixed = await resolveOne(root, ".kiwi/sessions/plan-run-7/pm-state.json", { runId: "plan-run-7" });
    const suffixed = await resolveOne(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l3/pm-state.json", { runId: "plan-run-7" });

    expect(suffixed.score).toBe(unsuffixed.score);
    // A positive floor: equality would also hold if the bonus were removed from both sides.
    const noRunId = await resolveOne(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l3/pm-state.json");
    expect(suffixed.score).toBeGreaterThan(noRunId.score);
  });
});

describe("FR-NODE-126 AC-5 — two lanes of one plan_run_id resolve independently", () => {
  it("keeps each lane's suffixed pm-state.json distinct while both carry the plan_run_id", async () => {
    const root = await tempRoot();
    await write(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l1/pm-state.json", JSON.stringify({ tasks: ["l1"] }));
    await write(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l2/pm-state.json", JSON.stringify({ tasks: ["l2"] }));

    const laneOne = await resolveOne(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l1/pm-state.json", { runId: "plan-run-7" });
    const laneTwo = await resolveOne(root, ".kiwi/sessions/plan-run-7/lanes/w2s1l2/pm-state.json", { runId: "plan-run-7" });

    expect(laneOne.runId).toBe("plan-run-7");
    expect(laneTwo.runId).toBe("plan-run-7");
    expect(laneOne.relativePath).toBe(".kiwi/sessions/plan-run-7/lanes/w2s1l1/pm-state.json");
    expect(laneTwo.relativePath).toBe(".kiwi/sessions/plan-run-7/lanes/w2s1l2/pm-state.json");
    expect(laneOne.relativePath).not.toBe(laneTwo.relativePath);
  });
});
