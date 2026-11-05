import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWorkGraph, WAVE_CHECK_DIAGNOSTICS_LIMIT, type CheckRecord, type WaveCheckReport } from "../../../src/core/orchestrator/wave-check.js";
import type { WavesEvent } from "../../../src/core/orchestrator/journal-schema.js";

// FR-NODE-246 — the work-graph check: every defect under a named code, a stage preview without a lock,
// and the AC partition as the only allocation check.

type Json = Record<string, unknown>;

function node(wave: string, acs: string[], extra: Json = {}): Json {
  return { wave, title: `node ${wave}`, purpose: "why", acs, done_when: [], files: [`src/${wave}.ts`], ...extra };
}

/** Target 5.3.0 holds FR-A-001 (AC-1, AC-2) and FR-A-002 (AC-1); wave-1 -> wave-2. */
function graph(extra: Json = {}): Json {
  return {
    schema_version: "2.0.0",
    run_id: "run-a",
    title: "g",
    scope: { target: "5.3.0" },
    nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"]), node("wave-2", ["FR-A-002 AC-1"])],
    edges: [{ from: "wave-1", to: "wave-2" }],
    ...extra
  };
}

function record(id: string, acIds: string[], extra: Partial<CheckRecord> = {}): CheckRecord {
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

function records(): CheckRecord[] {
  return [record("FR-A-001", ["AC-1", "AC-2"]), record("FR-A-002", ["AC-1"])];
}

function check(value: unknown, options: { records?: CheckRecord[]; journal?: WavesEvent[] | null; allDiagnostics?: boolean } = {}): WaveCheckReport {
  return checkWorkGraph({
    graph: value,
    records: options.records ?? records(),
    journal: options.journal === undefined ? null : options.journal,
    ...(options.allDiagnostics === undefined ? {} : { allDiagnostics: options.allDiagnostics })
  });
}

function codes(report: WaveCheckReport): string[] {
  return report.diagnostics.map((item) => item.code);
}

function only(report: WaveCheckReport, code: string) {
  return report.diagnostics.filter((item) => item.code === code);
}

describe("FR-NODE-246 AC-1 — the verdict", () => {
  // @req FR-NODE-246 AC-1
  it("FR-NODE-246 AC-1: a clean graph is ok; an error makes it not ok and a warning leaves it ok", () => {
    const clean = check(graph());
    expect(clean.ok).toBe(true);
    expect(clean.diagnostics).toEqual([]);

    const warned = check(graph(), { records: [record("FR-A-001", ["AC-1", "AC-2"], { stability: "draft" }), record("FR-A-002", ["AC-1"])] });
    expect(warned.diagnostics.every((item) => item.severity === "warning")).toBe(true);
    expect(warned.diagnostics.length).toBeGreaterThan(0);
    expect(warned.ok).toBe(true);

    expect(check(graph({ nodes: [node("wave-1", ["FR-A-001 AC-1"]), node("wave-2", ["FR-A-002 AC-1"])] })).ok).toBe(false);
  });
});

describe("FR-NODE-246 AC-2 — WG-01 parse refusals", () => {
  // @req FR-NODE-246 AC-2
  it("FR-NODE-246 AC-2: each parse refusal is an error naming its code and the node or edge, and the SRS checks are skipped", () => {
    const cases: Array<[Json, string, string]> = [
      [graph({ nodes: [node("wave-1", ["FR-A-001 AC-1"]), node("wave-1", ["FR-A-002 AC-1"])], edges: [] }), "lane-plan-incomplete", "wave-1"],
      [graph({ edges: [{ from: "wave-1", to: "wave-9" }] }), "lane-plan-incomplete", "wave-9"],
      [graph({ edges: [{ from: "wave-1", to: "wave-1" }] }), "schedule-cycle", "wave-1 -> wave-1"],
      [graph({ edges: [{ from: "wave-1", to: "wave-2" }, { from: "wave-1", to: "wave-2" }] }), "lane-plan-incomplete", "wave-1 -> wave-2"],
      [graph({ edges: [{ from: "wave-1", to: "wave-2" }, { from: "wave-2", to: "wave-1" }] }), "schedule-cycle", "wave-1 -> wave-2 -> wave-1"],
      [graph({ nodes: [node("wave-1", ["FR-A-001/AC-1"])], edges: [] }), "work-graph-invalid", "FR-A-001/AC-1"]
    ];
    for (const [value, code, named] of cases) {
      const report = check(value, { records: [] });
      expect(report.ok, code).toBe(false);
      expect(codes(report), JSON.stringify(value.edges)).toEqual([code]);
      expect(report.diagnostics[0]?.message).toContain(named);
      expect(report.stages).toBeNull();
    }
  });

  // @req FR-NODE-246 AC-2
  it("FR-NODE-246 AC-2: a 1.0.0 declaration is not a work graph", () => {
    const report = check({ schema_version: "1.0.0", waves: [] });
    expect(codes(report)).toEqual(["work-graph-invalid"]);
  });
});

describe("FR-NODE-246 AC-3 — WG-02 acs entries against the SRS", () => {
  // @req FR-NODE-246 AC-3
  it("FR-NODE-246 AC-3: a missing or discarded requirement and a missing AC are errors", () => {
    const value = graph({ scope: { requirements: ["FR-A-001"] }, nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2", "FR-A-001 AC-3", "FR-Z-009 AC-1", "FR-A-002 AC-1"])], edges: [] });
    const report = check(value, { records: [record("FR-A-001", ["AC-1", "AC-2"]), record("FR-A-002", ["AC-1"], { status: "discarded" })] });
    expect(only(report, "ac-missing").map((item) => item.message)).toEqual([expect.stringContaining("FR-A-001 AC-3")]);
    expect(only(report, "requirement-missing").map((item) => item.message)).toEqual([expect.stringContaining("FR-Z-009")]);
    expect(only(report, "requirement-discarded").map((item) => item.message)).toEqual([expect.stringContaining("FR-A-002")]);
    expect(report.diagnostics.filter((item) => ["ac-missing", "requirement-missing", "requirement-discarded"].includes(item.code)).every((item) => item.severity === "error")).toBe(true);
  });

  // @req FR-NODE-246 AC-3
  it("FR-NODE-246 AC-3: an expired AC is ac-expired naming the successor when the marker carries one", () => {
    const expired = record("FR-A-002", [], {
      expiredAcceptanceCriteria: [{ id: "AC-1", text: "t", checked: false, line: 1, expiredOn: "2026-11-01", successor: "FR-A-003" }]
    });
    const report = check(graph({ nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"]), node("wave-2", ["FR-A-002 AC-1"])] }), {
      records: [record("FR-A-001", ["AC-1", "AC-2"]), expired, record("FR-A-003", ["AC-1"], { target: "other" })]
    });
    const [diagnostic] = only(report, "ac-expired");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toContain("FR-A-003");
    expect(diagnostic?.details).toMatchObject({ node: "wave-2", ac: "FR-A-002 AC-1", successor: "FR-A-003" });

    const bare = record("FR-A-002", [], { expiredAcceptanceCriteria: [{ id: "AC-1", text: "t", checked: false, line: 1, expiredOn: "2026-11-01" }] });
    const plain = only(check(graph(), { records: [record("FR-A-001", ["AC-1", "AC-2"]), bare] }), "ac-expired")[0];
    expect(plain?.details).not.toHaveProperty("successor");
  });
});

describe("FR-NODE-246 AC-4 — WG-03 the AC partition", () => {
  // @req FR-NODE-246 AC-4
  it("FR-NODE-246 AC-4: a live AC of a target scope in no node is ac-unassigned", () => {
    const report = check(graph({ nodes: [node("wave-1", ["FR-A-001 AC-1"]), node("wave-2", ["FR-A-002 AC-1"])] }));
    expect(only(report, "ac-unassigned")).toEqual([expect.objectContaining({ severity: "error", details: { ac: "FR-A-001 AC-2" } })]);
    // A discarded requirement of the target and a requirement of another target are not in the scope.
    const wider = [...records(), record("FR-A-005", ["AC-1"], { status: "discarded" }), record("FR-B-001", ["AC-1"], { target: "other" })];
    expect(codes(check(graph(), { records: wider }))).toEqual([]);
  });

  // @req FR-NODE-246 AC-4
  it("FR-NODE-246 AC-4: a requirements scope holds exactly its listed requirements", () => {
    const value = graph({ scope: { requirements: ["FR-A-001", "FR-A-002"] } });
    expect(codes(check(value, { records: [...records(), record("FR-A-003", ["AC-1"])] }))).toEqual([]);
    const narrow = graph({ scope: { requirements: ["FR-A-001"] } });
    expect(only(check(narrow), "ac-out-of-scope")).toEqual([expect.objectContaining({ severity: "error", details: { node: "wave-2", ac: "FR-A-002 AC-1" } })]);
  });

  // @req FR-NODE-246 AC-4
  it("FR-NODE-246 AC-4: an AC in two nodes is ac-assigned-twice naming both", () => {
    const report = check(graph({ nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"]), node("wave-2", ["FR-A-002 AC-1", "FR-A-001 AC-2"])] }));
    expect(only(report, "ac-assigned-twice")).toEqual([expect.objectContaining({ severity: "error", details: { ac: "FR-A-001 AC-2", nodes: ["wave-1", "wave-2"] } })]);
  });

  // @req FR-NODE-246 AC-4
  it("FR-NODE-246 AC-4: an acs entry of another target is ac-out-of-scope", () => {
    const value = graph({ nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"]), node("wave-2", ["FR-A-002 AC-1", "FR-B-001 AC-1"])] });
    const report = check(value, { records: [...records(), record("FR-B-001", ["AC-1"], { target: "other" })] });
    expect(only(report, "ac-out-of-scope")).toEqual([expect.objectContaining({ severity: "error", details: { node: "wave-2", ac: "FR-B-001 AC-1" } })]);
  });
});

describe("FR-NODE-246 AC-5 — WG-04 a split requirement", () => {
  // @req FR-NODE-246 AC-5
  it("FR-NODE-246 AC-5: the ACs of one requirement in two nodes is warning ac-split naming the requirement and the nodes", () => {
    const report = check(graph({ nodes: [node("wave-1", ["FR-A-001 AC-1"]), node("wave-2", ["FR-A-002 AC-1", "FR-A-001 AC-2"])] }));
    expect(only(report, "ac-split")).toEqual([expect.objectContaining({ severity: "warning", requirementId: "FR-A-001", details: { nodes: ["wave-1", "wave-2"] } })]);
    expect(report.ok).toBe(true);
  });
});

describe("FR-NODE-246 AC-6 — WG-05 dependency order", () => {
  const dependsOn = (target: string) => ({ traceLinks: [{ type: "Requirement", reference: target, relation: "depends_on", notes: "-" }] });

  // @req FR-NODE-246 AC-6
  it("FR-NODE-246 AC-6: a dependency held by the same node or an ancestor passes", () => {
    const later = [record("FR-A-001", ["AC-1", "AC-2"]), record("FR-A-002", ["AC-1"], dependsOn("FR-A-001"))];
    expect(codes(check(graph(), { records: later }))).toEqual([]);
    const same = [record("FR-A-001", ["AC-1", "AC-2"], dependsOn("FR-A-002")), record("FR-A-002", ["AC-1"])];
    expect(codes(check(graph({ nodes: [node("wave-1", ["FR-A-002 AC-1", "FR-A-001 AC-1", "FR-A-001 AC-2"])], edges: [] }), { records: same }))).toEqual([]);
  });

  // @req FR-NODE-246 AC-6
  it("FR-NODE-246 AC-6: a dependency held by a later or unrelated node is error dependency-order", () => {
    const earlier = [record("FR-A-001", ["AC-1", "AC-2"], dependsOn("FR-A-002")), record("FR-A-002", ["AC-1"])];
    const report = check(graph(), { records: earlier });
    expect(only(report, "dependency-order")).toEqual([
      expect.objectContaining({ severity: "error", requirementId: "FR-A-001", details: { dependency: "FR-A-002", node: "wave-1", dependencyNode: "wave-2" } })
    ]);
    const unrelated = check(graph({ edges: [] }), { records: [record("FR-A-001", ["AC-1", "AC-2"]), record("FR-A-002", ["AC-1"], dependsOn("FR-A-001"))] });
    expect(codes(unrelated)).toEqual(["dependency-order"]);
    // A dependency on a requirement outside the graph is not this check's concern.
    const outside = check(graph(), { records: [record("FR-A-001", ["AC-1", "AC-2"], dependsOn("FR-Q-001")), record("FR-A-002", ["AC-1"])] });
    expect(codes(outside)).toEqual([]);
    // Only a Requirement / depends_on row is a dependency.
    const related = { traceLinks: [{ type: "Requirement", reference: "FR-A-002", relation: "related_to", notes: "-" }] };
    expect(codes(check(graph(), { records: [record("FR-A-001", ["AC-1", "AC-2"], related), record("FR-A-002", ["AC-1"])] }))).toEqual([]);
  });
});

describe("FR-NODE-246 AC-7 — WG-06 secrets and URLs", () => {
  // @req FR-NODE-246 AC-7
  it("FR-NODE-246 AC-7: a string field a shared secret pattern matches is secret-in-graph naming the node and field", () => {
    const leaky = graph({
      nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], { description: "call with api_key=abc12345" }), node("wave-2", ["FR-A-002 AC-1"], { cautions: ["fine", "token: ghp_" + "a".repeat(36)] })]
    });
    const report = check(leaky);
    expect(only(report, "secret-in-graph").map((item) => [item.severity, item.details])).toEqual([
      ["error", { node: "wave-1", field: "nodes[0].description" }],
      ["error", { node: "wave-2", field: "nodes[1].cautions[1]" }]
    ]);
    expect(only(check(graph({ title: "MONKEY_KEY rotation" })), "secret-in-graph")).toEqual([]);
  });

  // @req FR-NODE-246 AC-7
  it("FR-NODE-246 AC-7: a secret in a graph the parse refuses is still reported", () => {
    const refusedGraph = graph({ title: "password=hunter22", edges: [{ from: "wave-1", to: "wave-9" }] });
    expect(codes(check(refusedGraph))).toEqual(["lane-plan-incomplete", "secret-in-graph"]);
  });

  // @req FR-NODE-246 AC-7
  it("FR-NODE-246 AC-7: an http or https URL in any on_complete field is url-in-action", () => {
    const value = graph({
      defaults: { on_complete: [{ id: "tell", kind: "instruction", text: "post to https://chat.example/x" }] },
      nodes: [
        node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], { on_complete: [{ id: "n", kind: "notify", channel: "team", message: "see http://example.invalid/r" }] }),
        node("wave-2", ["FR-A-002 AC-1"], { description: "docs at https://example.invalid" })
      ]
    });
    expect(only(check(value), "url-in-action").map((item) => [item.severity, item.details])).toEqual([
      ["error", { node: "wave-1", field: "nodes[0].on_complete[0].message" }],
      ["error", { node: null, field: "defaults.on_complete[0].text" }]
    ]);
  });
});

describe("FR-NODE-246 AC-8 — WG-07 completion actions", () => {
  // @req FR-NODE-246 AC-8
  it("FR-NODE-246 AC-8: an action id repeated within a node after the defaults apply is an error", () => {
    const twice = [
      { id: "tell", kind: "instruction", text: "a" },
      { id: "tell", kind: "notify", channel: "team" }
    ];
    const own = check(graph({ nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], { on_complete: twice }), node("wave-2", ["FR-A-002 AC-1"])] }));
    expect(only(own, "action-id-duplicate")).toEqual([expect.objectContaining({ severity: "error", details: { node: "wave-1", action: "tell" } })]);
    const inherited = check(graph({ defaults: { on_complete: twice }, nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], { on_complete: [] }), node("wave-2", ["FR-A-002 AC-1"])] }));
    expect(only(inherited, "action-id-duplicate").map((item) => item.details)).toEqual([{ node: "wave-2", action: "tell" }]);
  });

  // @req FR-NODE-246 AC-8
  it("FR-NODE-246 AC-8: a message placeholder outside the closed list is an error", () => {
    const placeholders = "{run_id} {wave} {title} {purpose} {acs_done} {acs_total} {github_issues} {completed_at}";
    const fine = graph({ defaults: { on_complete: [{ id: "n", kind: "notify", channel: "team", message: placeholders }] } });
    expect(codes(check(fine))).toEqual([]);
    const bad = graph({ defaults: { on_complete: [{ id: "n", kind: "notify", channel: "team", message: "{wave} by {owner} at {completed-at}" }] } });
    expect(only(check(bad), "message-placeholder-unknown").map((item) => [item.severity, item.details])).toEqual([
      ["error", { node: null, action: "n", placeholder: "{owner}" }],
      ["error", { node: null, action: "n", placeholder: "{completed-at}" }]
    ]);
  });
});

describe("FR-NODE-246 AC-9 — WG-08 the journal's waves", () => {
  const stamp = (journalLine: number, wave: string): WavesEvent => ({ journalLine, run_id: "run-a", wave, status: "in_progress" });

  // @req FR-NODE-246 AC-9
  it("FR-NODE-246 AC-9: a wave the run's journal names that is not a node is journal-wave-missing", () => {
    const report = check(graph(), { journal: [stamp(1, "all"), stamp(2, "wave-1"), stamp(3, "wave-7"), stamp(4, "wave-7")] });
    expect(report.journal_checked).toBe(true);
    expect(only(report, "journal-wave-missing")).toEqual([expect.objectContaining({ severity: "error", details: { wave: "wave-7" } })]);
  });

  // @req FR-NODE-246 AC-9
  it("FR-NODE-246 AC-9: without a run the output says journal_checked false", () => {
    expect(check(graph()).journal_checked).toBe(false);
  });
});

describe("FR-NODE-246 AC-10 — WG-09 a draft requirement", () => {
  // @req FR-NODE-246 AC-10
  it("FR-NODE-246 AC-10: a node requirement whose Stability is draft is warning requirement-draft", () => {
    const report = check(graph(), { records: [record("FR-A-001", ["AC-1", "AC-2"]), record("FR-A-002", ["AC-1"], { stability: "draft" })] });
    expect(report.diagnostics).toEqual([expect.objectContaining({ code: "requirement-draft", severity: "warning", requirementId: "FR-A-002", details: { nodes: ["wave-2"] } })]);
  });
});

describe("FR-NODE-246 AC-11 — the stage preview", () => {
  // @req FR-NODE-246 AC-11
  it("FR-NODE-246 AC-11: every node is placed in a stage by computeLanePlan, dependencies and shared files apart", () => {
    const value = graph({
      nodes: [
        node("wave-1", ["FR-A-001 AC-1"]),
        node("wave-2", ["FR-A-001 AC-2"], { files: ["src/shared.ts"] }),
        node("wave-3", ["FR-A-002 AC-1"], { files: ["src/shared.ts"] }),
        node("wave-4", ["FR-A-003 AC-1"])
      ],
      edges: [{ from: "wave-1", to: "wave-4" }]
    });
    const report = check(value, { records: [...records(), record("FR-A-003", ["AC-1"])] });
    expect(report.stages).toEqual([
      { stage: 1, waves: ["wave-1", "wave-2"] },
      { stage: 2, waves: ["wave-3"] },
      { stage: 3, waves: ["wave-4"] }
    ]);
  });

  // @req FR-NODE-246 AC-11
  it("FR-NODE-246 AC-11: an SDS write set the command read joins the node's files", () => {
    const value = graph({ edges: [] });
    const report = checkWorkGraph({ graph: value, records: records(), journal: null, sdsWriteSets: new Map([["wave-2", ["src/wave-1.ts"]]]) });
    expect(report.stages).toEqual([
      { stage: 1, waves: ["wave-1"] },
      { stage: 2, waves: ["wave-2"] }
    ]);
  });
});

describe("FR-NODE-246 AC-12 — bounded diagnostics", () => {
  function noisy(): Json {
    const acs = Array.from({ length: 60 }, (_, index) => `FR-Z-${String(index + 1).padStart(3, "0")} AC-1`);
    return graph({ nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"]), node("wave-2", ["FR-A-002 AC-1", ...acs])] });
  }
  const drafts = (): CheckRecord[] => Array.from({ length: 5 }, (_, index) => record(`FR-D-00${index + 1}`, ["AC-1"], { stability: "draft", target: "x" }));

  // @req FR-NODE-246 AC-12
  it("FR-NODE-246 AC-12: at most 50 entries, errors first, with a truncation descriptor and a per-code summary over all", () => {
    const value = noisy();
    (value.nodes as Json[]).push(node("wave-3", drafts().map((entry) => `${entry.id} AC-1`)));
    const report = check(value, { records: [...records(), ...drafts()] });
    expect(WAVE_CHECK_DIAGNOSTICS_LIMIT).toBe(50);
    expect(report.diagnostics).toHaveLength(50);
    expect(report.diagnostics.every((item) => item.severity === "error")).toBe(true);
    expect(report.diagnosticsTruncation).toEqual({ total: 70, returned: 50, limit: 50 });
    expect(report.diagnosticsSummary).toEqual({ errors: 65, warnings: 5, byCode: { "requirement-missing": 60, "ac-out-of-scope": 5, "requirement-draft": 5 } });
  });

  // @req FR-NODE-246 AC-12
  it("FR-NODE-246 AC-12: all diagnostics returns them all, errors before warnings", () => {
    const value = noisy();
    (value.nodes as Json[]).unshift(node("wave-3", drafts().map((entry) => `${entry.id} AC-1`)));
    // The journal check runs last, so its error would follow the draft warnings if nothing reordered them.
    const journal: WavesEvent[] = [{ journalLine: 1, run_id: "run-a", wave: "wave-9", status: "in_progress" }];
    const report = check(value, { records: [...records(), ...drafts()], allDiagnostics: true, journal });
    expect(report.diagnostics).toHaveLength(71);
    expect(report).not.toHaveProperty("diagnosticsTruncation");
    const severities = report.diagnostics.map((item) => item.severity);
    expect(severities).toEqual([...Array(66).fill("error"), ...Array(5).fill("warning")]);
  });
});

describe("FR-NODE-246 AC-14 — an unknown ID in a requirement-list scope", () => {
  // @req FR-NODE-246 AC-14
  it("FR-NODE-246 AC-14: a scope requirement that is not in the SRS is error requirement-missing naming the ID", () => {
    const value = graph({ scope: { requirements: ["FR-A-001", "FR-Z-404", "FR-A-002"] } });
    const report = check(value);
    expect(report.ok).toBe(false);
    expect(only(report, "requirement-missing")).toEqual([
      expect.objectContaining({ severity: "error", requirementId: "FR-Z-404", message: expect.stringContaining("FR-Z-404"), details: { scope: "FR-Z-404" } })
    ]);
    // A target scope names no ID, and every listed ID that exists is silent.
    expect(codes(check(graph({ scope: { requirements: ["FR-A-001", "FR-A-002"] } })))).toEqual([]);
  });
});

describe("FR-NODE-246 — one diagnostic per node, never merged by the shared dedup", () => {
  /** Two nodes declaring the same content, so only the node tells their diagnostics apart. */
  function twin(extra: Json, acs: [string[], string[]] = [["FR-A-001 AC-1", "FR-A-001 AC-2"], ["FR-A-002 AC-1"]]): Json {
    return graph({ nodes: [node("wave-1", acs[0], extra), node("wave-2", acs[1], extra)] });
  }
  function nodesOf(report: WaveCheckReport, code: string): unknown[] {
    return only(report, code)
      .map((item) => (item.details as { node?: unknown }).node)
      .sort();
  }

  // @req FR-NODE-246 AC-8
  it("FR-NODE-246 AC-8: the same unknown placeholder in two nodes is an error for each node", () => {
    const action = { id: "notify-team", kind: "notify", channel: "team", message: "done {bogus}" };
    const report = check(twin({ on_complete: [action] }));
    expect(nodesOf(report, "message-placeholder-unknown")).toEqual(["wave-1", "wave-2"]);
    expect(report.diagnosticsSummary.byCode["message-placeholder-unknown"]).toBe(2);
  });

  // @req FR-NODE-246 AC-3, AC-7, AC-8
  it("FR-NODE-246 AC-3, AC-7, AC-8: every per-node code repeated in two nodes yields one diagnostic per node", () => {
    const twice = [
      { id: "tell", kind: "instruction", text: "a" },
      { id: "tell", kind: "notify", channel: "team", message: "see https://example.invalid" }
    ];
    const content = check(twin({ description: "api_key=abc12345", on_complete: twice }));
    for (const code of ["secret-in-graph", "url-in-action", "action-id-duplicate"]) expect(nodesOf(content, code), code).toEqual(["wave-1", "wave-2"]);

    const srs = check(twin({}, [["FR-Z-009 AC-1", "FR-A-001 AC-9", "FR-A-002 AC-1", "FR-A-001 AC-1", "FR-A-001 AC-2"], ["FR-Z-009 AC-1", "FR-A-001 AC-9", "FR-A-002 AC-1"]]), {
      records: [record("FR-A-001", ["AC-1", "AC-2"]), record("FR-A-002", [], { expiredAcceptanceCriteria: [{ id: "AC-1", text: "t", checked: false, line: 1, expiredOn: "2026-11-01" }] })]
    });
    for (const code of ["requirement-missing", "ac-missing", "ac-expired"]) expect(nodesOf(srs, code), code).toEqual(["wave-1", "wave-2"]);
  });
});

describe("FR-NODE-246 AC-2 — a list field written as a single value is refused, never passed", () => {
  // @req FR-NODE-246 AC-2
  it("FR-NODE-246 AC-2: each list-typed field given one value instead of a list is error work-graph-invalid", () => {
    const action = { id: "n", kind: "notify", channel: "team" };
    const one = (extra: Json): Json => graph({ nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], extra), node("wave-2", ["FR-A-002 AC-1"])] });
    const cases: Array<[string, Json]> = [
      ["acs", one({ acs: "FR-A-001 AC-1" })],
      ["done_when", one({ done_when: { id: "DW-1", text: "t" } })],
      ["files", one({ files: "src/a.ts" })],
      ["sds", one({ sds: "docs/sds/a.sds.md" })],
      ["github_issues", one({ github_issues: 7 })],
      ["cautions", one({ cautions: "careful" })],
      ["on_complete", one({ on_complete: action })],
      ["defaults.on_complete", graph({ defaults: { on_complete: action } })],
      ["edges", graph({ edges: { from: "wave-1", to: "wave-2" } })],
      ["nodes", graph({ nodes: node("wave-1", ["FR-A-001 AC-1"]) })],
      ["scope.requirements", graph({ scope: { requirements: "FR-A-001" } })]
    ];
    for (const [field, value] of cases) {
      const report = check(value);
      expect(codes(report), field).toEqual(["work-graph-invalid"]);
      expect(report.ok, field).toBe(false);
    }
  });

  // @req FR-NODE-246 AC-7
  it("FR-NODE-246 AC-7: a secret inside an on_complete written as one object is still secret-in-graph", () => {
    const value = graph({ nodes: [node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], { on_complete: { id: "n", kind: "notify", channel: "team", message: "token=ab12cd34" } }), node("wave-2", ["FR-A-002 AC-1"])] });
    expect(codes(check(value))).toEqual(["work-graph-invalid", "secret-in-graph"]);
  });
});

describe("FR-NODE-246 AC-13 — the allocation kernel is gone", () => {
  const repo = path.resolve(__dirname, "../../..");
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const full = path.join(directory, name);
      return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
    });
  }

  // @req FR-NODE-246 AC-13
  it("FR-NODE-246 AC-13: allocation.ts and its test are removed and no source names the kernel", () => {
    expect(existsSync(path.join(repo, "src/core/orchestrator/allocation.ts"))).toBe(false);
    expect(existsSync(path.join(repo, "test/core/orchestrator/allocation.fr-node-133.test.ts"))).toBe(false);
    const naming = sourceFiles(path.join(repo, "src")).filter((file) => /checkWaveAllocation|deriveAllocationSet|resolveAllocationOnResume|ALLOCATION_CONJUNCTS/.test(readFileSync(file, "utf8")));
    expect(naming).toEqual([]);
  });
});
