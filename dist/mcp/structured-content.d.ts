import { z } from "zod";
import type { MachineResult } from "../core/dto.js";
export declare const machineResultOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
}, z.core.$loose>;
export type McpStructuredResult = {
    structuredContent: Record<string, unknown>;
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: true;
};
export declare function toStructuredContent<T extends MachineResult>(result: T): Record<string, unknown>;
export declare function toMcpToolResult<T extends MachineResult>(result: T): McpStructuredResult;
//# sourceMappingURL=structured-content.d.ts.map