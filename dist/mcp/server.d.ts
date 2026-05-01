import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CacheMode } from "../core/inputs.js";
export type McpServerInput = {
    root: string;
    cacheMode?: CacheMode;
};
export declare function createMcpServer(input: McpServerInput): McpServer;
export declare function runMcpServer(input: McpServerInput): Promise<void>;
//# sourceMappingURL=server.d.ts.map