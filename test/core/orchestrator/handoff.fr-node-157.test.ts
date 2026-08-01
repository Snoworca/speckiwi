// FR-NODE-157 — resolvability over a named field set against the dispatch base (05 §6.2 layer 4).
//
// The scope is exactly six sources: the plan path, the sidecar path, every write-set entry, every
// read-set entry, every non-null acceptance test-id file, and every path named in the body's
// Interfaces and Tasks sections. Five named fields and Context prose are outside it.

import { describe, expect, it } from "vitest";
import { validateHandoff, type HandoffCatalogTask, type HandoffRoot, type HandoffValidation } from "../../../src/core/orchestrator/handoff.js";
import { defaultCatalog, defaultHandoff, defaultLane, defaultRoot, defaultSections, handoffWith, renderBody, MODULE_PATH, TEST_PATH, READ_A, READ_B, PLAN_PATH, SIDECAR_PATH } from "./handoff-fixtures.js";
import { at } from "../../support/at.js";

const EXTRA_TEST = "test/core/orchestrator/lane-plan.extra.test.ts";

function validate(text: string, options: { root?: HandoffRoot; catalog?: HandoffCatalogTask[]; lane?: ReturnType<typeof defaultLane> } = {}): HandoffValidation {
  return validateHandoff(text, options.lane ?? defaultLane(), options.catalog ?? defaultCatalog(), options.root ?? defaultRoot());
}

function codes(result: HandoffValidation): string[] {
  return result.violations.map((violation) => violation.code);
}

describe("FR-NODE-157 AC-1 — one unresolvable fixture per scoped field", () => {
  it("refuses an unresolvable plan path", () => {
    expect(codes(validate(handoffWith({ plan_path: 'plan_path: "docs/plans/absent.plan.md"' })))).toContain("handoff-unresolvable-reference");
  });

  it("refuses an unresolvable sidecar path", () => {
    expect(codes(validate(handoffWith({ sidecar_path: 'sidecar_path: "docs/plans/absent.sidecar.json"' })))).toContain("handoff-unresolvable-reference");
  });

  it("refuses an unresolvable read-set entry", () => {
    const read_set = ["read_set:", `  - "${READ_A}"`, `  - "${READ_B}"`, '  - "src/core/absent/gone.ts"'].join("\n");
    expect(codes(validate(handoffWith({ read_set })))).toContain("handoff-unresolvable-reference");
  });

  it("refuses an unresolvable path named in the Interfaces section", () => {
    const sections = defaultSections();
    sections.Interfaces = "You import from `src/core/absent/interfaces-only.ts` and modify it not at all.";
    expect(codes(validate(handoffWith({}, renderBody(sections))))).toContain("handoff-unresolvable-reference");
  });

  it("refuses an unresolvable path named in the Tasks section", () => {
    const sections = defaultSections();
    sections.Tasks = `### T-PH003-04 — red\n\nWrite \`${TEST_PATH}\` first, reading \`src/core/absent/tasks-only.ts\` for the shape.\n\n### T-PH003-05 — green\n\nImplement \`${MODULE_PATH}\`.`;
    expect(codes(validate(handoffWith({}, renderBody(sections))))).toContain("handoff-unresolvable-reference");
  });
});

describe("FR-NODE-157 AC-2 — the tree is the dispatch base, never a sha that does not yet exist", () => {
  it("resolves a path absent from the repository head but staged by the dispatch-base commit", () => {
    const staged = "docs/research/work/waves/wave-2/design.md";
    const text = handoffWith({ read_set: ["read_set:", `  - "${READ_A}"`, `  - "${READ_B}"`, `  - "${staged}"`].join("\n") });

    expect(codes(validate(text))).toContain("handoff-unresolvable-reference");
    expect(validate(text, { root: { ...defaultRoot(), stagedPaths: [staged] } }).violations).toEqual([]);
  });
});

describe("FR-NODE-157 AC-3 — a sidecar-shaped task id named in the body must exist in the sidecar", () => {
  it("refuses a body naming a task id absent from the sidecar", () => {
    const sections = defaultSections();
    sections.Tasks = `### T-PH003-04 — red\n\nWrite \`${TEST_PATH}\` first.\n\n### T-PH009-99 — green\n\nImplement \`${MODULE_PATH}\`.`;
    expect(codes(validate(handoffWith({}, renderBody(sections))))).toContain("handoff-unresolvable-reference");
  });

  it("resolves the same id once the sidecar carries it", () => {
    const sections = defaultSections();
    sections.Tasks = `### T-PH003-04 — red\n\nWrite \`${TEST_PATH}\` first.\n\n### T-PH009-99 — green\n\nImplement \`${MODULE_PATH}\`.`;
    const root: HandoffRoot = { ...defaultRoot(), sidecarTaskIds: [...defaultRoot().sidecarTaskIds, "T-PH009-99"] };

    expect(validate(handoffWith({}, renderBody(sections)), { root }).violations).toEqual([]);
  });
});

describe("FR-NODE-157 AC-4 — requirement ids and acceptance criterion ids resolve", () => {
  it("refuses a requirement id that does not resolve", () => {
    const text = handoffWith({ req_ids: 'req_ids: ["FR-FLOW-071", "FR-FLOW-999"]' });
    expect(codes(validate(text))).toContain("handoff-unresolvable-reference");
  });

  it("refuses an acceptance-row criterion id that does not exist on its named requirement", () => {
    const acceptance = ["acceptance:", `  - { ac_id: "AC-9", req_id: "FR-FLOW-071", test_id: "${TEST_PATH}::assigns every task to exactly one lane" }`].join("\n");
    expect(codes(validate(handoffWith({ acceptance })))).toContain("handoff-unresolvable-reference");
  });
});

describe("FR-NODE-157 AC-5 — the handoff-level command covers both test-file sets", () => {
  it("refuses a command omitting a per-task verification command's test file", () => {
    const catalog = defaultCatalog();
    at(catalog, 0).verification_cmd = { posix: `npx vitest run --reporter=json ${EXTRA_TEST}`, windows: `npx vitest run --reporter=json ${EXTRA_TEST}` };

    expect(codes(validate(defaultHandoff(), { catalog }))).toContain("handoff-unresolvable-reference");
  });

  it("refuses a command omitting a non-null acceptance test-id file", () => {
    const acceptance = [
      "acceptance:",
      `  - { ac_id: "AC-1", req_id: "FR-FLOW-071", test_id: "${TEST_PATH}::assigns every task to exactly one lane" }`,
      `  - { ac_id: "AC-2", req_id: "FR-FLOW-071", test_id: "${EXTRA_TEST}::covers the extra case" }`
    ].join("\n");
    const write_set = ["write_set:", `  - "${MODULE_PATH}"`, `  - "${TEST_PATH}"`, `  - "${EXTRA_TEST}"`].join("\n");
    const lane = { ...defaultLane(), writeSet: [MODULE_PATH, TEST_PATH, EXTRA_TEST] };

    expect(codes(validate(handoffWith({ acceptance, write_set }), { lane }))).toContain("handoff-unresolvable-reference");
  });

  it("accepts a command naming both sets", () => {
    const command = `npx vitest run --no-file-parallelism --reporter=json ${TEST_PATH} ${EXTRA_TEST}`;
    const acceptance = [
      "acceptance:",
      `  - { ac_id: "AC-1", req_id: "FR-FLOW-071", test_id: "${TEST_PATH}::assigns every task to exactly one lane" }`,
      `  - { ac_id: "AC-2", req_id: "FR-FLOW-071", test_id: "${EXTRA_TEST}::covers the extra case" }`
    ].join("\n");
    const write_set = ["write_set:", `  - "${MODULE_PATH}"`, `  - "${TEST_PATH}"`, `  - "${EXTRA_TEST}"`].join("\n");
    const lane = { ...defaultLane(), writeSet: [MODULE_PATH, TEST_PATH, EXTRA_TEST] };
    const catalog = defaultCatalog();
    at(catalog, 0).verification_cmd = { posix: `npx vitest run --reporter=json ${EXTRA_TEST}`, windows: `npx vitest run --reporter=json ${EXTRA_TEST}` };

    const text = handoffWith({ acceptance, write_set, verification_cmd: ["verification_cmd:", `  posix: "${command}"`, `  windows: "${command}"`].join("\n") });
    expect(validate(text, { lane, catalog }).violations).toEqual([]);
  });
});

describe("FR-NODE-157 AC-6 — the out-of-scope set is not resolved", () => {
  it("accepts a handoff whose five out-of-scope fields all name non-existent locations", () => {
    const result = validate(
      handoffWith({
        manifest_path: 'manifest_path: "kiwi/orchestrator/nowhere/w9.manifest.json"',
        heartbeat_path: 'heartbeat_path: "kiwi/orchestrator/nowhere/w9.heartbeat"',
        deferred_mutations_path: 'deferred_mutations_path: ".kiwi/sessions/nowhere/deferred-mutations.jsonl"',
        decisions_path: 'decisions_path: ".kiwi/sessions/nowhere/decisions.jsonl"',
        regression_baseline_ref: 'regression_baseline_ref: "kiwi/waves.jsonl#L99 frozen.regression_baseline"'
      })
    );

    expect(result.violations).toEqual([]);
    expect(defaultRoot().headPaths).not.toContain("kiwi/orchestrator/nowhere/w9.manifest.json");
  });

  it("does not resolve a path named only in Context prose", () => {
    const sections = defaultSections();
    sections.Context = "The prior wave's report lives at `docs/analysis/nowhere/absent-report.md` and explains why.";
    expect(validate(handoffWith({}, renderBody(sections))).violations).toEqual([]);
  });
});

describe("FR-NODE-157 — the plan and sidecar paths of the accepted fixture do resolve", () => {
  it("resolves both against the dispatch base", () => {
    expect(defaultRoot().headPaths).toEqual(expect.arrayContaining([PLAN_PATH, SIDECAR_PATH]));
    expect(validate(defaultHandoff()).violations).toEqual([]);
  });
});
