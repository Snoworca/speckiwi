import { describe, expectTypeOf, it } from "vitest";
import type {
  ParsedWorkspace,
  RequirementRecord,
  TextFile
} from "../../../src/core/types.js";

// FR-PARSE-024: types.ts adds optional origin ('body'|'step') and stepName to
// RequirementRecord and optional stepRecords, stepFiles, and stateFile to ParsedWorkspace
// so that new fields are backward compatible with existing single-constructor and fixture
// call sites. These are compile-time (type-level) acceptance criteria, verified with
// vitest's type-level assertions plus a no-new-field construction.

describe("FR-PARSE-024 optional origin and stepName fields on RequirementRecord and ParsedWorkspace", () => {
  // AC-1: RequirementRecord declares optional origin and stepName fields.
  it("FR-PARSE-024 AC-1", () => {
    expectTypeOf<RequirementRecord["origin"]>().toEqualTypeOf<"body" | "step" | undefined>();
    expectTypeOf<RequirementRecord["stepName"]>().toEqualTypeOf<string | undefined>();
    // Both fields must be optional (assignable from a record that omits them).
    expectTypeOf<{ origin?: "body" | "step"; stepName?: string }>().toMatchTypeOf<
      Pick<RequirementRecord, "origin" | "stepName">
    >();
  });

  // AC-2: ParsedWorkspace declares optional stepRecords, stepFiles, and stateFile fields.
  it("FR-PARSE-024 AC-2", () => {
    expectTypeOf<ParsedWorkspace["stepRecords"]>().toEqualTypeOf<RequirementRecord[] | undefined>();
    expectTypeOf<ParsedWorkspace["stepFiles"]>().toEqualTypeOf<TextFile[] | undefined>();
    expectTypeOf<ParsedWorkspace["stateFile"]>().toEqualTypeOf<TextFile | null | undefined>();
  });

  // AC-3: Existing code constructing RequirementRecord or ParsedWorkspace without the new
  // fields type-checks unchanged.
  it("FR-PARSE-024 AC-3", () => {
    // A RequirementRecord literal that omits origin/stepName must remain assignable.
    const recordWithoutNewFields: RequirementRecord = {
      id: "FR-ARCH-001",
      title: "Sample",
      type: "functional",
      target: "v3.0.0",
      status: "planned",
      scope: "10.product-architecture",
      filePath: "docs/spec/10.product-architecture.srs.md",
      headingLine: 1,
      metadata: {},
      acceptanceCriteria: [],
      verificationEvidence: [],
      traceLinks: [],
      changeNotes: [],
      tags: []
    };
    // A ParsedWorkspace literal that omits stepRecords/stepFiles/stateFile must remain assignable.
    const workspaceWithoutNewFields: ParsedWorkspace = {
      root: { root: "/tmp/ws" },
      index: {
        metadata: {},
        activeTarget: "v3.0.0",
        targets: [],
        scopes: [],
        completedWork: [],
        targetGoals: {}
      },
      files: [],
      records: [recordWithoutNewFields],
      diagnostics: []
    };
    expectTypeOf(recordWithoutNewFields).toMatchTypeOf<RequirementRecord>();
    expectTypeOf(workspaceWithoutNewFields).toMatchTypeOf<ParsedWorkspace>();
  });
});
