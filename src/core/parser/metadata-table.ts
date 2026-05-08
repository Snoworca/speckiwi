import { parseMetadataRows } from "./table.js";
import type { RequirementBlockRange } from "./block-scanner.js";

export function parseMetadataTable(block: RequirementBlockRange, lines: string[]): { metadata: Record<string, string>; endLine: number } {
  return parseMetadataRows(lines, block.startLine);
}
