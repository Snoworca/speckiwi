import path from "node:path";
import { access } from "node:fs/promises";
import { fileReferences, relatedDocsDestinations, relatedDocsPath, traceLinkPaths, type FileReference } from "../parser/file-references.js";
import { checkPrdReferenceFiles } from "../prd/files.js";
import type { ParsedWorkspace } from "../types.js";

/** Every file reference `links check` verifies: each requirement's Related Docs files and Trace Link paths. */
export function listFileReferences(workspace: ParsedWorkspace): FileReference[] {
  return workspace.records.flatMap(fileReferences);
}

export interface LinkCheckResult {
  checked: number;
  /**
   * FR-PARSE-036 — every entry carries the registered diagnostic code for its finding as well as the
   * reason text. The three checks below were the only implementation of `SRS-W003`, `SRS-W004` and the
   * evidence side of `SRS-E012`, and they reported free-text reasons a caller could not filter on,
   * which is how five dangling `Related Docs` paths survived two releases in this repository.
   */
  broken: Array<{ requirementId: string; reference: string; reason: string; code: string }>;
  networkAccess: false;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function checkLinks(workspace: ParsedWorkspace): Promise<LinkCheckResult> {
  const ids = new Set(workspace.records.map((record) => record.id));
  const broken: LinkCheckResult["broken"] = [];
  let checked = 0;
  for (const record of workspace.records) {
    for (const link of relatedDocsDestinations(record)) {
      checked += 1;
      const target = relatedDocsPath(link);
      if (target === undefined) continue;
      // An absolute target resolves to itself.
      if (!(await exists(path.resolve(workspace.root.root, target)))) {
        broken.push({ requirementId: record.id, reference: link, reason: "local file missing", code: "SRS-W003" });
      }
    }
    const issue = record.metadata["GitHub Issue"];
    if (issue && issue !== "-") {
      checked += 1;
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(issue)) {
        broken.push({ requirementId: record.id, reference: issue, reason: "invalid GitHub issue URL", code: "SRS-W004" });
      }
    }
    for (const trace of record.traceLinks) {
      if (trace.type === "Requirement") {
        checked += 1;
        if (!ids.has(trace.reference)) {
          broken.push({ requirementId: record.id, reference: trace.reference, reason: "requirement missing", code: "SRS-E012" });
        }
        continue;
      }
      for (const referenced of traceLinkPaths(trace)) {
        checked += 1;
        if (!(await exists(path.resolve(workspace.root.root, referenced)))) {
          broken.push({
            requirementId: record.id,
            reference: trace.reference,
            reason: `${trace.type} trace path missing: ${referenced}`,
            code: "SRS-W074"
          });
        }
      }
    }
  }
  // @req FR-NODE-242 AC-1 — a `docs/prd/<file>.prd.md#PRD-<n>` reference must name an item its PRD
  // holds. The file of a Trace path is already one of the file references checked above (SRS-W074),
  // so a Trace row adds only its item; a Rationale reference is checked for both.
  for (const problem of await checkPrdReferenceFiles(workspace.root.root, workspace.records)) {
    if (problem.field === "traceLinks" && problem.problem === "missing-file") continue;
    broken.push({
      requirementId: problem.requirementId,
      reference: problem.reference,
      reason: problem.problem === "missing-file" ? "PRD file missing" : `PRD item missing: ${problem.reference.slice(problem.reference.lastIndexOf("#") + 1)}`,
      code: "SRS-W079"
    });
  }
  return { checked, broken, networkAccess: false };
}
