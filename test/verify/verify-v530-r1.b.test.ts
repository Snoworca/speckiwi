import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { checkWorkGraph, type CheckRecord } from "../../src/core/orchestrator/wave-check.js";
import { proposeWaves, readExpectedFiles, type ProposalRequirement, type WaveProposal } from "../../src/core/orchestrator/wave-propose.js";

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// FR-NODE-246 helpers
// ---------------------------------------------------------------------------------------------

function gnode(wave: string, acs: string[], extra: Json = {}): Json {
  return { wave, title: `node ${wave}`, purpose: "why", acs, done_when: [], files: [`src/${wave}.ts`], ...extra };
}

function graph(extra: Json = {}): Json {
  return {
    schema_version: "2.0.0",
    run_id: "run-a",
    title: "g",
    scope: { target: "5.3.0" },
    nodes: [gnode("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"]), gnode("wave-2", ["FR-A-002 AC-1"])],
    edges: [{ from: "wave-1", to: "wave-2" }],
    ...extra
  };
}

function crecord(id: string, acIds: string[], extra: Partial<CheckRecord> = {}): CheckRecord {
  return {
    id,
    target: "5.3.0",
    status: "planned",
    stability: "evolving",
    acceptanceCriteria: acIds.map((acId, index) => ({ id: acId, text: "t", checked: false, line: index + 1 })),
    traceLinks: [],
    ...extra
  };
}

function crecords(): CheckRecord[] {
  return [crecord("FR-A-001", ["AC-1", "AC-2"]), crecord("FR-A-002", ["AC-1"])];
}

describe("FR-NODE-246 — verify r1.b", () => {
  // @req FR-NODE-246 AC-8
  it("FR-NODE-246 AC-8: an unknown placeholder in each of two nodes is reported as an error for each node", () => {
    const action = { id: "notify-team", kind: "notify", channel: "team", message: "done {bogus}" };
    const value = graph({
      nodes: [
        gnode("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], { on_complete: [action] }),
        gnode("wave-2", ["FR-A-002 AC-1"], { on_complete: [action] })
      ]
    });
    const report = checkWorkGraph({ graph: value, records: crecords(), journal: null });
    const placeholders = report.diagnostics.filter((item) => item.code === "message-placeholder-unknown");
    const nodes = placeholders.map((item) => (item.details as { node?: unknown } | undefined)?.node).sort();
    expect(nodes).toEqual(["wave-1", "wave-2"]);
  });

  // @req FR-NODE-246 AC-7
  it("FR-NODE-246 AC-7: a URL in an on_complete field written as a single object, not a list, is url-in-action", () => {
    const value = graph({
      nodes: [
        gnode("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], {
          on_complete: { id: "notify-team", kind: "notify", channel: "team", message: "see https://hooks.example.com/x" }
        }),
        gnode("wave-2", ["FR-A-002 AC-1"])
      ]
    });
    const report = checkWorkGraph({ graph: value, records: crecords(), journal: null });
    // Lead decision (round 1): a non-list on_complete makes the whole graph invalid, so the URL never
    // passes; the property kept is that the check refuses the graph with an error, not which code names it.
    const errors = report.diagnostics.filter((item) => item.severity === "error").map((item) => item.code);
    expect(errors.some((code) => code === "url-in-action" || code === "work-graph-invalid")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// FR-NODE-247 helpers
// ---------------------------------------------------------------------------------------------

function preq(id: string, extra: Partial<ProposalRequirement> = {}): ProposalRequirement {
  return { id, title: `title of ${id}`, acs: ["AC-1"], dependsOn: [], cites: [], ...extra };
}

function propose(requirements: readonly ProposalRequirement[], files: Record<string, readonly string[]>): WaveProposal {
  const read = readExpectedFiles(files);
  if (!read.ok) throw new Error(read.message);
  return proposeWaves({ runId: "run-247", scope: { target: "5.3.0" }, requirements, expectedFiles: read.files, trackedPaths: [] });
}

describe("FR-NODE-247 — verify r1.b", () => {
  // @req FR-NODE-247 AC-5
  it("FR-NODE-247 AC-5, AC-7: two files in the same module directory src/core give 0.5 affinity, so the two singletons merge at the floor", () => {
    // src/core/a.ts and src/core/b.ts: no shared path, one shared module directory (src/core).
    // AC-5 gives 0.5 × 1 = 0.5; AC-7 merges a unit of fewer than 2 requirements into a unit with affinity >= 0.5.
    const proposal = propose([preq("FR-A-001"), preq("FR-A-002")], { "FR-A-001": ["src/core/a.ts"], "FR-A-002": ["src/core/b.ts"] });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.graph.nodes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// FR-NODE-254 — CLI round record
// ---------------------------------------------------------------------------------------------

const PROOF = { kind: "digest", ref: "sha256:0123456789abcdef" };

function roundPayload(overrides: Json = {}): Json {
  return {
    loop: "P",
    scope: "wave-1-post",
    roundIndex: 1,
    mode: "normal",
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 1,
    verifiers: ["verifier-1"],
    rows: [{ id: "R-1", verdict: "pass", kept: false, verifier: "verifier-1" }],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: [],
    ...overrides
  };
}

describe("FR-NODE-254 — verify r1.b", () => {
  // @req FR-NODE-254 AC-1
  it("FR-NODE-254 AC-1: round record refuses a round whose verifiers list is empty, with a usage error and no journal line", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-r1b-"));
    try {
      await mkdir(path.join(root, "kiwi"), { recursive: true });
      await writeFile(path.join(root, "kiwi/waves.jsonl"), "", "utf8");
      const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
      const body = roundPayload({ verifiers: [], rows: [] , frozenDenominator: 0 });
      const exit = await main(
        ["--root", root, "orchestrate", "round", "record", "--run-id", "run-a", "--payload", JSON.stringify(body), "--proof", JSON.stringify(PROOF), "--json"],
        pipes
      );
      const journal = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");
      expect({ exit, journal }).toEqual({ exit: 1, journal: "" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
