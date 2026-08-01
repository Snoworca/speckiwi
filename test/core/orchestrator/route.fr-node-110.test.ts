import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeRoute, GATED_BY, PROBE_FIELD_IDS, RUNGS, UNRECOGNISED_FIELD_GATES, type ProbeFieldId, type RouteProbe, type Rung } from "../../../src/core/orchestrator/route.js";
import { baseProbe, stepProbe } from "../../support/route-probe-fixture.js";

// FR-NODE-110 — `computeRoute` is the disqualifier-first classifier of 09 §3. Every predicate removes
// rungs and none selects one, so a wrong route traces to one named predicate and one recorded value.
// The fixtures below are the baseline plus the single field each case is about.

const AUTO = { auto: false } as const;
const SOURCE = path.join(fileURLToPath(new URL("../../../", import.meta.url)), "src", "core", "orchestrator", "route.ts");

function rungOf(probe: RouteProbe): Rung {
  return computeRoute(probe, AUTO).rung;
}

function firedBy(probe: RouteProbe): string[] {
  return computeRoute(probe, AUTO).removed.map((entry) => entry.by);
}

describe("FR-NODE-110 AC-1 — computeRoute is pure", () => {
  it("returns deep-equal decisions for the same probe value and the same opts", () => {
    const probe = baseProbe({ anchoredReqs: ["FR-NODE-001"], scopes: ["NODE", "CLI"], unreadable: ["S7"] });

    const first = computeRoute(probe, AUTO);
    const second = computeRoute(probe, AUTO);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("reads no clock and no randomness while classifying", () => {
    const realDate = globalThis.Date;
    const realRandom = Math.random;
    let clockReads = 0;
    let randomReads = 0;
    const countingDate = new Proxy(realDate, {
      apply: () => { clockReads += 1; return ""; },
      construct: () => { clockReads += 1; return new realDate(0); },
      get: (target, property, receiver) => (property === "now" ? () => { clockReads += 1; return 0; } : Reflect.get(target, property, receiver))
    });

    try {
      globalThis.Date = countingDate as DateConstructor;
      Math.random = () => { randomReads += 1; return 0; };
      computeRoute(baseProbe({ scopes: ["NODE", "CLI"], unreadable: ["S3"] }), AUTO);
    } finally {
      globalThis.Date = realDate;
      Math.random = realRandom;
    }

    expect({ clockReads, randomReads }).toEqual({ clockReads: 0, randomReads: 0 });
  });

  it("imports no filesystem, git or network module", async () => {
    const source = await readFile(SOURCE, "utf8");

    expect(source).not.toMatch(/from\s+"node:/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
});

describe("FR-NODE-110 AC-2 — computeRoute is total", () => {
  it("returns exactly one rung from the closed three-value enum for any schema-valid probe", () => {
    const modes: RouteProbe["mode"][] = ["sdd", "vibe", "wait", "tdd"];
    const sources: RouteProbe["modeSource"][] = ["mcp", "cli", "default-wait"];
    const ids = ["FR-NODE-001", "FR-CLI-002", "FR-FLOW-003"];
    const targets = [null, "", "v2.6.0", "v2.5.0"];
    let seed = 20260801;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
    const someIds = (): string[] => ids.filter(() => next() < 0.5);
    const count = (): number => Math.floor(next() * 4);
    const seen = new Set<Rung>();

    for (let iteration = 0; iteration < 3000; iteration += 1) {
      // Stratified: the step rung clears only when D1 through D4 and seven of D8's fields all stay
      // quiet, which is rare enough under the wide domain that an unstratified draw would leave R-STEP
      // unvisited and the totality claim untested on the middle rung.
      const stepShaped = next() < 0.4;
      const probe: RouteProbe = {
        mode: pick(modes),
        modeSource: pick(sources),
        planContractOk: next() < 0.5,
        planRejectReason: next() < 0.5 ? null : "reason",
        planOpenTasks: count(),
        planReqIds: someIds(),
        planTarget: pick(targets),
        anchoredReqs: stepShaped ? [] : someIds(),
        anchorCoverage: [0, 0.1, 0.2, 0.5, 1][Math.floor(next() * 5)] as number,
        scopes: ["NODE", "CLI", "FLOW"].filter(() => next() < (stepShaped ? 0.2 : 0.5)),
        scopeReqIds: someIds(),
        externalPaths: next() < (stepShaped ? 0.1 : 0.5) ? ["../outside/file.ts"] : [],
        ambiguities: count(),
        orderedSections: stepShaped ? 0 : count(),
        linkedSubIssues: stepShaped ? 0 : count(),
        taskListGroups: stepShaped ? 0 : count(),
        declaredExistingReqEdit: next() < (stepShaped ? 0.1 : 0.5),
        activeTarget: pick(targets),
        blockedStability: someIds(),
        // The pool carries two ids outside the vocabulary. `unreadable[]` arrives from a JSON document
        // written by a producer, so no type stops one, and `S11` is the likeliest — the design's own
        // table calls S11 the unreadable list itself.
        unreadable: [...PROBE_FIELD_IDS, "S11", "S13"].filter(() => next() < (stepShaped ? 0.04 : 0.25))
      };

      const decision = computeRoute(probe, { auto: next() < 0.5 });

      expect(RUNGS).toContain(decision.rung);
      expect(decision.removed.some((entry) => entry.rung === decision.rung)).toBe(false);
      seen.add(decision.rung);
    }

    expect([...seen].sort()).toEqual(["R-ORCH", "R-PLAN", "R-STEP"]);
  });
});

describe("FR-NODE-110 AC-3 — every disqualifier has a firing and a non-firing fixture", () => {
  it("D1 fires on a measured anchored requirement and records the anchor set", () => {
    const decision = computeRoute(baseProbe({ anchoredReqs: ["FR-NODE-001"], anchorCoverage: 0.5 }), AUTO);

    expect(decision.removed).toContainEqual({ rung: "R-STEP", by: "D1", observed: ["FR-NODE-001"] });
  });

  it("D1 fires on the declared existing-requirement edit and records that half separately", () => {
    const decision = computeRoute(baseProbe({ declaredExistingReqEdit: true }), AUTO);

    expect(decision.removed).toContainEqual({ rung: "R-STEP", by: "D1", observed: "declared" });
  });

  it("D1 does not fire when no requirement is anchored and none is declared", () => {
    expect(firedBy(baseProbe())).not.toContain("D1");
  });

  it("D2 fires on an out-of-cwd path and records the paths", () => {
    const decision = computeRoute(baseProbe({ externalPaths: ["../sibling/src/index.ts"] }), AUTO);

    expect(decision.removed).toContainEqual({ rung: "R-STEP", by: "D2", observed: ["../sibling/src/index.ts"] });
  });

  it("D2 does not fire on an empty external-path set", () => {
    expect(firedBy(baseProbe({ externalPaths: [] }))).not.toContain("D2");
  });

  it("D3 fires on a two-scope write set and records the scopes", () => {
    const decision = computeRoute(baseProbe({ scopes: ["NODE", "CLI"] }), AUTO);

    expect(decision.removed).toContainEqual({ rung: "R-STEP", by: "D3", observed: ["NODE", "CLI"] });
  });

  it("D3 does not fire on a single scope", () => {
    expect(firedBy(baseProbe({ scopes: ["NODE"] }))).not.toContain("D3");
  });

  // AC-3 requires `observed` to record the value the predicate fired on. 09 §3.6's code block writes
  // `p.orderedSections` for all three of D4's disjuncts, so a removal caused by a task-list group is
  // recorded as "D4 observed 0" — in the lock and in the committee's evidence table. The requirement is
  // right and the design's code block is wrong, so the three counts and the firing disjunct are recorded.
  it("D4 fires on declared ordered structure and records the count it fired on", () => {
    const decision = computeRoute(baseProbe({ orderedSections: 3 }), AUTO);

    expect(decision.removed).toContainEqual({
      rung: "R-STEP",
      by: "D4",
      observed: { ordered_sections: 3, linked_sub_issues: 0, task_list_groups: 0, fired: ["ordered_sections"] }
    });
  });

  it("D4 records the task-list-group count when that is the disjunct that fired", () => {
    const decision = computeRoute(baseProbe({ taskListGroups: 1 }), AUTO);
    const entry = decision.removed.find((row) => row.by === "D4");

    expect(entry?.observed).toEqual({ ordered_sections: 0, linked_sub_issues: 0, task_list_groups: 1, fired: ["task_list_groups"] });
  });

  it("D4 records the linked-sub-issue count when that is the disjunct that fired", () => {
    const decision = computeRoute(baseProbe({ linkedSubIssues: 2 }), AUTO);
    const entry = decision.removed.find((row) => row.by === "D4");

    expect(entry?.observed).toEqual({ ordered_sections: 0, linked_sub_issues: 2, task_list_groups: 0, fired: ["linked_sub_issues"] });
  });

  it("D4 names every disjunct that fired when more than one did", () => {
    const decision = computeRoute(baseProbe({ orderedSections: 4, linkedSubIssues: 2, taskListGroups: 1 }), AUTO);
    const entry = decision.removed.find((row) => row.by === "D4");

    expect(entry?.observed).toMatchObject({ fired: ["ordered_sections", "linked_sub_issues", "task_list_groups"] });
  });

  it("D4 does not fire on an unstructured input", () => {
    expect(firedBy(baseProbe({ orderedSections: 1, linkedSubIssues: 1, taskListGroups: 0 }))).not.toContain("D4");
  });

  it("D5 fires on a contract-invalid plan and records the reject reason", () => {
    const decision = computeRoute(baseProbe({ planContractOk: false, planRejectReason: "tdd_policy is disabled" }), AUTO);

    expect(decision.removed).toContainEqual({ rung: "R-PLAN", by: "D5", observed: "tdd_policy is disabled" });
  });

  it("D5 does not fire on a contract-valid plan", () => {
    expect(firedBy(baseProbe({ planContractOk: true }))).not.toContain("D5");
  });

  it("D6 fires when the plan has no open task and records which branch ran", () => {
    const decision = computeRoute(baseProbe({ planOpenTasks: 0 }), AUTO);
    const entry = decision.removed.find((row) => row.by === "D6");

    expect(entry).toMatchObject({ rung: "R-PLAN", by: "D6" });
    expect(entry?.observed).toMatchObject({ branch: "substitute", open_tasks: 0 });
  });

  it("D6 records the anchored branch when the anchor set carries signal", () => {
    const decision = computeRoute(baseProbe({ anchoredReqs: ["FR-CLI-009"], anchorCoverage: 0.5 }), AUTO);
    const entry = decision.removed.find((row) => row.by === "D6");

    expect(entry?.observed).toMatchObject({ branch: "anchored", intersection: [] });
  });

  it("D6 does not fire when the plan covers this work through the substitute link", () => {
    expect(firedBy(baseProbe())).not.toContain("D6");
  });

  it("D7 fires on blocked stability and records the blocked ids", () => {
    const decision = computeRoute(baseProbe({ blockedStability: ["FR-NODE-007"] }), AUTO);

    expect(decision.removed).toContainEqual({ rung: "R-PLAN", by: "D7", observed: ["FR-NODE-007"] });
  });

  it("D7 fires on an empty active target", () => {
    expect(firedBy(baseProbe({ activeTarget: "" }))).toContain("D7");
  });

  it("D7 does not fire on a registered target with no blocked requirement", () => {
    expect(firedBy(baseProbe())).not.toContain("D7");
  });

  it("D8 fires on an unreadable field and records the field id", () => {
    const decision = computeRoute(baseProbe({ unreadable: ["S7"] }), AUTO);

    expect(decision.removed).toContainEqual({ rung: "R-STEP", by: "D8", observed: "S7" });
  });

  it("D8 does not fire when every field was read", () => {
    expect(firedBy(baseProbe({ unreadable: [] }))).not.toContain("D8");
  });
});

describe("FR-NODE-110 AC-4 — removed[] ordering is deterministic", () => {
  const everything = baseProbe({
    anchoredReqs: ["FR-OTHER-001"],
    anchorCoverage: 0.5,
    externalPaths: ["../sibling/x.ts"],
    scopes: ["NODE", "CLI"],
    orderedSections: 2,
    planContractOk: false,
    planRejectReason: "schema_version must be 1.1.0",
    planOpenTasks: 0,
    blockedStability: ["FR-NODE-007"],
    unreadable: ["S3", "S9"]
  });

  it("evaluates predicates in the fixed order D1 through D8", () => {
    expect(firedBy(everything)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D8"]);
  });

  it("produces the same sequence on every call", () => {
    expect(computeRoute(everything, AUTO).removed).toEqual(computeRoute(everything, AUTO).removed);
  });
});

describe("FR-NODE-110 AC-5 — every count threshold is exercised at plus and minus one", () => {
  it("D3 clears at one scope and fires at two", () => {
    expect(firedBy(baseProbe({ scopes: ["NODE"] }))).not.toContain("D3");
    expect(firedBy(baseProbe({ scopes: ["NODE", "CLI"] }))).toContain("D3");
  });

  it("D4 clears at one ordered section and fires at two", () => {
    expect(firedBy(baseProbe({ orderedSections: 1 }))).not.toContain("D4");
    expect(firedBy(baseProbe({ orderedSections: 2 }))).toContain("D4");
  });

  it("D4 clears at one linked sub-issue and fires at two", () => {
    expect(firedBy(baseProbe({ linkedSubIssues: 1 }))).not.toContain("D4");
    expect(firedBy(baseProbe({ linkedSubIssues: 2 }))).toContain("D4");
  });

  it("D4 clears at zero task-list groups and fires at one", () => {
    expect(firedBy(baseProbe({ taskListGroups: 0 }))).not.toContain("D4");
    expect(firedBy(baseProbe({ taskListGroups: 1 }))).toContain("D4");
  });

  it("D6 fires at zero open tasks and clears at one", () => {
    expect(firedBy(baseProbe({ planOpenTasks: 0 }))).toContain("D6");
    expect(firedBy(baseProbe({ planOpenTasks: 1 }))).not.toContain("D6");
  });

  it("the anchor-coverage comparison clears immediately below 0.2 and fires exactly at 0.2", () => {
    const anchored = { anchoredReqs: ["FR-NODE-001"] };

    expect(firedBy(baseProbe({ ...anchored, anchorCoverage: 0.19999999 }))).not.toContain("D1");
    expect(firedBy(baseProbe({ ...anchored, anchorCoverage: 0.2 }))).toContain("D1");
  });
});

describe("FR-NODE-110 AC-6 — each adjacent pair of the selection order", () => {
  it("selects R-PLAN when nothing was removed", () => {
    const decision = computeRoute(baseProbe(), AUTO);

    expect(decision.removed).toEqual([]);
    expect(decision.rung).toBe("R-PLAN");
  });

  it("selects R-STEP when only R-PLAN was removed", () => {
    expect(rungOf(stepProbe())).toBe("R-STEP");
  });

  it("selects R-ORCH when both R-PLAN and R-STEP were removed", () => {
    expect(rungOf(stepProbe({ scopes: ["NODE", "CLI"] }))).toBe("R-ORCH");
  });
});

describe("FR-NODE-110 AC-7 — no predicate removes R-ORCH", () => {
  it("returns R-ORCH when every disqualifier fires and every probe field is unreadable", () => {
    const decision = computeRoute(baseProbe({
      anchoredReqs: ["FR-OTHER-001"],
      anchorCoverage: 0.5,
      declaredExistingReqEdit: true,
      externalPaths: ["../sibling/x.ts"],
      scopes: ["NODE", "CLI"],
      orderedSections: 2,
      linkedSubIssues: 2,
      taskListGroups: 1,
      planContractOk: false,
      planRejectReason: "tasks[] is empty",
      planOpenTasks: 0,
      blockedStability: ["FR-NODE-007"],
      activeTarget: "",
      unreadable: [...PROBE_FIELD_IDS]
    }), AUTO);

    expect(decision.rung).toBe("R-ORCH");
    expect(decision.removed.filter((entry) => entry.rung === "R-ORCH")).toEqual([]);
    expect(decision.alternative).toBeNull();
  });
});

describe("FR-NODE-110 AC-8 — alternative is the second surviving rung", () => {
  it("names R-STEP when R-PLAN is selected", () => {
    expect(computeRoute(baseProbe(), AUTO).alternative).toBe("R-STEP");
  });

  it("names R-ORCH when R-STEP is selected", () => {
    expect(computeRoute(stepProbe(), AUTO).alternative).toBe("R-ORCH");
  });

  it("is null when exactly one rung survives", () => {
    expect(computeRoute(stepProbe({ scopes: ["NODE", "CLI"] }), AUTO).alternative).toBeNull();
  });
});

describe("FR-NODE-110 AC-9 — D8's GATED_BY map is total over the twelve probe field ids", () => {
  const stepGated: ProbeFieldId[] = ["S3", "S3c", "S4", "S5", "S7", "S8", "S12"];
  const planGated: ProbeFieldId[] = ["S2", "S9", "S10"];

  it("is keyed by exactly the twelve members unreadable[] can hold", () => {
    expect(Object.keys(GATED_BY).sort()).toEqual([...PROBE_FIELD_IDS].sort());
    expect(PROBE_FIELD_IDS).toEqual(["S1", "S2", "S3", "S3c", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S12"]);
  });

  it.each(stepGated)("%s removes R-STEP", (field) => {
    const decision = computeRoute(baseProbe({ unreadable: [field] }), AUTO);

    expect(decision.removed).toEqual([{ rung: "R-STEP", by: "D8", observed: field }]);
  });

  it.each(planGated)("%s removes R-PLAN", (field) => {
    const decision = computeRoute(baseProbe({ unreadable: [field] }), AUTO);

    expect(decision.removed).toEqual([{ rung: "R-PLAN", by: "D8", observed: field }]);
  });

  it.each(["S1", "S6"] as ProbeFieldId[])("%s maps to the empty list rather than to undefined", (field) => {
    expect(GATED_BY[field]).toEqual([]);
    expect(computeRoute(baseProbe({ unreadable: [field] }), AUTO).removed).toEqual([]);
  });

  // `unreadable[]` arrives from a JSON document a producer wrote, so an id outside the vocabulary is a
  // reachable input rather than a type error. `S11` is the likeliest of all: 09 §3.2 names S11 as the
  // unreadable list itself, so a producer listing it has made exactly the mistake the table invites.
  it.each(["S11", "S13", "", "constructor", "toString", "__proto__"])("keeps the ladder total on the unrecognised id %j", (field) => {
    const decision = computeRoute(baseProbe({ unreadable: [field] }), AUTO);

    expect(RUNGS).toContain(decision.rung);
    expect(decision.rung).toBe("R-ORCH");
  });

  it("fails closed on an unrecognised id by removing both cheap rungs", () => {
    const decision = computeRoute(baseProbe({ unreadable: ["S11"] }), AUTO);

    expect(UNRECOGNISED_FIELD_GATES).toEqual(["R-PLAN", "R-STEP"]);
    expect(decision.removed).toEqual([
      { rung: "R-PLAN", by: "D8", observed: "S11" },
      { rung: "R-STEP", by: "D8", observed: "S11" }
    ]);
  });

  it("never lets an unrecognised id buy the zero-deliberation fast path", () => {
    const decision = computeRoute(baseProbe({ planContractOk: false, blockedStability: ["FR-NODE-007"], unreadable: ["S11"] }), AUTO);

    expect(decision.recommended).toBe(false);
    expect(decision.withheld_because.map((entry) => entry.split(":")[0])).toContain("clause-1");
  });
});

describe("FR-NODE-110 AC-10 — RouteDecision is a closed six-field record", () => {
  it("carries the six declared fields and no others", () => {
    const decision = computeRoute(stepProbe(), AUTO);

    expect(Object.keys(decision).sort()).toEqual(["alternative", "decisive", "recommended", "removed", "rung", "withheld_because"]);
  });
});
