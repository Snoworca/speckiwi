import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { PREFIX_TYPE, type ChangeNoteRow, type Diagnostic, type EvidenceRow, type Priority, type RequirementRecord, type Risk, type Stability, type TextFile, type TraceLink } from "../types.js";
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

function parseSectionTable(section: SectionRange | undefined, file: TextFile, requirementId: string, diagnosticCode?: "SRS-W016" | "SRS-W017", tableLabel = "Markdown"): { table?: ParsedTable; diagnostics: Diagnostic[] } {
  if (!section) return { diagnostics: [] };
  const options = {
    filePath: file.relativePath,
    lineOffset: section.contentStartLine - 1,
    requirementId,
    tableLabel,
    ...(diagnosticCode ? { diagnosticCode } : {})
  };
  return parseMarkdownTableResult(section.lines, 0, options);
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

function isPlaceholderCell(value: string): boolean {
  const normalized = value.trim();
  return normalized === "" || normalized === "-";
}

// @req FR-PARSE-019
function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

// @req FR-PARSE-019
function markdownLinkTargets(value: string): string[] {
  return [...value.matchAll(/\[[^\]]+]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
}

// @req FR-PARSE-019
function splitReferenceTokens(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((token) => token.trim())
    .filter((token) => !isPlaceholderCell(token));
}

// @req FR-PARSE-019
function normalizeReferenceToken(value: string, baseFilePath: string): string {
  const trimmed = value.trim();
  if (!trimmed || isPlaceholderCell(trimmed)) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed.replace(/#.*$/, "");
  const withoutFragment = trimmed.replace(/#.*$/, "").replace(/\\/g, "/");
  if (!withoutFragment) return "";
  if (withoutFragment.startsWith("./") || withoutFragment.startsWith("../")) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(baseFilePath), withoutFragment));
  }
  return path.posix.normalize(withoutFragment.replace(/^\/+/, ""));
}

// @req FR-PARSE-019
function relatedDocsFromMetadata(value: string | undefined, filePath: string): string[] {
  if (!value || isPlaceholderCell(value)) return [];
  const markdownTargets = markdownLinkTargets(value);
  const tokens = markdownTargets.length > 0 ? markdownTargets : splitReferenceTokens(value);
  return unique(tokens.map((token) => normalizeReferenceToken(token, filePath)));
}

// @req FR-PARSE-019
function evidenceReferencesFromRows(rows: EvidenceRow[], filePath: string): string[] {
  return unique(rows.flatMap((row) => splitReferenceTokens(row.reference).map((token) => normalizeReferenceToken(token, filePath))));
}

// @req FR-PARSE-019
function traceReferencesFromRows(rows: TraceLink[], filePath: string): string[] {
  return unique(rows.map((row) => normalizeReferenceToken(row.reference, filePath)));
}

// @req FR-PARSE-019
function newWorkCandidateFor(record: Pick<RequirementRecord, "status" | "stability">): boolean {
  return (record.status === "planned" || record.status === "in_progress" || record.status === "blocked") && record.stability !== "draft" && record.stability !== "deprecated";
}

function changeNotesFromTable(table: ParsedTable | undefined): ChangeNoteRow[] {
  return (table?.rows ?? [])
    .map((row, index) => {
      const line = table?.rowLines[index];
      return {
        date: row.Date ?? "",
        change: row.Change ?? "",
        reason: row.Reason ?? "",
        ...(typeof line === "number" ? { line } : {})
      };
    })
    .filter((row) => ![row.date, row.change, row.reason].every(isPlaceholderCell));
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
  const evidenceRows = evidenceRowsFromTable(verificationEvidence.table);
  const traceRows = traceLinksFromTable(traceLinks.table);
  const changeNotes = parseSectionTable(sections["Change Notes"], file, block.heading.id, undefined, "Change Notes");
  diagnostics.push(...changeNotes.diagnostics);
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
    ...(block.heading.marker ? { marker: block.heading.marker } : {}),
    metadata,
    acceptanceCriteria: acceptanceCriteria.criteria,
    verificationEvidence: evidenceRows,
    traceLinks: traceRows,
    changeNotes: changeNotesFromTable(changeNotes.table),
    tags,
    relatedDocs: relatedDocsFromMetadata(metadata["Related Docs"], file.relativePath),
    evidenceReferences: evidenceReferencesFromRows(evidenceRows, file.relativePath),
    traceReferences: traceReferencesFromRows(traceRows, file.relativePath),
    markdown: file.lines.slice(block.startLine - 1, block.endLine).join(file.newline),
    blockStartLine: block.startLine,
    blockEndLine: block.endLine,
    sectionLines: Object.fromEntries(Object.entries(sections).map(([name, section]) => [name, section.startLine]))
  };
  if (metadata.Priority) record.priority = metadata.Priority as Priority;
  if (metadata.Risk) record.risk = metadata.Risk as Risk;
  if (metadata.Stability) record.stability = metadata.Stability as Stability;
  record.newWorkCandidate = newWorkCandidateFor(record);
  const requirement = sectionText(sections.Requirement?.lines);
  if (requirement) record.requirement = requirement;
  const rationale = sectionText(sections.Rationale?.lines);
  if (rationale) record.rationale = rationale;
  const research = sectionText(sections["Research / Analysis"]?.lines);
  if (research) record.research = research;
  const implementationNotes = sectionText(sections["Implementation Notes"]?.lines);
  if (implementationNotes) record.implementationNotes = implementationNotes;
  return { record, diagnostics };
}

export function getRequirementMarkdown(records: RequirementRecord[], id: string): string | undefined {
  return records.find((record) => record.id === id)?.markdown;
}

// FR-NODE-046 — full-text search core query over requirement records.
//
// Returns the records whose searchable text contains the caller-supplied `query`
// substring, deterministically ordered by requirement id. The searchable text
// spans at least the requirement statement, the heading title, and the
// acceptance criteria text. This is a free-text engine distinct from the
// supersedes trace-search helper (src/core/mutation/trace-search.ts), which
// resolves incoming rows by an exact type/relation/reference filter.
function searchableText(record: RequirementRecord): string {
  return [record.title, record.requirement ?? "", ...record.acceptanceCriteria.map((ac) => ac.text)].join("\n");
}

// @req FR-NODE-046
export function searchRequirementRecords(records: readonly RequirementRecord[], query: string): RequirementRecord[] {
  return records
    .filter((record) => searchableText(record).includes(query))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
