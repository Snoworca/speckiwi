import { z } from "zod";
import type { MachineResult } from "../core/dto.js";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

const diagnosticSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["error", "warning", "info"]),
    path: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    details: z.record(z.string(), jsonValueSchema).optional()
  })
  .passthrough();

export const diagnosticBagOutputSchema = z
  .object({
    errors: z.array(diagnosticSchema),
    warnings: z.array(diagnosticSchema),
    infos: z.array(diagnosticSchema),
    summary: z
      .object({
        errorCount: z.number(),
        warningCount: z.number(),
        infoCount: z.number()
      })
      .passthrough()
  })
  .passthrough();

const coreErrorOutputSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), jsonValueSchema).optional()
  })
  .passthrough();

export const machineResultOutputSchema = z
  .object({
    ok: z.boolean(),
    diagnostics: diagnosticBagOutputSchema
  })
  .passthrough();

export const machineErrorOutputSchema = z
  .object({
    ok: z.literal(false),
    diagnostics: diagnosticBagOutputSchema,
    error: coreErrorOutputSchema
  })
  .passthrough();

const pageOutputSchema = z
  .object({
    limit: z.number(),
    offset: z.number(),
    returned: z.number(),
    total: z.number(),
    hasMore: z.boolean(),
    nextOffset: z.number().nullable()
  })
  .passthrough();

const documentSummaryOutputSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    path: z.string()
  })
  .passthrough();

const requirementSummaryOutputSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    status: z.string(),
    statement: z.string(),
    documentId: z.string(),
    tags: z.array(z.string()),
    path: z.string()
  })
  .passthrough();

const relationOutputSchema = z
  .object({
    type: z.string(),
    target: z.string(),
    source: z.string().optional(),
    description: z.string().optional()
  })
  .passthrough();

const graphNodeOutputSchema = z
  .object({
    key: z.string(),
    entityType: z.string(),
    id: z.string()
  })
  .passthrough();

const graphEdgeOutputSchema = z
  .object({
    key: z.string(),
    source: z.string(),
    target: z.string(),
    relationType: z.string(),
    sourceType: z.string(),
    targetType: z.string(),
    sourceId: z.string(),
    targetId: z.string()
  })
  .passthrough();

const proposalSummaryOutputSchema = z
  .object({
    id: z.string(),
    path: z.string(),
    operation: z.string(),
    target: z.object({ kind: z.string() }).passthrough()
  })
  .passthrough();

function coreSuccessOutputSchema(shape: z.ZodRawShape): z.ZodObject<z.ZodRawShape> {
  return z
    .object({
      ok: z.literal(true),
      diagnostics: diagnosticBagOutputSchema,
      ...shape
    })
    .passthrough();
}

function coreToolOutputSchema(shape: z.ZodRawShape): z.ZodTypeAny {
  const successSchema = coreSuccessOutputSchema(shape);
  return z
    .object({
      ok: z.boolean(),
      diagnostics: diagnosticBagOutputSchema,
      error: coreErrorOutputSchema.optional(),
      ...optionalOutputShape(shape)
    })
    .passthrough()
    .superRefine((value, ctx) => {
      if (value.ok !== false && value.error !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["error"],
          message: "Successful structured content must not include an error field."
        });
        return;
      }
      const parsed = (value.ok === false ? machineErrorOutputSchema : successSchema).safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Structured content does not match ${value.ok === false ? "error" : "success"} output schema.`
        });
      }
    });
}

function optionalOutputShape(shape: z.ZodRawShape): z.ZodRawShape {
  return Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).optional()]));
}

export const overviewOutputSchema = coreToolOutputSchema({
  project: z.object({ id: z.string() }).passthrough(),
  overview: z.object({ id: z.string(), title: z.string() }).passthrough(),
  stats: z.object({ documents: z.number(), scopes: z.number(), requirements: z.number() }).passthrough()
});

export const listDocumentsOutputSchema = coreToolOutputSchema({
  documents: z.array(documentSummaryOutputSchema),
  page: pageOutputSchema
});

export const readDocumentOutputSchema = coreToolOutputSchema({
  documentId: z.string(),
  path: z.string(),
  rawYaml: z.string().optional(),
  parsed: z.record(z.string(), jsonValueSchema).optional()
});

export const searchOutputSchema = coreToolOutputSchema({
  query: z.string(),
  mode: z.enum(["auto", "exact", "bm25"]),
  results: z.array(
    z
      .object({
        entityType: z.string(),
        id: z.string(),
        score: z.number(),
        matchedFields: z.array(z.string()),
        path: z.string()
      })
      .passthrough()
  ),
  page: pageOutputSchema
});

export const getRequirementOutputSchema = coreToolOutputSchema({
  requirement: z.record(z.string(), jsonValueSchema),
  document: documentSummaryOutputSchema.optional(),
  relations: z
    .object({
      incoming: z.array(relationOutputSchema),
      outgoing: z.array(relationOutputSchema)
    })
    .passthrough()
    .optional()
});

export const listRequirementsOutputSchema = coreToolOutputSchema({
  requirements: z.array(requirementSummaryOutputSchema),
  page: pageOutputSchema
});

export const previewRequirementIdOutputSchema = coreToolOutputSchema({
  id: z.string(),
  generated: z.boolean(),
  prefix: z.string(),
  projectSegment: z.string(),
  scopeSegment: z.string(),
  sequence: z.number(),
  formattedSequence: z.string(),
  collisionCount: z.number()
});

export const graphOutputSchema = coreToolOutputSchema({
  graphType: z.enum(["document", "scope", "requirement", "dependency", "traceability"]),
  nodes: z.array(graphNodeOutputSchema),
  edges: z.array(graphEdgeOutputSchema)
});

export const traceOutputSchema = coreToolOutputSchema({
  root: z.string(),
  requirementId: z.string(),
  direction: z.enum(["upstream", "downstream", "both"]),
  depth: z.number(),
  nodes: z.array(graphNodeOutputSchema),
  edges: z.array(graphEdgeOutputSchema)
});

export const impactOutputSchema = coreToolOutputSchema({
  root: z.string(),
  requirementId: z.string(),
  impacted: z.array(
    z
      .object({
        id: z.string(),
        depth: z.number(),
        via: z.array(z.string()),
        relationType: z.string()
      })
      .passthrough()
  ),
  nodes: z.array(graphNodeOutputSchema),
  edges: z.array(graphEdgeOutputSchema)
});

const validateOutcomeOutputSchema = z
  .object({
    ok: z.boolean(),
    valid: z.boolean(),
    diagnostics: diagnosticBagOutputSchema
  })
  .passthrough();

export const validateOutputSchema = z
  .object({
    ok: z.boolean(),
    valid: z.boolean().optional(),
    diagnostics: diagnosticBagOutputSchema,
    error: coreErrorOutputSchema.optional()
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const parsed = (value.error === undefined ? validateOutcomeOutputSchema : machineErrorOutputSchema).safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Structured content does not match validate output schema."
      });
    }
  });

export const proposeOutputSchema = coreToolOutputSchema({
  mode: z.literal("propose"),
  applied: z.literal(false),
  proposal: proposalSummaryOutputSchema
});

export const applyOutputSchema = coreToolOutputSchema({
  mode: z.literal("apply"),
  applied: z.literal(true),
  modifiedFiles: z.array(z.string()),
  cacheStale: z.boolean()
});

export function toolOutputSchemaFor(name: string): z.ZodTypeAny {
  switch (name) {
    case "speckiwi_overview":
      return overviewOutputSchema;
    case "speckiwi_list_documents":
      return listDocumentsOutputSchema;
    case "speckiwi_read_document":
      return readDocumentOutputSchema;
    case "speckiwi_search":
      return searchOutputSchema;
    case "speckiwi_get_requirement":
      return getRequirementOutputSchema;
    case "speckiwi_list_requirements":
      return listRequirementsOutputSchema;
    case "speckiwi_preview_requirement_id":
      return previewRequirementIdOutputSchema;
    case "speckiwi_trace_requirement":
      return traceOutputSchema;
    case "speckiwi_graph":
      return graphOutputSchema;
    case "speckiwi_impact":
      return impactOutputSchema;
    case "speckiwi_validate":
      return validateOutputSchema;
    case "speckiwi_propose_change":
      return proposeOutputSchema;
    case "speckiwi_apply_change":
      return applyOutputSchema;
    default:
      return machineResultOutputSchema;
  }
}

export type McpStructuredResult = {
  structuredContent: Record<string, unknown>;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

export function toStructuredContent<T extends MachineResult>(result: T): Record<string, unknown> {
  return result as unknown as Record<string, unknown>;
}

export function toMcpToolResult<T extends MachineResult>(result: T): McpStructuredResult {
  const toolResult: McpStructuredResult = {
    structuredContent: toStructuredContent(result),
    content: [{ type: "text", text: JSON.stringify(result) }]
  };

  if (result.ok === false && "error" in result) {
    toolResult.isError = true;
  }

  return toolResult;
}
