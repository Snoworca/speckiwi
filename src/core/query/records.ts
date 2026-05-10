import { diagnostic } from "../diagnostic.js";
import { PREFIX_TYPE, type Diagnostic, type EvidenceRow, type Priority, type RequirementRecord, type Risk, type Stability, type TextFile, type TraceLink } from "../types.js";
import type { RequirementBlockRange } from "../parser/block-scanner.js";
import { parseRequirementSections } from "../parser/section-parser.js";
import { parseAcceptanceCriteria } from "../parser/ac-parser.js";
import { parseMarkdownTableResult, parseMetadataRows } from "../parser/table.js";
import type { ParsedTable } from "../parser/table.js";
import type { SectionRange } from "../parser/section-parser.js";

function sectionText(lines: string[] | undefined): string | undefined {
  if (!lines) return undefined;
  const text = lines.join("\n").trim();
  return text || undefined;
}

export interface RequirementRecordResult {
  record: RequirementRecord;
  diagnostics: Diagnostic[];
}

function headingContainsForbiddenMarkdown(title: string): boolean {
  return (
    /\[[^\]]+\]\([^)]+\)/.test(title) ||
    /`[^`]+`/.test(title) ||
    /(^|[\s([{])(?:\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|_[^_\n]+_)(?=$|[\s)\]},.:;!?])/.test(title) ||
    /\p{Extended_Pictographic}/u.test(title)
  );
}

function parseSectionTable(section: SectionRange | undefined, file: TextFile, requirementId: string, diagnosticCode: "SRS-W016" | "SRS-W017", tableLabel: string): { table?: ParsedTable; diagnostics: Diagnostic[] } {
  if (!section) return { diagnostics: [] };
  return parseMarkdownTableResult(section.lines, 0, {
    filePath: file.relativePath,
    lineOffset: section.contentStartLine - 1,
    diagnosticCode,
    requirementId,
    tableLabel
  });
}

function evidenceRowsFromTable(table: ParsedTable | undefined): EvidenceRow[] {
  return (table?.rows ?? [])
    .map((row, index) => {
      const line = table?.rowLines[index];
      return {
        id: row["Evidence ID"] ?? "",
        type: row.Type ?? "",
        reference: row.Reference ?? "",
        covers: row.Covers ?? "",
        notes: row.Notes ?? "",
        ...(typeof line === "number" ? { line } : {})
      };
    })
    .filter((row) => row.id !== "" || row.type !== "" || row.reference !== "" || row.covers !== "" || row.notes !== "");
}

function traceLinksFromTable(table: ParsedTable | undefined): TraceLink[] {
  return (table?.rows ?? [])
    .map((row, index) => {
      const line = table?.rowLines[index];
      return {
        type: row.Type ?? "",
        reference: row.Reference ?? "",
        relation: row.Relation ?? "",
        notes: row.Notes ?? "",
        ...(typeof line === "number" ? { line } : {})
      };
    })
    .filter((row) => row.type !== "" || row.reference !== "" || row.relation !== "" || row.notes !== "");
}

export function toRequirementRecord(file: TextFile, block: RequirementBlockRange): RequirementRecordResult {
  const diagnostics: Diagnostic[] = [];
  const { metadata, diagnostics: metadataDiagnostics } = parseMetadataRows(file.lines, block.startLine, {
    filePath: file.relativePath,
    requirementId: block.heading.id
  });
  diagnostics.push(...metadataDiagnostics);
  const { sections, diagnostics: sectionDiagnostics } = parseRequirementSections(block, file.lines, file.relativePath);
  diagnostics.push(...sectionDiagnostics);
  const acceptanceCriteria = parseAcceptanceCriteria(sections["Acceptance Criteria"], file.relativePath, block.heading.id);
  diagnostics.push(...acceptanceCriteria.diagnostics);
  const verificationEvidence = parseSectionTable(sections["Verification Evidence"], file, block.heading.id, "SRS-W016", "Verification Evidence");
  diagnostics.push(...verificationEvidence.diagnostics);
  const traceLinks = parseSectionTable(sections["Trace Links"], file, block.heading.id, "SRS-W017", "Trace Links");
  diagnostics.push(...traceLinks.diagnostics);
  if (headingContainsForbiddenMarkdown(block.heading.title)) {
    diagnostics.push(
      diagnostic("SRS-E020", "error", `Requirement heading contains forbidden Markdown content: ${block.heading.id}`, {
        filePath: file.relativePath,
        line: block.startLine,
        requirementId: block.heading.id
      })
    );
  }
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
    acceptanceCriteria: acceptanceCriteria.criteria,
    verificationEvidence: evidenceRowsFromTable(verificationEvidence.table),
    traceLinks: traceLinksFromTable(traceLinks.table),
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
  return { record, diagnostics };
}

export function getRequirementMarkdown(records: RequirementRecord[], id: string): string | undefined {
  return records.find((record) => record.id === id)?.markdown;
}
