import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRoadmap, computeRoadmapItems, roadmapItemStatus, type RoadmapItemView } from "../../../src/core/roadmap/compute-roadmap.js";
import { readRoadmap } from "../../../src/core/roadmap/load-roadmap.js";
import { parseRoadmap } from "../../../src/core/roadmap/parse-roadmap.js";
import type { RoadmapRequirement, RoadmapSources } from "../../../src/core/roadmap/roadmap-model.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { requirement, roadmapText, sources, type ItemSpec } from "./roadmap-fixture.js";

// FR-NODE-255 — each roadmap item's status, AC progress and schedule health, computed from the item,
// its child features, the Target Map and the requirement records for a given as-of date.

const ASOF = "2026-11-20";

function views(items: ItemSpec[], src: RoadmapSources, asOf = ASOF): RoadmapItemView[] {
  const text = roadmapText(...items);
  return computeRoadmapItems(parseRoadmap(text, src).document, src, asOf);
}

function only(spec: Omit<ItemSpec, "n">, src: RoadmapSources, asOf = ASOF): RoadmapItemView {
  return views([{ n: 1, ...spec }], src, asOf)[0]!;
}

function statusOf(spec: Omit<ItemSpec, "n">, src: RoadmapSources): string {
  const text = roadmapText({ n: 1, ...spec });
  const document = parseRoadmap(text, src).document;
  return roadmapItemStatus(document, src, document.items[0]!).status;
}

function withRecords(requirements: RoadmapRequirement[], targets: RoadmapSources["targets"] = sources().targets): RoadmapSources {
  return sources({ requirements, targets });
}

describe("FR-NODE-255 AC-1 — the requirement set R and the target set T", () => {
  // @req FR-NODE-255 AC-1
  it("collects Targets members, listed requirements and non-cancelled child features, without discarded requirements", () => {
    const src = withRecords(
      [
        requirement("FR-A-001", "1.0.0", "planned"),
        requirement("FR-A-003", "1.0.0", "discarded"),
        requirement("FR-B-001", "2.0.0", "planned"),
        requirement("FR-C-001", "2.0.0", "planned"),
        requirement("FR-D-001", "2.0.0", "planned"),
        requirement("FR-E-001", "1.1.0", "planned")
      ],
      [
        { target: "1.0.0", status: "planned" },
        { target: "1.1.0", status: "planned" },
        { target: "1.2.0", status: "planned" }
      ]
    );
    const [milestone, feature, cancelled] = views(
      [
        { n: 1, fields: { Kind: "milestone", Targets: "1.0.0", Requirements: "FR-B-001, FR-A-003" } },
        { n: 2, fields: { Milestone: "RM-1", Targets: "1.1.0", Requirements: "FR-C-001" } },
        { n: 3, fields: { Milestone: "RM-1", Targets: "1.2.0", Requirements: "FR-D-001", Lifecycle: "cancelled" } }
      ],
      src
    );
    expect(milestone!.scope).toEqual({ requirements: ["FR-A-001", "FR-B-001", "FR-C-001", "FR-E-001"], targets: ["1.0.0", "1.1.0"] });
    expect(feature!.scope).toEqual({ requirements: ["FR-C-001", "FR-E-001"], targets: ["1.1.0"] });
    expect(cancelled!.scope).toEqual({ requirements: ["FR-D-001"], targets: ["1.2.0"] });
  });
});

describe("FR-NODE-255 AC-2 — the status is the first rule that holds", () => {
  const targets = [
    { target: "r", status: "released" },
    { target: "c", status: "completed" },
    { target: "a", status: "active" },
    { target: "p", status: "planned" }
  ];

  // @req FR-NODE-255 AC-2
  it("takes Lifecycle first, then idea, released, done, in-progress and planned", () => {
    const verified = withRecords([requirement("FR-V-001", "p", "verified")], targets);
    expect(statusOf({ fields: { Requirements: "FR-V-001", Lifecycle: "cancelled" } }, verified)).toBe("cancelled");
    expect(statusOf({ fields: { Requirements: "FR-V-001", Lifecycle: "paused" } }, verified)).toBe("paused");
    expect(statusOf({}, verified)).toBe("idea");
    expect(statusOf({ fields: { Targets: "r", Requirements: "FR-V-001" } }, verified)).toBe("released");
    expect(statusOf({ fields: { Requirements: "FR-V-001" } }, verified)).toBe("done");
    expect(statusOf({ fields: { Targets: "c" } }, verified)).toBe("done");
    expect(statusOf({ fields: { Targets: "r, c" } }, verified)).toBe("done");
    expect(statusOf({ fields: { Targets: "p" } }, verified)).toBe("done");
    expect(statusOf({ fields: { Targets: "p" } }, withRecords([requirement("FR-P-001", "p", "planned"), requirement("FR-V-001", "p", "verified")], targets))).toBe("in-progress");
    expect(statusOf({ fields: { Targets: "a" } }, withRecords([], targets))).toBe("in-progress");
    expect(statusOf({ fields: { Targets: "p", "Actual Start": "2026-11-01" } }, withRecords([], targets))).toBe("in-progress");
    expect(statusOf({ fields: { Targets: "p" } }, withRecords([requirement("FR-P-001", "p", "planned")], targets))).toBe("planned");
  });

  // @req FR-NODE-255 AC-2
  it("counts in_progress, implemented, verified and blocked requirements as started, and names the rule and its basis", () => {
    for (const status of ["in_progress", "implemented", "blocked"] as const) {
      const src = withRecords([requirement("FR-P-001", "p", "planned"), requirement("FR-S-001", "p", status)], targets);
      const view = only({ fields: { Targets: "p" } }, src);
      expect(view.status, status).toBe("in-progress");
      expect(view.statusRule).toBe("requirement-started");
      expect(view.statusBasis).toEqual({ requirements: ["FR-S-001"], targets: [] });
    }
    const mixed = withRecords([requirement("FR-P-001", "p", "planned"), requirement("FR-V-001", "p", "verified")], targets);
    expect(only({ fields: { Targets: "p" } }, mixed).statusRule).toBe("requirement-started");
    const active = only({ fields: { Targets: "a" } }, withRecords([], targets));
    expect([active.statusRule, active.statusBasis]).toEqual(["target-active", { requirements: [], targets: ["a"] }]);
    const done = only({ fields: { Requirements: "FR-V-001" } }, mixed);
    expect([done.statusRule, done.statusBasis]).toEqual(["requirements-verified", { requirements: ["FR-V-001"], targets: [] }]);
    const completed = only({ fields: { Targets: "c" } }, withRecords([], targets));
    expect([completed.statusRule, completed.statusBasis]).toEqual(["targets-completed", { requirements: [], targets: ["c"] }]);
    const released = only({ fields: { Targets: "r" } }, withRecords([], targets));
    expect([released.statusRule, released.statusBasis]).toEqual(["targets-released", { requirements: [], targets: ["r"] }]);
  });

  // @req FR-NODE-255 AC-2
  it("is idea only when both sets are empty, so an unregistered target still makes the item planned", () => {
    expect(statusOf({ fields: { Targets: "9.9.9" } }, withRecords([], targets))).toBe("planned");
  });
});

describe("FR-NODE-255 AC-3 — the blocked flag and the targets that never count as finished", () => {
  // @req FR-NODE-255 AC-3
  it("sets blocked exactly when a requirement of R is blocked", () => {
    const blocked = withRecords([requirement("FR-B-001", "1.0.0", "blocked")]);
    expect(only({ fields: { Targets: "1.0.0" } }, blocked).blocked).toBe(true);
    expect(only({ fields: { Targets: "1.0.0" } }, withRecords([requirement("FR-B-001", "1.0.0", "implemented")])).blocked).toBe(false);
  });

  // @req FR-NODE-255 AC-3
  it("counts an archived or frozen target as neither completed nor released", () => {
    for (const status of ["archived", "frozen"]) {
      const src = withRecords([], [{ target: "x", status }, { target: "r", status: "released" }]);
      expect(statusOf({ fields: { Targets: "x" } }, src), status).toBe("planned");
      expect(statusOf({ fields: { Targets: "x, r" } }, src), status).toBe("planned");
    }
  });
});

describe("FR-NODE-255 AC-4 — acceptance-criterion progress", () => {
  // @req FR-NODE-255 AC-4
  it("counts the live criteria of R, rounds the percent and reports requirement counts by status", () => {
    const expiring: RoadmapRequirement = { ...requirement("FR-X-001", "1.0.0", "verified", [true]), expiredAcceptanceCriteria: [{ id: "AC-2", text: "gone", checked: true, line: 9, expiredOn: "2026-11-01" }] } as RoadmapRequirement;
    const src = withRecords([requirement("FR-A-001", "1.0.0", "implemented", [true, false]), requirement("FR-A-002", "1.0.0", "verified", [true, true]), expiring]);
    const view = only({ fields: { Targets: "1.0.0" } }, src);
    expect(view.progress.acceptanceCriteria).toEqual({ total: 5, checked: 4 });
    expect(view.progress.percent).toBe(80);
    expect(view.progress.requirements.total).toBe(3);
    expect(view.progress.requirements.byStatus).toMatchObject({ implemented: 1, verified: 2, planned: 0 });
    const third = only({ fields: { Targets: "1.0.0" } }, withRecords([requirement("FR-A-001", "1.0.0", "planned", [true, false, false])]));
    expect(third.progress.percent).toBe(33);
    const twoThirds = only({ fields: { Targets: "1.0.0" } }, withRecords([requirement("FR-A-001", "1.0.0", "planned", [true, true, false])]));
    expect(twoThirds.progress.percent).toBe(67);
  });

  // @req FR-NODE-255 AC-4
  it("reports percent null when R has no criterion", () => {
    const view = only({ fields: { Targets: "1.0.0" } }, withRecords([requirement("FR-A-001", "1.0.0", "planned")]));
    expect(view.progress.acceptanceCriteria).toEqual({ total: 0, checked: 0 });
    expect(view.progress.percent).toBeNull();
  });
});

describe("FR-NODE-255 AC-5 — schedule health and slip", () => {
  const planned = withRecords([requirement("FR-A-001", "1.1.0", "planned")]);
  const done = withRecords([requirement("FR-A-001", "1.1.0", "verified")]);
  const base = { Targets: "1.1.0" };

  // @req FR-NODE-255 AC-5
  it("is unscheduled without a Planned End", () => {
    const view = only({ fields: base }, planned);
    expect([view.schedule.health, view.schedule.slipDays]).toEqual(["unscheduled", null]);
  });

  // @req FR-NODE-255 AC-5
  it("is on-track up to the end of the planned-end range and late after it, for an unfinished item", () => {
    const at = (asOf: string, end = "2026-11-20") => only({ fields: { ...base, "Planned End": end } }, planned, asOf).schedule;
    expect([at("2026-11-10").health, at("2026-11-10").slipDays]).toEqual(["on-track", -10]);
    expect([at("2026-11-20").health, at("2026-11-20").slipDays]).toEqual(["on-track", 0]);
    expect([at("2026-11-21").health, at("2026-11-21").slipDays]).toEqual(["late", 1]);
    expect(at("2026-11-30", "2026-11").health).toBe("on-track");
    expect([at("2026-12-01", "2026-11").health, at("2026-12-01", "2026-11").slipDays]).toEqual(["late", 1]);
    const paused = only({ fields: { ...base, "Planned End": "2026-11-01", Lifecycle: "paused" } }, planned, "2026-11-05").schedule;
    expect(paused.health).toBe("late");
  });

  // @req FR-NODE-255 AC-5
  it("is done or done-late for a finished item, measured to Actual End", () => {
    const at = (actualEnd: string) => only({ fields: { ...base, "Planned End": "2026-11-20", "Actual End": actualEnd } }, done, "2026-12-31").schedule;
    expect([at("-").health, at("-").slipDays]).toEqual(["done", null]);
    expect([at("2026-11-18").health, at("2026-11-18").slipDays]).toEqual(["done", -2]);
    expect([at("2026-11-20").health, at("2026-11-20").slipDays]).toEqual(["done", 0]);
    expect([at("2026-11-25").health, at("2026-11-25").slipDays]).toEqual(["done-late", 5]);
    const cancelled = only({ fields: { ...base, "Planned End": "2026-11-01", Lifecycle: "cancelled" } }, planned, "2026-12-31").schedule;
    expect(cancelled.health).toBe("done");
    const released = withRecords([], [{ target: "1.1.0", status: "released" }]);
    expect(only({ fields: { ...base, "Planned End": "2026-11-01" } }, released, "2026-12-31").schedule.health).toBe("done");
  });
});

describe("FR-NODE-255 AC-6 — baseline and replan count", () => {
  // @req FR-NODE-255 AC-6
  it("takes the From of a field's first history row as its baseline and counts the Planned End rows", () => {
    const view = only(
      {
        fields: { "Planned Start": "2026-11-02", "Planned End": "2026-11-14", "Actual Start": "2026-11-03" },
        history: [
          ["2026-11-01", "Created", "-", "-", "x"],
          ["2026-11-02", "Planned End", "2026-11-07", "2026-11-10", "first move"],
          ["2026-11-03", "Actual Start", "-", "2026-11-03", "sync"],
          ["2026-11-04", "Planned End", "2026-11-10", "2026-11-14", "second move"]
        ]
      },
      sources()
    );
    expect(view.schedule.baseline).toEqual({ "Planned Start": "2026-11-02", "Planned End": "2026-11-07", "Actual Start": "-", "Actual End": "-" });
    expect(view.schedule.replanCount).toBe(2);
    expect(only({ fields: { "Planned End": "2026-11-14" } }, sources()).schedule.replanCount).toBe(0);
  });
});

describe("FR-NODE-255 AC-7 — the as-of date is an input", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TZ;
  });

  // @req FR-NODE-255 AC-7
  it("gives byte-identical results for the same document, SRS and as-of date, whatever the clock says", () => {
    const items: ItemSpec[] = [{ n: 1, fields: { Targets: "1.0.0", "Planned End": "2026-11-10" } }];
    const first = JSON.stringify(views(items, sources(), "2026-11-15"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    expect(JSON.stringify(views(items, sources(), "2026-11-15"))).toBe(first);
    expect(first).toContain('"health":"late"');
  });

  // @req FR-NODE-255 AC-7
  it("defaults the as-of date to the local calendar date and passes an explicit one through", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(path.join(rootPath, "docs", "roadmap.md"), roadmapText({ n: 1, fields: { Targets: "v1.0.0", "Planned End": "2026-11-05" } }), "utf8");
    const root = await resolveProjectRoot(rootPath);
    process.env.TZ = "Asia/Seoul";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T20:00:00Z"));
    const today = await readRoadmap(root);
    expect(today.ok && today.value.asOf).toBe("2026-11-06");
    expect(today.ok && today.value.items[0]?.schedule.health).toBe("late");
    const pinned = await readRoadmap(root, { asOf: "2026-11-01" });
    expect(pinned.ok && [pinned.value.asOf, pinned.value.items[0]?.schedule.health]).toEqual(["2026-11-01", "on-track"]);
    const malformed = await readRoadmap(root, { asOf: "2026-11" });
    expect(malformed.ok).toBe(false);
  });
});

describe("FR-NODE-255 AC-8 — a one-target item without a purpose borrows the target goal", () => {
  // @req FR-NODE-255 AC-8
  it("shows the goal and marks the source only for exactly one target and a `-` Purpose", () => {
    const text = (purpose: string, targets: string) =>
      roadmapText({ n: 1, fields: { Targets: targets } }).replace("Purpose of item 1.", purpose);
    const read = (purpose: string, targets: string) => {
      const src = sources();
      return computeRoadmapItems(parseRoadmap(text(purpose, targets), src).document, src, ASOF)[0]!;
    };
    expect([read("-", "1.0.0").purpose, read("-", "1.0.0").purposeSource]).toEqual(["Ship the first release.", "target"]);
    expect([read("-", "1.0.0, 1.1.0").purpose, read("-", "1.0.0, 1.1.0").purposeSource]).toEqual(["-", "item"]);
    expect([read("Own words.", "1.0.0").purpose, read("Own words.", "1.0.0").purposeSource]).toEqual(["Own words.", "item"]);
  });
});

describe("FR-NODE-255 AC-9 — an Actual End on an unfinished item", () => {
  // @req FR-NODE-255 AC-9
  it("warns with ROADMAP-W015 unless the computed status is done, released or cancelled", () => {
    const w015 = (fields: ItemSpec["fields"], src = sources()) =>
      checkRoadmap(roadmapText({ n: 1, fields }), src).diagnostics.filter((item) => item.code === "ROADMAP-W015").length;
    expect(w015({ Targets: "1.1.0", "Actual End": "2026-11-04" })).toBe(1);
    expect(w015({ Targets: "1.1.0", "Actual End": "-" })).toBe(0);
    expect(w015({ Targets: "1.1.0", "Actual End": "2026-11-04", Lifecycle: "cancelled" })).toBe(0);
    expect(w015({ Targets: "1.1.0", "Actual End": "2026-11-04" }, withRecords([requirement("FR-A-001", "1.1.0", "verified")]))).toBe(0);
    expect(w015({ Targets: "1.1.0", "Actual End": "2026-11-04" }, withRecords([], [{ target: "1.1.0", status: "released" }]))).toBe(0);
  });

  // @req FR-NODE-255 AC-9
  it("keeps the parser's diagnostics and reports W015 at the Actual End row", () => {
    const text = roadmapText({ n: 1, fields: { Targets: "9.9.9", "Actual End": "2026-11-04" } });
    const found = checkRoadmap(text, sources()).diagnostics.map((item) => `${item.code}@${item.line}`);
    const row = text.split("\n").findIndex((line) => line.startsWith("| Actual End")) + 1;
    expect(found).toEqual(expect.arrayContaining(["ROADMAP-W009@" + (text.split("\n").findIndex((line) => line.startsWith("| Targets")) + 1), `ROADMAP-W015@${row}`]));
  });
});

describe("FR-NODE-255 readRoadmap on a workspace", () => {
  // @req FR-NODE-255 AC-1
  it("reads the Target Map and the records of the workspace, and answers an absent roadmap with no item", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    const absent = await readRoadmap(root, { asOf: ASOF });
    expect(absent.ok && absent.value).toMatchObject({ exists: false, source: null, items: [], diagnostics: [] });
    await writeFile(path.join(rootPath, "docs", "roadmap.md"), roadmapText({ n: 1, fields: { Targets: "v1.0.0" } }), "utf8");
    const present = await readRoadmap(root, { asOf: ASOF });
    if (!present.ok) throw new Error("expected ok");
    expect(present.value.exists).toBe(true);
    expect(present.value.source).toMatch(/^docs\/roadmap\.md@sha256:[0-9a-f]{64}$/);
    expect(present.value.items[0]?.status).toBe("in-progress");
    expect(present.value.items[0]?.scope.requirements.length).toBeGreaterThan(0);
    expect(present.value.diagnostics).toEqual([]);
  });
});
