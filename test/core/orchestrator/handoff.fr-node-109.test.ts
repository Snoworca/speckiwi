// FR-NODE-109 — a handoff carrying `base_sha` is rejected, and layer 4 resolves against the
// dispatch base: HEAD at 3.f plus the set of paths 3.f-prime is about to stage (05 §2.1 ordering
// rule 2, §6.2 layer 4).

import { describe, expect, it } from "vitest";
import { validateHandoff, type HandoffRoot, type HandoffValidation } from "../../../src/core/orchestrator/handoff.js";
import {
  defaultCatalog,
  defaultHandoff,
  defaultLane,
  defaultRoot,
  defaultSections,
  handoffWith,
  manifestTemplateBlock,
  renderBody,
  acceptanceBlock,
  MODULE_PATH,
  TEST_PATH,
  READ_A
} from "./handoff-fixtures.js";

function validate(text: string, root: HandoffRoot = defaultRoot()): HandoffValidation {
  return validateHandoff(text, defaultLane(), defaultCatalog(), root);
}

function codes(result: HandoffValidation): string[] {
  return result.violations.map((violation) => violation.code);
}

describe("FR-NODE-109 AC-1 — a top-level base_sha key is rejected regardless of its value", () => {
  it.each([['base_sha: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c"'], ["base_sha: null"], ["base_sha: 0"]])("rejects %s", (block) => {
    const result = validate(handoffWith({ base_sha: block }));
    expect(result.ok).toBe(false);
    expect(result.violations.some((violation) => violation.detail.includes("base_sha"))).toBe(true);
  });
});

describe("FR-NODE-109 AC-2 — manifest_template.base_sha is not a top-level field", () => {
  it("validates a conformant handoff whose manifest template carries base_sha: null", () => {
    expect(manifestTemplateBlock()).toContain("  base_sha: null");
    expect(validate(defaultHandoff()).violations).toEqual([]);
  });
});

describe("FR-NODE-109 AC-3 — layer 4 resolves the declared field set and nothing else", () => {
  it("does not resolve a path named only in the body's Context prose", () => {
    const sections = defaultSections();
    sections.Context = "The prior wave's report at `docs/analysis/nowhere/absent-report.md` explains the split.";
    const result = validate(handoffWith({}, renderBody(sections)));

    expect(result.violations).toEqual([]);
  });

  it("does resolve a path named in the Interfaces section", () => {
    const sections = defaultSections();
    sections.Interfaces = "You import from `src/core/absent/missing-module.ts` and modify it not at all.";
    expect(codes(validate(handoffWith({}, renderBody(sections))))).toContain("handoff-unresolvable-reference");
  });
});

describe("FR-NODE-109 AC-4 — the five workspace-local or git-ignored fields are excluded", () => {
  it("accepts a handoff whose manifest, heartbeat, deferred-mutations, decisions and baseline paths name nothing that exists", () => {
    const result = validate(
      handoffWith({
        manifest_path: 'manifest_path: "kiwi/orchestrator/nowhere/w9-s9-l9.manifest.json"',
        heartbeat_path: 'heartbeat_path: "kiwi/orchestrator/nowhere/w9-s9-l9.heartbeat"',
        deferred_mutations_path: 'deferred_mutations_path: ".kiwi/sessions/nowhere/deferred-mutations.jsonl"',
        decisions_path: 'decisions_path: ".kiwi/sessions/nowhere/decisions.jsonl"',
        regression_baseline_ref: 'regression_baseline_ref: "kiwi/waves.jsonl#L99 frozen.regression_baseline"'
      })
    );

    expect(result.violations).toEqual([]);
  });
});

describe("FR-NODE-109 AC-5 — inside the scope, a path resolves at HEAD or as a write-set member", () => {
  it("resolves a read-set path that exists at HEAD", () => {
    expect(defaultRoot().headPaths).toContain(READ_A);
    expect(validate(defaultHandoff()).violations).toEqual([]);
  });

  it("resolves a write-set path that exists at neither HEAD nor the staged set", () => {
    const root = defaultRoot();
    expect(root.headPaths).not.toContain(MODULE_PATH);
    expect(root.stagedPaths).not.toContain(MODULE_PATH);
    expect(validate(defaultHandoff(), root).violations).toEqual([]);
  });

  it("raises handoff-unresolvable-reference for a read-set path that is neither", () => {
    const text = handoffWith({ read_set: ["read_set:", `  - "${READ_A}"`, '  - "src/core/absent/gone.ts"'].join("\n") });
    expect(codes(validate(text))).toContain("handoff-unresolvable-reference");
  });
});

describe("FR-NODE-109 AC-6 — the dispatch base includes the paths 3.f-prime is about to stage", () => {
  it("resolves a read-set path absent from HEAD but present in the staged set", () => {
    const text = handoffWith({ read_set: ["read_set:", `  - "${READ_A}"`, '  - "docs/research/work/waves/wave-2/design.md"'].join("\n") });

    const withoutStaged = validate(text);
    expect(codes(withoutStaged)).toContain("handoff-unresolvable-reference");

    const staged: HandoffRoot = { ...defaultRoot(), stagedPaths: ["docs/research/work/waves/wave-2/design.md"] };
    expect(validate(text, staged).violations).toEqual([]);
  });
});

describe("FR-NODE-109 AC-7 — every non-null acceptance test id resolves, and none is shared", () => {
  it("refuses a test id naming a file that is neither at the dispatch base nor in the write set", () => {
    const acceptance = ["acceptance:", '  - { ac_id: "AC-1", req_id: "FR-FLOW-071", test_id: "test/core/absent/nothing.test.ts::a case" }'].join("\n");
    const text = handoffWith({
      acceptance,
      verification_cmd: ["verification_cmd:", `  posix: "npx vitest run --reporter=json ${TEST_PATH} test/core/absent/nothing.test.ts"`, `  windows: "npx vitest run --reporter=json ${TEST_PATH} test/core/absent/nothing.test.ts"`].join("\n")
    });

    expect(codes(validate(text))).toContain("handoff-unresolvable-reference");
  });

  it("refuses two acceptance rows sharing one test id", () => {
    const shared = `${TEST_PATH}::assigns every task to exactly one lane`;
    const acceptance = ["acceptance:", `  - { ac_id: "AC-1", req_id: "FR-FLOW-071", test_id: "${shared}" }`, `  - { ac_id: "AC-2", req_id: "FR-FLOW-071", test_id: "${shared}" }`].join("\n");

    expect(codes(validate(handoffWith({ acceptance })))).toContain("handoff-unresolvable-reference");
  });

  it("accepts the four distinct rows of the worked example", () => {
    expect(acceptanceBlock()).toContain("AC-4");
    expect(validate(defaultHandoff()).violations).toEqual([]);
  });
});
