// Fixture builder for `validateHandoff`'s five layers.
//
// The shape is 05 §6.3's worked example, which §4.1 makes the source of §10.3's fixtures. Front
// matter is held as named blocks so a test can replace or drop exactly one field without restating
// the other twenty-six, and the body is held separately so a heading test can reorder it.

import type { HandoffCatalogTask, HandoffLane, HandoffRoot } from "../../../src/core/orchestrator/handoff.js";

/** One front-matter field, rendered. The key is how a test names the block it replaces. */
export type YamlBlock = [key: string, text: string];

export const PLAN_PATH = "docs/plans/2026-08-02.speckiwi.v260-wave2.plan.md";
export const SIDECAR_PATH = "docs/plans/2026-08-02.speckiwi.v260-wave2.sidecar.json";
export const MODULE_PATH = "src/core/orchestrator/lane-plan.ts";
export const TEST_PATH = "test/core/orchestrator/lane-plan.test.ts";
export const READ_A = "src/core/workflow/validate.ts";
export const READ_B = "src/core/types.ts";
export const HEARTBEAT_PATH = "kiwi/orchestrator/run-1/lanes/w2-s2-l3.heartbeat";

export const VERIFICATION_CMD = `npx vitest run --no-file-parallelism --reporter=json ${TEST_PATH}`;

export function manifestTemplateBlock(): string {
  return [
    "manifest_template:",
    '  schema_version: "1.0.0"',
    "  run_id: null",
    "  wave: null",
    "  stage: null",
    "  lane: null",
    "  workspace_path: null",
    "  base_sha: null",
    "  head_sha: null",
    "  status: null",
    "  intentionally_empty: false",
    "  bootstrap_done_at: null",
    "  heartbeat_at: null",
    "  written_paths: []",
    "  commits: []",
    "  commands_run: []",
    "  acceptance_results: []",
    "  red_evidence: []",
    "  deferred_mutations_path: null",
    "  external_side_effects: []",
    "  needs_user: null",
    "  design_refuted: null",
    "  finished_at: null"
  ].join("\n");
}

/** The four §6.3 acceptance rows: three tested, one null exactly at `ceil(4 / 4)`. */
export function acceptanceBlock(): string {
  return [
    "acceptance:",
    `  - { ac_id: "AC-1", req_id: "FR-FLOW-071", test_id: "${TEST_PATH}::assigns every task to exactly one lane" }`,
    `  - { ac_id: "AC-2", req_id: "FR-FLOW-071", test_id: "${TEST_PATH}::never splits a covers_ac pair" }`,
    `  - { ac_id: "AC-3", req_id: "FR-FLOW-071", test_id: "${TEST_PATH}::produces byte-identical JSON on two calls" }`,
    '  - { ac_id: "AC-4", req_id: "FR-FLOW-071", test_id: null,',
    '      untested_reason: "Depends on the wave-2 partition postmortem, which wave 3 lane 5 writes.",',
    '      untested_owner: "wave-3/lane-5" }'
  ].join("\n");
}

export function defaultBlocks(): YamlBlock[] {
  return [
    ["handoff_contract", 'handoff_contract: "1.0.0"'],
    ["handoff_kind", 'handoff_kind: "lane"'],
    ["run_id", 'run_id: "2026-08-02.speckiwi.v260"'],
    ["wave", "wave: 2"],
    ["stage", "stage: 2"],
    ["lane", 'lane: "lane-3"'],
    ["isolation", 'isolation: "none-serial"'],
    ["auto", "auto: true"],
    ["branch", "branch: null"],
    ["bootstrap", ["bootstrap:", "  - kind: assert", '    posix:   "npx vitest --version"', '    windows: "npx vitest --version"'].join("\n")],
    ["plan_run_id", 'plan_run_id: "2026-08-02.speckiwi.v260-wave2"'],
    ["plan_path", `plan_path: "${PLAN_PATH}"`],
    ["sidecar_path", `sidecar_path: "${SIDECAR_PATH}"`],
    ["task_ids", 'task_ids: ["T-PH003-04", "T-PH003-05"]'],
    ["req_ids", 'req_ids: ["FR-FLOW-071"]'],
    ["design_items", 'design_items: ["D-031", "D-032"]'],
    ["write_set", ["write_set:", `  - "${MODULE_PATH}"`, `  - "${TEST_PATH}"`].join("\n")],
    ["read_set", ["read_set:", `  - "${READ_A}"`, `  - "${READ_B}"`].join("\n")],
    ["acceptance", acceptanceBlock()],
    ["verification_cmd", ["verification_cmd:", `  posix: "${VERIFICATION_CMD}"`, `  windows: "${VERIFICATION_CMD}"`].join("\n")],
    ["regression_baseline_ref", 'regression_baseline_ref: "kiwi/waves.jsonl#L7 frozen.regression_baseline"'],
    ["depends_on_lanes", "depends_on_lanes: []"],
    [
      "commit_policy",
      ["commit_policy:", '  granularity: "per-task"', '  pathspec: "write_set"', '  trailers: ["Orch-Run", "Orch-Wave", "Orch-Stage", "Orch-Lane", "Orch-Task"]'].join("\n")
    ],
    ["deferred_mutations_path", 'deferred_mutations_path: ".kiwi/sessions/run-1/lanes/lane-3/deferred-mutations.jsonl"'],
    ["decisions_path", 'decisions_path: ".kiwi/sessions/run-1/lanes/lane-3/decisions.jsonl"'],
    ["manifest_path", 'manifest_path: "kiwi/orchestrator/run-1/lanes/w2-s2-l3.manifest.json"'],
    ["heartbeat_path", `heartbeat_path: "${HEARTBEAT_PATH}"`],
    ["manifest_template", manifestTemplateBlock()],
    ["forbidden", ["forbidden:", '  - "Do not allocate a Requirement ID. Every id you need is in req_ids."', '  - "Do not run git push and do not open a pull request."'].join("\n")],
    [
      "escalation",
      [
        'escalation: "Stop and write manifest_path with the matching status, naming the reason:',
        "             lease-breach-requested if you need a path outside write_set, design-refuted with",
        '             the design item id and evidence if a design item cannot be implemented."'
      ].join("\n")
    ]
  ];
}

export const BODY_HEADINGS = ["Setup", "Objective", "Context", "Interfaces", "Tasks", "Acceptance", "Constraints", "Out of scope", "Manifest", "Escalation"] as const;

/** One English paragraph per required heading, keyed by heading, so a test can reorder or drop one. */
export function defaultSections(): Record<string, string> {
  return {
    Setup: "You run at the host root with the integration branch already checked out. Run the bootstrap\nentries in order, in your shell's variant, before reading anything else.",
    Objective: "Implement the pure function that partitions a planner sidecar into execution lanes. It\nperforms no input and no output of its own.",
    Context: "The sidecar parser and the dependency-cycle detector both exist already. Neither of them\nchanges here.",
    Interfaces: `You add one module and one test file. You import from \`${READ_A}\` and \`${READ_B}\`; you modify\nneither of those two files.`,
    Tasks: `### T-PH003-04 — red\n\nWrite \`${TEST_PATH}\` first and confirm it fails because \`${MODULE_PATH}\` does not exist yet.\n\n### T-PH003-05 — green\n\nImplement \`${MODULE_PATH}\` until every test passes. Do not weaken a test to reach green.`,
    Acceptance: "AC-1, AC-2 and AC-3 are covered by the three named tests. AC-4 has no test yet, and the front\nmatter records its reason and its owner.",
    Constraints: "The function is pure. It reads no file, calls no clock and opens no socket.",
    "Out of scope": "The command-line verb, the tool wrapper and the lock-file writer. Other lanes own them.",
    Manifest: "Write the manifest path as your last act, filling every field of the manifest template.",
    Escalation: "If the sidecar parser does not expose the fields this document names, stop and report a dead\nbase rather than repairing it yourself."
  };
}

export function renderBody(sections: Record<string, string>, order: readonly string[] = BODY_HEADINGS): string {
  return order.map((heading) => `## ${heading}\n\n${sections[heading] ?? ""}`).join("\n\n");
}

export function renderHandoff(blocks: YamlBlock[], body: string): string {
  return `---\n${blocks.map(([, text]) => text).join("\n")}\n---\n\n${body}\n`;
}

export function defaultHandoff(): string {
  return renderHandoff(defaultBlocks(), renderBody(defaultSections()));
}

export function withBlock(blocks: YamlBlock[], key: string, text: string): YamlBlock[] {
  const replaced = blocks.map<YamlBlock>((block) => (block[0] === key ? [key, text] : block));
  return replaced.some((block) => block[0] === key) ? replaced : [...replaced, [key, text]];
}

export function withoutBlock(blocks: YamlBlock[], key: string): YamlBlock[] {
  return blocks.filter((block) => block[0] !== key);
}

/** A handoff built from `defaultBlocks()` with the named blocks replaced. */
export function handoffWith(overrides: Record<string, string>, body?: string): string {
  let blocks = defaultBlocks();
  for (const [key, text] of Object.entries(overrides)) blocks = withBlock(blocks, key, text);
  return renderHandoff(blocks, body ?? renderBody(defaultSections()));
}

export function defaultLane(): HandoffLane {
  return { laneId: "lane-3", taskIds: ["T-PH003-04", "T-PH003-05"], writeSet: [MODULE_PATH, TEST_PATH] };
}

function task(id: string, phase: "red" | "green"): HandoffCatalogTask {
  return {
    id,
    type: "code",
    req_ids: ["FR-FLOW-071"],
    files: [{ path: MODULE_PATH }],
    test_files: [TEST_PATH],
    action: "implement",
    acceptance_tests: [`${TEST_PATH}::assigns every task to exactly one lane`],
    verification_cmd: { posix: VERIFICATION_CMD, windows: VERIFICATION_CMD },
    dod: "the verification command exits zero",
    rollback: "git revert the task commit",
    covers_ac: ["AC-1"],
    depends_on_task: [],
    tdd: { phase }
  };
}

export function defaultCatalog(): HandoffCatalogTask[] {
  return [task("T-PH003-04", "red"), task("T-PH003-05", "green")];
}

export function defaultRoot(): HandoffRoot {
  return {
    headPaths: [PLAN_PATH, SIDECAR_PATH, READ_A, READ_B],
    stagedPaths: [],
    sidecarTaskIds: ["T-PH003-04", "T-PH003-05"],
    requirementAcIds: { "FR-FLOW-071": ["AC-1", "AC-2", "AC-3", "AC-4"] }
  };
}
