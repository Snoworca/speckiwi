// FR-NODE-154 — handoff validation: the thirteen task fields, set equality, the ten ordered
// headings and the front-matter schema (05 §6.1, §6.2 layers 1 and 2).
//
// Every number in this file is load-bearing: thirteen fields, ten headings, and an expected count
// computed as thirteen times the declared task count rather than fixed.

import { describe, expect, it } from "vitest";
import {
  HANDOFF_BODY_HEADINGS,
  HANDOFF_TASK_FIELDS,
  MANIFEST_TEMPLATE_ARRAY_FIELDS,
  validateHandoff,
  type HandoffCatalogTask,
  type HandoffValidation
} from "../../../src/core/orchestrator/handoff.js";
import {
  BODY_HEADINGS,
  defaultCatalog,
  defaultHandoff,
  defaultLane,
  defaultRoot,
  defaultSections,
  handoffWith,
  manifestTemplateBlock,
  renderBody,
  MODULE_PATH,
  TEST_PATH,
  HEARTBEAT_PATH
} from "./handoff-fixtures.js";

function codes(result: HandoffValidation): string[] {
  return result.violations.map((violation) => violation.code);
}

function validate(text: string, options: { catalog?: HandoffCatalogTask[]; lane?: ReturnType<typeof defaultLane> } = {}): HandoffValidation {
  return validateHandoff(text, options.lane ?? defaultLane(), options.catalog ?? defaultCatalog(), defaultRoot());
}

describe("FR-NODE-154 — the fixture the whole file varies is itself accepted", () => {
  it("accepts the worked-example handoff", () => {
    const result = validate(defaultHandoff());
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("FR-NODE-154 AC-1 — the expected field count is thirteen times the declared task count", () => {
  it("refuses a checked count below expected and reports expected as 13 x 2", () => {
    const catalog = defaultCatalog();
    delete (catalog[0] as Record<string, unknown>).dod;
    const result = validate(defaultHandoff(), { catalog });

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("handoff-task-field-count");
    const violation = result.violations.find((entry) => entry.code === "handoff-task-field-count");
    expect(violation?.expected).toBe(26);
    expect(violation?.actual).toBe(25);
  });

  it("computes expected from the declared task count rather than from a constant", () => {
    const third: HandoffCatalogTask = { ...defaultCatalog()[0], id: "T-PH003-06" };
    const catalog = [...defaultCatalog(), third];
    delete (catalog[2] as Record<string, unknown>).rollback;
    const text = handoffWith({ task_ids: 'task_ids: ["T-PH003-04", "T-PH003-05", "T-PH003-06"]' });
    const lane = { ...defaultLane(), taskIds: ["T-PH003-04", "T-PH003-05", "T-PH003-06"] };

    const violation = validate(text, { catalog, lane }).violations.find((entry) => entry.code === "handoff-task-field-count");
    expect(violation?.expected).toBe(39);
    expect(violation?.actual).toBe(38);
  });

  it("counts thirteen fields per task on the accepted fixture", () => {
    expect(HANDOFF_TASK_FIELDS).toHaveLength(13);
    expect(validate(defaultHandoff()).counts.taskFieldCount).toBe(26);
  });
});

describe("FR-NODE-154 AC-2 — each of the thirteen fields is individually detected", () => {
  it.each(HANDOFF_TASK_FIELDS.map((field) => [field]))("refuses a handoff whose catalog omits %s", (field) => {
    const catalog = defaultCatalog();
    delete (catalog[0] as Record<string, unknown>)[field];
    const result = validate(defaultHandoff(), { catalog });

    expect(codes(result)).toContain("handoff-task-field-count");
    expect(result.ok).toBe(false);
  });
});

describe("FR-NODE-154 AC-3 — equality, not subset, on task ids and on the write set", () => {
  it("refuses a strict subset of the task assignment", () => {
    const text = handoffWith({ task_ids: 'task_ids: ["T-PH003-04"]' });
    expect(codes(validate(text))).toContain("handoff-set-inequality");
  });

  it("refuses a strict superset of the task assignment", () => {
    const text = handoffWith({ task_ids: 'task_ids: ["T-PH003-04", "T-PH003-05", "T-PH003-06"]' });
    expect(codes(validate(text))).toContain("handoff-set-inequality");
  });

  it("refuses a strict subset of the lane's computed write set", () => {
    const text = handoffWith({ write_set: ["write_set:", `  - "${MODULE_PATH}"`].join("\n") });
    expect(codes(validate(text))).toContain("handoff-set-inequality");
  });

  it("refuses a strict superset of the lane's computed write set", () => {
    const text = handoffWith({ write_set: ["write_set:", `  - "${MODULE_PATH}"`, `  - "${TEST_PATH}"`, '  - "src/core/orchestrator/extra.ts"'].join("\n") });
    expect(codes(validate(text))).toContain("handoff-set-inequality");
  });
});

describe("FR-NODE-154 AC-4 — ten body headings, present and in order", () => {
  it("declares exactly ten headings", () => {
    expect(HANDOFF_BODY_HEADINGS).toHaveLength(10);
    expect([...HANDOFF_BODY_HEADINGS]).toEqual([...BODY_HEADINGS]);
  });

  it.each(BODY_HEADINGS.map((heading) => [heading]))("refuses a handoff missing the %s heading", (heading) => {
    const order = BODY_HEADINGS.filter((entry) => entry !== heading);
    const result = validate(handoffWith({}, renderBody(defaultSections(), order)));

    expect(codes(result)).toContain("handoff-schema-invalid");
    expect(result.ok).toBe(false);
  });

  it("refuses all ten headings in a different order", () => {
    const order = [...BODY_HEADINGS];
    [order[1], order[2]] = [order[2], order[1]];
    expect(codes(validate(handoffWith({}, renderBody(defaultSections(), order))))).toContain("handoff-schema-invalid");
  });

  it("accepts all ten headings in the declared order", () => {
    expect(validate(handoffWith({}, renderBody(defaultSections(), BODY_HEADINGS))).ok).toBe(true);
  });
});

describe("FR-NODE-154 AC-5 — bootstrap ordering and the record typing", () => {
  it("refuses an install entry that follows an assert entry", () => {
    const bootstrap = [
      "bootstrap:",
      "  - kind: assert",
      '    posix:   "npx vitest --version"',
      '    windows: "npx vitest --version"',
      "  - kind: install",
      '    posix:   "NODE_ENV=development npm ci"',
      '    windows: "npm ci"'
    ].join("\n");
    expect(codes(validate(handoffWith({ bootstrap })))).toContain("handoff-schema-invalid");
  });

  it("accepts a bootstrap of assert entries alone, with no install and no record entry", () => {
    const bootstrap = ["bootstrap:", "  - kind: assert", '    posix:   "npx vitest --version"', '    windows: "npx vitest --version"'].join("\n");
    const result = validate(handoffWith({ bootstrap }));
    expect(result.violations).toEqual([]);
  });

  it("refuses a heartbeat-writing entry typed assert rather than record", () => {
    const bootstrap = [
      "bootstrap:",
      "  - kind: assert",
      '    posix:   "npx vitest --version"',
      '    windows: "npx vitest --version"',
      "  - kind: assert",
      `    posix:   "printf '{}' > ${HEARTBEAT_PATH}"`,
      `    windows: "Set-Content ${HEARTBEAT_PATH} '{}'"`
    ].join("\n");
    expect(codes(validate(handoffWith({ bootstrap })))).toContain("handoff-schema-invalid");
  });

  it("accepts the same heartbeat-writing entry typed record", () => {
    const bootstrap = [
      "bootstrap:",
      "  - kind: assert",
      '    posix:   "npx vitest --version"',
      '    windows: "npx vitest --version"',
      "  - kind: record",
      `    posix:   "printf '{}' > ${HEARTBEAT_PATH}"`,
      `    windows: "Set-Content ${HEARTBEAT_PATH} '{}'"`
    ].join("\n");
    expect(validate(handoffWith({ bootstrap })).violations).toEqual([]);
  });
});

describe("FR-NODE-154 AC-6 — every bootstrap entry carries both shell variants", () => {
  it("refuses an entry carrying only the POSIX command", () => {
    const bootstrap = ["bootstrap:", "  - kind: assert", '    posix:   "npx vitest --version"'].join("\n");
    expect(codes(validate(handoffWith({ bootstrap })))).toContain("handoff-schema-invalid");
  });

  it("refuses an entry carrying only the Windows command", () => {
    const bootstrap = ["bootstrap:", "  - kind: assert", '    windows: "npx vitest --version"'].join("\n");
    expect(codes(validate(handoffWith({ bootstrap })))).toContain("handoff-schema-invalid");
  });
});

describe("FR-NODE-154 AC-7 — the manifest template's three exceptions", () => {
  it("names six array fields", () => {
    expect(MANIFEST_TEMPLATE_ARRAY_FIELDS).toHaveLength(6);
  });

  it.each(MANIFEST_TEMPLATE_ARRAY_FIELDS.map((field) => [field]))("refuses a template whose %s is null rather than an empty array", (field) => {
    const template = manifestTemplateBlock().replace(`  ${field}: []`, `  ${field}: null`);
    expect(template).not.toBe(manifestTemplateBlock());
    expect(codes(validate(handoffWith({ manifest_template: template })))).toContain("handoff-schema-invalid");
  });

  it("refuses a template whose schema version is null", () => {
    const template = manifestTemplateBlock().replace('  schema_version: "1.0.0"', "  schema_version: null");
    expect(codes(validate(handoffWith({ manifest_template: template })))).toContain("handoff-schema-invalid");
  });

  it("refuses a template whose intentionally-empty flag is not false", () => {
    const template = manifestTemplateBlock().replace("  intentionally_empty: false", "  intentionally_empty: null");
    expect(codes(validate(handoffWith({ manifest_template: template })))).toContain("handoff-schema-invalid");
  });

  it("accepts the object carrying the three exceptions with every other value null", () => {
    expect(validate(handoffWith({ manifest_template: manifestTemplateBlock() })).violations).toEqual([]);
  });
});

describe("FR-NODE-154 AC-8 — the heartbeat path and the decisions path are required", () => {
  it("refuses a handoff omitting the heartbeat path", () => {
    const blocks = handoffWith({ heartbeat_path: "" });
    expect(codes(validate(blocks))).toContain("handoff-schema-invalid");
  });

  it("refuses a handoff omitting the decisions path", () => {
    expect(codes(validate(handoffWith({ decisions_path: "" })))).toContain("handoff-schema-invalid");
  });
});

describe("FR-NODE-154 AC-9 — a base-sha front-matter field is refused outright", () => {
  it.each([['base_sha: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c"'], ["base_sha: null"], ['base_sha: ""']])("refuses %s", (block) => {
    const result = validate(handoffWith({ base_sha: block }));
    expect(codes(result)).toContain("handoff-schema-invalid");
    expect(result.ok).toBe(false);
  });
});

describe("FR-NODE-154 AC-10 — the layer selection follows the handoff kind", () => {
  const brokenCatalog = (): HandoffCatalogTask[] => {
    const catalog = defaultCatalog();
    delete (catalog[0] as Record<string, unknown>).dod;
    return catalog;
  };

  it("skips layer 1 on a remediation handoff and records a task field count of zero", () => {
    const text = handoffWith({ handoff_kind: 'handoff_kind: "remediation"' });
    const result = validate(text, { catalog: brokenCatalog() });

    expect(codes(result)).not.toContain("handoff-task-field-count");
    expect(result.counts.taskFieldCount).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("refuses the same layer-1 defect on a lane handoff", () => {
    expect(codes(validate(defaultHandoff(), { catalog: brokenCatalog() }))).toContain("handoff-task-field-count");
  });

  it("refuses the same layer-1 defect on an epilogue handoff", () => {
    const text = handoffWith({ handoff_kind: 'handoff_kind: "epilogue"', stage: "stage: null", lane: 'lane: "epilogue"' });
    const lane = { laneId: "epilogue", taskIds: ["T-PH003-04", "T-PH003-05"], writeSet: null };
    const result = validateHandoff(text, lane, brokenCatalog(), defaultRoot());

    expect(codes(result)).toContain("handoff-task-field-count");
    expect(result.ok).toBe(false);
  });

  it("computes an epilogue handoff's write set from the catalog rather than from the lane row", () => {
    const text = handoffWith({ handoff_kind: 'handoff_kind: "epilogue"', stage: "stage: null", lane: 'lane: "epilogue"' });
    const lane = { laneId: "epilogue", taskIds: ["T-PH003-04", "T-PH003-05"], writeSet: null };

    expect(validateHandoff(text, lane, defaultCatalog(), defaultRoot()).violations).toEqual([]);
  });
});
