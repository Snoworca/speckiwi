import { describe, expect, it } from "vitest";
import { derivePlanProbe, type PlanTaskCatalogEntry } from "../../../src/core/orchestrator/route-probe.js";

// FR-NODE-116 — S2's contract and requirement-id sets (09 §3.2 S2, §3.3 D5). Each conjunct is a boot
// rejection in the delegated child, so a plan failing any of them is not runnable and the routing
// decision must know which one failed. `lifecycle_req_ids` is deliberately not sourced from
// `trace_links[]`: a trace-sourced set can be strictly smaller and would hide a frozen requirement from
// D7, which is the sole enforcement point for blocked stability on the plan rung.

const PLAN_TEXT = ["---", "run_id: 2026-08-01.speckiwi.v260", "target: v2.6.0", 'plan_contract: "1.2.0"', "---", "", "# Plan", ""].join("\n");

function sidecar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "1.1.0",
    plan_contract: "1.2.0",
    run_id: "2026-08-01.speckiwi.v260",
    target: "v2.6.0",
    tdd_policy: "strict",
    phases: [{ id: "PH-001", title: "Routing", task_ids: ["T-PH001-01"] }],
    tasks: [{ id: "T-PH001-01", phase_id: "PH-001", req_ids: ["FR-NODE-110"], trace_links: [] }],
    ...overrides
  };
}

function catalog(...entries: Array<Partial<PlanTaskCatalogEntry>>): PlanTaskCatalogEntry[] {
  return entries.map((entry, index) => ({ id: `T-PH001-0${index + 1}`, req_ids: [], status: "pending", ...entry }));
}

describe("FR-NODE-116 AC-1 — one fixture per conjunct failing in isolation", () => {
  it.each([
    [{ plan_contract: "1.1.0" }, "plan_contract"],
    [{ schema_version: "1.0.0" }, "schema_version"],
    [{ tasks: [] }, "tasks"],
    [{ tdd_policy: "disabled" }, "tdd_policy"],
    [{ tasks: [{ id: "T-1", phase_id: "PH-001", req_ids: [] }] }, "task id"]
  ])("rejects %j and names the conjunct", (override, named) => {
    const probe = derivePlanProbe(PLAN_TEXT, catalog(), sidecar(override));

    expect(probe.contract_ok).toBe(false);
    expect(probe.reject_reason).toContain(named);
  });

  it("names the phase id when only the phase id regex fails", () => {
    const probe = derivePlanProbe(PLAN_TEXT, catalog(), sidecar({ phases: [{ id: "PHASE-1", task_ids: [] }] }));

    expect(probe.contract_ok).toBe(false);
    expect(probe.reject_reason).toContain("phase id");
  });

  it("names the run id when only the run id regex fails", () => {
    const probe = derivePlanProbe(PLAN_TEXT, catalog(), sidecar({ run_id: "NO" }));

    expect(probe.contract_ok).toBe(false);
    expect(probe.reject_reason).toContain("run id");
  });
});

describe("FR-NODE-116 AC-2 — every conjunct holding", () => {
  it("accepts the contract and reports no reject reason", () => {
    const probe = derivePlanProbe(PLAN_TEXT, catalog(), sidecar());

    expect(probe.contract_ok).toBe(true);
    expect(probe.reject_reason).toBeNull();
  });

  it("accepts tdd_policy relaxed, which is not the rejected value", () => {
    expect(derivePlanProbe(PLAN_TEXT, catalog(), sidecar({ tdd_policy: "relaxed" })).contract_ok).toBe(true);
  });
});

describe("FR-NODE-116 AC-3 — open_tasks counts entries outside {done, skipped}", () => {
  it("counts the open rows of a catalog carrying done, skipped and open entries", () => {
    const entries = catalog({ status: "done" }, { status: "skipped" }, { status: "pending" }, { status: "in_progress" }, { status: "blocked" });

    expect(derivePlanProbe(PLAN_TEXT, entries, sidecar()).open_tasks).toBe(3);
  });

  it("counts zero on a fully completed catalog", () => {
    expect(derivePlanProbe(PLAN_TEXT, catalog({ status: "done" }, { status: "skipped" }), sidecar()).open_tasks).toBe(0);
  });

  it("unions the open entries' req_ids into req_ids", () => {
    const entries = catalog(
      { status: "pending", req_ids: ["FR-NODE-110", "FR-NODE-111"] },
      { status: "in_progress", req_ids: ["FR-NODE-111"] }
    );

    expect(derivePlanProbe(PLAN_TEXT, entries, sidecar()).req_ids).toEqual(["FR-NODE-110", "FR-NODE-111"]);
  });
});

describe("FR-NODE-116 AC-4 — lifecycle_req_ids spans every entry regardless of status", () => {
  it("keeps a done Task's req_ids in lifecycle_req_ids and out of req_ids", () => {
    const entries = catalog({ status: "done", req_ids: ["FR-NODE-112"] }, { status: "pending", req_ids: ["FR-NODE-110"] });

    const probe = derivePlanProbe(PLAN_TEXT, entries, sidecar());

    expect(probe.lifecycle_req_ids).toEqual(["FR-NODE-112", "FR-NODE-110"]);
    expect(probe.req_ids).toEqual(["FR-NODE-110"]);
  });

  it("keeps a skipped Task's req_ids in lifecycle_req_ids", () => {
    const probe = derivePlanProbe(PLAN_TEXT, catalog({ status: "skipped", req_ids: ["FR-NODE-113"] }), sidecar());

    expect(probe.lifecycle_req_ids).toEqual(["FR-NODE-113"]);
    expect(probe.req_ids).toEqual([]);
  });
});

describe("FR-NODE-116 AC-5 — lifecycle_req_ids is not sourced from trace_links", () => {
  it("keeps a req_ids member that no trace_links row references", () => {
    const entries = catalog({ status: "pending", req_ids: ["FR-NODE-114"] });
    const untraced = sidecar({ tasks: [{ id: "T-PH001-01", phase_id: "PH-001", req_ids: ["FR-NODE-114"], trace_links: [] }] });

    const probe = derivePlanProbe(PLAN_TEXT, entries, untraced);

    expect(probe.lifecycle_req_ids).toContain("FR-NODE-114");
  });

  it("keeps a req_ids member the sidecar's legacy traces[] array does not carry", () => {
    const entries = catalog({ status: "done", req_ids: ["FR-NODE-115"] });
    const legacy = sidecar({ tasks: [{ id: "T-PH001-01", phase_id: "PH-001", req_ids: [], traces: [] }] });

    expect(derivePlanProbe(PLAN_TEXT, entries, legacy).lifecycle_req_ids).toEqual(["FR-NODE-115"]);
  });
});

describe("FR-NODE-116 AC-6 — three inputs, and the sidecar owns three of the conjuncts", () => {
  it("takes exactly three arguments", () => {
    expect(derivePlanProbe.length).toBe(3);
  });

  it("reads plan_contract, schema_version and tdd_policy from the sidecar, not from the plan text", () => {
    const misleading = ["---", 'plan_contract: "1.2.0"', 'schema_version: "1.1.0"', "tdd_policy: strict", "target: v2.6.0", "---"].join("\n");

    const probe = derivePlanProbe(misleading, catalog(), sidecar({ plan_contract: "0.9.0" }));

    expect(probe.contract_ok).toBe(false);
    expect(probe.reject_reason).toContain("plan_contract");
  });

  it("reads target from the plan document's frontmatter (09 §3.2 S2)", () => {
    const other = ["---", "target: v2.7.0", "---"].join("\n");

    expect(derivePlanProbe(other, catalog(), sidecar()).target).toBe("v2.7.0");
    expect(derivePlanProbe("# no frontmatter\n", catalog(), sidecar()).target).toBe("v2.6.0");
  });

  // This repository is Windows-first with `core.autocrlf=true` and no `.gitattributes`, so the same plan
  // file is LF in the index and CRLF in the working tree. A line-ending-sensitive reader makes the same
  // inputs route to two different targets, and D6 removes R-PLAN on the one that read wrong.
  it("reads the same target from a CRLF plan document as from an LF one", () => {
    const lf = ["---", "target: v2.7.0", "---", "", "# Plan", ""].join("\n");
    const crlf = lf.replace(/\n/g, "\r\n");

    expect(derivePlanProbe(crlf, catalog(), sidecar()).target).toBe(derivePlanProbe(lf, catalog(), sidecar()).target);
    expect(derivePlanProbe(crlf, catalog(), sidecar()).target).toBe("v2.7.0");
  });
});
