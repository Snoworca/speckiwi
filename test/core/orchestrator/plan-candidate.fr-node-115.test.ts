import { describe, expect, it } from "vitest";
import { selectPlanCandidate, type PlanFrontmatter } from "../../../src/core/orchestrator/route-probe.js";

// FR-NODE-115 — S2's producer (09 §3.2 S2, §10.1). The comparator must be total: an undated candidate
// exists in this repository today, and two or more candidates is the normal case and is deliberately not
// a prompt, because the orchestrator has no AskUserQuestion at Phase 1.c-prime.

function dated(entries: Record<string, string | null>): Record<string, PlanFrontmatter> {
  return Object.fromEntries(Object.entries(entries).map(([plan, generated]) => [plan, generated === null ? {} : { generated_at: generated }]));
}

describe("FR-NODE-115 AC-1 — dated candidates order by generated_at descending", () => {
  const frontmatters = dated({
    "docs/plans/2026-06-17.speckiwi.v3-0-0.plan.md": "2026-06-17T00:00:00Z",
    "docs/plans/2026-06-29.specwkiki.v230-plan.plan.md": "2026-06-29T00:00:00Z",
    "docs/plans/2026-07-08.speckiwi.v2301-kiwi-step.plan.md": "2026-07-08T00:00:00Z",
    "docs/plans/2026-07-10.speckiwi.v2301-flow.plan.md": "2026-07-10T00:00:00Z",
    "docs/plans/2026-07-28.speckiwi.v242.plan.md": "2026-07-28T00:00:00Z",
    "docs/plans/2026-07-29.speckiwi.v243.plan.md": "2026-07-29T00:00:00Z"
  });

  it("selects the newest as path and records the whole ordered set", () => {
    const selection = selectPlanCandidate(Object.keys(frontmatters), frontmatters);

    expect(selection.path).toBe("docs/plans/2026-07-29.speckiwi.v243.plan.md");
    expect(selection.candidates).toEqual([
      "docs/plans/2026-07-29.speckiwi.v243.plan.md",
      "docs/plans/2026-07-28.speckiwi.v242.plan.md",
      "docs/plans/2026-07-10.speckiwi.v2301-flow.plan.md",
      "docs/plans/2026-07-08.speckiwi.v2301-kiwi-step.plan.md",
      "docs/plans/2026-06-29.specwkiki.v230-plan.plan.md",
      "docs/plans/2026-06-17.speckiwi.v3-0-0.plan.md"
    ]);
  });

  it("does not depend on the order the glob returned", () => {
    const forwards = selectPlanCandidate(Object.keys(frontmatters), frontmatters);
    const backwards = selectPlanCandidate([...Object.keys(frontmatters)].reverse(), frontmatters);

    expect(backwards.candidates).toEqual(forwards.candidates);
  });
});

describe("FR-NODE-115 AC-2 — an equal generated_at is resolved lexicographically", () => {
  it("orders two candidates sharing a timestamp by path", () => {
    const frontmatters = dated({ "docs/plans/b.plan.md": "2026-07-29T00:00:00Z", "docs/plans/a.plan.md": "2026-07-29T00:00:00Z" });

    const selection = selectPlanCandidate(["docs/plans/b.plan.md", "docs/plans/a.plan.md"], frontmatters);

    expect(selection.candidates).toEqual(["docs/plans/a.plan.md", "docs/plans/b.plan.md"]);
    expect(selection.path).toBe("docs/plans/a.plan.md");
  });
});

describe("FR-NODE-115 AC-3 — an undated candidate sorts below every dated candidate", () => {
  it("places the undated candidate last however old the dated ones are", () => {
    const frontmatters = dated({ "docs/plans/undated.plan.md": null, "docs/plans/old.plan.md": "2020-01-01T00:00:00Z" });

    const selection = selectPlanCandidate(["docs/plans/undated.plan.md", "docs/plans/old.plan.md"], frontmatters);

    expect(selection.candidates).toEqual(["docs/plans/old.plan.md", "docs/plans/undated.plan.md"]);
    expect(selection.path).toBe("docs/plans/old.plan.md");
  });

  it("orders two undated candidates lexicographically between themselves", () => {
    const frontmatters = dated({ "docs/plans/z.plan.md": null, "docs/plans/a.plan.md": null });

    const selection = selectPlanCandidate(["docs/plans/z.plan.md", "docs/plans/a.plan.md"], frontmatters);

    expect(selection.candidates).toEqual(["docs/plans/a.plan.md", "docs/plans/z.plan.md"]);
  });

  it("treats a candidate with no frontmatter entry at all as undated", () => {
    const selection = selectPlanCandidate(["docs/plans/missing.plan.md", "docs/plans/dated.plan.md"], dated({ "docs/plans/dated.plan.md": "2020-01-01T00:00:00Z" }));

    expect(selection.candidates).toEqual(["docs/plans/dated.plan.md", "docs/plans/missing.plan.md"]);
  });
});

describe("FR-NODE-115 AC-4 — an empty candidate set", () => {
  it("yields a null path and an empty candidate list", () => {
    expect(selectPlanCandidate([], {})).toEqual({ path: null, candidates: [] });
  });
});

describe("FR-NODE-115 AC-5 — no candidate is removed before ordering", () => {
  it("keeps and selects a candidate that would fail the plan-contract conjuncts", () => {
    const frontmatters: Record<string, PlanFrontmatter> = {
      "docs/plans/broken.plan.md": { generated_at: "2026-07-29T00:00:00Z", plan_contract: "1.0.0", tdd_policy: "disabled" },
      "docs/plans/valid.plan.md": { generated_at: "2026-07-01T00:00:00Z", plan_contract: "1.2.0", tdd_policy: "strict" }
    };

    const selection = selectPlanCandidate(Object.keys(frontmatters), frontmatters);

    expect(selection.path).toBe("docs/plans/broken.plan.md");
    expect(selection.candidates).toContain("docs/plans/broken.plan.md");
  });
});

describe("FR-NODE-115 AC-6 — the candidate set is the whole glob and nothing else", () => {
  it("takes no user-supplied plan path", () => {
    expect(selectPlanCandidate.length).toBe(2);
  });

  it("returns every input path and no other", () => {
    const paths = ["docs/plans/a.plan.md", "docs/plans/b.plan.md", "docs/plans/c.plan.md"];

    const selection = selectPlanCandidate(paths, dated({ "docs/plans/b.plan.md": "2026-01-01T00:00:00Z" }));

    expect([...selection.candidates].sort()).toEqual([...paths].sort());
  });
});
