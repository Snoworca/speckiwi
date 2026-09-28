import type { AcceptanceCriterion, Diagnostic, RequirementRecord } from "../types.js";
import { REQ_MARKER_SOURCE, REQUIREMENT_ID_SOURCE, requirementIdsIn, sdsContractIdsIn } from "../testing/test-citations.js";

// @req FR-NODE-209
//
// The lite profile of the SDS rules (docs/rule/SDS-MD-Rules §9): a body-scope design document under
// docs/sds/ that a coding agent reads and a checker parses. Everything here is a pure function of the
// document text and the requirement records, so the grammar is tested without a disk; reading the
// files is the job of check-sds.ts.
//
// The grammar keeps the machine markers to four — `@req`, `←`, `→` and `SDS-AC-n (<REQ-ID> AC-m)` —
// and treats every signature as opaque text: only the declared name is extracted from it.

/** A lite SDS longer than this many lines is refused; the work is split into more SDS files instead. */
export const LITE_SDS_LINE_CAP = 100;

/**
 * Every code the lite checks emit, with the severity it is emitted at. The rules document names the
 * same set (FR-NODE-209 AC-5), and its test derives the list from here.
 */
export const LITE_SDS_DIAGNOSTICS = {
  "SDS-E060": { severity: "error", title: "Lite SDS metadata field or section is missing" },
  "SDS-E061": { severity: "error", title: "Lite SDS exceeds the line cap" },
  "SDS-E062": { severity: "error", title: "@req names no existing requirement" },
  "SDS-E063": { severity: "error", title: "Acceptance contract line is malformed or duplicated, or its (REQ AC) reference does not resolve" },
  "SDS-E064": { severity: "error", title: "Acceptance contracts and Test Plan rows do not pair up with a valid test file" },
  "SDS-E065": { severity: "error", title: "→ target is not declared on an Interfaces line" },
  "SDS-E066": { severity: "error", title: "Malformed Depends line" },
  "SDS-E067": { severity: "error", title: "Malformed Files or symbol line" },
  "SDS-W068": { severity: "warning", title: "In-target requirement named by no @req" },
  "SDS-W069": { severity: "warning", title: "SDS file is not lite profile and was not checked" },
  "SDS-E070": { severity: "error", title: "Requirement listed in Requirements is named by no @req" }
} as const satisfies Record<string, { severity: "error" | "warning"; title: string }>;

export type LiteSdsCode = keyof typeof LITE_SDS_DIAGNOSTICS;

export function liteSdsDiagnostic(code: LiteSdsCode, message: string, filePath: string, line?: number, requirementId?: string): Diagnostic {
  return {
    code,
    severity: LITE_SDS_DIAGNOSTICS[code].severity,
    message,
    filePath,
    ...(typeof line === "number" ? { line } : {}),
    ...(requirementId ? { requirementId } : {})
  };
}

export interface LiteSdsFileEntry {
  /** Repository-relative POSIX path. */
  readonly path: string;
  readonly line: number;
  readonly responsibility: string;
  /** The `@req` ids written on this line. */
  readonly reqIds: string[];
  /** Test files of the Test Plan rows whose contracts point (→) at a symbol declared in this file. */
  readonly testFiles: string[];
}

export interface LiteSdsSymbol {
  readonly name: string;
  /** `Parent.member` for a member line, or the dotted name the signature itself carries. */
  readonly qualifiedName: string;
  readonly signature: string;
  readonly file: string;
  readonly line: number;
  readonly callers: string[];
  /** The ids written on this line together with those inherited from its file and parent symbol. */
  readonly reqIds: string[];
  /** The ids written on this line only. */
  readonly ownReqIds: string[];
}

export interface LiteSdsDependsChain {
  readonly line: number;
  /** Ordered layers; each layer is one or more module names, `*` standing alone in the first. */
  readonly layers: string[][];
}

export interface LiteSdsContract {
  readonly id: string;
  readonly line: number;
  readonly requirementId: string | null;
  readonly acId: string | null;
  readonly text: string;
  readonly targets: string[];
}

export interface LiteSdsTestPlanRow {
  readonly sdsAcId: string;
  readonly line: number;
  readonly testFiles: string[];
  readonly summary: string;
}

export interface LiteSdsDocument {
  readonly path: string;
  readonly lineCount: number;
  readonly metadata: Record<string, string>;
  readonly target: string | null;
  readonly status: string | null;
  readonly files: LiteSdsFileEntry[];
  readonly symbols: LiteSdsSymbol[];
  readonly depends: LiteSdsDependsChain[];
  readonly contracts: LiteSdsContract[];
  readonly testPlan: LiteSdsTestPlanRow[];
  /** Files paths ∪ Test Plan test files, sorted — what implementing this SDS may write. */
  readonly writeSet: string[];
  /** Every id an `@req` names on a Files or symbol line, sorted. */
  readonly reqIds: string[];
  /**
   * The optional `Requirements` metadata: the requirements this SDS is written for. When present it is
   * the scope of the no-`@req` check; when absent that scope is the Target's open requirements.
   */
  readonly requirementScope: { line: number; ids: string[] } | null;
}

export interface LiteSdsParse {
  readonly isLite: boolean;
  readonly document: LiteSdsDocument;
  /** Structural diagnostics: the ones that need no requirement records. */
  readonly diagnostics: Diagnostic[];
}

/** The slice of a requirement record the reference and coverage checks read. */
export type LiteSdsRequirement = Pick<RequirementRecord, "id" | "target" | "status"> & {
  readonly acceptanceCriteria: ReadonlyArray<Pick<AcceptanceCriterion, "id">>;
};

const REQUIRED_METADATA = ["Document Type", "Profile", "Target", "Status", "Date"] as const;
const SECTION_INTERFACES = "Interfaces";
const SECTION_FILES = "Files";
const SECTION_DEPENDS = "Depends";
const SECTION_CONTRACTS = "Acceptance Contracts";
const SECTION_TEST_PLAN = "Test Plan";

/** A status whose requirement is done or withdrawn, and so needs no design. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(["verified", "discarded"]);

const DECLARATION_KEYWORD =
  /\b(?:class|interface|type|enum|struct|trait|function|def|fn|func|const|let|var|val|module|namespace|record|object|protocol)\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/;
const DOTTED_IDENTIFIER = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;
const DEPENDS_MEMBER = /^[A-Za-z0-9_.@/-]+$/;
const CONTRACT_LINE = /^SDS-AC-(\d+)\b\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/;
const REFERENCE = new RegExp(`^\\s*(${REQUIREMENT_ID_SOURCE})\\s+(AC-\\d+)\\s*$`);
const ANNOTATION_MARKER = new RegExp(`←|${REQ_MARKER_SOURCE}`, "g");
/** A list item: a `-` or `*` bullet, or an ordered `1.` / `1)` item. */
const LIST_ITEM = /^(\s*)(?:[-*]|\d+[.)])\s+(.*)$/;
/** The opening or closing line of a fenced code block, whose contents are never read as structure. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

function stripTicks(value: string): string {
  return value.replace(/`/g, "").trim();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Lines of the text, not counting the empty string a trailing newline leaves. */
function countLines(lines: readonly string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

/** `## 1. Interfaces` and `## Interfaces` name the same section. */
function headingName(raw: string): string {
  return raw.replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim();
}

function tableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return undefined;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** Leading `code spans` of a bullet body, separated by `/`, `,` or whitespace, and the rest. */
function leadingSpans(body: string): { spans: string[]; rest: string } {
  const spans: string[] = [];
  let rest = body;
  for (;;) {
    const span = /^\s*`([^`]+)`/.exec(rest);
    if (!span) break;
    spans.push((span[1] as string).trim());
    rest = rest.slice(span[0].length);
    const separator = /^\s*[/,]?\s*(?=`)/.exec(rest);
    if (!separator) break;
    rest = rest.slice(separator[0].length);
  }
  return { spans, rest };
}

/** The responsibility or contract text, the `← callers` and the `@req` ids of a Files or symbol line. */
function annotations(rest: string): { text: string; callers: string[]; reqIds: string[] } {
  const body = rest.replace(/^\s*(?:—|–|-|:)\s*/, "");
  const markers = [...body.matchAll(ANNOTATION_MARKER)];
  const first = markers[0];
  const text = (first === undefined ? body : body.slice(0, first.index)).trim();
  const callers: string[] = [];
  const reqIds: string[] = [];
  markers.forEach((marker, index) => {
    const start = (marker.index ?? 0) + marker[0].length;
    const next = markers[index + 1];
    const segment = body.slice(start, next === undefined ? body.length : next.index);
    if (marker[0] === "←") {
      callers.push(...segment.split(",").map(stripTicks).filter((caller) => caller !== ""));
    } else {
      reqIds.push(...requirementIdsIn(segment));
    }
  });
  return { text, callers, reqIds };
}

/** Removes balanced `<…>` groups, so generic arguments never read as the declared name. */
function withoutGenerics(signature: string): string {
  let out = "";
  let depth = 0;
  for (const char of signature) {
    if (char === "<") depth += 1;
    else if (char === ">" && depth > 0) depth -= 1;
    else if (depth === 0) out += char;
  }
  return out;
}

/**
 * The declared name of one signature span: the identifier after a declaration keyword, else the last
 * identifier before the first `(`, `:` or `=` with generic groups ignored. The dotted form is kept so
 * `Store.touch(…)` declares both `touch` and `Store.touch`.
 */
export function declaredName(signature: string): { name: string; dotted: string } | undefined {
  const head = signature.split("(")[0] as string;
  const keyword = DECLARATION_KEYWORD.exec(head);
  const dotted = keyword
    ? (keyword[1] as string)
    : [...(withoutGenerics(head).split(/[:=]/)[0] ?? "").matchAll(DOTTED_IDENTIFIER)].pop()?.[0];
  if (dotted === undefined) return undefined;
  return { name: dotted.split(".").pop() as string, dotted };
}

/** A repository-relative path with `/` separators and no empty, `.` or trailing segment, or why it is not one. */
function normalisedPath(raw: string): { path: string } | { reason: string } {
  const value = raw.trim().replace(/\\/g, "/");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return { reason: `'${raw}' is absolute; write a repository-relative path` };
  const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return { reason: "the path is empty" };
  if (segments.includes("..")) return { reason: `'${raw}' leaves the repository root` };
  return { path: segments.join("/") };
}

/** The layers of one Depends line, or the reason it is malformed. */
function dependsLayers(body: string): { layers: string[][] } | { reason: string } {
  if (/[{}()[\]]/.test(body)) return { reason: "braces or brackets are not allowed; write one chain per line" };
  if (body.includes("->")) return { reason: "layers are separated by '→', not '->'" };
  const layers = body.split("→").map((layer) => layer.split(",").map(stripTicks));
  if (layers.length < 2) return { reason: "a chain needs at least two layers joined by '→'" };
  for (const [index, layer] of layers.entries()) {
    for (const member of layer) {
      if (member === "") return { reason: "a layer or a member is empty" };
      if (member === "*") {
        if (index !== 0 || layer.length !== 1) return { reason: "'*' may only stand alone as the first layer" };
        continue;
      }
      if (!DEPENDS_MEMBER.test(member)) return { reason: `'${member}' is not a module name` };
    }
  }
  return { layers };
}

interface MutableFile {
  path: string;
  line: number;
  responsibility: string;
  reqIds: string[];
}

interface FileItem {
  indent: number;
  body: string;
  lineNumber: number;
}

interface SymbolFrame {
  indent: number;
  symbol: LiteSdsSymbol | undefined;
}

// @req FR-NODE-209 AC-1 AC-2 AC-4
export function parseLiteSds(text: string, filePath: string): LiteSdsParse {
  const lines = text.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];
  const metadata: Record<string, string> = {};
  const metadataLines: Record<string, number> = {};
  const files: MutableFile[] = [];
  const symbols: LiteSdsSymbol[] = [];
  const depends: LiteSdsDependsChain[] = [];
  const contracts: LiteSdsContract[] = [];
  const testPlan: LiteSdsTestPlanRow[] = [];
  const seenSections = new Set<string>();

  let h2: string | undefined;
  let h3: string | undefined;
  const fileItems: FileItem[] = [];
  let fence: string | undefined;
  const invalidRows = new Set<number>();

  /** Reads one Acceptance Contracts line, declaring every SDS-AC it names. */
  const readContract = (text: string, listed: boolean, lineNumber: number): void => {
    const body = text.replace(/\*\*/g, "");
    const contract = CONTRACT_LINE.exec(body);
    const named = contract ? [`SDS-AC-${contract[1] as string}`] : [...new Set(sdsContractIdsIn(body))];
    if (named.length === 0) {
      diagnostics.push(liteSdsDiagnostic("SDS-E063", "Acceptance Contracts line is not an `SDS-AC-n (<REQ-ID> AC-m): WHEN … THE SYSTEM SHALL …` contract", filePath, lineNumber));
      return;
    }
    if (!contract) {
      diagnostics.push(liteSdsDiagnostic("SDS-E063", `${named.join(", ")} is not written as \`SDS-AC-n (<REQ-ID> AC-m): WHEN … THE SYSTEM SHALL …\``, filePath, lineNumber));
    } else if (!listed) {
      diagnostics.push(liteSdsDiagnostic("SDS-E063", "Acceptance Contracts line is not a list item `- SDS-AC-n (<REQ-ID> AC-m): WHEN … THE SYSTEM SHALL …`", filePath, lineNumber));
    }
    for (const id of named) {
      if (contracts.some((declared) => declared.id === id)) {
        diagnostics.push(liteSdsDiagnostic("SDS-E063", `${id} is declared more than once; give each contract its own number`, filePath, lineNumber));
        continue;
      }
      if (!contract) {
        contracts.push({ id, line: lineNumber, requirementId: null, acId: null, text: body, targets: [] });
        continue;
      }
      const reference = contract[2] === undefined ? null : REFERENCE.exec(contract[2]);
      if (!reference) {
        diagnostics.push(
          liteSdsDiagnostic(
            "SDS-E063",
            contract[2] === undefined
              ? `${id} carries no (<REQ-ID> AC-m) reference to the requirement criterion it interprets`
              : `${id} reference '(${contract[2]})' is not of the form (<REQ-ID> AC-m)`,
            filePath,
            lineNumber
          )
        );
      }
      const statement = contract[3] as string;
      const arrow = statement.lastIndexOf("→");
      const targets =
        arrow < 0
          ? []
          : statement
              .slice(arrow + 1)
              .split(",")
              .map((target) => stripTicks(target).replace(/\(\)$/, "").replace(/\.$/, ""))
              .filter((target) => target !== "");
      contracts.push({
        id,
        line: lineNumber,
        requirementId: reference ? (reference[1] as string) : null,
        acId: reference ? (reference[2] as string) : null,
        text: (arrow < 0 ? statement : statement.slice(0, arrow)).trim(),
        targets
      });
    }
  };

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const fenceLine = FENCE.exec(raw);
    if (fence !== undefined) {
      const closes = fenceLine !== null && (fenceLine[1] as string)[0] === fence[0] && (fenceLine[1] as string).length >= fence.length;
      if (closes) fence = undefined;
      return;
    }
    if (fenceLine) {
      fence = fenceLine[1] as string;
      return;
    }
    const heading = /^(#{2,3})\s+(.*?)\s*$/.exec(raw);
    if (heading) {
      const name = headingName(heading[2] as string);
      if ((heading[1] as string).length === 2) {
        h2 = name;
        h3 = undefined;
        seenSections.add(name);
      } else {
        h3 = name;
        if (h2 === SECTION_INTERFACES) seenSections.add(`${SECTION_INTERFACES}/${name}`);
      }
      return;
    }

    if (h2 === undefined) {
      const cells = tableCells(raw);
      if (cells && cells.length >= 2 && !isSeparatorRow(cells) && cells[0] !== "Field") {
        metadata[cells[0] as string] = stripTicks(cells[1] as string);
        metadataLines[cells[0] as string] = lineNumber;
      }
      return;
    }

    if (h2 === SECTION_TEST_PLAN) {
      const cells = tableCells(raw);
      if (!cells || isSeparatorRow(cells)) return;
      const id = stripTicks(cells[0] ?? "");
      if (!/^SDS-AC-\d+$/.test(id)) return;
      const testFiles: string[] = [];
      for (const named of (cells[1] ?? "").split(",").map(stripTicks)) {
        if (named === "" || named === "-") continue;
        const normalised = normalisedPath(named);
        if ("path" in normalised) testFiles.push(normalised.path);
        else {
          invalidRows.add(lineNumber);
          diagnostics.push(liteSdsDiagnostic("SDS-E064", `Test Plan row for ${id} names an invalid test file: ${normalised.reason}`, filePath, lineNumber));
        }
      }
      testPlan.push({ sdsAcId: id, line: lineNumber, testFiles, summary: (cells[2] ?? "").trim() });
      return;
    }

    // Everything the checked sections hold is a list item; a line in any other form would be read as
    // nothing, so it is reported in the section that would have read it.
    const item = LIST_ITEM.exec(raw);
    if (raw.trim() === "") return;

    // @req FR-NODE-209 AC-1 @req FR-NODE-210 AC-6 — every SDS-AC the section names becomes a contract,
    // however its line is written: one the grammar cannot read is reported, never dropped, so the Test
    // Plan check still reaches it. A full-profile design writes its contracts as plain lines (§3).
    if (h2 === SECTION_CONTRACTS) {
      readContract(item === null ? raw.trim() : (item[2] as string).trim(), item !== null, lineNumber);
      return;
    }
    if (h2 !== SECTION_INTERFACES) return;
    if (!item) {
      if (h3 === SECTION_DEPENDS) {
        diagnostics.push(liteSdsDiagnostic("SDS-E066", "Malformed Depends line: write each chain as a list item", filePath, lineNumber));
      } else if (h3 === SECTION_FILES) {
        diagnostics.push(liteSdsDiagnostic("SDS-E067", "Files line is not a list item; write one file or symbol per list item", filePath, lineNumber));
      }
      return;
    }
    const body = (item[2] as string).trim();
    if (h3 === SECTION_DEPENDS) {
      const parsed = dependsLayers(body);
      if ("reason" in parsed) diagnostics.push(liteSdsDiagnostic("SDS-E066", `Malformed Depends line: ${parsed.reason}`, filePath, lineNumber));
      else depends.push({ line: lineNumber, layers: parsed.layers });
      return;
    }
    if (h3 === SECTION_FILES) fileItems.push({ indent: (item[1] as string).replace(/\t/g, "  ").length, body, lineNumber });
  });

  // A Files entry is a list item at the list's own left margin, so a list indented as a whole reads the
  // same; a deeper item is a symbol of the entry above it.
  const baseIndent = Math.min(...fileItems.map((entry) => entry.indent));
  let currentFile: MutableFile | undefined;
  let entryFailed = false;
  let frames: SymbolFrame[] = [];
  for (const { indent, body, lineNumber } of fileItems) {
    const { spans, rest } = leadingSpans(body);
    if (indent <= baseIndent) {
      frames = [];
      currentFile = undefined;
      entryFailed = true;
      if (spans.length !== 1) {
        diagnostics.push(
          liteSdsDiagnostic(
            "SDS-E067",
            spans.length === 0 ? "Files entry carries no `path` span" : "Files entry names more than one path; write one file per line",
            filePath,
            lineNumber
          )
        );
        continue;
      }
      const normalised = normalisedPath(spans[0] as string);
      if ("reason" in normalised) {
        diagnostics.push(liteSdsDiagnostic("SDS-E067", `Files entry path is invalid: ${normalised.reason}`, filePath, lineNumber));
        continue;
      }
      const { text: responsibility, reqIds } = annotations(rest);
      currentFile = { path: normalised.path, line: lineNumber, responsibility, reqIds };
      files.push(currentFile);
      entryFailed = false;
      continue;
    }

    if (!currentFile) {
      // Under an entry that was itself refused, the entry's diagnostic already covers the line.
      if (!entryFailed) {
        diagnostics.push(liteSdsDiagnostic("SDS-E067", "Symbol line has no Files entry above it; an entry sits at the list's left margin", filePath, lineNumber));
      }
      continue;
    }
    if (spans.length === 0) {
      diagnostics.push(liteSdsDiagnostic("SDS-E067", "Symbol line carries no `signature` span", filePath, lineNumber));
      continue;
    }
    while (frames.length > 0 && (frames[frames.length - 1] as SymbolFrame).indent >= indent) frames.pop();
    const parent = frames[frames.length - 1]?.symbol;
    const { callers, reqIds: ownReqIds } = annotations(rest);
    const inherited = parent ? parent.reqIds : currentFile.reqIds;
    let last: LiteSdsSymbol | undefined;
    for (const signature of spans) {
      const declared = declaredName(signature);
      if (!declared) {
        diagnostics.push(liteSdsDiagnostic("SDS-E067", `No declared name can be read from \`${signature}\``, filePath, lineNumber));
        continue;
      }
      last = {
        name: declared.name,
        qualifiedName: parent ? `${parent.name}.${declared.name}` : declared.dotted,
        signature,
        file: currentFile.path,
        line: lineNumber,
        callers,
        reqIds: uniqueSorted([...inherited, ...ownReqIds]),
        ownReqIds: uniqueSorted(ownReqIds)
      };
      symbols.push(last);
    }
    frames.push({ indent, symbol: last });
  }

  const isLite = (metadata.Profile ?? "").toLowerCase() === "lite";
  if (!isLite) {
    const found = metadata.Profile === undefined ? "absent" : `'${metadata.Profile}'`;
    return {
      isLite,
      document: assemble(filePath, lines, metadata, metadataLines, files, symbols, depends, contracts, testPlan),
      diagnostics: [liteSdsDiagnostic("SDS-E060", `Metadata 'Profile' must be 'lite' for a lite SDS (found: ${found})`, filePath)]
    };
  }

  for (const field of REQUIRED_METADATA) {
    if ((metadata[field] ?? "") === "") diagnostics.push(liteSdsDiagnostic("SDS-E060", `Lite SDS metadata is missing '${field}'`, filePath));
  }
  if (metadata["Document Type"] !== undefined && metadata["Document Type"] !== "" && metadata["Document Type"].toLowerCase() !== "sds") {
    diagnostics.push(liteSdsDiagnostic("SDS-E060", `Metadata 'Document Type' must be 'sds' (found: '${metadata["Document Type"]}')`, filePath));
  }
  for (const [section, label] of [
    [SECTION_INTERFACES, `## ${SECTION_INTERFACES}`],
    [`${SECTION_INTERFACES}/${SECTION_FILES}`, `### ${SECTION_FILES} under ## ${SECTION_INTERFACES}`],
    [SECTION_CONTRACTS, `## ${SECTION_CONTRACTS}`],
    [SECTION_TEST_PLAN, `## ${SECTION_TEST_PLAN}`]
  ] as const) {
    if (!seenSections.has(section)) diagnostics.push(liteSdsDiagnostic("SDS-E060", `Lite SDS is missing the section ${label}`, filePath));
  }

  const lineCount = countLines(lines);
  if (lineCount > LITE_SDS_LINE_CAP) {
    diagnostics.push(liteSdsDiagnostic("SDS-E061", `Lite SDS has ${lineCount} lines, over the ${LITE_SDS_LINE_CAP}-line cap; split the work into more SDS files`, filePath));
  }

  for (const contract of contracts) {
    const rows = testPlan.filter((row) => row.sdsAcId === contract.id);
    // A row whose file was invalid has been reported at that row already.
    if (!rows.some((row) => row.testFiles.length > 0) && !rows.some((row) => invalidRows.has(row.line))) {
      diagnostics.push(
        liteSdsDiagnostic(
          "SDS-E064",
          rows.length === 0 ? `${contract.id} has no Test Plan row` : `${contract.id} has a Test Plan row that names no test file`,
          filePath,
          contract.line
        )
      );
    }
  }

  for (const row of testPlan) {
    if (!contracts.some((contract) => contract.id === row.sdsAcId)) {
      diagnostics.push(liteSdsDiagnostic("SDS-E064", `Test Plan row names ${row.sdsAcId}, which no Acceptance Contracts line declares`, filePath, row.line));
    }
  }

  const declared = new Set(symbols.flatMap((symbol) => [symbol.name, symbol.qualifiedName]));
  for (const contract of contracts) {
    for (const target of contract.targets) {
      if (!declared.has(target)) {
        diagnostics.push(liteSdsDiagnostic("SDS-E065", `${contract.id} points at \`${target}\`, which no Interfaces line declares`, filePath, contract.line));
      }
    }
  }

  return { isLite, document: assemble(filePath, lines, metadata, metadataLines, files, symbols, depends, contracts, testPlan), diagnostics };
}

function assemble(
  filePath: string,
  lines: readonly string[],
  metadata: Record<string, string>,
  metadataLines: Record<string, number>,
  files: readonly MutableFile[],
  symbols: readonly LiteSdsSymbol[],
  depends: readonly LiteSdsDependsChain[],
  contracts: readonly LiteSdsContract[],
  testPlan: readonly LiteSdsTestPlanRow[]
): LiteSdsDocument {
  // An empty or `-` Requirements cell names nothing, and reads as the field being absent.
  const scopeIds = [...new Set(requirementIdsIn(metadata.Requirements ?? ""))];
  const testFilesByFile = new Map<string, Set<string>>();
  for (const contract of contracts) {
    const planned = testPlan.filter((row) => row.sdsAcId === contract.id).flatMap((row) => row.testFiles);
    for (const target of contract.targets) {
      for (const symbol of symbols) {
        if (symbol.name !== target && symbol.qualifiedName !== target) continue;
        const bucket = testFilesByFile.get(symbol.file) ?? new Set<string>();
        for (const file of planned) bucket.add(file);
        testFilesByFile.set(symbol.file, bucket);
      }
    }
  }
  const testFiles = testPlan.flatMap((row) => row.testFiles);
  return {
    path: filePath,
    lineCount: countLines(lines),
    metadata,
    target: (metadata.Target ?? "") === "" ? null : (metadata.Target as string),
    status: (metadata.Status ?? "") === "" ? null : (metadata.Status as string),
    files: files.map((file) => ({ ...file, reqIds: uniqueSorted(file.reqIds), testFiles: uniqueSorted(testFilesByFile.get(file.path) ?? []) })),
    symbols: [...symbols],
    depends: [...depends],
    contracts: [...contracts],
    testPlan: [...testPlan],
    writeSet: uniqueSorted([...files.map((file) => file.path), ...testFiles]),
    reqIds: uniqueSorted([...files.flatMap((file) => file.reqIds), ...symbols.flatMap((symbol) => symbol.ownReqIds)]),
    requirementScope: scopeIds.length === 0 ? null : { line: metadataLines.Requirements ?? 0, ids: scopeIds }
  };
}

// @req FR-NODE-209 AC-2 — the checks that need the requirement records: an `@req` or a `(REQ AC)`
// that names nothing.
export function liteSdsReferenceDiagnostics(document: LiteSdsDocument, requirements: readonly LiteSdsRequirement[]): Diagnostic[] {
  // The first record of an id wins: the workspace lists body requirements before step ones.
  const byId = new Map<string, LiteSdsRequirement>();
  for (const requirement of requirements) if (!byId.has(requirement.id)) byId.set(requirement.id, requirement);
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<string>();
  const cite = (id: string, line: number): void => {
    if (byId.has(id) || reported.has(`${line}\u0000${id}`)) return;
    reported.add(`${line}\u0000${id}`);
    diagnostics.push(liteSdsDiagnostic("SDS-E062", `@req ${id} names no existing requirement`, document.path, line, id));
  };
  for (const file of document.files) for (const id of file.reqIds) cite(id, file.line);
  for (const symbol of document.symbols) for (const id of symbol.ownReqIds) cite(id, symbol.line);
  for (const id of document.requirementScope?.ids ?? []) {
    if (byId.has(id)) continue;
    diagnostics.push(
      liteSdsDiagnostic("SDS-E062", `Requirements metadata names ${id}, which is not an existing requirement`, document.path, document.requirementScope?.line, id)
    );
  }
  for (const contract of document.contracts) {
    if (contract.requirementId === null || contract.acId === null) continue;
    const requirement = byId.get(contract.requirementId);
    if (!requirement) {
      diagnostics.push(
        liteSdsDiagnostic("SDS-E063", `${contract.id} interprets ${contract.requirementId} ${contract.acId}, but ${contract.requirementId} does not exist`, document.path, contract.line, contract.requirementId)
      );
    } else if (!requirement.acceptanceCriteria.some((criterion) => criterion.id === contract.acId)) {
      diagnostics.push(
        liteSdsDiagnostic("SDS-E063", `${contract.id} interprets ${contract.requirementId} ${contract.acId}, but ${contract.requirementId} has no ${contract.acId}`, document.path, contract.line, contract.requirementId)
      );
    }
  }
  return diagnostics;
}

// @req FR-NODE-209 AC-2 @req FR-FLOW-182 AC-3 — an in-scope requirement that no `@req` names. An SDS
// whose `Requirements` metadata lists its scope is checked against that list alone, and a miss is the
// error SDS-E070: the SDS declared the requirement in scope, so its design must name it before the SDS
// can be agreed. Without the field the scope is the
// Target's open requirements, and the union is taken over every lite SDS of that target, because work
// too large for one file is split across several (FR-FLOW-182 AC-5); that warning lands on the first
// unscoped document of the target in the order given.
export function liteSdsCoverageDiagnostics(documents: readonly LiteSdsDocument[], requirements: readonly LiteSdsRequirement[]): Diagnostic[] {
  const known = new Set(requirements.map((requirement) => requirement.id));
  const diagnostics: Diagnostic[] = [];
  for (const document of documents) {
    if (document.requirementScope === null) continue;
    const named = new Set(document.reqIds);
    // A listed id that names no requirement is SDS-E062 already.
    for (const id of document.requirementScope.ids) {
      if (!known.has(id) || named.has(id)) continue;
      diagnostics.push(liteSdsDiagnostic("SDS-E070", `${id} is listed in Requirements but no @req in ${document.path} names it`, document.path, document.requirementScope.line, id));
    }
  }

  const byTarget = new Map<string, LiteSdsDocument[]>();
  for (const document of documents) {
    if (document.target === null) continue;
    const group = byTarget.get(document.target) ?? [];
    group.push(document);
    byTarget.set(document.target, group);
  }
  for (const [target, group] of byTarget) {
    const anchor = group.find((document) => document.requirementScope === null);
    if (anchor === undefined) continue;
    const named = new Set(group.flatMap((document) => document.reqIds));
    const paths = group.map((document) => document.path).join(", ");
    for (const requirement of [...requirements].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (requirement.target !== target || CLOSED_STATUSES.has(requirement.status) || named.has(requirement.id)) continue;
      diagnostics.push(
        liteSdsDiagnostic("SDS-W068", `${requirement.id} is in target ${target} but no @req in ${paths} names it`, anchor.path, undefined, requirement.id)
      );
    }
  }
  return diagnostics;
}

export interface LiteSdsSummary {
  readonly target: string | null;
  readonly status: string | null;
  readonly files: string[];
  readonly testFiles: string[];
  readonly requirementIds: string[];
  readonly sdsAcs: Array<{ id: string; requirementId: string | null; acId: string | null; targets: string[] }>;
  readonly depends: string[][][];
  readonly writeSet: string[];
  /** The `Requirements` metadata list, or null when the SDS is scoped by its Target. */
  readonly requirementScope: string[] | null;
}

// @req IR-CLI-102 AC-1 — the parsed summary `speckiwi sds check` prints beside the diagnostics.
export function summarizeLiteSds(document: LiteSdsDocument): LiteSdsSummary {
  return {
    target: document.target,
    status: document.status,
    files: document.files.map((file) => file.path),
    testFiles: uniqueSorted(document.testPlan.flatMap((row) => row.testFiles)),
    requirementIds: document.reqIds,
    sdsAcs: document.contracts.map(({ id, requirementId, acId, targets }) => ({ id, requirementId, acId, targets })),
    depends: document.depends.map((chain) => chain.layers),
    writeSet: document.writeSet,
    requirementScope: document.requirementScope?.ids ?? null
  };
}
