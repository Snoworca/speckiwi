import { z } from "zod";
import { acceptsRoadmapDateCell, ROADMAP_BINDINGS, ROADMAP_DATE_CELL_FORMS, type RoadmapBinding, type RoadmapInputBinding } from "../../cli/commands/roadmap.js";
import { resolveProjectRoot } from "../../core/project-root.js";
import type { Diagnostic } from "../../core/types.js";
import type { McpCallContext, McpDependencies, McpServerHandle, McpToolMetadata } from "../adapter.js";
import { mcpSuccess, resultToMcp } from "../errors.js";
import { missingRequiredArguments } from "../required-args.js";

// @req IR-MCP-009 — one tool per `speckiwi roadmap` command, taken from the command's binding row: the
// schema is derived from the row's inputs, and the handler hands the input to the row's `run`, the
// same call the command makes, so each tool returns what its command prints under `--json`.

/** A date-cell input, refused at the schema by the judgement the CLI option uses. */
function dateCellSchema(encoding: keyof typeof ROADMAP_DATE_CELL_FORMS): z.ZodTypeAny {
  return z.string().refine((value) => acceptsRoadmapDateCell(encoding, value), { message: `must be ${ROADMAP_DATE_CELL_FORMS[encoding]}` });
}

function inputSchema(input: RoadmapInputBinding): z.ZodTypeAny {
  const base =
    input.encoding === "list" ? z.array(z.string())
      : input.encoding === "boolean" ? z.boolean()
        : input.encoding === "integer" ? z.number().int().min(input.minimum ?? 0)
          : input.encoding === "choice" ? z.enum(input.choices as [string, ...string[]])
            : input.encoding === "planned-date" || input.encoding === "actual-date" ? dateCellSchema(input.encoding)
              : z.string();
  const described = base.describe(input.help);
  return input.required ? described : described.optional();
}

function toolSchema(binding: RoadmapBinding): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = binding.itemArgument ? { item: z.string().describe("roadmap item ID, e.g. RM-3") } : {};
  for (const input of binding.inputs) shape[input.dest] = inputSchema(input);
  return shape;
}

/** The input schemas of the six roadmap tools; server.ts lists them and each handler checks its required inputs. */
export const ROADMAP_TOOL_SCHEMAS: Readonly<Record<string, Record<string, z.ZodTypeAny>>> = Object.fromEntries(
  ROADMAP_BINDINGS.map((binding) => [binding.tool, toolSchema(binding)])
);

/** A check report lists its diagnostics in the value, and the envelope does not repeat them (FR-MCP-070 AC-1). */
function readAnswer(value: unknown): unknown {
  const diagnostics = (value as { diagnostics?: unknown }).diagnostics;
  return mcpSuccess(value, Array.isArray(diagnostics) ? (diagnostics as Diagnostic[]) : []);
}

/**
 * Registers the readers or the writers. Readers are registered by read-tools.ts with the SRS-query
 * metadata that opens the per-call root; writers by mutation-tools.ts as workspace mutations, which
 * the gate holds to the startup root.
 */
export function registerRoadmapTools(
  server: McpServerHandle,
  deps: McpDependencies,
  kind: RoadmapBinding["kind"],
  metadataFor: (tool: string) => McpToolMetadata
): void {
  for (const binding of ROADMAP_BINDINGS) {
    if (binding.kind !== kind) continue;
    const schema = ROADMAP_TOOL_SCHEMAS[binding.tool] ?? {};
    server.registerTool(
      binding.tool,
      async (input: Record<string, unknown>, context?: McpCallContext) => {
        const missing = missingRequiredArguments(binding.tool, schema, input);
        if (missing) return missing;
        const root = await resolveProjectRoot(process.cwd(), context?.root ?? deps.root);
        if (binding.kind === "mutation") return resultToMcp(await binding.run(root, input));
        const result = await binding.run(root, input);
        return result.ok ? readAnswer(result.value) : resultToMcp(result);
      },
      metadataFor(binding.tool)
    );
  }
}
