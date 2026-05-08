import { PREFIX_TYPE, type Priority, type RequirementRecord, type Risk, type Stability, type TextFile } from "../types.js";
import type { RequirementBlockRange } from "../parser/block-scanner.js";
import { parseMetadataTable } from "../parser/metadata-table.js";
import { parseRequirementSections } from "../parser/section-parser.js";
import { parseAcceptanceCriteria } from "../parser/ac-parser.js";
import { parseEvidenceTable } from "../parser/evidence-parser.js";
import { parseTraceLinksTable } from "../parser/trace-parser.js";

function sectionText(lines: string[] | undefined): string | undefined {
  if (!lines) return undefined;
  const text = lines.join("\n").trim();
  return text || undefined;
}

export function toRequirementRecord(file: TextFile, block: RequirementBlockRange): RequirementRecord {
  const { metadata } = parseMetadataTable(block, file.lines);
  const sections = parseRequirementSections(block, file.lines);
  const prefix = block.heading.id.split("-")[0] as keyof typeof PREFIX_TYPE;
  const type = (metadata.Type || PREFIX_TYPE[prefix]) as RequirementRecord["type"];
  const target = metadata.Target || "";
  const status = (metadata.Status || "planned") as RequirementRecord["status"];
  const tags = (metadata.Tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const scope = metadata.Scope || block.heading.id.split("-")[1] || "";
  const record: RequirementRecord = {
    id: block.heading.id,
    title: block.heading.title,
    type,
    target,
    status,
    scope,
    filePath: file.relativePath,
    headingLine: block.startLine,
    metadata,
    acceptanceCriteria: parseAcceptanceCriteria(sections["Acceptance Criteria"]),
    verificationEvidence: parseEvidenceTable(sections["Verification Evidence"]),
    traceLinks: parseTraceLinksTable(sections["Trace Links"]),
    tags,
    markdown: file.lines.slice(block.startLine - 1, block.endLine).join(file.newline),
    blockStartLine: block.startLine,
    blockEndLine: block.endLine,
    sectionLines: Object.fromEntries(Object.entries(sections).map(([name, section]) => [name, section.startLine]))
  };
  if (metadata.Priority) record.priority = metadata.Priority as Priority;
  if (metadata.Risk) record.risk = metadata.Risk as Risk;
  if (metadata.Stability) record.stability = metadata.Stability as Stability;
  const requirement = sectionText(sections.Requirement?.lines);
  if (requirement) record.requirement = requirement;
  const rationale = sectionText(sections.Rationale?.lines);
  if (rationale) record.rationale = rationale;
  return record;
}

export function getRequirementMarkdown(records: RequirementRecord[], id: string): string | undefined {
  return records.find((record) => record.id === id)?.markdown;
}
