import { describe, expect, it } from "vitest";
import { parseWaveDeclaration } from "../../../src/core/orchestrator/wave-declaration.js";
import {
  proposalRequirementsOf,
  proposeWaves,
  readExpectedFiles,
  type ProposalCaps,
  type ProposalRecord,
  type ProposalRequirement,
  type ProposalScope,
  type WaveProposal
} from "../../../src/core/orchestrator/wave-propose.js";

// FR-NODE-247 — `orchestrate wave propose`: the deterministic draft work graph. The command binding
// (AC-1) is not here; this file drives the pure core the command calls.

type Files = Record<string, readonly string[]>;

interface ProposeOptions {
  readonly caps?: Partial<ProposalCaps>;
  readonly trackedPaths?: readonly string[];
  readonly scope?: ProposalScope;
}

function req(id: string, extra: Partial<ProposalRequirement> = {}): ProposalRequirement {
  return { id, title: `title of ${id}`, acs: ["AC-1"], dependsOn: [], cites: [], ...extra };
}

function acs(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `AC-${index + 1}`);
}

/** A path alone in its own module directory, so it shares nothing but itself. */
function own(name: string): string {
  return `${name}/one/two/file.ts`;
}

function propose(requirements: readonly ProposalRequirement[], files: Files = {}, options: ProposeOptions = {}): WaveProposal {
  const read = readExpectedFiles(files);
  if (!read.ok) throw new Error(read.message);
  return proposeWaves({
    runId: "run-247",
    scope: options.scope ?? { target: "5.3.0" },
    requirements,
    expectedFiles: read.files,
    trackedPaths: options.trackedPaths ?? [],
    ...(options.caps === undefined ? {} : { caps: options.caps })
  });
}

type Graph = Extract<WaveProposal, { ok: true }>["graph"];

const LIVE_AC = { id: "AC-1", text: "live", checked: false, line: 1 };

function selected(selection: ReturnType<typeof proposalRequirementsOf>): readonly ProposalRequirement[] {
  if (!selection.ok) throw new Error(`expected a selection, got ${JSON.stringify(selection.violations)}`);
  return selection.requirements;
}

function graphOf(proposal: WaveProposal): Graph {
  if (!proposal.ok) throw new Error(`expected a graph, got ${proposal.code} ${JSON.stringify(proposal.violations)}`);
  return proposal.graph;
}

/** Each node's requirements, in wave order, read off `acs`. */
function groups(proposal: WaveProposal): string[][] {
  return graphOf(proposal).nodes.map((node) => [...new Set(node.acs.map((ac) => ac.split(" ")[0] as string))]);
}

function sortedGroups(proposal: WaveProposal): string[][] {
  return groups(proposal).map((group) => [...group].sort());
}

describe("FR-NODE-247 orchestrate wave propose", () => {
  // @req FR-NODE-247 AC-2
  it("AC-2: a path absent at HEAD with a tracked neighbour within distance 2 is refused with files-not-grounded naming it", () => {
    const proposal = propose(
      [req("FR-X-3"), req("FR-X-1"), req("FR-X-2")],
      { "FR-X-3": ["src/core/orchestrator/lane-plans.ts"], "FR-X-1": ["src/core/orchestrator/lane-plans.ts"], "FR-X-2": ["src/core/orchestrator/lane-plan.ts"] },
      { trackedPaths: ["src/core/orchestrator/lane-plan.ts", "README.md"] }
    );
    expect(proposal.ok).toBe(false);
    if (proposal.ok) return;
    expect(proposal.code).toBe("files-not-grounded");
    expect(proposal.violations).toEqual([
      { path: "src/core/orchestrator/lane-plans.ts", nearest: "src/core/orchestrator/lane-plan.ts", requirements: ["FR-X-1", "FR-X-3"] }
    ]);
  });

  // @req FR-NODE-247 AC-2
  it("AC-2: the comparison is after POSIX normalisation, and a path with no near neighbour is accepted as a new file", () => {
    const refused = propose([req("FR-X-1")], { "FR-X-1": ["src\\core\\lane-plans.ts"] }, { trackedPaths: ["src/core/lane-plan.ts"] });
    expect(refused.ok).toBe(false);

    const accepted = propose(
      [req("FR-X-1")],
      { "FR-X-1": ["src/core/brand-new-module.ts", "./src/core/lane-plan.ts"] },
      { trackedPaths: ["src/core/lane-plan.ts"] }
    );
    expect(graphOf(accepted).nodes[0]?.files).toEqual(["src/core/brand-new-module.ts", "src/core/lane-plan.ts"]);
  });

  // @req FR-NODE-247 AC-2
  it("AC-2: the input is the scope's non-discarded requirements, dependencies are depends_on rows into the set, citations the rest", () => {
    const records: ProposalRecord[] = [
      {
        id: "FR-X-1",
        title: "one",
        target: "5.3.0",
        status: "planned",
        acceptanceCriteria: [{ id: "AC-1", text: "first", checked: false, line: 1 }, { id: "AC-3", text: "third", checked: false, line: 2 }],
        traceLinks: [
          { type: "Requirement", reference: "FR-X-2", relation: "depends_on", notes: "-" },
          { type: "Requirement", reference: "FR-OUT-9", relation: "depends on", notes: "-" },
          { type: "Code", reference: "src/never/read/from-srs.ts", relation: "depends_on", notes: "-" },
          { type: "Requirement", reference: "FR-X-3", relation: "related_to", notes: "-" }
        ],
        requirement: "speckiwi SHALL use FR-X-2 and FR-X-3 and FR-X-4.",
        rationale: "Cites FR-OUT-9 outside the set.",
        research: "-",
        implementationNotes: "Also FR-X-1 itself."
      },
      { id: "FR-X-2", title: "two", target: "5.3.0", status: "implemented", acceptanceCriteria: [LIVE_AC], traceLinks: [] },
      { id: "FR-X-3", title: "three", target: "5.3.0", status: "planned", acceptanceCriteria: [LIVE_AC], traceLinks: [] },
      { id: "FR-X-4", title: "four", target: "5.3.0", status: "discarded", acceptanceCriteria: [LIVE_AC], traceLinks: [] },
      { id: "FR-X-5", title: "five", target: "5.2.0", status: "planned", acceptanceCriteria: [LIVE_AC], traceLinks: [] }
    ];

    const byTarget = selected(proposalRequirementsOf(records, { target: "5.3.0" }));
    expect(byTarget.map((entry) => entry.id)).toEqual(["FR-X-1", "FR-X-2", "FR-X-3"]);
    expect(byTarget[0]).toEqual({
      id: "FR-X-1",
      title: "one",
      acs: ["AC-1", "AC-3"],
      dependsOn: ["FR-OUT-9", "FR-X-2"],
      cites: ["FR-OUT-9", "FR-X-1", "FR-X-2", "FR-X-3", "FR-X-4"]
    });

    const named = selected(proposalRequirementsOf(records, { requirements: ["FR-X-5", "FR-X-2"] }));
    expect(named.map((entry) => entry.id)).toEqual(["FR-X-2", "FR-X-5"]);

    // The Code row's path is never an expected file: files come from the map only.
    expect(graphOf(propose(byTarget)).nodes.flatMap((node) => node.files)).toEqual([]);
  });

  // @req FR-NODE-247 AC-2
  it("AC-2: a citation a depends_on row already carries is not also a soft citation; links out of the set are ignored", () => {
    // 1 -> 3 scores 3 (4 if the citation counted again); 1 and 2 share three paths of one directory: 3.5.
    const three = ["m/a/b/one.ts", "m/a/b/two.ts", "m/a/b/three.ts"];
    const proposal = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-3", "FR-OUT-9"], cites: ["FR-X-3", "FR-OUT-8", "FR-X-1"] }), req("FR-X-2"), req("FR-X-3")],
      { "FR-X-1": three, "FR-X-2": three },
      { caps: { requirements: 2 } }
    );
    expect(sortedGroups(proposal)).toContainEqual(["FR-X-1", "FR-X-2"]);
    expect(graphOf(proposal).edges.map((edge) => edge.reason)).toEqual(["FR-X-1 depends on FR-X-3"]);
  });

  // @req FR-NODE-247 AC-11
  it("AC-11: --requirements naming an ID that is no requirement, or a discarded one, is refused naming each ID", () => {
    const records: ProposalRecord[] = [
      { id: "FR-X-1", title: "one", target: "5.3.0", status: "planned", acceptanceCriteria: [LIVE_AC], traceLinks: [] },
      { id: "FR-X-4", title: "four", target: "5.3.0", status: "discarded", acceptanceCriteria: [LIVE_AC], traceLinks: [] }
    ];
    const refused = proposalRequirementsOf(records, { requirements: ["FR-X-4", "FR-X-1", "FR-NOPE-1"] });
    expect(refused).toEqual({
      ok: false,
      code: "invalid-requirement-id",
      violations: [
        { id: "FR-NOPE-1", reason: "not-a-requirement" },
        { id: "FR-X-4", reason: "discarded" }
      ]
    });
    // A target scope leaves discarded requirements out; only a named one is refused.
    expect(selected(proposalRequirementsOf(records, { target: "5.3.0" })).map((entry) => entry.id)).toEqual(["FR-X-1"]);
    expect(selected(proposalRequirementsOf(records, { requirements: ["FR-X-1"] })).map((entry) => entry.id)).toEqual(["FR-X-1"]);
  });

  // @req FR-NODE-247 AC-12
  it("AC-12: a requirement of the scope with no live acceptance criterion is refused by name, and no graph is built", () => {
    const proposal = propose([req("FR-X-3", { acs: [] }), req("FR-X-2"), req("FR-X-1", { acs: [] })]);
    expect(proposal).toEqual({ ok: false, code: "requirement-without-live-ac", violations: [{ requirement: "FR-X-1" }, { requirement: "FR-X-3" }] });
    expect(propose([req("FR-X-1"), req("FR-X-2")]).ok).toBe(true);
  });

  // @req FR-NODE-247 AC-2
  it("AC-2: a malformed files map is named, not guessed", () => {
    expect(readExpectedFiles([]).ok).toBe(false);
    expect(readExpectedFiles({ "FR-X-1": "src/a.ts" }).ok).toBe(false);
    expect(readExpectedFiles({ "FR-X-1": 5 }).ok).toBe(false);
    expect(readExpectedFiles({ "FR-X-1": [1] }).ok).toBe(false);
    expect(readExpectedFiles({ "FR-X-1": ["../outside.ts"] }).ok).toBe(false);
    expect(readExpectedFiles({ "FR-X-1": ["/abs.ts"] }).ok).toBe(false);
    expect(readExpectedFiles({ "FR-X-1": ["src/a.ts"] }).ok).toBe(true);
  });

  // @req FR-NODE-247 AC-3
  it("AC-3: a path named by at least 25% and at least 3 requirements is a hub, listed and left out of affinity", () => {
    const hub = "src/cli/commands/orchestrate.ts";
    const four = [req("FR-X-1"), req("FR-X-2"), req("FR-X-3"), req("FR-X-4")];
    const proposal = propose(four, { "FR-X-1": [hub], "FR-X-2": [hub], "FR-X-3": [hub], "FR-X-4": [own("d")] });
    expect(proposal.ok && proposal.hubs).toEqual([hub]);
    expect(sortedGroups(proposal)).toEqual([["FR-X-1"], ["FR-X-2"], ["FR-X-3"], ["FR-X-4"]]);
    // The hub stays in each node's files: it is only out of affinity.
    expect(graphOf(proposal).nodes[0]?.files).toEqual([hub]);
  });

  // @req FR-NODE-247 AC-3
  it("AC-3: below 3 requirements, or below 25% of the set, a shared path is not a hub", () => {
    const shared = own("shared");
    const two = propose([req("FR-X-1"), req("FR-X-2")], { "FR-X-1": [shared], "FR-X-2": [shared] });
    expect(two.ok && two.hubs).toEqual([]);
    expect(sortedGroups(two)).toEqual([["FR-X-1", "FR-X-2"]]);

    const thirteen = Array.from({ length: 13 }, (_unused, index) => req(`FR-Y-${index + 1}`));
    const files: Files = Object.fromEntries(thirteen.map((entry) => [entry.id, [own(entry.id.toLowerCase())]]));
    for (const id of ["FR-Y-1", "FR-Y-2", "FR-Y-3"]) files[id] = [shared];
    const sparse = propose(thirteen, files);
    expect(sparse.ok && sparse.hubs).toEqual([]);
    expect(sortedGroups(sparse)).toContainEqual(["FR-Y-1", "FR-Y-2", "FR-Y-3"]);
  });

  // @req FR-NODE-247 AC-3
  it("AC-3: exactly 25% (3 of 12) is a hub", () => {
    const twelve = Array.from({ length: 12 }, (_unused, index) => req(`FR-Y-${index + 1}`));
    const files: Files = Object.fromEntries(twelve.map((entry) => [entry.id, [own(entry.id.toLowerCase())]]));
    for (const id of ["FR-Y-1", "FR-Y-2", "FR-Y-3"]) files[id] = [own("shared")];
    const proposal = propose(twelve, files);
    expect(proposal.ok && proposal.hubs).toEqual([own("shared")]);
    expect(groups(proposal)).toHaveLength(12);
  });

  // @req FR-NODE-247 AC-4
  it("AC-4: a single requirement over a cap is no cycle: it is not refused and stays alone", () => {
    const proposal = propose([req("FR-X-1", { acs: acs(30) }), req("FR-X-2")], { "FR-X-1": [own("s")], "FR-X-2": [own("s")] });
    expect(sortedGroups(proposal)).toEqual([["FR-X-1"], ["FR-X-2"]]);
  });

  // @req FR-NODE-247 AC-4
  it("AC-4: a dependency cycle is one unit in one node", () => {
    const proposal = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-2"] }), req("FR-X-2", { dependsOn: ["FR-X-1"] })],
      {},
      { caps: { requirements: 2 } }
    );
    expect(sortedGroups(proposal)).toEqual([["FR-X-1", "FR-X-2"]]);
  });

  // @req FR-NODE-247 AC-4
  it("AC-4: a cycle over a cap is refused with requirement-cycle-over-cap naming its requirements", () => {
    const cycle = [
      req("FR-X-1", { dependsOn: ["FR-X-3"] }),
      req("FR-X-2", { dependsOn: ["FR-X-1"] }),
      req("FR-X-3", { dependsOn: ["FR-X-2"] }),
      req("FR-X-4")
    ];
    const overCount = propose(cycle, {}, { caps: { requirements: 2 } });
    expect(overCount.ok).toBe(false);
    if (overCount.ok) return;
    expect(overCount.code).toBe("requirement-cycle-over-cap");
    expect(overCount.violations).toEqual([{ requirements: ["FR-X-1", "FR-X-2", "FR-X-3"] }]);

    // Two cycles over the cap are both named, in requirement-ID order; {1,2} depends on {3,4}.
    const twoCycles = propose(
      [
        req("FR-X-1", { dependsOn: ["FR-X-2", "FR-X-3"] }),
        req("FR-X-2", { dependsOn: ["FR-X-1"] }),
        req("FR-X-3", { dependsOn: ["FR-X-4"] }),
        req("FR-X-4", { dependsOn: ["FR-X-3"] })
      ],
      {},
      { caps: { requirements: 1 } }
    );
    expect(twoCycles.ok ? null : twoCycles.violations).toEqual([{ requirements: ["FR-X-1", "FR-X-2"] }, { requirements: ["FR-X-3", "FR-X-4"] }]);

    const overAcs = propose([req("FR-X-1", { dependsOn: ["FR-X-2"], acs: acs(13) }), req("FR-X-2", { dependsOn: ["FR-X-1"], acs: acs(13) })]);
    expect(overAcs.ok ? null : overAcs.code).toBe("requirement-cycle-over-cap");

    const overFiles = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-2"] }), req("FR-X-2", { dependsOn: ["FR-X-1"] })],
      { "FR-X-1": [own("a"), own("b")], "FR-X-2": [own("c")] },
      { caps: { files: 2 } }
    );
    expect(overFiles.ok ? null : overFiles.code).toBe("requirement-cycle-over-cap");
  });

  // @req FR-NODE-247 AC-5
  it("AC-5: one dependency (3) outweighs two shared paths in one module directory (2.5)", () => {
    const proposal = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-3"] }), req("FR-X-2"), req("FR-X-3")],
      { "FR-X-1": ["m/a/b/one.ts", "m/a/b/two.ts"], "FR-X-2": ["m/a/b/one.ts", "m/a/b/two.ts"] },
      { caps: { requirements: 2 } }
    );
    expect(sortedGroups(proposal)).toContainEqual(["FR-X-1", "FR-X-3"]);
  });

  // @req FR-NODE-247 AC-5
  it("AC-5: a shared path with its directory (1.5) outweighs one citation (1); two citations (2) outweigh it", () => {
    const one = propose(
      [req("FR-X-1", { cites: ["FR-X-3"] }), req("FR-X-2"), req("FR-X-3")],
      { "FR-X-1": [own("shared")], "FR-X-2": [own("shared")] },
      { caps: { requirements: 2 } }
    );
    expect(sortedGroups(one)).toContainEqual(["FR-X-1", "FR-X-2"]);

    const both = propose(
      [req("FR-X-1", { cites: ["FR-X-3"] }), req("FR-X-2"), req("FR-X-3", { cites: ["FR-X-1"] })],
      { "FR-X-1": [own("shared")], "FR-X-2": [own("shared")] },
      { caps: { requirements: 2 } }
    );
    expect(sortedGroups(both)).toContainEqual(["FR-X-1", "FR-X-3"]);
  });

  // @req FR-NODE-247 AC-5
  it("AC-5: a module directory is the first three segments of the file's directory; sharing one alone (0.5) is below the merge threshold", () => {
    // FR-X-2 cites FR-X-1 and shares its directory p/one/two: 1.5 against FR-X-1 and FR-X-3.
    const competitor = req("FR-X-2", { cites: ["FR-X-1"] });
    const sameDirectory = propose(
      [req("FR-X-1"), competitor, req("FR-X-3")],
      { "FR-X-1": ["src/core/query/a.ts", own("p")], "FR-X-2": ["p/one/two/other.ts"], "FR-X-3": ["src/core/query/deeper/b.ts", own("p")] },
      { caps: { requirements: 2 } }
    );
    // 1 path + 2 directories (p/one/two, src/core/query) = 2 beats 1.5.
    expect(sortedGroups(sameDirectory)).toContainEqual(["FR-X-1", "FR-X-3"]);

    const otherDirectory = propose(
      [req("FR-X-1"), competitor, req("FR-X-3")],
      { "FR-X-1": ["src/core/query/a.ts", own("p")], "FR-X-2": ["p/one/two/other.ts"], "FR-X-3": ["src/core/other/b.ts", own("p")] },
      { caps: { requirements: 2 } }
    );
    // 1 path + 1 directory = 1.5 ties 1.5; the tie goes to the smaller joined IDs.
    expect(sortedGroups(otherDirectory)).toContainEqual(["FR-X-1", "FR-X-2"]);
    // A directory alone never reaches the threshold of the first pass; units of 2 skip the floor pass.
    const directoryOnly = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-2"] }), req("FR-X-2", { dependsOn: ["FR-X-1"] }), req("FR-X-3", { dependsOn: ["FR-X-4"] }), req("FR-X-4", { dependsOn: ["FR-X-3"] })],
      { "FR-X-1": ["src/core/query/a.ts"], "FR-X-3": ["src/core/query/b.ts"] }
    );
    expect(sortedGroups(directoryOnly)).toEqual([["FR-X-1", "FR-X-2"], ["FR-X-3", "FR-X-4"]]);
  });

  // @req FR-NODE-247 AC-5
  it("AC-5: the module directory is the directory holding the file, cut to three segments: src/core/a.ts and src/core/b.ts share src/core", () => {
    // 0.5 alone: no first-pass merge, but the floor pass merges two lone requirements.
    expect(sortedGroups(propose([req("FR-X-1"), req("FR-X-2")], { "FR-X-1": ["src/core/a.ts"], "FR-X-2": ["src/core/b.ts"] }))).toEqual([["FR-X-1", "FR-X-2"]]);
    // The file name is never a segment of it: src/core/x.ts and src/core/x.ts/y.ts hold no directory in common.
    expect(sortedGroups(propose([req("FR-X-1"), req("FR-X-2")], { "FR-X-1": ["src/core/x.ts"], "FR-X-2": ["src/core/x.ts/y.ts"] }))).toEqual([["FR-X-1"], ["FR-X-2"]]);
    // Deeper directories are cut to three segments: a/b/c/d/e.ts and a/b/c/f.ts share a/b/c.
    expect(sortedGroups(propose([req("FR-X-1"), req("FR-X-2")], { "FR-X-1": ["a/b/c/d/e.ts"], "FR-X-2": ["a/b/c/f.ts"] }))).toEqual([["FR-X-1", "FR-X-2"]]);
    // Directories that differ within their first three segments share nothing.
    expect(sortedGroups(propose([req("FR-X-1"), req("FR-X-2")], { "FR-X-1": ["src/core/query/one/a.ts"], "FR-X-2": ["src/core/other/b.ts"] }))).toEqual([["FR-X-1"], ["FR-X-2"]]);
  });

  // @req FR-NODE-247 AC-6
  it("AC-6: the requirement cap holds: six requirements that all cite each other give 5 and 1", () => {
    const ids = Array.from({ length: 6 }, (_unused, index) => `FR-X-${index + 1}`);
    const six = ids.map((id) => req(id, { cites: ids.filter((other) => other !== id) }));
    expect(sortedGroups(propose(six))).toEqual([["FR-X-1", "FR-X-2", "FR-X-3", "FR-X-4", "FR-X-5"], ["FR-X-6"]]);
  });

  // @req FR-NODE-247 AC-6
  it("AC-6: the live-AC cap and the non-test path cap hold, and the cap options replace them", () => {
    const shared = own("shared");
    const heavy = propose([req("FR-X-1", { acs: acs(13) }), req("FR-X-2", { acs: acs(13) })], { "FR-X-1": [shared], "FR-X-2": [shared] });
    expect(sortedGroups(heavy)).toEqual([["FR-X-1"], ["FR-X-2"]]);
    const raised = propose(
      [req("FR-X-1", { acs: acs(13) }), req("FR-X-2", { acs: acs(13) })],
      { "FR-X-1": [shared], "FR-X-2": [shared] },
      { caps: { acs: 26 } }
    );
    expect(sortedGroups(raised)).toEqual([["FR-X-1", "FR-X-2"]]);

    const twelve = (prefix: string): string[] => Array.from({ length: 12 }, (_unused, index) => own(`${prefix}${index}`));
    const wide = { "FR-X-1": [shared, ...twelve("a")], "FR-X-2": [shared, ...twelve("b"), own("c")] };
    // 1 + 12 + 13 = 26 non-test paths: over the default 25.
    expect(sortedGroups(propose([req("FR-X-1"), req("FR-X-2")], wide))).toEqual([["FR-X-1"], ["FR-X-2"]]);
    // Test paths do not count against the cap.
    const withTests = { "FR-X-1": [shared, ...twelve("a")], "FR-X-2": [shared, ...twelve("b"), "test/c.fr-x-2.test.ts"] };
    expect(sortedGroups(propose([req("FR-X-1"), req("FR-X-2")], withTests))).toEqual([["FR-X-1", "FR-X-2"]]);
    expect(sortedGroups(propose([req("FR-X-1"), req("FR-X-2")], wide, { caps: { files: 26 } }))).toEqual([["FR-X-1", "FR-X-2"]]);

    expect(sortedGroups(propose([req("FR-X-1"), req("FR-X-2")], { "FR-X-1": [shared], "FR-X-2": [shared] }, { caps: { requirements: 1 } }))).toEqual([
      ["FR-X-1"],
      ["FR-X-2"]
    ]);
  });

  // @req FR-NODE-247 AC-6
  it("AC-6: a merge that would make the unit graph cyclic is never taken", () => {
    // FR-X-1 -> FR-X-2 -> FR-X-3; 1 and 3 share a path; 2 is too heavy to merge with either.
    const proposal = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-2"] }), req("FR-X-2", { dependsOn: ["FR-X-3"], acs: acs(25) }), req("FR-X-3")],
      { "FR-X-1": [own("shared")], "FR-X-3": [own("shared")] }
    );
    expect(groups(proposal)).toEqual([["FR-X-3"], ["FR-X-2"], ["FR-X-1"]]);
  });

  // @req FR-NODE-247 AC-6
  it("AC-6: among equal affinity the smaller merged requirement count wins", () => {
    // {1,2} + 3 and 3 + 4 both score 1.5; the second merges 2 requirements, the first 3.
    const proposal = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-2"] }), req("FR-X-2", { dependsOn: ["FR-X-1"] }), req("FR-X-3"), req("FR-X-4")],
      { "FR-X-1": ["p/a/b/p.ts"], "FR-X-3": ["p/a/b/p.ts", "r/a/b/r.ts"], "FR-X-4": ["r/a/b/r.ts"] },
      { caps: { requirements: 3 } }
    );
    expect(sortedGroups(proposal)).toEqual([["FR-X-1", "FR-X-2"], ["FR-X-3", "FR-X-4"]]);
  });

  // @req FR-NODE-247 AC-6
  it("AC-6: among equal affinity and count the smaller joined requirement IDs win, compared by code unit", () => {
    // Each pair shares its own path (1.5); a path all three named would be a hub.
    const triangle = (a: string, b: string, c: string): Files => ({ [a]: [own("ab"), own("ac")], [b]: [own("ab"), own("bc")], [c]: [own("ac"), own("bc")] });
    const proposal = propose([req("FR-X-1"), req("FR-X-2"), req("FR-X-3")], triangle("FR-X-1", "FR-X-2", "FR-X-3"), { caps: { requirements: 2 } });
    expect(sortedGroups(proposal)).toEqual([["FR-X-1", "FR-X-2"], ["FR-X-3"]]);

    // Code-unit order joins {9,10} as "FR-X-10,FR-X-9", which sorts before "FR-X-2,FR-X-9"; a numeric
    // order would join "FR-X-9,FR-X-10" and take {2,9} instead.
    const codeUnit = propose(
      [req("FR-X-9"), req("FR-X-10"), req("FR-X-2")],
      { "FR-X-9": [own("p"), own("q")], "FR-X-10": [own("p")], "FR-X-2": [own("q")] },
      { caps: { requirements: 2 } }
    );
    expect(sortedGroups(codeUnit)).toEqual([["FR-X-10", "FR-X-9"], ["FR-X-2"]]);
  });

  // @req FR-NODE-247 AC-7
  it("AC-7: a lone requirement joins a unit it shares a module directory with (0.5), within the caps", () => {
    const joined = propose([req("FR-X-1"), req("FR-X-2"), req("FR-X-3")], { "FR-X-1": ["m/a/b/one.ts"], "FR-X-2": ["m/a/b/two.ts"], "FR-X-3": [own("z")] });
    expect(sortedGroups(joined)).toEqual([["FR-X-1", "FR-X-2"], ["FR-X-3"]]);

    const capped = propose(
      [req("FR-X-1", { acs: acs(13) }), req("FR-X-2", { acs: acs(13) })],
      { "FR-X-1": ["m/a/b/one.ts"], "FR-X-2": ["m/a/b/two.ts"] }
    );
    expect(sortedGroups(capped)).toEqual([["FR-X-1"], ["FR-X-2"]]);
  });

  // @req FR-NODE-247 AC-7
  it("AC-7: the floor pass reaches only units below 2 requirements and still keeps the unit graph acyclic", () => {
    const pairs = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-2"] }), req("FR-X-2", { dependsOn: ["FR-X-1"] }), req("FR-X-3", { dependsOn: ["FR-X-4"] }), req("FR-X-4", { dependsOn: ["FR-X-3"] })],
      { "FR-X-1": ["m/a/b/one.ts"], "FR-X-3": ["m/a/b/two.ts"] }
    );
    expect(sortedGroups(pairs)).toEqual([["FR-X-1", "FR-X-2"], ["FR-X-3", "FR-X-4"]]);

    // 1 -> 2 -> 3 with 2 too heavy; 1 and 3 share only a directory. Merging them would be a cycle.
    const chain = propose(
      [req("FR-X-1", { dependsOn: ["FR-X-2"] }), req("FR-X-2", { dependsOn: ["FR-X-3"], acs: acs(25) }), req("FR-X-3")],
      { "FR-X-1": ["m/a/b/one.ts"], "FR-X-3": ["m/a/b/two.ts"] }
    );
    expect(groups(chain)).toEqual([["FR-X-3"], ["FR-X-2"], ["FR-X-1"]]);
  });

  // @req FR-NODE-247 AC-8
  it("AC-8: nodes are in topological layers, ties by smallest requirement ID, named wave-1 to wave-N, one edge per node pair", () => {
    const proposal = propose(
      [
        req("FR-X-1", { dependsOn: ["FR-X-2", "FR-X-5"] }),
        req("FR-X-2", { dependsOn: ["FR-X-3"] }),
        req("FR-X-3"),
        req("FR-X-4"),
        req("FR-X-5", { dependsOn: ["FR-X-3"] })
      ],
      {},
      { caps: { requirements: 1 } }
    );
    const graph = graphOf(proposal);
    expect(graph.nodes.map((node) => node.wave)).toEqual(["wave-1", "wave-2", "wave-3", "wave-4", "wave-5"]);
    // Layer 1: FR-X-3, FR-X-4; layer 2: FR-X-2, FR-X-5; layer 3: FR-X-1.
    expect(groups(proposal)).toEqual([["FR-X-3"], ["FR-X-4"], ["FR-X-2"], ["FR-X-5"], ["FR-X-1"]]);
    expect(graph.edges).toEqual([
      { from: "wave-1", to: "wave-3", reason: "FR-X-2 depends on FR-X-3" },
      { from: "wave-1", to: "wave-4", reason: "FR-X-5 depends on FR-X-3" },
      { from: "wave-3", to: "wave-5", reason: "FR-X-1 depends on FR-X-2" },
      { from: "wave-4", to: "wave-5", reason: "FR-X-1 depends on FR-X-5" }
    ]);
  });

  // @req FR-NODE-247 AC-8
  it("AC-8: an edge's reason names every requirement pair it carries", () => {
    const proposal = propose(
      [
        req("FR-X-1", { dependsOn: ["FR-X-3"] }),
        req("FR-X-2", { dependsOn: ["FR-X-3", "FR-X-4"] }),
        req("FR-X-3", { dependsOn: ["FR-X-4"], acs: acs(25) }),
        req("FR-X-4", { acs: acs(25) })
      ],
      { "FR-X-1": [own("s")], "FR-X-2": [own("s")] },
      { caps: { requirements: 2 } }
    );
    expect(groups(proposal).map((group) => [...group].sort())).toEqual([["FR-X-4"], ["FR-X-3"], ["FR-X-1", "FR-X-2"]]);
    expect(graphOf(proposal).edges).toEqual([
      { from: "wave-1", to: "wave-2", reason: "FR-X-3 depends on FR-X-4" },
      { from: "wave-1", to: "wave-3", reason: "FR-X-2 depends on FR-X-4" },
      { from: "wave-2", to: "wave-3", reason: "FR-X-1 depends on FR-X-3; FR-X-2 depends on FR-X-3" }
    ]);
  });

  // @req FR-NODE-247 AC-8
  it("AC-8: within a node, requirements in dependency order, ties by ID, each requirement's live ACs by number", () => {
    const proposal = propose([
      req("FR-X-1", { dependsOn: ["FR-X-3"], acs: ["AC-10", "AC-2", "AC-1"] }),
      req("FR-X-2", { acs: ["AC-1"] }),
      req("FR-X-3", { acs: ["AC-2", "AC-1"] })
    ], { "FR-X-2": [own("s")], "FR-X-3": [own("s")] });
    expect(graphOf(proposal).nodes[0]?.acs).toEqual([
      "FR-X-2 AC-1",
      "FR-X-3 AC-1",
      "FR-X-3 AC-2",
      "FR-X-1 AC-1",
      "FR-X-1 AC-2",
      "FR-X-1 AC-10"
    ]);
  });

  // @req FR-NODE-247 AC-9
  it("AC-9: nodes carry the union of expected paths, done_when [], and a bounded title and purpose; the draft passes the 2.0.0 parse", () => {
    const longTitle = "a very long requirement title that goes on ".repeat(10);
    const requirements = Array.from({ length: 5 }, (_unused, index) =>
      req(`FR-LONGSCOPE-${index + 100}`, { title: longTitle, dependsOn: index === 0 ? [] : [`FR-LONGSCOPE-${index + 99}`] })
    );
    const files: Files = Object.fromEntries(requirements.map((entry, index) => [entry.id, ["m/a/b/shared.ts", `m/a/b/f${index}.ts`, `m/a/b/f${index}.ts`]]));
    const proposal = propose([...requirements, req("FR-OTHER-1")], files, { scope: { requirements: ["FR-OTHER-1", ...requirements.map((entry) => entry.id)] } });
    const graph = graphOf(proposal);
    const first = graph.nodes[0]!;
    expect(first.files).toEqual(["m/a/b/f0.ts", "m/a/b/f1.ts", "m/a/b/f2.ts", "m/a/b/f3.ts", "m/a/b/f4.ts", "m/a/b/shared.ts"]);
    expect(first.done_when).toEqual([]);
    for (const node of graph.nodes) {
      expect([...node.title].length).toBeGreaterThan(0);
      expect([...node.title].length).toBeLessThanOrEqual(60);
      expect([...node.purpose].length).toBeGreaterThan(0);
      expect([...node.purpose].length).toBeLessThanOrEqual(300);
    }
    expect(first.title.startsWith("FR-LONGSCOPE-100")).toBe(true);
    expect(first.purpose.startsWith(`FR-LONGSCOPE-100 ${longTitle.slice(0, 20)}`)).toBe(true);
    expect(graph.scope).toEqual({ requirements: ["FR-LONGSCOPE-100", "FR-LONGSCOPE-101", "FR-LONGSCOPE-102", "FR-LONGSCOPE-103", "FR-LONGSCOPE-104", "FR-OTHER-1"] });

    const parsed = parseWaveDeclaration(JSON.parse(JSON.stringify(graph)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.declaration.waves.map((wave) => [...wave.requirements].sort())).toEqual(sortedGroups(proposal));
    expect(parsed.declaration.waves.map((wave) => wave.files)).toEqual(graph.nodes.map((node) => node.files));
  });

  // @req FR-NODE-247 AC-9
  it("AC-9: a graph with edges passes the parse with the edges as dependencies", () => {
    const graph = graphOf(propose([req("FR-X-1", { dependsOn: ["FR-X-2"] }), req("FR-X-2")], {}, { caps: { requirements: 1 } }));
    expect(graph.schema_version).toBe("2.0.0");
    expect(graph.run_id).toBe("run-247");
    const parsed = parseWaveDeclaration(graph);
    expect(parsed.ok && parsed.declaration.waves.map((wave) => wave.dependsOn)).toEqual([[], ["wave-1"]]);
  });

  // @req FR-NODE-247 AC-10
  it("AC-10: the output is byte-identical whatever the order of the requirement list, the files map keys and their lists", () => {
    const random = seeded(247);
    const ids = Array.from({ length: 24 }, (_unused, index) => `FR-Z-${index + 1}`);
    const requirements = ids.map((id, index) => {
      const dependsOn = ids.slice(0, index).filter(() => random() < 0.12);
      const cites = ids.filter((other) => other !== id && random() < 0.06);
      return req(id, { title: `title ${id}`, acs: acs(1 + Math.floor(random() * 8)), dependsOn, cites });
    });
    // A cycle, to exercise the strongly connected component path too.
    requirements[3] = { ...requirements[3]!, dependsOn: [...requirements[3]!.dependsOn, "FR-Z-5"] };
    requirements[4] = { ...requirements[4]!, dependsOn: [...requirements[4]!.dependsOn, "FR-Z-4"] };
    const modules = ["src/core/query", "src/core/orchestrator", "src/cli/commands", "skills/claude/kiwi-pm", "test/core/orchestrator"];
    const files: Record<string, string[]> = {};
    for (const id of ids) {
      const count = 1 + Math.floor(random() * 4);
      files[id] = Array.from({ length: count }, () => `${modules[Math.floor(random() * modules.length)]}/f${Math.floor(random() * 10)}.ts`);
    }
    files["FR-Z-1"]!.push("src/mcp/server.ts");
    for (const id of ids.slice(1, 9)) files[id]!.push("src/mcp/server.ts");

    const run = (list: readonly ProposalRequirement[], map: Files): string => JSON.stringify(propose(list, map, { caps: { requirements: 4 } }));
    const reference = run(requirements, files);
    expect(JSON.parse(reference).ok).toBe(true);
    expect(JSON.parse(reference).hubs).toContain("src/mcp/server.ts");
    for (let round = 0; round < 30; round += 1) {
      const list = shuffle(requirements, random).map((entry) => ({
        ...entry,
        dependsOn: shuffle(entry.dependsOn, random),
        cites: shuffle(entry.cites, random),
        acs: shuffle(entry.acs, random)
      }));
      const map = Object.fromEntries(shuffle(Object.entries(files), random).map(([id, paths]) => [id, shuffle(paths, random)]));
      expect(run(list, map)).toBe(reference);
    }
  });
});

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}
