import { describe, expect, it } from "vitest";
import { proposeWaves, readExpectedFiles, type ProposalCaps, type ProposalRequirement, type WaveProposal } from "../../../src/core/orchestrator/wave-propose.js";
import { rawGit } from "./support/git-fixture.js";
import { writeUnder } from "./sds-fixtures.js";
import { orchestrate, workGraphWorkspace, type RequirementSpec } from "../../cli/wave-graph-fixtures.js";

// @req FR-NODE-288 — `wave propose` lists every citation without a depends_on row that the draft
// splits across two nodes.
//
// SB15 (5.3.7): layers that cited each other only in prose were proposed as nodes with no edge
// between them, so they would dispatch side by side and the dependency would surface as a failing
// verification_cmd in a worker.

function req(id: string, extra: Partial<ProposalRequirement> = {}): ProposalRequirement {
  return { id, title: `title of ${id}`, acs: ["AC-1"], dependsOn: [], cites: [], ...extra };
}

function propose(requirements: readonly ProposalRequirement[], caps: Partial<ProposalCaps> = {}): WaveProposal {
  const files = Object.fromEntries(requirements.map((entry) => [entry.id, [`${entry.id.toLowerCase()}/one/two/file.ts`]]));
  const read = readExpectedFiles(files);
  if (!read.ok) throw new Error(read.message);
  return proposeWaves({ runId: "run-288", scope: { target: "5.4.0" }, requirements, expectedFiles: read.files, trackedPaths: [], caps });
}

type Ok = Extract<WaveProposal, { ok: true }>;

function ok(proposal: WaveProposal): Ok {
  if (!proposal.ok) throw new Error(`expected a graph, got ${proposal.code}`);
  return proposal;
}

function nodeOf(proposal: Ok, id: string): string {
  return proposal.graph.nodes.find((node) => node.acs.some((ac) => ac.startsWith(`${id} `)))?.wave as string;
}

describe("FR-NODE-288 AC-1 — a citation split across two nodes is listed, and draws no edge", () => {
  it("lists each split pair with both nodes, sorted", () => {
    const proposal = ok(propose([req("FR-X-1", { cites: ["FR-X-2", "FR-X-3"] }), req("FR-X-2"), req("FR-X-3", { cites: ["FR-X-1"] })], { requirements: 1 }));
    const expected = [
      { requirement: "FR-X-1", cites: "FR-X-2", node: nodeOf(proposal, "FR-X-1"), citedNode: nodeOf(proposal, "FR-X-2") },
      { requirement: "FR-X-1", cites: "FR-X-3", node: nodeOf(proposal, "FR-X-1"), citedNode: nodeOf(proposal, "FR-X-3") },
      { requirement: "FR-X-3", cites: "FR-X-1", node: nodeOf(proposal, "FR-X-3"), citedNode: nodeOf(proposal, "FR-X-1") }
    ];
    expect(proposal.crossNodeCitations).toEqual(expected);
    expect(new Set(expected.flatMap((pair) => [pair.node, pair.citedNode])).size).toBe(3);
    expect(proposal.graph.edges).toEqual([]);
  });
});

describe("FR-NODE-288 AC-2 — a citation inside one node, or one a depends_on row carries, is not listed", () => {
  it("lists nothing when the cited requirement shares the node", () => {
    const proposal = ok(propose([req("FR-X-1", { cites: ["FR-X-2"] }), req("FR-X-2")]));
    expect(nodeOf(proposal, "FR-X-1")).toBe(nodeOf(proposal, "FR-X-2"));
    expect(proposal.crossNodeCitations).toEqual([]);
  });

  it("lists nothing for a depends_on link, which draws the edge instead", () => {
    const proposal = ok(propose([req("FR-X-1", { dependsOn: ["FR-X-2"], cites: ["FR-X-2"] }), req("FR-X-2")], { requirements: 1 }));
    expect(proposal.graph.edges).toHaveLength(1);
    expect(proposal.crossNodeCitations).toEqual([]);
  });
});

describe("FR-NODE-288 AC-3 — the draft graph is the same with the list beside it", () => {
  it("leaves the graph equal to the one proposed when every requirement already sits alone", () => {
    const withCitations = ok(propose([req("FR-X-1", { cites: ["FR-X-2"] }), req("FR-X-2")], { requirements: 1 }));
    const without = ok(propose([req("FR-X-1"), req("FR-X-2")], { requirements: 1 }));
    expect(JSON.stringify(withCitations.graph)).toBe(JSON.stringify(without.graph));
    expect(Object.keys(withCitations).sort()).toEqual(["crossNodeCitations", "graph", "hubs", "ok"]);
  });
});

describe("FR-NODE-288 AC-1 — the CLI prints the list beside the draft", () => {
  it("names the split pair read from a requirement's rationale", async () => {
    const A: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1 }], rationale: "Builds on FR-ARCH-002." };
    const B: RequirementSpec = { id: "FR-ARCH-002", acs: [{ n: 1 }] };
    const { root } = await workGraphWorkspace({ requirements: [A, B], noJournal: true });
    await rawGit(root, "init", "--initial-branch", "main");
    await rawGit(root, "config", "user.name", "Propose Fixture");
    await rawGit(root, "config", "user.email", "propose@example.invalid");
    await rawGit(root, "config", "commit.gpgsign", "false");
    await rawGit(root, "add", "--", ".");
    await rawGit(root, "commit", "-m", "base");
    await writeUnder(root, "files.json", JSON.stringify({ "FR-ARCH-001": ["src/a.ts"], "FR-ARCH-002": ["src/b.ts"] }));
    const run = await orchestrate(root, ["wave", "propose", "--target", "v1.0.0", "--files", "files.json", "--run-id", "r288", "--max-requirements", "1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.crossNodeCitations).toEqual([{ requirement: "FR-ARCH-001", cites: "FR-ARCH-002", node: expect.any(String), citedNode: expect.any(String) }]);
  });
});
