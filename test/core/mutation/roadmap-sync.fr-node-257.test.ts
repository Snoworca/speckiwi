import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncRoadmapActuals } from "../../../src/core/mutation/roadmap-sync.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { proposeRoadmapActuals } from "../../../src/core/roadmap/actual-dates.js";
import { checkRoadmap } from "../../../src/core/roadmap/compute-roadmap.js";
import { parseRoadmap } from "../../../src/core/roadmap/parse-roadmap.js";
import type { RoadmapSources } from "../../../src/core/roadmap/roadmap-model.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { requirement, roadmapText, sources, type ItemSpec } from "../roadmap/roadmap-fixture.js";

// FR-NODE-257 — roadmap sync: the empty Actual Start and Actual End cells, filled from the computed
// status on the as-of date; proposed by default, written only when applied, optionally for one item.

const ASOF = "2026-11-20";

function propose(items: ItemSpec[], src: RoadmapSources, itemId?: string) {
  return proposeRoadmapActuals(parseRoadmap(roadmapText(...items), src).document, src, ASOF, itemId);
}

const targets: RoadmapSources["targets"] = [
  { target: "active", status: "active" },
  { target: "planned", status: "planned" },
  { target: "released", status: "released" }
];

describe("FR-NODE-257 AC-1 — which empty cells are proposed", () => {
  // @req FR-NODE-257 AC-1
  it("proposes Actual Start for in-progress, done and released items and Actual End for done and released ones", () => {
    const src = sources({
      targets,
      requirements: [requirement("FR-S-001", "planned", "implemented"), requirement("FR-V-001", "planned", "verified"), requirement("FR-P-001", "planned", "planned")]
    });
    const proposals = propose(
      [
        { n: 1, fields: { Requirements: "FR-S-001, FR-P-001" } },
        { n: 2, fields: { Requirements: "FR-V-001" } },
        { n: 3, fields: { Requirements: "FR-P-001" } },
        { n: 4, fields: { Targets: "released" } },
        { n: 5, fields: { Requirements: "FR-V-001", Lifecycle: "cancelled" } },
        { n: 6, fields: { Targets: "active", Lifecycle: "paused" } }
      ],
      src
    );
    expect(proposals.map((proposal) => [proposal.item, proposal.field, proposal.value, proposal.status])).toEqual([
      ["RM-1", "Actual Start", ASOF, "in-progress"],
      ["RM-2", "Actual Start", ASOF, "done"],
      ["RM-2", "Actual End", ASOF, "done"],
      ["RM-4", "Actual Start", ASOF, "released"],
      ["RM-4", "Actual End", ASOF, "released"]
    ]);
  });
});

describe("FR-NODE-257 AC-2 — what each proposal rests on", () => {
  // @req FR-NODE-257 AC-2
  it("names the status rule and its basis and lists earlier Status change notes and Completed Work Log rows", () => {
    const started = {
      ...requirement("FR-S-001", "planned", "implemented"),
      changeNotes: [
        { date: "2026-11-01", change: "Created", reason: "x" },
        { date: "2026-11-03", change: "Status -> in_progress", reason: "began" },
        { date: "2026-11-09", change: "Status -> implemented", reason: "built" },
        { date: "2026-11-20", change: "Status -> implemented", reason: "same day, not earlier" }
      ]
    };
    const src = sources({
      targets,
      requirements: [started, requirement("FR-P-001", "planned", "planned")],
      completedWork: [
        { date: "2026-11-10", requirementIds: ["FR-S-001"], summary: "Built the thing" },
        { date: "2026-11-11", requirementIds: ["FR-P-001"], summary: "Not the basis" },
        { date: "2026-11-25", requirementIds: ["FR-S-001"], summary: "Later" }
      ]
    });
    const [proposal] = propose([{ n: 1, fields: { Requirements: "FR-S-001, FR-P-001" } }], src);
    expect(proposal).toMatchObject({ rule: "requirement-started", basis: { requirements: ["FR-S-001"], targets: [] } });
    expect(proposal!.candidates).toEqual([
      { date: "2026-11-03", source: "change-note", requirementId: "FR-S-001", text: "Status -> in_progress" },
      { date: "2026-11-09", source: "change-note", requirementId: "FR-S-001", text: "Status -> implemented" },
      { date: "2026-11-10", source: "completed-work", requirementId: "FR-S-001", text: "Built the thing" }
    ]);
  });

  // @req FR-NODE-257 AC-2
  it("takes the candidates of a target rule from the requirements of those targets", () => {
    const shipped = { ...requirement("FR-R-001", "released", "verified"), changeNotes: [{ date: "2026-11-02", change: "Status -> verified", reason: "done" }] };
    const src = sources({ targets, requirements: [shipped] });
    const [start] = propose([{ n: 1, fields: { Targets: "released" } }], src);
    expect(start).toMatchObject({ rule: "targets-released", basis: { requirements: [], targets: ["released"] } });
    expect(start!.candidates).toEqual([{ date: "2026-11-02", source: "change-note", requirementId: "FR-R-001", text: "Status -> verified" }]);
  });
});

describe("FR-NODE-257 AC-3 — a recorded actual date is never touched", () => {
  // @req FR-NODE-257 AC-3
  it("proposes nothing for an actual date that is not `-`", () => {
    const src = sources({ targets, requirements: [requirement("FR-V-001", "planned", "verified")] });
    expect(propose([{ n: 1, fields: { Requirements: "FR-V-001", "Actual Start": "2026-11-02" } }], src).map((proposal) => proposal.field)).toEqual(["Actual End"]);
    expect(propose([{ n: 1, fields: { Requirements: "FR-V-001", "Actual Start": "2026-11-02", "Actual End": "2026-11-09" } }], src)).toEqual([]);
  });
});

async function workspace(roadmap: string, targetStatus = "active"): Promise<{ rootPath: string; file: string }> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const index = path.join(rootPath, "docs", "spec", "00.index.md");
  const text = await readFile(index, "utf8");
  await writeFile(index, text.replace("| v1.0.0 | release | active | Fixture release |", `| v1.0.0 | release | ${targetStatus} | Fixture release |`), "utf8");
  const file = path.join(rootPath, "docs", "roadmap.md");
  await writeFile(file, roadmap, "utf8");
  return { rootPath, file };
}

const lf = async (file: string) => (await readFile(file, "utf8")).replace(/\r\n/g, "\n");

describe("FR-NODE-257 AC-4 — propose by default, write only when applied", () => {
  // @req FR-NODE-257 AC-4
  it("returns the proposals and writes nothing without apply", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1, fields: { Targets: "v1.0.0" } }));
    const before = await readFile(file, "utf8");
    const result = await syncRoadmapActuals(await resolveProjectRoot(rootPath), { asOf: ASOF });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ asOf: ASOF, dryRun: true, written: false });
    expect(result.value?.proposals.map((proposal) => [proposal.item, proposal.field, proposal.candidates.map((candidate) => candidate.date)])).toEqual([
      ["RM-1", "Actual Start", ["2026-05-10"]]
    ]);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-257 AC-4
  it("writes the dates with one history row each under apply, as update records a change", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1, fields: { Targets: "v1.0.0" } }, { n: 2, fields: { Targets: "v1.0.0", "Actual Start": "2026-11-01" } }), "completed");
    const result = await syncRoadmapActuals(await resolveProjectRoot(rootPath), { asOf: ASOF, apply: true, date: "2026-11-21" });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ dryRun: false, written: true });
    expect(result.mutation).toMatchObject({ kind: "sync_roadmap_actuals", filePath: "docs/roadmap.md", written: true });
    const written = await lf(file);
    const items = parseRoadmap(written, sources()).document.items;
    expect(items.map((item) => [item.fields["Actual Start"]?.value, item.fields["Actual End"]?.value])).toEqual([
      [ASOF, ASOF],
      ["2026-11-01", ASOF]
    ]);
    expect(items[0]!.history.map((row) => [row.date, row.field, row.from, row.to])).toEqual([
      ["2026-11-01", "Created", "-", "-"],
      ["2026-11-21", "Actual Start", "-", ASOF],
      ["2026-11-21", "Actual End", "-", ASOF]
    ]);
    expect(items[0]!.history[1]!.reason).toContain("targets-completed");
    expect(items[1]!.history.map((row) => row.field)).toEqual(["Created", "Actual End"]);
    expect(checkRoadmap(written, sources({ targets: [{ target: "v1.0.0", status: "completed" }] })).diagnostics).toEqual([]);
  });

  // @req FR-NODE-257 AC-4
  it("writes nothing under apply while another mutation holds the SRS lock", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1, fields: { Targets: "v1.0.0" } }));
    await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
    const now = Date.now();
    await writeFile(
      path.join(rootPath, "kiwi", ".srs.lock"),
      JSON.stringify({ schemaVersion: "1.0.0", owner: "other:1", operation: "other", requestId: "r", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }),
      "utf8"
    );
    const before = await readFile(file, "utf8");
    const result = await syncRoadmapActuals(await resolveProjectRoot(rootPath), { asOf: ASOF, apply: true });
    expect(result).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-257 AC-4
  it("refuses an as-of date that is not a calendar day", async () => {
    const { rootPath } = await workspace(roadmapText({ n: 1, fields: { Targets: "v1.0.0" } }));
    const result = await syncRoadmapActuals(await resolveProjectRoot(rootPath), { asOf: "2026-11" });
    expect(result.error?.code).toBe("USAGE");
  });
});

describe("FR-NODE-257 AC-5 — one item only", () => {
  // @req FR-NODE-257 AC-5
  it("proposes and writes only for the named item", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1, fields: { Targets: "v1.0.0" } }, { n: 2, fields: { Targets: "v1.0.0" } }));
    const result = await syncRoadmapActuals(await resolveProjectRoot(rootPath), { asOf: ASOF, apply: true, item: "RM-2" });
    expect(result.value?.proposals.map((proposal) => proposal.item)).toEqual(["RM-2"]);
    const items = parseRoadmap(await lf(file), sources()).document.items;
    expect(items.map((item) => item.fields["Actual Start"]?.value)).toEqual(["-", ASOF]);
  });

  // @req FR-NODE-257 AC-5
  it("refuses an item that does not exist and writes nothing", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1, fields: { Targets: "v1.0.0" } }));
    const before = await readFile(file, "utf8");
    const result = await syncRoadmapActuals(await resolveProjectRoot(rootPath), { asOf: ASOF, apply: true, item: "RM-9" });
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
