import { z } from "zod";
import type { MachineResult } from "../core/dto.js";

export const machineResultOutputSchema = z.object({ ok: z.boolean() }).passthrough();

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
