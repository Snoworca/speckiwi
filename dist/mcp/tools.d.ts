import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SpecKiwiCore } from "../core/api.js";
import type { MachineResult } from "../core/dto.js";
export { createSpecKiwiCore } from "../core/api.js";
export declare function registerMcpTools(server: McpServer, core: SpecKiwiCore): void;
export declare function toolResultFromCore<T extends MachineResult>(result: T): CallToolResult;
//# sourceMappingURL=tools.d.ts.map