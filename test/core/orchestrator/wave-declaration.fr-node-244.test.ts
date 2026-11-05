import { describe, expect, it } from "vitest";
import {
  declarationEntryDigest,
  parseWaveDeclaration,
  waveReadiness,
  type WaveDeclaration
} from "../../../src/core/orchestrator/wave-declaration.js";
import { computeLanePlan } from "../../../src/core/orchestrator/lane-plan.js";

// FR-NODE-244 — wave declaration schema 2.0.0: a work graph of nodes and edges, normalized to the
// same WaveDeclaration 1.0.0 yields.

type Json = Record<string, unknown>;

function node(wave: string, extra: Json = {}): Json {
  return {
    wave,
    title: `node ${wave}`,
    purpose: "why this node exists",
    acs: [`FR-NODE-216 AC-${wave.slice(5)}`],
    done_when: [],
    files: [`src/${wave}.ts`],
    ...extra
  };
}

function graph(extra: Json = {}): Json {
  return {
    schema_version: "2.0.0",
    run_id: "run-a",
    title: "a work graph",
    scope: { requirements: ["FR-NODE-216"] },
    nodes: [node("wave-1"), node("wave-2")],
    edges: [{ from: "wave-1", to: "wave-2", reason: "wave-2 calls wave-1" }],
    ...extra
  };
}

function withNode(extra: Json, wave = "wave-1"): Json {
  return graph({ nodes: [node(wave, extra)], edges: [] });
}

function parsed(value: unknown): WaveDeclaration {
  const result = parseWaveDeclaration(value);
  if (!result.ok) throw new Error(`expected a declaration, got ${result.message}`);
  return result.declaration;
}

function refusal(value: unknown): { gate: string | null; message: string } {
  const result = parseWaveDeclaration(value);
  if (result.ok) throw new Error(`expected a refusal of ${JSON.stringify(value)}`);
  return { gate: result.gate, message: result.message };
}

function without(record: Json, key: string): Json {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

describe("FR-NODE-244 AC-1 — the 2.0.0 top level", () => {
  // @req FR-NODE-244 AC-1
  it("FR-NODE-244 AC-1: accepts the required keys with engine, prd and defaults", () => {
    expect(parsed(graph({ engine: "kiwi-orchestrator", prd: "docs/prd/x.prd.md", defaults: { on_complete: [] } })).waves).toHaveLength(2);
    expect(parsed(graph({ scope: { target: "5.3.0" } })).waves).toHaveLength(2);
  });

  // @req FR-NODE-244 AC-1
  it("FR-NODE-244 AC-1: refuses a missing required key and an unknown top-level key", () => {
    for (const key of ["run_id", "title", "scope", "nodes", "edges"]) {
      expect(refusal(without(graph(), key)).message, key).toContain(`needs ${key}`);
    }
    expect(refusal(graph({ waves: [] })).message).toContain("waves");
    expect(refusal(graph({ status: "done" })).message).toContain("status");
    expect(refusal(graph({ run_id: "" })).message).toContain("run_id");
    expect(refusal(graph({ title: 5 })).message).toContain("title");
    expect(refusal(graph({ engine: "kiwi-other" })).message).toContain("engine");
    expect(refusal(graph({ prd: 3 })).message).toContain("prd");
  });

  // @req FR-NODE-244 AC-1
  it("FR-NODE-244 AC-1: scope holds exactly one of target or a non-empty requirements list", () => {
    expect(refusal(graph({ scope: { target: "5.3.0", requirements: ["FR-NODE-216"] } })).message).toContain("scope");
    expect(refusal(graph({ scope: {} })).message).toContain("scope");
    expect(refusal(graph({ scope: { requirements: [] } })).message).toContain("scope");
    expect(refusal(graph({ scope: { requirements: ["not an id"] } })).message).toContain("scope");
    expect(refusal(graph({ scope: { target: 5 } })).message).toContain("scope");
  });
});

describe("FR-NODE-244 AC-2 — a node's keys", () => {
  // @req FR-NODE-244 AC-2
  it("FR-NODE-244 AC-2: accepts description, github_issues, cautions, on_complete and sds", () => {
    const extra = {
      description: "d".repeat(4000),
      github_issues: [101, "hancomins/og-server#14"],
      cautions: ["c".repeat(300)],
      on_complete: [{ id: "report", kind: "notify", channel: "bumbum-report" }],
      sds: ["docs/sds/x.sds.md"]
    };
    expect(parsed(withNode(extra)).waves[0]?.sds).toEqual(["docs/sds/x.sds.md"]);
  });

  // @req FR-NODE-244 AC-2
  it("FR-NODE-244 AC-2: refuses a node missing a required key", () => {
    for (const key of ["wave", "title", "purpose", "acs", "done_when", "files"]) {
      expect(refusal(graph({ nodes: [without(node("wave-1"), key)], edges: [] })).message, key).toContain(`needs ${key}`);
    }
  });

  // @req FR-NODE-244 AC-2
  it("FR-NODE-244 AC-2: refuses status, state, coordinates and any other unknown node key", () => {
    for (const key of ["status", "state", "x", "y", "position", "requirements", "depends_on"]) {
      expect(refusal(withNode({ [key]: 1 })).message, key).toContain(key);
    }
  });

  // @req FR-NODE-244 AC-2
  it("FR-NODE-244 AC-2: enforces the wave name and the title, purpose, description and caution lengths", () => {
    refusal(withNode({}, "wave-01"));
    refusal(withNode({}, "w1"));
    refusal(withNode({ title: "" }));
    refusal(withNode({ title: "t".repeat(61) }));
    expect(parsed(withNode({ title: "가".repeat(60), purpose: "p".repeat(300) })).waves).toHaveLength(1);
    refusal(withNode({ purpose: "" }));
    refusal(withNode({ purpose: "p".repeat(301) }));
    refusal(withNode({ description: "d".repeat(4001) }));
    refusal(withNode({ cautions: ["c".repeat(301)] }));
    refusal(withNode({ cautions: "one caution" }));
  });

  // @req FR-NODE-244 AC-2
  it("FR-NODE-244 AC-2: github_issues holds positive integers or owner/repo#n", () => {
    for (const bad of [0, -1, 1.5, "#14", "owner/repo#0", "owner/repo", "https://github.com/o/r/issues/1"]) {
      refusal(withNode({ github_issues: [bad] }));
    }
    refusal(withNode({ github_issues: 101 }));
  });
});

describe("FR-NODE-244 AC-3 — acs and the node's requirement set", () => {
  // @req FR-NODE-244 AC-3
  it("FR-NODE-244 AC-3: refuses an empty acs, a repeated item and any form other than <REQ-ID> AC-<n>", () => {
    for (const acs of [[], ["FR-NODE-216/AC-1"], ["AC-1"], ["FR-NODE-216  AC-1"], ["FR-NODE-216 AC-0"], ["FR-NODE-216 AC-1", "FR-NODE-216 AC-1"], "FR-NODE-216 AC-1"]) {
      refusal(withNode({ acs }));
    }
  });

  // @req FR-NODE-244 AC-3
  it("FR-NODE-244 AC-3: computes the requirement set from acs in first-occurrence order", () => {
    const declaration = parsed(withNode({ acs: ["IR-CLI-104 AC-2", "FR-NODE-216 AC-1", "IR-CLI-104 AC-1", "FR-MCP-070 AC-3"] }));
    expect(declaration.waves[0]?.requirements).toEqual(["IR-CLI-104", "FR-NODE-216", "FR-MCP-070"]);
  });
});

describe("FR-NODE-244 AC-4 — done_when", () => {
  // @req FR-NODE-244 AC-4
  it("FR-NODE-244 AC-4: accepts an empty list and a list of {id, text} with unique DW ids", () => {
    expect(parsed(withNode({ done_when: [] })).waves).toHaveLength(1);
    expect(parsed(withNode({ done_when: [{ id: "DW-1", text: "a" }, { id: "DW-2", text: "b" }] })).waves).toHaveLength(1);
  });

  // @req FR-NODE-244 AC-4
  it("FR-NODE-244 AC-4: refuses a malformed or repeated id", () => {
    for (const done_when of [
      [{ id: "DW-0", text: "a" }],
      [{ id: "dw-1", text: "a" }],
      [{ id: "DW-1" }],
      [{ id: "DW-1", text: "a" }, { id: "DW-1", text: "b" }],
      ["DW-1"],
      {}
    ]) {
      refusal(withNode({ done_when }));
    }
  });
});

describe("FR-NODE-244 AC-5 — on_complete", () => {
  // @req FR-NODE-244 AC-5
  it("FR-NODE-244 AC-5: accepts notify and instruction actions on a node and as defaults", () => {
    const actions = [
      { id: "report", kind: "notify", channel: "bumbum-report", message: "done", blocking: true },
      { id: "issue-done", kind: "instruction", text: "move the issue to done" }
    ];
    expect(parsed(withNode({ on_complete: actions })).waves).toHaveLength(1);
    expect(parsed(graph({ defaults: { on_complete: actions } })).waves).toHaveLength(2);
  });

  // @req FR-NODE-244 AC-5
  it("FR-NODE-244 AC-5: refuses another kind, a notify without a channel, a bad channel alias and a non-boolean blocking", () => {
    const bad = [
      { id: "hook", kind: "webhook", url: "https://example.invalid" },
      { id: "hook", kind: "webhook", text: "post it" },
      { kind: "notify", channel: "ok" },
      { id: "report", kind: "notify" },
      { id: "report", kind: "notify", channel: "https://chat.example/x" },
      { id: "report", kind: "notify", channel: "Report" },
      { id: "report", kind: "notify", channel: "a".repeat(41) },
      { id: "report", kind: "notify", channel: "ok", blocking: "yes" },
      { id: "do", kind: "instruction" },
      { id: "do", kind: "instruction", text: "x", channel: "ok" }
    ];
    for (const action of bad) {
      refusal(withNode({ on_complete: [action] }));
      refusal(graph({ defaults: { on_complete: [action] } }));
    }
    refusal(graph({ defaults: { on_start: [] } }));
  });
});

describe("FR-NODE-244 AC-6 — edges", () => {
  // @req FR-NODE-244 AC-6
  it("FR-NODE-244 AC-6: an empty edge list is accepted and implies no dependency from node order", () => {
    const declaration = parsed(graph({ edges: [] }));
    expect(declaration.waves.map((entry) => entry.dependsOn)).toEqual([[], []]);
  });

  // @req FR-NODE-244 AC-6
  it("FR-NODE-244 AC-6: refuses an unknown endpoint, a duplicate edge and a duplicate node with lane-plan-incomplete", () => {
    expect(refusal(graph({ edges: [{ from: "wave-1", to: "wave-9" }] })).gate).toBe("lane-plan-incomplete");
    expect(refusal(graph({ edges: [{ from: "wave-9", to: "wave-1" }] })).gate).toBe("lane-plan-incomplete");
    expect(refusal(graph({ edges: [{ from: "wave-1", to: "wave-2" }, { from: "wave-1", to: "wave-2", reason: "again" }] })).gate).toBe("lane-plan-incomplete");
    expect(refusal(graph({ nodes: [node("wave-1"), node("wave-1")], edges: [] })).gate).toBe("lane-plan-incomplete");
  });

  // @req FR-NODE-244 AC-6
  it("FR-NODE-244 AC-6: refuses a self edge and a cycle with schedule-cycle", () => {
    expect(refusal(graph({ edges: [{ from: "wave-1", to: "wave-1" }] })).gate).toBe("schedule-cycle");
    expect(refusal(graph({ edges: [{ from: "wave-1", to: "wave-2" }, { from: "wave-2", to: "wave-1" }] })).gate).toBe("schedule-cycle");
  });

  // @req FR-NODE-244 AC-6
  it("FR-NODE-244 AC-6: refuses an edge with an unknown key or a non-string reason", () => {
    refusal(graph({ edges: [{ from: "wave-1", to: "wave-2", weight: 1 }] }));
    refusal(graph({ edges: [{ from: "wave-1", to: "wave-2", reason: 3 }] }));
    refusal(graph({ edges: {} }));
  });
});

describe("FR-NODE-244 AC-7 — the same WaveDeclaration as 1.0.0", () => {
  const v1 = {
    schema_version: "1.0.0",
    waves: [
      { wave: "wave-1", depends_on: [], files: ["src/wave-1.ts"], requirements: ["FR-NODE-216"] },
      { wave: "wave-2", depends_on: ["wave-1"], files: ["src/wave-2.ts"], requirements: ["FR-NODE-216"] },
      { wave: "wave-3", depends_on: ["wave-1", "wave-2"], files: ["src\\wave-3.ts"], requirements: ["IR-CLI-104"], sds: ["docs/sds/w3.sds.md"] }
    ]
  };
  const v2 = graph({
    nodes: [
      node("wave-3", { acs: ["IR-CLI-104 AC-1"], files: ["src/wave-3.ts"], sds: ["docs/sds/w3.sds.md"] }),
      node("wave-1"),
      node("wave-2", { acs: ["FR-NODE-216 AC-2"] })
    ],
    edges: [
      { from: "wave-2", to: "wave-3" },
      { from: "wave-1", to: "wave-2" },
      { from: "wave-1", to: "wave-3" }
    ]
  });

  // @req FR-NODE-244 AC-7
  it("FR-NODE-244 AC-7: depends_on comes from the edges into a node and the entries are in ascending n", () => {
    expect(parsed(v2)).toEqual(parsed(v1));
  });

  // @req FR-NODE-244 AC-7
  it("FR-NODE-244 AC-7: readiness and the lane plan accept the 2.0.0 parse unchanged", () => {
    const statuses = new Map([[1, "complete" as const]]);
    expect(waveReadiness(parsed(v2), statuses).ready.map((entry) => entry.wave)).toEqual(["wave-2"]);
    const plan = (declaration: WaveDeclaration) =>
      computeLanePlan({
        waves: declaration.waves.map((entry) => ({ waveId: entry.wave, writeSet: [...entry.files] })),
        dependencies: Object.fromEntries(declaration.waves.map((entry) => [entry.wave, [...entry.dependsOn]])),
        laneCap: 4
      });
    expect(JSON.stringify(plan(parsed(v2)))).toBe(JSON.stringify(plan(parsed(v1))));
  });
});

describe("FR-NODE-244 AC-8 — the declaration digest", () => {
  // @req FR-NODE-244 AC-8
  it("FR-NODE-244 AC-8: a 1.0.0 and a 2.0.0 file declaring the same waves yield the same digest", () => {
    const v1 = { schema_version: "1.0.0", waves: [{ wave: "wave-1", depends_on: [], files: ["src/wave-1.ts"], requirements: ["X-Y-1"], sds: ["docs/sds/a.sds.md"] }] };
    const v2 = withNode({ sds: ["docs/sds/a.sds.md"] });
    expect(declarationEntryDigest(parsed(v2).waves[0]!)).toBe(declarationEntryDigest(parsed(v1).waves[0]!));
  });

  // @req FR-NODE-244 AC-8
  it("FR-NODE-244 AC-8: editing the descriptive fields, the edge reason or acs leaves every digest unchanged", () => {
    const digests = (value: Json) => parsed(value).waves.map(declarationEntryDigest);
    const base = digests(graph());
    const edited = graph({
      title: "renamed",
      nodes: [
        node("wave-1", {
          title: "other",
          purpose: "other purpose",
          description: "more",
          github_issues: [7],
          cautions: ["careful"],
          done_when: [{ id: "DW-1", text: "x" }],
          on_complete: [{ id: "report", kind: "notify", channel: "team" }],
          acs: ["IR-CLI-104 AC-1", "IR-CLI-104 AC-2"]
        }),
        node("wave-2")
      ],
      edges: [{ from: "wave-1", to: "wave-2", reason: "a different reason" }]
    });
    expect(digests(edited)).toEqual(base);
    expect(digests(graph({ edges: [] }))).not.toEqual(base);
  });
});
