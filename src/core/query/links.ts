import path from "node:path";
import { access } from "node:fs/promises";
import type { ParsedWorkspace } from "../types.js";

export interface LinkCheckResult {
  checked: number;
  broken: Array<{ requirementId: string; reference: string; reason: string }>;
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
        broken.push({ requirementId: record.id, reference: link, reason: "local file missing" });
      }
    }
    const issue = record.metadata["GitHub Issue"];
    if (issue && issue !== "-") {
      checked += 1;
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(issue)) {
        broken.push({ requirementId: record.id, reference: issue, reason: "invalid GitHub issue URL" });
      }
    }
    for (const trace of record.traceLinks) {
      if (trace.type === "Requirement") {
        checked += 1;
        if (!ids.has(trace.reference)) {
          broken.push({ requirementId: record.id, reference: trace.reference, reason: "requirement missing" });
        }
      }
    }
  }
  return { checked, broken, networkAccess: false };
}
