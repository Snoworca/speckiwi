// @req FR-NODE-154, FR-NODE-155, FR-NODE-156, FR-NODE-157, FR-NODE-109 — `validateHandoff` (05 §6).
//
// A handoff is the executing agent's *complete* input, read by a cold agent with no conversation, so
// every mechanical property of it is checkable rather than reviewed. Five layers, plus the schema
// checks that precede them; which layers apply is selected from `handoff_kind` (05 §6.2).
//
// The function is pure. Everything it needs from disk or from git arrives in `root`: the dispatch
// base is HEAD at Phase 3.f *plus the set of paths Phase 3.f-prime is about to stage*, because layer
// 4 runs one step before the commit whose sha would name it — which is also why a `base_sha`
// front-matter field is refused outright rather than resolved (05 §2.1 ordering rule 2).

import { maskExcludedConstructs, maskFencedBlocks } from "./prose-gate.js";

/** The ten required body headings, in the order §6.1's bolded sentence states them. */
export const HANDOFF_BODY_HEADINGS = ["Setup", "Objective", "Context", "Interfaces", "Tasks", "Acceptance", "Constraints", "Out of scope", "Manifest", "Escalation"] as const;

/** The thirteen per-task fields layer 1 counts, in §6.2 layer 1's order. */
export const HANDOFF_TASK_FIELDS = ["id", "type", "req_ids", "files", "test_files", "action", "acceptance_tests", "verification_cmd", "dod", "rollback", "covers_ac", "depends_on_task", "tdd"] as const;

export type HandoffTaskField = (typeof HANDOFF_TASK_FIELDS)[number];

/** §3.4's six array fields, which the manifest template carries as `[]` rather than as `null`. */
export const MANIFEST_TEMPLATE_ARRAY_FIELDS = ["written_paths", "commits", "commands_run", "acceptance_results", "red_evidence", "external_side_effects"] as const;

export const HANDOFF_KINDS = ["lane", "remediation", "epilogue"] as const;

export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export const BOOTSTRAP_KINDS = ["install", "assert", "record"] as const;

/**
 * The closed violation vocabulary. Three of the six are §13 gate ids; the other three report the
 * layers §13 covers through the round-invalidating rule rather than through a gate of their own.
 */
export const HANDOFF_VIOLATION_CODES = ["handoff-schema-invalid", "handoff-task-field-count", "handoff-set-inequality", "handoff-not-english", "handoff-unresolvable-reference", "handoff-untested-ac-over-cap"] as const;

export type HandoffViolationCode = (typeof HANDOFF_VIOLATION_CODES)[number];

export interface HandoffViolation {
  code: HandoffViolationCode;
  /** 0 for the schema checks that precede the layers; 1..5 for §6.2's five layers. */
  layer: 0 | 1 | 2 | 3 | 4 | 5;
  detail: string;
  expected?: number;
  actual?: number;
  /** 1-based document lines, on the violations that can name them. */
  lines?: number[];
}

/** The lane row `lanes.lock.json` records, narrowed to what §6.2 layers 1 and 2 compare against. */
export interface HandoffLane {
  laneId: string;
  /** The assignment for this handoff's kind. */
  taskIds: string[];
  /** `null` for an `epilogue` handoff, which has no lane row; §6.2 layer 2 computes it from the catalog. */
  writeSet: string[] | null;
}

/** One sidecar task, carrying the thirteen fields layer 1 counts. */
export interface HandoffCatalogTask {
  id: string;
  type?: string | null;
  req_ids?: string[] | null;
  files?: Array<{ path: string; line_range?: string }> | null;
  test_files?: string[] | null;
  action?: string | null;
  acceptance_tests?: string[] | null;
  verification_cmd?: { posix: string; windows: string } | null;
  dod?: string | null;
  rollback?: string | null;
  covers_ac?: string[] | null;
  depends_on_task?: string[] | null;
  tdd?: { phase: "red" | "green" } | null;
}

/**
 * The dispatch base and the lookups layer 4 resolves against, all injected.
 *
 * The impure collection stays in the CLI, the pattern §10.1 already uses for `groundFiles`.
 */
export interface HandoffRoot {
  /** Paths that exist at HEAD when layer 4 runs, at Phase 3.f. */
  headPaths: string[];
  /** Paths the Phase 3.f-prime commit is about to stage; together with `headPaths` this is the dispatch base. */
  stagedPaths: string[];
  /** Task ids present in the sidecar the handoff names. */
  sidecarTaskIds: string[];
  /** Requirement id to its acceptance criterion ids; an absent key is an unresolvable requirement. */
  requirementAcIds: Record<string, string[]>;
  /** `--allow-untested-ac N`, an absolute row count. Defaults to zero. */
  allowUntestedAc?: number;
}

export interface HandoffValidation {
  ok: boolean;
  violations: HandoffViolation[];
  /** The counters `lane-{k}.lock.json` records (§3.3a), plus the allowance in force when it was measured. */
  counts: {
    taskFieldCount: number;
    acceptanceRowCount: number;
    untestedRowCount: number;
    untestedAllowance: number;
    untestedCap: number;
  };
}

/** Hangul, CJK ideographs, Kana and Cyrillic — §6.2 layer 3's script set. */
const NON_LATIN_SCRIPT = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}]/u;

const SIDECAR_TASK_ID = /\bT-PH\d{3}-\d{2}\b/g;

const PATH_TOKEN = /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9]+/g;

const MINIMUM_UNTESTED_REASON = 20;

// ---------------------------------------------------------------------------------------------
// The YAML subset §6.1's front matter is written in.
//
// Purpose-built rather than general: the schema is closed and stated, and this repository ships no
// YAML dependency. It covers exactly what §6.1 and §6.3 use — block maps, block sequences of scalars
// and of maps, flow collections that may span lines, multi-line double-quoted scalars, and comments.
// ---------------------------------------------------------------------------------------------

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Reader {
  lines: string[];
  index: number;
}

const KEY = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** An out-of-range read is the empty string. `noUncheckedIndexedAccess` is on across this package. */
function charAt(text: string, position: number): string {
  return text[position] ?? "";
}

function lineAt(reader: Reader): string {
  return reader.lines[reader.index] ?? "";
}

function skipBlank(reader: Reader): void {
  while (reader.index < reader.lines.length) {
    const trimmed = lineAt(reader).trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) return;
    reader.index += 1;
  }
}

/** A trailing `# comment`, removed only when the hash sits outside a quoted run. */
function stripComment(text: string): string {
  let single = false;
  let double = false;
  for (let position = 0; position < text.length; position += 1) {
    const character = text[position];
    if (character === '"' && !single) double = !double;
    else if (character === "'" && !double) single = !single;
    else if (character === "#" && !single && !double && (position === 0 || /\s/.test(charAt(text, position - 1)))) return text.slice(0, position);
  }
  return text;
}

function unquote(text: string): string {
  return text.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseScalar(raw: string): YamlValue {
  const text = raw.trim();
  if (text === "" || text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) return unquote(text);
  return text;
}

function quoteClosed(text: string): boolean {
  let count = 0;
  for (let position = 0; position < text.length; position += 1) {
    if (text[position] === '"' && text[position - 1] !== "\\") count += 1;
  }
  return count >= 2;
}

function flowBalanced(text: string): boolean {
  let depth = 0;
  let quoted = false;
  for (let position = 0; position < text.length; position += 1) {
    const character = text[position];
    if (character === '"' && text[position - 1] !== "\\") quoted = !quoted;
    else if (!quoted && (character === "[" || character === "{")) depth += 1;
    else if (!quoted && (character === "]" || character === "}")) depth -= 1;
  }
  return depth === 0;
}

interface FlowReader {
  text: string;
  position: number;
}

function skipFlowSpace(flow: FlowReader): void {
  while (flow.position < flow.text.length && /\s/.test(charAt(flow.text, flow.position))) flow.position += 1;
}

function readFlowQuoted(flow: FlowReader): string {
  const quote = charAt(flow.text, flow.position);
  let value = quote;
  flow.position += 1;
  while (flow.position < flow.text.length) {
    const character = charAt(flow.text, flow.position);
    value += character;
    flow.position += 1;
    if (character === quote && charAt(flow.text, flow.position - 2) !== "\\") break;
  }
  return unquote(value);
}

function parseFlowValue(flow: FlowReader): YamlValue {
  skipFlowSpace(flow);
  const character = charAt(flow.text, flow.position);

  if (character === "[") {
    flow.position += 1;
    const items: YamlValue[] = [];
    for (;;) {
      skipFlowSpace(flow);
      if (flow.position >= flow.text.length) break;
      if (charAt(flow.text, flow.position) === "]") {
        flow.position += 1;
        break;
      }
      items.push(parseFlowValue(flow));
      skipFlowSpace(flow);
      if (charAt(flow.text, flow.position) === ",") flow.position += 1;
    }
    return items;
  }

  if (character === "{") {
    flow.position += 1;
    const map: { [key: string]: YamlValue } = {};
    for (;;) {
      skipFlowSpace(flow);
      if (flow.position >= flow.text.length) break;
      if (charAt(flow.text, flow.position) === "}") {
        flow.position += 1;
        break;
      }
      let key = "";
      while (flow.position < flow.text.length && charAt(flow.text, flow.position) !== ":") {
        key += charAt(flow.text, flow.position);
        flow.position += 1;
      }
      flow.position += 1;
      map[key.trim().replace(/^["']|["']$/g, "")] = parseFlowValue(flow);
      skipFlowSpace(flow);
      if (charAt(flow.text, flow.position) === ",") flow.position += 1;
    }
    return map;
  }

  if (character === '"' || character === "'") return readFlowQuoted(flow);

  let plain = "";
  while (flow.position < flow.text.length && !",]}".includes(charAt(flow.text, flow.position))) {
    plain += charAt(flow.text, flow.position);
    flow.position += 1;
  }
  return parseScalar(plain);
}

/** Read the value that begins on the current line, consuming continuation lines when it needs them. */
function readInlineValue(reader: Reader, rest: string): YamlValue {
  if (rest.startsWith("[") || rest.startsWith("{")) {
    let text = rest;
    reader.index += 1;
    while (!flowBalanced(text) && reader.index < reader.lines.length) {
      text += ` ${lineAt(reader).trim()}`;
      reader.index += 1;
    }
    return parseFlowValue({ text, position: 0 });
  }

  if (rest.startsWith('"') && !quoteClosed(rest)) {
    let text = rest;
    reader.index += 1;
    while (reader.index < reader.lines.length && !quoteClosed(text)) {
      text += ` ${lineAt(reader).trim()}`;
      reader.index += 1;
    }
    return parseScalar(stripComment(text));
  }

  reader.index += 1;
  return parseScalar(stripComment(rest));
}

function parseNode(reader: Reader, minIndent: number): YamlValue | undefined {
  skipBlank(reader);
  if (reader.index >= reader.lines.length) return undefined;
  const line = lineAt(reader);
  if (indentOf(line) < minIndent) return undefined;
  const trimmed = line.trim();
  return trimmed === "-" || trimmed.startsWith("- ") ? parseSequence(reader, indentOf(line)) : parseMapping(reader, indentOf(line));
}

function parseSequence(reader: Reader, indent: number): YamlValue[] {
  const items: YamlValue[] = [];
  for (;;) {
    skipBlank(reader);
    if (reader.index >= reader.lines.length) break;
    const line = lineAt(reader);
    if (indentOf(line) < indent) break;
    const trimmed = line.trim();
    if (trimmed !== "-" && !trimmed.startsWith("- ")) break;

    let restStart = indent + 1;
    while (restStart < line.length && charAt(line, restStart) === " ") restStart += 1;
    const rest = line.slice(restStart);

    if (rest === "") {
      reader.index += 1;
      items.push(parseNode(reader, indent + 1) ?? null);
      continue;
    }
    if (!"[{\"'".includes(charAt(rest, 0)) && KEY.test(rest)) {
      // `- key: value` opens a mapping whose remaining keys align under the dash.
      reader.lines[reader.index] = " ".repeat(restStart) + rest;
      items.push(parseMapping(reader, restStart));
      continue;
    }
    items.push(readInlineValue(reader, rest));
  }
  return items;
}

function parseMapping(reader: Reader, indent: number): { [key: string]: YamlValue } {
  const map: { [key: string]: YamlValue } = {};
  for (;;) {
    skipBlank(reader);
    if (reader.index >= reader.lines.length) break;
    const line = lineAt(reader);
    if (indentOf(line) < indent) break;
    const trimmed = line.trim();
    if (trimmed === "-" || trimmed.startsWith("- ")) break;

    const entry = KEY.exec(trimmed);
    if (!entry) break;

    const key = entry[1] ?? "";
    const value = entry[2] ?? "";
    if (stripComment(value).trim() === "") {
      reader.index += 1;
      map[key] = parseNode(reader, indent + 1) ?? null;
      continue;
    }
    map[key] = readInlineValue(reader, value);
  }
  return map;
}

// ---------------------------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------------------------

/**
 * A parsed handoff (§6.1), the shape `planStageCoupling` consumes.
 *
 * Declared here because this module is its producer. It was declared on `substrate.ts` while no
 * producer existed; a second front-matter reader in the CLI would have been two spellings of one
 * concept, and this repository ships no YAML dependency to make the second one cheap.
 */
export interface ParsedHandoff {
  kind: HandoffKind;
  lane: string;
  wave: number;
  stage: number | null;
  frontMatter: Record<string, unknown>;
  headings: string[];
  body: string;
}

interface SplitHandoff {
  frontMatter: { [key: string]: YamlValue };
  frontMatterLineCount: number;
  body: string;
}

function splitHandoff(text: string): SplitHandoff | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close < 0) return null;

  const reader: Reader = { lines: lines.slice(1, close), index: 0 };
  return { frontMatter: parseMapping(reader, 0), frontMatterLineCount: close - 1, body: lines.slice(close + 1).join("\n") };
}

interface AcceptanceRow {
  acId: string | null;
  reqId: string | null;
  testId: string | null;
  untestedReason: string | null;
  untestedOwner: string | null;
}

function asString(value: YamlValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function stringList(value: YamlValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isRecord(value: YamlValue | undefined): value is { [key: string]: YamlValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acceptanceRows(front: { [key: string]: YamlValue }): AcceptanceRow[] {
  const raw = front.acceptance;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((row) => ({
    acId: asString(row.ac_id),
    reqId: asString(row.req_id),
    testId: asString(row.test_id),
    untestedReason: asString(row.untested_reason),
    untestedOwner: asString(row.untested_owner)
  }));
}

/** Level-2 headings, in source order, with fenced blocks excluded so an example heading is not one. */
function bodyHeadings(body: string): string[] {
  return maskFencedBlocks(body)
    .map((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((heading): heading is string => heading !== undefined);
}

/** The lines of one level-2 section, up to the next level-2 heading. */
function sectionLines(body: string, heading: string): string[] {
  const lines = maskFencedBlocks(body);
  const start = lines.findIndex((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1] === heading);
  if (start < 0) return [];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+\S/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function normalisePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathsIn(lines: string[]): string[] {
  return lines.flatMap((line) => [...line.matchAll(PATH_TOKEN)].map((match) => normalisePath(match[0])));
}

function sameSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

// ---------------------------------------------------------------------------------------------
// The layers
// ---------------------------------------------------------------------------------------------

function checkSchema(front: { [key: string]: YamlValue }, body: string, violations: HandoffViolation[]): void {
  const refuse = (detail: string): void => {
    violations.push({ code: "handoff-schema-invalid", layer: 0, detail });
  };

  // @req FR-NODE-109 AC-1 — a commit's sha is a hash over its own tree, so no value written into a
  // file inside that commit can equal it. The field is refused rather than resolved, and the value
  // is not consulted: `null` is refused on the same footing as a sha.
  if (Object.prototype.hasOwnProperty.call(front, "base_sha")) refuse("front matter carries a top-level base_sha field, which no value inside its own commit could satisfy");

  const kind = asString(front.handoff_kind);
  if (kind === null || !(HANDOFF_KINDS as readonly string[]).includes(kind)) refuse(`handoff_kind ${kind ?? "(absent)"} is outside the closed list`);

  const headings = bodyHeadings(body);
  const required = [...HANDOFF_BODY_HEADINGS];
  const missing = required.filter((heading) => !headings.includes(heading));
  if (missing.length > 0) refuse(`body is missing the required heading(s): ${missing.join(", ")}`);
  else if (headings.filter((heading) => required.includes(heading as (typeof HANDOFF_BODY_HEADINGS)[number])).join(" ") !== required.join(" ")) {
    refuse(`body headings are out of order; the declared order is ${required.join(", ")}`);
  }

  checkBootstrap(front, refuse);
  checkManifestTemplate(front, refuse);

  for (const field of ["heartbeat_path", "decisions_path"]) {
    if ((asString(front[field]) ?? "").trim() === "") refuse(`${field} is required and is absent or empty`);
  }
}

function checkBootstrap(front: { [key: string]: YamlValue }, refuse: (detail: string) => void): void {
  const raw = front.bootstrap;
  if (!Array.isArray(raw)) {
    refuse("bootstrap is required and is not an ordered list");
    return;
  }

  const heartbeatPath = asString(front.heartbeat_path) ?? "";
  let sawAssert = false;

  raw.filter(isRecord).forEach((entry, position) => {
    const entryKind = asString(entry.kind);
    const posix = asString(entry.posix);
    const windows = asString(entry.windows);

    if (entryKind === null || !(BOOTSTRAP_KINDS as readonly string[]).includes(entryKind)) refuse(`bootstrap entry ${position} carries no kind from the closed list`);
    // Both variants are mandatory because `NODE_ENV=development npm ci` is a parse error in
    // PowerShell and this repository's primary shell is PowerShell (§6.1).
    if ((posix ?? "").trim() === "" || (windows ?? "").trim() === "") refuse(`bootstrap entry ${position} carries only one of its POSIX and Windows commands`);

    if (entryKind === "assert") sawAssert = true;
    if (entryKind === "install" && sawAssert) refuse(`bootstrap entry ${position} installs after an assert entry; an install precedes its assertions`);

    // An action mistyped as an assertion silently violates the install-precedes-assertion rule, so
    // the writer of the heartbeat is typed `record` (§6.1 correction (b)).
    const writesHeartbeat = [posix ?? "", windows ?? ""].some((command) => (heartbeatPath !== "" && command.includes(heartbeatPath)) || /heartbeat/i.test(command));
    if (writesHeartbeat && entryKind !== "record") refuse(`bootstrap entry ${position} writes the heartbeat and is typed ${entryKind ?? "(none)"} rather than record`);
  });
}

function checkManifestTemplate(front: { [key: string]: YamlValue }, refuse: (detail: string) => void): void {
  const template = front.manifest_template;
  if (!isRecord(template)) {
    refuse("manifest_template is required and is not an object");
    return;
  }

  if ((asString(template.schema_version) ?? "").trim() === "") refuse("manifest_template.schema_version carries no literal version");
  if (template.intentionally_empty !== false) refuse("manifest_template.intentionally_empty is not false");

  for (const field of MANIFEST_TEMPLATE_ARRAY_FIELDS) {
    const value = template[field];
    if (!Array.isArray(value) || value.length > 0) refuse(`manifest_template.${field} is not an empty array; an empty array is a claim and an absent field is silence`);
  }

  const exceptions = new Set<string>(["schema_version", "intentionally_empty", ...MANIFEST_TEMPLATE_ARRAY_FIELDS]);
  for (const [key, value] of Object.entries(template)) {
    if (!exceptions.has(key) && value !== null) refuse(`manifest_template.${key} is not null; the template carries three stated exceptions and no others`);
  }
}

/** @req FR-NODE-154 AC-1, AC-2 — layer 1, skipped for a `remediation` handoff. */
function checkTaskFields(taskIds: string[], catalog: HandoffCatalogTask[], violations: HandoffViolation[]): number {
  const byId = new Map(catalog.map((task) => [task.id, task]));
  let checked = 0;

  for (const taskId of taskIds) {
    const task = byId.get(taskId) as unknown as Record<string, unknown> | undefined;
    if (!task) continue;
    for (const field of HANDOFF_TASK_FIELDS) {
      const value = task[field];
      // Present, or explicitly `null`. An empty *array* counts: §3.4's rule is that an empty array
      // is a claim and an absent field is silence, so a task that genuinely depends on nothing is
      // complete rather than under-filled. An empty string is silence and does not count.
      if (value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      checked += 1;
    }
  }

  const expected = HANDOFF_TASK_FIELDS.length * taskIds.length;
  if (checked !== expected) {
    violations.push({ code: "handoff-task-field-count", layer: 1, detail: `checked ${checked} task fields against an expected ${HANDOFF_TASK_FIELDS.length} x ${taskIds.length}; the round is invalid`, expected, actual: checked });
  }
  return checked;
}

/** @req FR-NODE-154 AC-3 — layer 2: equality, not subset, so scope can be neither dropped nor widened. */
function checkSetEquality(front: { [key: string]: YamlValue }, kind: HandoffKind, lane: HandoffLane, catalog: HandoffCatalogTask[], violations: HandoffViolation[]): void {
  const declaredTasks = stringList(front.task_ids);
  if (!sameSet(declaredTasks, lane.taskIds)) {
    violations.push({ code: "handoff-set-inequality", layer: 2, detail: `task_ids [${declaredTasks.join(", ")}] does not equal the assignment [${lane.taskIds.join(", ")}]`, expected: lane.taskIds.length, actual: declaredTasks.length });
  }

  const computed = lane.writeSet ?? epilogueWriteSet(lane.taskIds, catalog);
  const declaredWrites = stringList(front.write_set).map(normalisePath);
  if (!sameSet(declaredWrites, computed.map(normalisePath))) {
    violations.push({ code: "handoff-set-inequality", layer: 2, detail: `write_set does not equal the ${kind === "epilogue" ? "catalog-computed" : "lane's computed"} write set`, expected: computed.length, actual: declaredWrites.length });
  }
}

/** An epilogue has no lane row, so its write set is `files ∪ test_files` over its task set (§6.2 layer 2). */
function epilogueWriteSet(taskIds: string[], catalog: HandoffCatalogTask[]): string[] {
  const byId = new Map(catalog.map((task) => [task.id, task]));
  const paths = new Set<string>();
  for (const taskId of taskIds) {
    const task = byId.get(taskId);
    if (!task) continue;
    for (const file of task.files ?? []) paths.add(normalisePath(file.path));
    for (const testFile of task.test_files ?? []) paths.add(normalisePath(testFile));
  }
  return [...paths];
}

/**
 * @req FR-NODE-156 — layer 3, over a named denominator.
 *
 * The body plus exactly two front-matter fields, because those two are authored natural-language
 * prose the executing agent reads exactly as the body is. Every other field is an identifier, a
 * path, an enum, a command or a closed list quoted verbatim, and is outside the scan. The scan is a
 * script check and not a language check: it passes fluent Spanish, and loop H verifier 2 is what
 * catches English too poor to act on.
 */
function checkEnglishOnly(front: { [key: string]: YamlValue }, body: string, bodyStartLine: number, rows: AcceptanceRow[], violations: HandoffViolation[]): void {
  const hits: number[] = [];
  maskExcludedConstructs(body).forEach((line, offset) => {
    if (NON_LATIN_SCRIPT.test(line)) hits.push(bodyStartLine + offset);
  });
  if (hits.length > 0) violations.push({ code: "handoff-not-english", layer: 3, detail: "non-Latin script in the handoff body, outside code fences, code spans and blockquotes", lines: hits });

  const escalation = asString(front.escalation) ?? "";
  if (NON_LATIN_SCRIPT.test(escalation)) violations.push({ code: "handoff-not-english", layer: 3, detail: "non-Latin script in the escalation field" });

  for (const row of rows) {
    if (row.untestedReason !== null && NON_LATIN_SCRIPT.test(row.untestedReason)) {
      violations.push({ code: "handoff-not-english", layer: 3, detail: `non-Latin script in the untested_reason of ${row.acId ?? "(unnamed row)"}` });
    }
  }
}

/** Test files named as arguments of a command, by the same path shape layer 4 uses elsewhere. */
function commandPaths(command: string | null | undefined): string[] {
  return command ? [...command.matchAll(PATH_TOKEN)].map((match) => normalisePath(match[0])) : [];
}

/**
 * @req FR-NODE-157, FR-NODE-109 — layer 4, over a named field set and against a named tree.
 *
 * Revision 2 said *"every referenced path"* with no scope and *"exists at `base_sha`"* with no way
 * to evaluate it; both halves were unrunnable. The scope and the out-of-scope set are both named so
 * that no implementer invents the boundary.
 */
function checkResolvability(front: { [key: string]: YamlValue }, body: string, rows: AcceptanceRow[], root: HandoffRoot, violations: HandoffViolation[]): void {
  const refuse = (detail: string): void => {
    violations.push({ code: "handoff-unresolvable-reference", layer: 4, detail });
  };

  const writeSet = stringList(front.write_set).map(normalisePath);
  const dispatchBase = new Set([...root.headPaths.map(normalisePath), ...root.stagedPaths.map(normalisePath), ...writeSet]);

  // A `test_id` is `path::case name`; the file half is what layer 4 resolves and what the union
  // verification command must name.
  const acceptanceTestFiles = rows.flatMap((row) => (row.testId === null ? [] : [normalisePath(row.testId.split("::")[0] ?? "")]));

  const scoped = [
    ...[asString(front.plan_path), asString(front.sidecar_path)].filter((value): value is string => value !== null).map(normalisePath),
    ...writeSet,
    ...stringList(front.read_set).map(normalisePath),
    ...acceptanceTestFiles,
    ...pathsIn(sectionLines(body, "Interfaces")),
    ...pathsIn(sectionLines(body, "Tasks"))
  ];

  for (const reference of new Set(scoped)) {
    if (!dispatchBase.has(reference)) refuse(`${reference} exists at neither the dispatch base nor the declared write set`);
  }

  for (const taskId of new Set(maskFencedBlocks(body).join("\n").match(SIDECAR_TASK_ID) ?? [])) {
    if (!root.sidecarTaskIds.includes(taskId)) refuse(`task id ${taskId} does not exist in the named sidecar`);
  }

  for (const reqId of stringList(front.req_ids)) {
    if (!Object.prototype.hasOwnProperty.call(root.requirementAcIds, reqId)) refuse(`requirement id ${reqId} does not resolve`);
  }

  for (const row of rows) {
    if (row.reqId === null || row.acId === null) {
      refuse("an acceptance row names no requirement id or no criterion id");
      continue;
    }
    const criteria = root.requirementAcIds[row.reqId];
    if (criteria === undefined) refuse(`acceptance row ${row.acId} names the unresolvable requirement ${row.reqId}`);
    else if (!criteria.includes(row.acId)) refuse(`criterion ${row.acId} does not exist on ${row.reqId}`);
  }

  // Revision 1's layer 4 left `test_id` unresolved, so three criteria could all point at one trivial
  // test and satisfy every count-based closure in §6.5.
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.testId === null) continue;
    if (seen.has(row.testId)) refuse(`two acceptance rows share the test id ${row.testId}`);
    seen.add(row.testId);
  }

  checkVerificationCommand(front, acceptanceTestFiles, refuse);
}

function checkVerificationCommand(front: { [key: string]: YamlValue }, acceptanceTestFiles: string[], refuse: (detail: string) => void): void {
  const command = front.verification_cmd;
  if (!isRecord(command)) {
    refuse("verification_cmd is required and is not a {posix, windows} pair");
    return;
  }
  const posix = asString(command.posix);
  const windows = asString(command.windows);
  if ((posix ?? "").trim() === "" || (windows ?? "").trim() === "") {
    refuse("verification_cmd names no real script in one of its two variants");
    return;
  }

  // One run serves both the lane verification and the acceptance re-run, which is why the union
  // command must name every file either of them needs (§6.1's precedence rule).
  const named = new Set([...commandPaths(posix), ...commandPaths(windows)]);
  for (const file of new Set(acceptanceTestFiles)) {
    if (!named.has(file)) refuse(`the handoff-level verification command does not name the acceptance test file ${file}`);
  }
}

function checkPerTaskCommandCoverage(front: { [key: string]: YamlValue }, taskIds: string[], catalog: HandoffCatalogTask[], violations: HandoffViolation[]): void {
  const command = front.verification_cmd;
  if (!isRecord(command)) return;
  const named = new Set([...commandPaths(asString(command.posix)), ...commandPaths(asString(command.windows))]);
  const byId = new Map(catalog.map((task) => [task.id, task]));

  for (const taskId of taskIds) {
    const task = byId.get(taskId);
    if (!task?.verification_cmd) continue;
    for (const file of new Set([...commandPaths(task.verification_cmd.posix), ...commandPaths(task.verification_cmd.windows)])) {
      if (!named.has(file)) {
        violations.push({ code: "handoff-unresolvable-reference", layer: 4, detail: `the handoff-level verification command does not name ${file}, which ${taskId}'s own command runs` });
      }
    }
  }
}

/**
 * @req FR-NODE-155 — layer 5, the cap that closes the one critical defect a serial scope does not
 * remove.
 *
 * The rounding convention is ceiling because flooring forbids *any* untested criterion on a handoff
 * with fewer than four rows, which is most handoffs, and declaring the legitimate case is the whole
 * purpose of the attribution fields.
 */
function checkNonVacuousAcceptance(kind: HandoffKind, rows: AcceptanceRow[], root: HandoffRoot, violations: HandoffValidation["counts"], collected: HandoffViolation[]): void {
  const refuse = (detail: string): void => {
    collected.push({ code: "handoff-untested-ac-over-cap", layer: 5, detail });
  };

  const allowance = root.allowUntestedAc ?? 0;
  const untested = rows.filter((row) => row.testId === null);
  const cap = Math.max(allowance, Math.ceil(rows.length / 4));

  violations.acceptanceRowCount = rows.length;
  violations.untestedRowCount = untested.length;
  violations.untestedAllowance = allowance;
  violations.untestedCap = cap;

  if (rows.length === 0) {
    refuse("acceptance[] is empty");
    return;
  }
  if (untested.length > cap) refuse(`${untested.length} rows carry a null test id against a cap of ${cap}`);

  // The per-requirement bound is lane and remediation only: §5.2 routes to the epilogue exactly the
  // task types the planner marks TDD-exempt by construction, whose acceptance kinds are checklist
  // and file_state — neither a test file layer 4 could resolve.
  if (kind !== "epilogue") {
    const perRequirement = new Map<string, number>();
    for (const row of untested) {
      const reqId = row.reqId ?? "(unnamed)";
      perRequirement.set(reqId, (perRequirement.get(reqId) ?? 0) + 1);
    }
    for (const [reqId, count] of perRequirement) {
      if (count > 1) refuse(`${count} null rows carry the requirement id ${reqId}; a ${kind} handoff permits at most one per requirement`);
    }
  }

  for (const row of untested) {
    const name = row.acId ?? "(unnamed row)";
    if (row.untestedReason === null || row.untestedReason.trim().length < MINIMUM_UNTESTED_REASON) refuse(`the null row ${name} carries no untested_reason of at least ${MINIMUM_UNTESTED_REASON} characters`);
    if ((row.untestedOwner ?? "").trim() === "") refuse(`the null row ${name} names no untested_owner`);
  }
}

/**
 * @req FR-NODE-154 — five mechanical layers over a handoff, with the layer set selected from the
 * handoff's kind: all five for `lane` and `epilogue`; layers 2 through 5 for `remediation`, whose
 * layer 1 was already discharged on the originating lane's handoff and whose lock therefore records
 * a task field count of zero.
 */
/**
 * Read a handoff into the shape `planStageCoupling` and the lock writer consume, or `null` when the
 * document carries no closed front-matter block.
 *
 * `validateHandoff` is what judges a handoff; this only reads one. A caller that needs both calls
 * both — the parse is cheap and pure, and sharing a result object would tie the two lifetimes
 * together for no gain.
 */
export function readHandoff(text: string): ParsedHandoff | null {
  const document = splitHandoff(text);
  if (!document) return null;

  const front = document.frontMatter;
  const declaredKind = asString(front.handoff_kind);
  const wave = front.wave;
  const stage = front.stage;

  return {
    kind: (HANDOFF_KINDS as readonly string[]).includes(declaredKind ?? "") ? (declaredKind as HandoffKind) : "lane",
    lane: asString(front.lane) ?? "",
    wave: typeof wave === "number" ? wave : 0,
    stage: typeof stage === "number" ? stage : null,
    frontMatter: front,
    headings: bodyHeadings(document.body),
    body: document.body
  };
}

export function validateHandoff(text: string, lane: HandoffLane, catalog: HandoffCatalogTask[], root: HandoffRoot): HandoffValidation {
  const violations: HandoffViolation[] = [];
  const counts: HandoffValidation["counts"] = { taskFieldCount: 0, acceptanceRowCount: 0, untestedRowCount: 0, untestedAllowance: root.allowUntestedAc ?? 0, untestedCap: 0 };

  const document = splitHandoff(text);
  if (!document) {
    violations.push({ code: "handoff-schema-invalid", layer: 0, detail: "the document carries no closed YAML front-matter block" });
    return { ok: false, violations, counts };
  }

  const { frontMatter, body } = document;
  const declaredKind = asString(frontMatter.handoff_kind);
  const kind: HandoffKind = (HANDOFF_KINDS as readonly string[]).includes(declaredKind ?? "") ? (declaredKind as HandoffKind) : "lane";
  const rows = acceptanceRows(frontMatter);
  const taskIds = stringList(frontMatter.task_ids);

  checkSchema(frontMatter, body, violations);

  if (kind !== "remediation") counts.taskFieldCount = checkTaskFields(taskIds, catalog, violations);

  checkSetEquality(frontMatter, kind, lane, catalog, violations);
  checkEnglishOnly(frontMatter, body, document.frontMatterLineCount + 3, rows, violations);
  checkResolvability(frontMatter, body, rows, root, violations);
  checkPerTaskCommandCoverage(frontMatter, taskIds, catalog, violations);
  checkNonVacuousAcceptance(kind, rows, root, counts, violations);

  return { ok: violations.length === 0, violations, counts };
}
