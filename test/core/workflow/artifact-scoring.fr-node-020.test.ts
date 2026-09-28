import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkflowArtifacts, type ResolveWorkflowArtifactOptions } from "../../../src/core/workflow/artifacts.js";
import { writeText } from "../../support/workflow-harness.js";

// @req FR-NODE-020 AC-2 — each scoring signal, shown by two candidates that differ in that signal
// alone: the one the signal favours scores higher and is the one selected.

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-020-"));
  roots.push(root);
  for (const [relativePath, text] of Object.entries(files)) await writeText(root, relativePath, text);
  return root;
}

async function scores(root: string, options: ResolveWorkflowArtifactOptions) {
  const resolved = await resolveWorkflowArtifacts({ root }, options);
  const byPath = new Map(resolved.candidates.map((candidate) => [candidate.relativePath, candidate.score]));
  return { resolved, score: (relativePath: string): number => {
    const value = byPath.get(relativePath);
    expect(value, `${relativePath} was not a candidate`).toBeDefined();
    return value!;
  } };
}

const EMPTY_STATE = JSON.stringify({ tasks: [] });

describe("FR-NODE-020 AC-2 — candidate scoring applies the documented signals", () => {
  it("FR-NODE-020 AC-2: an explicit match outranks the same file found by discovery", async () => {
    const root = await workspace({ "kiwi/a/pm-state.json": EMPTY_STATE, "kiwi/b/pm-state.json": EMPTY_STATE });
    const discovered = await scores(root, { kind: "pm-state", allowAmbiguous: true });
    const explicit = await scores(root, { kind: "pm-state", explicitPath: "kiwi/a/pm-state.json" });
    expect(explicit.score("kiwi/a/pm-state.json")).toBeGreaterThan(discovered.score("kiwi/a/pm-state.json"));
    expect(explicit.resolved.selected?.relativePath).toBe("kiwi/a/pm-state.json");
  });

  it("FR-NODE-020 AC-2: the current contract path outranks the same kind elsewhere — pipeline and session state", async () => {
    const pipelineRoot = await workspace({ "kiwi/pipeline.jsonl": "", "kiwi/archive/pipeline.jsonl": "" });
    const pipeline = await scores(pipelineRoot, { kind: "pipeline" });
    expect(pipeline.score("kiwi/pipeline.jsonl")).toBeGreaterThan(pipeline.score("kiwi/archive/pipeline.jsonl"));
    expect(pipeline.resolved.selected?.relativePath).toBe("kiwi/pipeline.jsonl");

    const sessionRoot = await workspace({ ".kiwi/sessions/r1/pm-state.json": EMPTY_STATE, ".kiwi/sessions/r1/old/pm-state.json": EMPTY_STATE });
    const session = await scores(sessionRoot, { kind: "pm-state", runId: "r1" });
    expect(session.score(".kiwi/sessions/r1/pm-state.json")).toBeGreaterThan(session.score(".kiwi/sessions/r1/old/pm-state.json"));
    expect(session.resolved.selected?.relativePath).toBe(".kiwi/sessions/r1/pm-state.json");
  });

  it("FR-NODE-020 AC-2: a target match raises a candidate and a target mismatch lowers it below one that names no target", async () => {
    const root = await workspace({
      "kiwi/match/pm-state.json": JSON.stringify({ target: "v1" }),
      "kiwi/none/pm-state.json": EMPTY_STATE,
      "kiwi/mismatch/pm-state.json": JSON.stringify({ target: "v2" })
    });
    const { resolved, score } = await scores(root, { kind: "pm-state", target: "v1" });
    expect(score("kiwi/match/pm-state.json")).toBeGreaterThan(score("kiwi/none/pm-state.json"));
    expect(score("kiwi/none/pm-state.json")).toBeGreaterThan(score("kiwi/mismatch/pm-state.json"));
    expect(resolved.selected?.relativePath).toBe("kiwi/match/pm-state.json");
  });

  it("FR-NODE-020 AC-2: a run ID match raises a candidate and a run ID mismatch lowers it below one that names no run", async () => {
    const root = await workspace({
      "kiwi/match/pm-state.json": JSON.stringify({ run_id: "r1" }),
      "kiwi/none/pm-state.json": EMPTY_STATE,
      "kiwi/mismatch/pm-state.json": JSON.stringify({ run_id: "r2" })
    });
    const { resolved, score } = await scores(root, { kind: "pm-state", runId: "r1" });
    expect(score("kiwi/match/pm-state.json")).toBeGreaterThan(score("kiwi/none/pm-state.json"));
    expect(score("kiwi/none/pm-state.json")).toBeGreaterThan(score("kiwi/mismatch/pm-state.json"));
    expect(resolved.selected?.relativePath).toBe("kiwi/match/pm-state.json");
  });

  it("FR-NODE-020 AC-2: a recorded generated_at raises a candidate over an otherwise equal one", async () => {
    const root = await workspace({
      "kiwi/dated/pm-state.json": JSON.stringify({ generated_at: "2026-09-28T00:00:00.000Z" }),
      "kiwi/undated/pm-state.json": EMPTY_STATE
    });
    const { resolved, score } = await scores(root, { kind: "pm-state" });
    expect(score("kiwi/dated/pm-state.json")).toBeGreaterThan(score("kiwi/undated/pm-state.json"));
    expect(resolved.selected?.relativePath).toBe("kiwi/dated/pm-state.json");
  });

  it("FR-NODE-020 AC-2: a legacy location is penalised against the same state in a current location", async () => {
    const root = await workspace({ ".snoworca/sessions/s/pm-state.json": EMPTY_STATE, "kiwi/s/pm-state.json": EMPTY_STATE });
    const { resolved, score } = await scores(root, { kind: "pm-state" });
    expect(score("kiwi/s/pm-state.json")).toBeGreaterThan(score(".snoworca/sessions/s/pm-state.json"));
    expect(resolved.candidates.find((candidate) => candidate.relativePath === ".snoworca/sessions/s/pm-state.json")?.legacy).toBe(true);
    expect(resolved.selected?.relativePath).toBe("kiwi/s/pm-state.json");
  });

  it("FR-NODE-020 AC-2: a parse error lowers a candidate and is reported", async () => {
    const root = await workspace({ "kiwi/broken/pm-state.json": "{not json", "kiwi/sound/pm-state.json": EMPTY_STATE });
    const { resolved, score } = await scores(root, { kind: "pm-state" });
    expect(score("kiwi/sound/pm-state.json")).toBeGreaterThan(score("kiwi/broken/pm-state.json"));
    expect(resolved.selected?.relativePath).toBe("kiwi/sound/pm-state.json");
    expect(resolved.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W050", filePath: "kiwi/broken/pm-state.json" })]));
  });
});
