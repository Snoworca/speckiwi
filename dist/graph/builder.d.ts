import type { DiagnosticBag, GraphResult } from "../core/dto.js";
import { type RequirementRegistry } from "../core/requirements.js";
import { type LoadedWorkspace } from "../validate/semantic.js";
export type GraphType = "document" | "scope" | "requirement" | "dependency" | "traceability";
export declare function buildGraph(workspace: LoadedWorkspace, graphType?: GraphType): GraphResult;
export declare function buildGraphFromRegistry(registry: RequirementRegistry, graphType?: GraphType, diagnostics?: DiagnosticBag): GraphResult;
export declare function filterGraphResult(graph: GraphResult, graphType?: GraphType): GraphResult;
export declare function deserializeGraphResult(value: unknown): GraphResult | undefined;
//# sourceMappingURL=builder.d.ts.map