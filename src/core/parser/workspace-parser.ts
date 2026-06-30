import { discoverSrsFiles } from "./discover.js";
import { extractTargetGoals, parseCompletedWork, parseIndexDocument } from "./index-parser.js";
import { scanRequirementBlocks } from "./block-scanner.js";
import { toRequirementRecord } from "../query/records.js";
import { diagnostic } from "../diagnostic.js";
import type { ParsedWorkspace, ProjectRoot } from "../types.js";

export async function parseWorkspace(root: ProjectRoot): Promise<ParsedWorkspace> {
  const diagnostics = [];
  const discovered = await discoverSrsFiles(root);
  const { index, diagnostics: indexDiagnostics } = parseIndexDocument(discovered.index);
  diagnostics.push(...indexDiagnostics);

  if (discovered.appendix) {
    const appendixGoals = extractTargetGoals(discovered.appendix.lines);
    for (const [token, goal] of Object.entries(appendixGoals)) {
      if (index.targetGoals[token] && index.targetGoals[token] !== goal) {
        diagnostics.push(
          diagnostic(
            "SRS-W040",
            "warning",
            `Target Goal block for '${token}' defined in both 00.index.md and 90.appendix.md; appendix value wins`,
            { filePath: discovered.appendix.relativePath }
          )
        );
      }
      index.targetGoals[token] = goal;
    }
  }
  if (discovered.completedWork) {
    index.completedWork.push(...parseCompletedWork(discovered.completedWork));
  }

  const records = [];
  for (const file of discovered.scopeFiles) {
    const scanned = scanRequirementBlocks(file.lines, file.relativePath);
    diagnostics.push(...scanned.diagnostics);
    for (const block of scanned.blocks) {
      const parsed = toRequirementRecord(file, block);
      records.push(parsed.record);
      diagnostics.push(...parsed.diagnostics);
    }
  }
  const files = [discovered.index, ...discovered.scopeFiles, ...(discovered.completedWork ? [discovered.completedWork] : []), ...(discovered.appendix ? [discovered.appendix] : [])];
  return {
    root,
    index,
    files,
    records,
    diagnostics
  };
}
