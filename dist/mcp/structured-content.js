import { z } from "zod";
export const machineResultOutputSchema = z.object({ ok: z.boolean() }).passthrough();
export function toStructuredContent(result) {
    return result;
}
export function toMcpToolResult(result) {
    const toolResult = {
        structuredContent: toStructuredContent(result),
        content: [{ type: "text", text: JSON.stringify(result) }]
    };
    if (result.ok === false && "error" in result) {
        toolResult.isError = true;
    }
    return toolResult;
}
//# sourceMappingURL=structured-content.js.map