import { describe, expect, it } from "vitest";
import { compileSchemas, validateAgainstSchema, type SchemaKind } from "../../src/schema/compile.js";

const validDocuments: Record<SchemaKind, unknown> = {
  index: {
    schemaVersion: "speckiwi/index/v1",
    project: { id: "speckiwi", name: "SpecKiwi", language: "ko" },
    documents: [
      { id: "overview", type: "overview", path: "overview.yaml" },
      { id: "dictionary", type: "dictionary", path: "dictionary.yaml" },
      { id: "srs.core", type: "srs", path: "srs/core.yaml", scope: "core" }
    ],
    scopes: [{ id: "core", name: "Core", type: "module" }],
    links: []
  },
  overview: {
    schemaVersion: "speckiwi/overview/v1",
    id: "overview",
    type: "overview",
    title: "Overview",
    status: "active",
    summary: "Project summary",
    goals: [{ id: "G-001", statement: "Ship a local YAML spec graph." }],
    nonGoals: [],
    glossary: []
  },
  dictionary: {
    schemaVersion: "speckiwi/dictionary/v1",
    id: "dictionary",
    type: "dictionary",
    title: "Dictionary",
    status: "active",
    synonyms: { srs: ["requirements"] },
    normalizations: { "json rpc": "json-rpc" }
  },
  srs: {
    schemaVersion: "speckiwi/srs/v1",
    id: "srs.core",
    type: "srs",
    scope: "core",
    title: "Core SRS",
    status: "active",
    requirements: [
      {
        id: "FR-CORE-0001",
        type: "functional",
        title: "Validate workspace",
        status: "active",
        statement: "시스템은 workspace YAML을 deterministic하게 validate해야 한다.",
        rationale: "Validation protects apply.",
        acceptanceCriteria: [{ id: "AC-001", method: "test", description: "Invalid references produce diagnostics." }],
        relations: [],
        tags: ["validation"]
      }
    ]
  },
  prd: {
    schemaVersion: "speckiwi/prd/v1",
    id: "prd.core",
    type: "prd",
    title: "Core PRD",
    status: "active",
    items: [{ id: "PRD-001", type: "feature", title: "Validation", body: "Validate YAML files.", links: [] }]
  },
  technical: {
    schemaVersion: "speckiwi/technical/v1",
    id: "tech.validation",
    type: "technical",
    title: "Validation Design",
    status: "active",
    sections: [{ id: "SEC-001", title: "Registry", body: "Build a registry." }]
  },
  adr: {
    schemaVersion: "speckiwi/adr/v1",
    id: "adr.0001",
    type: "adr",
    title: "Use YAML",
    status: "accepted",
    decision: "Use YAML as the source of truth.",
    consequences: []
  },
  rule: {
    schemaVersion: "speckiwi/rule/v1",
    id: "rule.safe-write",
    type: "rule",
    title: "Safe Write",
    status: "active",
    rules: [{ id: "RULE-001", level: "must", statement: "Apply must stop on validation errors." }]
  },
  proposal: {
    schemaVersion: "speckiwi/proposal/v1",
    id: "proposal.2026-05-01T000000.update.FR-CORE-0001",
    type: "proposal",
    status: "proposed",
    operation: "update_requirement",
    target: { kind: "requirement", requirementId: "FR-CORE-0001", documentId: "srs.core" },
    base: {
      documentId: "srs.core",
      documentPath: "srs/core.yaml",
      target: { entityType: "requirement", id: "FR-CORE-0001", jsonPointer: "/requirements/0" },
      documentHash: `sha256:${"a".repeat(64)}`,
      targetHash: `sha256:${"b".repeat(64)}`,
      schemaVersion: "speckiwi/srs/v1",
      generatedAt: "2026-05-01T00:00:00.000Z"
    },
    changes: [{ op: "replace", path: "/requirements/0/statement", value: "Updated statement" }],
    reason: "Clarify the requirement."
  }
};

describe("schema compile layer", () => {
  it("compiles every v1 schema under Ajv2020 strict mode", () => {
    expect(Object.keys(compileSchemas()).sort()).toEqual([
      "adr",
      "dictionary",
      "index",
      "overview",
      "prd",
      "proposal",
      "rule",
      "srs",
      "technical"
    ]);
  });

  it("accepts valid examples for every schema kind", () => {
    for (const [kind, value] of Object.entries(validDocuments) as [SchemaKind, unknown][]) {
      expect(validateAgainstSchema(kind, value).summary.errorCount, kind).toBe(0);
    }
  });

  it("returns stable diagnostics for closed objects, metadata, and status enums", () => {
    const overview = validDocuments.overview as Record<string, unknown>;
    const adr = validDocuments.adr as Record<string, unknown>;

    expect(validateAgainstSchema("overview", { ...overview, extra: true }).errors[0]).toMatchObject({
      code: "UNKNOWN_FIELD"
    });
    expect(validateAgainstSchema("overview", { ...overview, metadata: null }).errors[0]).toMatchObject({
      code: "INVALID_METADATA"
    });
    expect(validateAgainstSchema("adr", { ...adr, status: "active" }).errors[0]).toMatchObject({
      code: "INVALID_DOCUMENT_STATUS"
    });
  });
});
