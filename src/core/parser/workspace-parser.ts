import { discoverSrsFiles, srsDocumentFiles } from "./discover.js";
import { extractTargetGoals, parseCompletedWork, parseIndexDocument } from "./index-parser.js";
import { scanRequirementBlocks } from "./block-scanner.js";
import { toRequirementRecord } from "../query/records.js";
import { diagnostic } from "../diagnostic.js";
import type { CompletedWorkEntry, ParsedWorkspace, ProjectRoot, RequirementRecord } from "../types.js";

// FR-PARSE-030: dedup identity for a Completed Work Log row. Scope is part of the key so that
// rows differing only by scope are treated as distinct entries (FND-005).
function completedWorkKey(entry: CompletedWorkEntry): string {
  return [
    entry.date,
    entry.target,
    entry.scope,
    entry.requirementIds.join(","),
    entry.summary,
    entry.reportPaths.join(",")
  ].join("\u0000");
}

function stepNameFromRelPath(rel: string): string | undefined {
  const marker = "docs/spec/steps/";
  const idx = rel.indexOf(marker);
  if (idx < 0) return undefined;
  const segments = rel.slice(idx + marker.length).split("/");
  return segments.length >= 2 ? segments[0] : undefined;
}

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
  // FR-PARSE-030: dual-read merge. The history file rows are appended after the index
  // (and 05.completed-work.md) rows; a row identical across sources is deduped and reported
  // once via SRS-W025 at the history file location. The dedup key includes Scope so that two
  // rows differing only by scope both survive (FND-005).
  if (discovered.completedWorkLog) {
    const historyEntries = parseCompletedWork(discovered.completedWorkLog);
    const seen = new Set(index.completedWork.map(completedWorkKey));
    for (const entry of historyEntries) {
      const key = completedWorkKey(entry);
      if (seen.has(key)) {
        diagnostics.push(
          diagnostic(
            "SRS-W025",
            "warning",
            `Completed Work Log row is duplicated across the index and history file: ${entry.date} ${entry.summary}`,
            {
              ...(entry.filePath ? { filePath: entry.filePath } : {}),
              ...(typeof entry.line === "number" ? { line: entry.line } : {})
            }
          )
        );
        continue;
      }
      seen.add(key);
      index.completedWork.push(entry);
    }
  }

  const records = [];
  for (const file of discovered.scopeFiles) {
    const scanned = scanRequirementBlocks(file.lines, file.relativePath);
    diagnostics.push(...scanned.diagnostics);
    for (const block of scanned.blocks) {
      const parsed = toRequirementRecord(file, block, scanned.lines);
      records.push(parsed.record);
      diagnostics.push(...parsed.diagnostics);
    }
  }
  const stepRecords: RequirementRecord[] = [];
  for (const file of discovered.stepFiles) {
    const stepName = stepNameFromRelPath(file.relativePath);
    const scanned = scanRequirementBlocks(file.lines, file.relativePath);
    diagnostics.push(...scanned.diagnostics);
    for (const block of scanned.blocks) {
      const parsed = toRequirementRecord(file, block, scanned.lines);
      stepRecords.push(stepName ? { ...parsed.record, stepName } : parsed.record);
      diagnostics.push(...parsed.diagnostics);
    }
  }

  const files = srsDocumentFiles(discovered);
  return {
    root,
    index,
    files,
    records,
    diagnostics,
    specDocuments: discovered.specDocuments,
    ...(discovered.stateFile ? { stateFile: discovered.stateFile } : {}),
    stepRecords
  };
}
