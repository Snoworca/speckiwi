import path from "node:path";
import { access } from "node:fs/promises";
import type { ParsedWorkspace } from "../types.js";

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

function markdownLinks(value: string): string[] {
  return [...value.matchAll(/\[[^\]]+]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
}

/** A trailing line designation, in either the dash-range or the colon-column spelling. */
const LINE_SUFFIX = /:\d+(?:[-:]\d+)?$/;
/** A reference that names a file: one token, an extension, no whitespace. */
const REPOSITORY_PATH = /^[A-Za-z0-9_.@/-]+\.[A-Za-z0-9]+$/;

/**
 * FR-NODE-206 — the files a Trace Link of a type other than Requirement names.
 *
 * Those rows went unread by THIS checker whatever they said, which is how a source edit could move a
 * line out from under a designation with nothing reddening. They were not unread altogether: the
 * `traceReference` filter keys on the cell whole, suffix and all, so a suffixed row answered its own
 * exact spelling and nothing else — dropping the suffix put 73 requirements within reach of the path
 * they always named, and cost no row the reference it had. The reference field is not always a path:
 * it also holds a task id, a requirement id and a sentence, so a candidate has to look like a file
 * before it is resolved as one — an extension is what separates `read.ts` from `T-PH001-02`.
 *
 * The line suffix goes before the path does, following what release readiness does with the
 * Verification Evidence reference — a different field, so a precedent rather than a second reader of
 * this one — because what this reports is whether the path resolves and not whether the line still
 * holds what the row describes. Resolution is exact from the workspace root and never by basename:
 * falling back to a basename search silently resolved twenty designations at a path no branch has
 * ever held onto a different file and scored them fresh.
 */
function referencedPaths(reference: string): string[] {
  return reference
    .split(";")
    .map((part) => part.trim().replace(/#.*$/, "").replace(LINE_SUFFIX, ""))
    .filter((part) => REPOSITORY_PATH.test(part));
}

export async function checkLinks(workspace: ParsedWorkspace): Promise<LinkCheckResult> {
  const ids = new Set(workspace.records.map((record) => record.id));
  const broken: LinkCheckResult["broken"] = [];
  let checked = 0;
  for (const record of workspace.records) {
    for (const link of markdownLinks(record.metadata["Related Docs"] ?? "")) {
      checked += 1;
      if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+$/.test(link)) continue;
      if (/^https?:\/\//.test(link)) continue;
      const absolute = path.resolve(workspace.root.root, "docs", "spec", path.normalize(link));
      if (!(await exists(absolute))) {
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
      for (const referenced of referencedPaths(trace.reference)) {
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
  return { checked, broken, networkAccess: false };
}
