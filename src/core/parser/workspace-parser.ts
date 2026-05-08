import { discoverSrsFiles } from "./discover.js";
import { parseIndexDocument } from "./index-parser.js";
import { scanRequirementBlocks } from "./block-scanner.js";
import { toRequirementRecord } from "../query/records.js";
import type { ParsedWorkspace, ProjectRoot } from "../types.js";

export async function parseWorkspace(root: ProjectRoot): Promise<ParsedWorkspace> {
  const diagnostics = [];
  const discovered = await discoverSrsFiles(root);
  const { index, diagnostics: indexDiagnostics } = parseIndexDocument(discovered.index);
  diagnostics.push(...indexDiagnostics);
  const records = [];
  for (const file of discovered.scopeFiles) {
    const scanned = scanRequirementBlocks(file.lines, file.relativePath);
    diagnostics.push(...scanned.diagnostics);
    for (const block of scanned.blocks) {
      records.push(toRequirementRecord(file, block));
    }
  }
  return {
    root,
    index,
    files: [discovered.index, ...discovered.scopeFiles],
    records,
    diagnostics
  };
}
