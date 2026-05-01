import { describe, expect, it } from "vitest";
import { renderJson } from "../../src/cli/json-renderer.js";
import { toMcpToolResult, toStructuredContent } from "../../src/mcp/structured-content.js";
import type { CoreResult, Diagnostic, SearchResultSet, ValidateResult } from "../../src/core/dto.js";
import type { ApplyChangeInput } from "../../src/core/inputs.js";
import { createDiagnosticBag, emptyDiagnosticBag, fail, ok, validationResult } from "../../src/core/result.js";

describe("Core DTO contract", () => {
  it("creates a success result with a DiagnosticBag", () => {
    const result = ok({ value: "ready" });

    expect(result).toEqual({
      ok: true,
      value: "ready",
      data: { value: "ready" },
      diagnostics: {
        errors: [],
        warnings: [],
        infos: [],
        summary: { errorCount: 0, warningCount: 0, infoCount: 0 }
      }
    });
  });

  it("keeps diagnostics grouped by severity instead of array shorthand", () => {
    const diagnostics: Diagnostic[] = [
      { severity: "warning", code: "MISSING_ACCEPTANCE_CRITERIA", message: "Missing acceptance criteria" },
      { severity: "error", code: "SCHEMA_VALIDATION_FAILED", message: "Schema validation failed", path: ".speckiwi/srs/b.yaml" },
      { severity: "error", code: "DUPLICATE_REQUIREMENT_ID", message: "Duplicate requirement id", path: ".speckiwi/srs/a.yaml" },
      { severity: "info", code: "RESERVED_INFO", message: "Reserved info diagnostic" }
    ];

    const bag = createDiagnosticBag(diagnostics);

    expect(Array.isArray(bag)).toBe(false);
    expect(bag.errors.map((diagnostic) => diagnostic.code)).toEqual(["DUPLICATE_REQUIREMENT_ID", "SCHEMA_VALIDATION_FAILED"]);
    expect(bag.warnings).toHaveLength(1);
    expect(bag.infos).toHaveLength(1);
    expect(bag.summary).toEqual({ errorCount: 2, warningCount: 1, infoCount: 1 });
  });

  it("distinguishes validation outcomes from tool execution errors", () => {
    const bag = createDiagnosticBag([
      { severity: "error", code: "SCHEMA_VALIDATION_FAILED", message: "Schema validation failed" }
    ]);

    const validation: ValidateResult = validationResult(bag);
    const executionError = fail(
      { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" },
      emptyDiagnosticBag()
    );

    expect(validation.ok).toBe(false);
    expect("error" in validation).toBe(false);
    expect(executionError.ok).toBe(false);
    expect("error" in executionError).toBe(true);
  });

  it("allows ErrorResult to satisfy specific CoreResult return contracts", () => {
    function readRequirement(): CoreResult<{ requirementId: string }> {
      return fail({ code: "NOT_FOUND", message: "Requirement not found" });
    }

    expect(readRequirement()).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" }
    });
  });

  it("renders deterministic one-object CLI JSON", () => {
    const result: CoreResult<{ z: string; a: string }> = ok({ z: "last", a: "first" });

    expect(renderJson(result)).toBe(
      '{"a":"first","data":{"a":"first","z":"last"},"diagnostics":{"errors":[],"infos":[],"summary":{"errorCount":0,"infoCount":0,"warningCount":0},"warnings":[]},"ok":true,"z":"last"}\n'
    );
  });

  it("rejects lossy JSON rendering inputs", () => {
    expect(() => renderJson(1 as never)).toThrow("top-level JSON object");
    expect(() => renderJson({ ok: true, diagnostics: emptyDiagnosticBag(), value: Number.NaN })).toThrow("non-finite");
  });

  it("reuses the same Core DTO object for MCP structuredContent", () => {
    const result: SearchResultSet = ok({
      query: "FR-CLI",
      mode: "exact",
      results: [
        {
          entityType: "requirement",
          id: "FR-CLI-006",
          score: 1,
          matchedFields: ["id"],
          path: ".speckiwi/srs/cli.yaml"
        }
      ],
      page: {
        limit: 10,
        offset: 0,
        returned: 1,
        total: 1,
        hasMore: false,
        nextOffset: null
      }
    });

    expect(toStructuredContent(result)).toBe(result);
    const toolResult = toMcpToolResult(result);

    expect(toolResult).toEqual({
      structuredContent: result,
      content: [{ type: "text", text: JSON.stringify(result) }]
    });
    expect(toolResult).not.toHaveProperty("isError");
  });

  it("keeps validate failures as non-error MCP tool results", () => {
    const result: ValidateResult = validationResult(
      createDiagnosticBag([{ severity: "error", code: "INVALID_YAML", message: "Invalid YAML" }])
    );
    const toolResult = toMcpToolResult(result);

    expect(toolResult.structuredContent).toBe(result);
    expect(toolResult).not.toHaveProperty("isError");
  });

  it("types apply inputs as exactly one confirmed source", () => {
    const byId: ApplyChangeInput = { proposalId: "proposal-1", confirm: true };
    const byPath: ApplyChangeInput = { proposalPath: ".speckiwi/proposals/p.yaml", confirm: true };
    // @ts-expect-error Apply input requires exactly one source.
    const invalidMultiple: ApplyChangeInput = { proposalId: "proposal-1", proposalPath: ".speckiwi/proposals/p.yaml", confirm: true };
    // @ts-expect-error Apply input requires exactly one source.
    const invalidMissing: ApplyChangeInput = { confirm: true };
    // @ts-expect-error Apply execution requires confirm:true.
    const invalidConfirm: ApplyChangeInput = { proposalId: "proposal-1", confirm: false };

    expect(byId.proposalId).toBe("proposal-1");
    expect(byPath.proposalPath).toBe(".speckiwi/proposals/p.yaml");
    expect([invalidMultiple, invalidMissing, invalidConfirm]).toHaveLength(3);
  });
});
