import { readFile } from "node:fs/promises";
import path from "node:path";
import { splitDiagnostics } from "../diagnostic.js";
import { parseStepState } from "../parser/index-parser.js";
import { isSafeTaskName } from "../step-name.js";
import type { Diagnostic, DiagnosticLocation, ParsedWorkspace, ProjectRoot, StepStateEntry, ValidationResult } from "../types.js";

// @req FR-PARSE-027 FR-PARSE-028 FR-PARSE-033 IR-CLI-046 FR-MCP-040
//
// validateWorkspaceScoped runs a single step-local validation pass over an already
// parsed workspace. It is the core the CLI `speckiwi step validate <name>` (IR-CLI-046)
// and MCP `validate_step` (FR-MCP-040) surfaces both compose over: given a step name it
//   1. scopes parse-time diagnostics to docs/spec/steps/<step>/ (so a body-scope error
//      never flips the step exit code, and a step-anchored parse error does), and
//   2. adds the step advisory rules — SRS-W044 (a step requirement shadows a body
//      requirement id), SRS-W045 (step overload at threshold >= 7), and a STEP_* namespace
//      advisory (a direct same-requirement conflict with another active step) — all as
//      non-gate-failing warnings.
//
// SRS-W044 / SRS-W045 / STEP_* live in a namespace registered separately from this module
// (FR-PARSE-028 diagnostic registry). To keep the step-local pass self-contained and free
// of the body-scope rule set, the advisories are constructed structurally here rather than
// through the registry-backed diagnostic() helper.

const STEP_OVERLOAD_THRESHOLD = 7;

// @req FR-PARSE-033 — tdd-mode SDS advisory constants. REQUIRED_SDS_HEADINGS is exported so the
// FR-NODE-080 scaffold template renders exactly the heading set this validator checks (no drift).
const SDS_LINE_CAP = 200;
export const REQUIRED_SDS_HEADINGS = [
  "Context & Scope",
  "Goals / Non-goals",
  "Architecture Decisions",
  "Interfaces",
  "Acceptance Contracts",
  "Test Plan",
  "Open Questions"
] as const;

// @req FR-PARSE-033 @req FR-PARSE-040
/** One step-local markdown file (design.md, intent.md) as loaded for the SDS pass. */
export interface StepFileInput {
  present: boolean;
  lines: readonly string[];
}

// @req FR-PARSE-033 @req FR-PARSE-040
/**
 * Loads one file under docs/spec/steps/<step>/ for the SDS pass. Neither design.md nor intent.md is
 * part of ParsedWorkspace (discovery only reads .srs.md files and state.md), so the CLI/MCP surfaces
 * load them here and hand them to validateWorkspaceScoped.
 */
async function loadStepFile(root: ProjectRoot, stepName: string, fileName: string): Promise<StepFileInput> {
  // FR-PARSE-033 AC-5: a non-single-segment step name never resolves a path outside docs/spec/steps.
  if (!isSafeTaskName(stepName)) {
    return { present: false, lines: [] };
  }
  try {
    const text = await readFile(path.join(root.root, "docs", "spec", "steps", stepName, fileName), "utf8");
    return { present: true, lines: text.split(/\r?\n/) };
  } catch {
    return { present: false, lines: [] };
  }
}

// @req FR-PARSE-033
/** The step's design.md — the authored SDS the advisories read. */
export async function loadStepDesign(root: ProjectRoot, stepName: string): Promise<StepFileInput> {
  return loadStepFile(root, stepName, "design.md");
}

// @req FR-PARSE-040
/** The step's intent.md — where a decision to skip the SDS is recorded, if it was recorded at all. */
export async function loadStepIntent(root: ProjectRoot, stepName: string): Promise<StepFileInput> {
  return loadStepFile(root, stepName, "intent.md");
}

export interface ScopedValidationOptions {
  /** The step name (docs/spec/steps/<step>/) whose local diagnostics to compute. */
  step: string;
  /** FR-PARSE-033 — the step's design.md, loaded by the surface; absent when omitted. */
  design?: StepFileInput;
  /**
   * FR-PARSE-040 — the step's intent.md, which is where a skip decision is recorded.
   *
   * Omitting it reads as "no record", which is the failing side of the gate. That default is
   * deliberate: a surface that forgets to load the file reports an unrecorded skip loudly instead of
   * silently excusing every skip, which is the failure mode this requirement exists to remove.
   */
  intent?: StepFileInput;
}

function stepPathSegment(stepName: string): string {
  return `docs/spec/steps/${stepName}/`;
}

function normalizePath(filePath: string | undefined): string {
  return (filePath ?? "").replace(/\\/g, "/");
}

// @req FR-PARSE-028
/** Construct an advisory warning outside the registry-backed diagnostic() helper. */
function advisory(code: string, message: string, location: DiagnosticLocation = {}): Diagnostic {
  return {
    code,
    severity: "warning",
    message,
    ...(location.filePath ? { filePath: location.filePath } : {}),
    ...(typeof location.line === "number" ? { line: location.line } : {}),
    ...(location.requirementId ? { requirementId: location.requirementId } : {})
  };
}

// @req FR-PARSE-028
/** Split a TouchesReq / DependsOn cell (comma/space separated) into its tokens. */
function parseCellTokens(cell: string): string[] {
  return cell
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token !== "" && token !== "-");
}

// @req FR-PARSE-028
/** Only steps still in flight participate in the direct-conflict advisory. */
function isActiveStep(entry: StepStateEntry): boolean {
  return entry.status === "active" || entry.status === "merging";
}

// @req FR-PARSE-028
/**
 * The active peer steps that share a touched requirement with the named step. An empty
 * list means no direct same-requirement conflict. The named step must itself be active for
 * the advisory to apply; a step never conflicts with itself.
 */
function directConflictPeers(workspace: ParsedWorkspace, stepName: string): string[] {
  const stateFile = workspace.stateFile;
  if (!stateFile) return [];
  const entries = parseStepState(stateFile.lines);
  const self = entries.find((entry) => entry.step === stepName);
  if (!self || !isActiveStep(self)) return [];
  const selfReqs = new Set(parseCellTokens(self.touchesReq));
  if (selfReqs.size === 0) return [];
  const peers: string[] = [];
  for (const entry of entries) {
    if (entry.step === stepName || !isActiveStep(entry)) continue;
    if (parseCellTokens(entry.touchesReq).some((req) => selfReqs.has(req))) {
      peers.push(entry.step);
    }
  }
  return peers;
}

// @req FR-PARSE-027 FR-PARSE-028
export function validateWorkspaceScoped(workspace: ParsedWorkspace, options: ScopedValidationOptions): ValidationResult {
  const stepName = options.step;
  const segment = stepPathSegment(stepName);
  const diagnostics: Diagnostic[] = [];

  // 1. Parse-time diagnostics anchored under this step's file tree (errors + warnings).
  //    Body-scope diagnostics (00.index.md, non-step scope files) are excluded, so a body
  //    error never influences the step exit code and a step-anchored error always does.
  for (const item of workspace.diagnostics) {
    if (normalizePath(item.filePath).includes(segment)) {
      diagnostics.push(item);
    }
  }

  const stepRecords = (workspace.stepRecords ?? []).filter((record) => record.stepName === stepName);

  // SRS-W044 step-shadows-body: a step requirement reuses a canonical body requirement id.
  const bodyIds = new Set(workspace.records.map((record) => record.id));
  for (const record of stepRecords) {
    if (bodyIds.has(record.id)) {
      diagnostics.push(
        advisory("SRS-W044", `Step requirement shadows body requirement id: ${record.id}`, {
          filePath: record.filePath,
          line: record.headingLine,
          requirementId: record.id
        })
      );
    }
  }

  // SRS-W045 step-overload: the step carries too many requirements (>= threshold).
  if (stepRecords.length >= STEP_OVERLOAD_THRESHOLD) {
    const anchor = stepRecords[0];
    diagnostics.push(
      advisory("SRS-W045", `Step '${stepName}' carries too many requirements: ${stepRecords.length}`, {
        ...(anchor ? { filePath: anchor.filePath, line: anchor.headingLine } : {})
      })
    );
  }

  // STEP_* advisory namespace: a direct same-requirement conflict with another active step.
  for (const peer of directConflictPeers(workspace, stepName)) {
    diagnostics.push(
      advisory("STEP_DIRECT_CONFLICT", `Step '${stepName}' directly conflicts with active step '${peer}' on a shared requirement`, {
        filePath: "docs/spec/steps/state.md"
      })
    );
  }

  // @req FR-PARSE-033 @req FR-PARSE-040 — SDS diagnostics, tdd work-mode only. All of them are
  // warnings that inform the step gate without flipping it, with one exception FR-PARSE-040 adds:
  // an SDS skipped without a recorded decision is SDS-E054, an error, because the alternative is a
  // rule and its own exemption living in the same file with nothing comparing them.
  const mode = workspace.stateFile ? parseStepState(workspace.stateFile.lines).mode : "wait";
  if (mode === "tdd") {
    diagnostics.push(
      ...sdsAdvisories(
        stepName,
        options.design ?? { present: false, lines: [] },
        options.intent ?? { present: false, lines: [] }
      )
    );
  }

  return splitDiagnostics(diagnostics);
}

// @req FR-PARSE-033
/** Lines of the section starting at the `##` heading containing `name`, up to the next `##`. */
function sdsSection(lines: readonly string[], name: string): readonly string[] {
  const isHeading = (line: string): boolean => /^##\s/.test(line);
  const start = lines.findIndex((line) => isHeading(line) && line.includes(name));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => isHeading(line));
  return end < 0 ? rest : rest.slice(0, end);
}

// @req FR-PARSE-040
/** The heading that opens the skip record inside intent.md. */
const SDS_SKIP_HEADING = "SDS Skip";

// @req FR-PARSE-040
/** The value cell of the first `| <field> | <value> |` row, or undefined when no such row exists. */
function skipRecordCell(lines: readonly string[], field: string): string | undefined {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const cells = trimmed.slice(1, -1).split("|");
    if (cells.length < 2) continue;
    if ((cells[0] ?? "").trim().toLowerCase() === field.toLowerCase()) return (cells[1] ?? "").trim();
  }
  return undefined;
}

// @req FR-PARSE-040
/**
 * Why this step's SDS skip does not hold, or undefined when it does.
 *
 * Every input lands on exactly one branch and the last branch is the only pass, so a record shape
 * nobody anticipated fails rather than slipping through — the denominator is the whole set of
 * intent.md files, not the ones this function happens to recognise. The three cells are checked
 * separately so the message can name the part that failed: "the record is bad" sends an author
 * hunting, "the Reason cell is empty" does not.
 *
 * The cells are a structure rather than a sentence on purpose. A free-prose skip note is the
 * self-declaration this gate replaces: every step would carry one reading "trivial", and the
 * comparison would be back to trusting the agent that benefits from the skip.
 */
function sdsSkipRecordFailure(intent: StepFileInput): string | undefined {
  if (!intent.present) return "intent.md is absent";
  const record = sdsSection(intent.lines, SDS_SKIP_HEADING);
  if (record.length === 0) return `intent.md has no '## ${SDS_SKIP_HEADING}' section`;
  const decision = skipRecordCell(record, "Decision");
  if (decision === undefined) return `the '${SDS_SKIP_HEADING}' section has no 'Decision' row`;
  if (decision.replace(/`/g, "").trim().toLowerCase() !== "skipped") {
    return `the 'Decision' cell reads '${decision}' rather than 'skipped'`;
  }
  const reason = skipRecordCell(record, "Reason");
  if (reason === undefined) return `the '${SDS_SKIP_HEADING}' section has no 'Reason' row`;
  if (reason === "" || reason === "-") return "the 'Reason' cell is empty";
  // The EARS shape is what keeps the stub a contract: an "SDS-AC-1" that states no condition and no
  // obligation carries none of what the skipped SDS would have carried.
  const hasEars = record.some((line) => /SDS-AC-\d+\s*:/.test(line) && /\bWHEN\b/.test(line) && /\bSHALL\b/.test(line));
  if (!hasEars) return `the '${SDS_SKIP_HEADING}' section carries no EARS 'SDS-AC-n: WHEN … SHALL …' line`;
  return undefined;
}

// @req FR-PARSE-033 @req FR-PARSE-040
/** SDS-W050..W053 advisories, plus the SDS-E054 skip-record error, over the tdd step's files. */
function sdsAdvisories(stepName: string, design: StepFileInput, intent: StepFileInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  const filePath = `docs/spec/steps/${stepName}/design.md`;
  if (!design.present) {
    const failure = sdsSkipRecordFailure(intent);
    out.push(
      failure === undefined
        ? advisory("SDS-W050", `SDS design.md is absent for tdd step '${stepName}'; the skip is recorded in intent.md`, {
            filePath
          })
        : {
            code: "SDS-E054",
            severity: "error",
            message: `SDS design.md is absent for tdd step '${stepName}' and the skip is not recorded: ${failure}`,
            filePath: `docs/spec/steps/${stepName}/intent.md`
          }
    );
    return out;
  }
  for (const heading of REQUIRED_SDS_HEADINGS) {
    if (!design.lines.some((line) => /^##\s/.test(line) && line.includes(heading))) {
      out.push(advisory("SDS-W051", `SDS design.md is missing the required heading: ${heading}`, { filePath }));
    }
  }
  const collectIds = (lines: readonly string[]): Set<string> => {
    const ids = new Set<string>();
    for (const line of lines) {
      for (const match of line.matchAll(/SDS-AC-\d+/g)) ids.add(match[0]);
    }
    return ids;
  };
  const declared = collectIds(sdsSection(design.lines, "Acceptance Contracts"));
  const mapped = collectIds(sdsSection(design.lines, "Test Plan"));
  for (const id of declared) {
    if (!mapped.has(id)) {
      out.push(advisory("SDS-W052", `SDS acceptance contract ${id} has no Test Plan mapping`, { filePath }));
    }
  }
  if (design.lines.length > SDS_LINE_CAP) {
    out.push(advisory("SDS-W053", `SDS design.md exceeds the ${SDS_LINE_CAP}-line cap: ${design.lines.length} lines`, { filePath }));
  }
  return out;
}
