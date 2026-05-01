import type { GraphResult } from "../core/dto.js";
import { type RequirementRegistry } from "../core/requirements.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
export type GraphType = "document" | "scope" | "requirement" | "dependency" | "traceability";
export declare function buildGraph(workspace: LoadedWorkspace, graphType?: GraphType): GraphResult;
export declare function buildGraphFromRegistry(registry: RequirementRegistry, graphType?: GraphType): GraphResult;
//# sourceMappingURL=builder.d.ts.map