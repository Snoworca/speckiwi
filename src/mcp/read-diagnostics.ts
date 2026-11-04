import { buildReadEnvelope, type BoundedReadEnvelope, type ReadEnvelopeOptions } from "../core/query/summary.js";
import { dedupeDiagnostics } from "../core/diagnostic.js";
import type { Diagnostic, ParsedWorkspace } from "../core/types.js";
import type { WorkOrderMeasurement } from "../core/workflow/work-order.js";
import type { McpWorkspaceIdentity } from "./adapter.js";

// @req FR-MCP-070 AC-2 — an MCP read answers with a bounded diagnostics list by default: the
// OrchestrationGrid team measured one requirement read at 3.18 MB. `diagnosticsSummary` still counts
// every entry, so a reader learns how many it did not get.
export const MCP_READ_DIAGNOSTICS_LIMIT = 20;

/** The sentence every bounded MCP reader's description carries, so the bound is never a surprise. */
export const MCP_READ_DIAGNOSTICS_SENTENCE =
  `Diagnostics are bounded to ${MCP_READ_DIAGNOSTICS_LIMIT} entries, errors first, with \`diagnosticsTruncation\` when more exist; \`diagnosticsSummary\` counts every entry, and \`includeAllDiagnostics: true\` returns them all.`;

/** The read-envelope options one MCP read call asks for. @req FR-MCP-070 AC-2 AC-3 */
function mcpReadEnvelopeOptions(input: Record<string, unknown>): ReadEnvelopeOptions {
  return input.includeAllDiagnostics === true ? {} : { diagnosticsLimit: MCP_READ_DIAGNOSTICS_LIMIT };
}

export type McpReadEnvelope<T extends object> = Omit<BoundedReadEnvelope<T>, "errors" | "warnings">;

/**
 * The read envelope an MCP read tool answers with: the CLI envelope, bounded unless the caller asks
 * for every entry, without its `errors`/`warnings` split. @req FR-MCP-070 AC-1 — those two arrays
 * repeat `diagnostics` entry for entry, and `diagnosticsSummary` already gives their counts; the CLI
 * keeps them because its output must stay byte-identical (FR-NODE-231 AC-3).
 */
export function mcpReadEnvelope<T extends object>(
  workspace: ParsedWorkspace,
  value: T,
  diagnostics: Diagnostic[],
  input: Record<string, unknown>
): McpReadEnvelope<T> {
  const { errors: _errors, warnings: _warnings, ...envelope } = buildReadEnvelope(workspace, value, diagnostics, mcpReadEnvelopeOptions(input));
  return envelope;
}

/** A blocking error named by its place in `diagnostics`, so the entry itself is listed once. */
export interface BlockingDiagnosticReference {
  index: number;
  code: string;
  filePath?: string;
  line?: number;
}

function diagnosticReference(diagnostics: readonly Diagnostic[], entry: Diagnostic): BlockingDiagnosticReference {
  const index = diagnostics.indexOf(entry);
  return {
    index,
    code: entry.code,
    ...(entry.filePath !== undefined ? { filePath: entry.filePath } : {}),
    ...(typeof entry.line === "number" ? { line: entry.line } : {})
  };
}

interface WorkOrderLike {
  diagnostics?: Diagnostic[];
  blockingDiagnostics?: Diagnostic[];
  blockers?: Diagnostic[];
  measurement?: WorkOrderMeasurement;
}

/**
 * The work order an MCP client receives. @req FR-MCP-070 AC-1 — the core order lists the workspace
 * diagnostics before deduplication and copies every error into `blockingDiagnostics` (and, under
 * explain, `blockers`), so one entry reached the client up to four times. Here `diagnostics` is
 * deduplicated (its length then equals `diagnosticsSummary`), and each blocking error is a reference
 * into it.
 *
 * @req FR-MCP-024 AC-2 — the measurement means what the CLI's does, the size of the answer itself, so
 * it is taken over the answer this function returns, `mcpWorkspace` included: the server would attach
 * that block after the handler, outside any measurement.
 */
export function mcpWorkOrder<T extends WorkOrderLike>(order: T, workspace?: McpWorkspaceIdentity): unknown {
  if (!Array.isArray(order.diagnostics)) return order;
  const { measurement, ...rest } = order;
  const diagnostics = dedupeDiagnostics(order.diagnostics);
  const references = diagnostics.filter((entry) => entry.severity === "error").map((entry) => diagnosticReference(diagnostics, entry));
  const projected = {
    ...rest,
    diagnostics,
    ...(Array.isArray(order.blockingDiagnostics) ? { blockingDiagnostics: references } : {}),
    ...(Array.isArray(order.blockers) ? { blockers: references } : {}),
    ...(workspace !== undefined ? { mcpWorkspace: workspace } : {})
  };
  if (measurement === undefined) return projected;
  const compactBytes = Buffer.byteLength(JSON.stringify(projected));
  return {
    ...projected,
    measurement: {
      ...measurement,
      compactBytes,
      compactApproxTokens: Math.ceil(compactBytes / 4),
      reductionRatio: measurement.baselineBytes === 0 ? 1 : compactBytes / measurement.baselineBytes
    }
  };
}

/**
 * The collision diagnosis an MCP client receives. @req FR-MCP-070 AC-1 — each group carried the same
 * duplicate diagnostic the top-level list already holds, in the same order; the group keeps its
 * `duplicateId` and `occurrences`, which are that diagnostic's details.
 */
export function mcpCollisionDiagnosis<G extends { diagnostic?: unknown }>(result: { ok: boolean; value?: { groups: G[] } }): unknown {
  if (!result.ok || result.value === undefined) return result;
  return { ...result, value: { ...result.value, groups: result.value.groups.map(({ diagnostic: _diagnostic, ...group }) => group) } };
}
