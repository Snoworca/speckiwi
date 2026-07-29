import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { REQUIRED_SDS_HEADINGS } from "../validator/validate-scoped.js";

export interface InitTemplateInput {
  product?: string;
  target?: string;
  scope?: string;
}

export interface AgentInstructionOptions {
  version?: string;
}

// @req FR-NODE-075 @req FR-NODE-077 @req FR-NODE-086 — v1.5 added the tdd work-mode workflow section;
// v1.6 makes it MCP-first (get_work_mode/set_work_mode), documents mode switching,
// and cites the installed SDS rules path; v1.7 turns the heading and the end marker English so the
// whole injected block is one language, which is why the version must be readable as "not v1.6".
export const AGENT_INSTRUCTION_VERSION = "1.7";
export const BUNDLED_RULES_VERSION = "1.0.0";

// @req FR-NODE-085 — the rules filename, the index rules pointer and the bundled version all derive
// from one constant per rules document, so raising a version cannot leave a filename or a pointer behind.
export const BUNDLED_SDS_RULES_VERSION = "1.0.0";
export const BUNDLED_SRS_RULES_FILENAME = `SRS-MD-Rules-v${BUNDLED_RULES_VERSION}.md`;
export const BUNDLED_SDS_RULES_FILENAME = `SDS-MD-Rules-v${BUNDLED_SDS_RULES_VERSION}.md`;

/**
 * @req FR-NODE-085 AC-2/AC-3 — the tool's own rules-file naming pattern, anchored to the whole file
 * name so a plain init prunes only the documents it owns and never a consumer's own document.
 */
export const RULES_DOCUMENT_FILENAME_PATTERN = /^(?:SRS|SDS)-MD-Rules-v\d+\.\d+\.\d+\.md$/;

/** The index metadata row that points at the bundled SRS-MD rules document. */
export function renderIndexRulesRow(): string {
  return `| Rules | [SRS-MD Authoring Rules v${BUNDLED_RULES_VERSION}](../rule/${BUNDLED_SRS_RULES_FILENAME}) |`;
}

/**
 * The Codex CLI version at (and above) which the `apply_patch` PostToolUse hook is supported.
 * A detected version below this floor cannot be trusted to honor the apply_patch hook, so the
 * installer warns instead of relying on it (FND-005 / FR-NODE-053 AC-3).
 */
export const CODEX_APPLY_PATCH_HOOK_FLOOR = "0.20.0";

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

/** Reads the leading (anchored) semver token from a possibly-noisy version line. */
function parseLeadingSemver(version: string): ParsedSemver | undefined {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

/** Semver precedence comparison (returns -1, 0, or 1), honoring prerelease ordering. */
function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  // A version with a prerelease has lower precedence than the same core without one.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const max = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < max; i += 1) {
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (ai === bi) continue;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) return Number(ai) < Number(bi) ? -1 : 1;
    if (aNum) return -1;
    if (bNum) return 1;
    return ai < bi ? -1 : 1;
  }
  return 0;
}

/**
 * Decides whether a detected `codex --version` string is below the apply_patch hook floor.
 * The version is read from the leading semver token so a noisy line still compares its version.
 * A prerelease of the floor core (e.g. 0.20.0-rc.1) precedes the final release and is below-floor.
 * An unparseable version surfaces uncertainty as below-floor so the caller warns.
 */
export function isCodexVersionBelowApplyPatchFloor(version: string): boolean {
  const parsed = parseLeadingSemver(version);
  if (!parsed) return true;
  const floor = parseLeadingSemver(CODEX_APPLY_PATCH_HOOK_FLOOR);
  if (!floor) return true;
  return compareSemver(parsed, floor) < 0;
}
// @req FR-NODE-086 — the injected block is delimited in English. The heading always carries a version
// suffix, so it can never collide with the unversioned legacy heading `# SpecKiwi SRS workflow`.
export const AGENT_INSTRUCTION_HEADING_PREFIX = "# SpecKiwi SRS workflow v";
export const AGENT_INSTRUCTION_END_MARKER = "<!-- /SpecKiwi SRS workflow -->";

// @req FR-NODE-086 — the heading/marker pair init injected up to v1.6. Kept verbatim so init can find a
// block written by an earlier version and replace it in place instead of appending a second one.
export const LEGACY_KOREAN_AGENT_HEADING_PREFIX = "# SpecKiwi SRS 워크플로 v";
export const LEGACY_KOREAN_AGENT_END_MARKER = "<!-- /SpecKiwi SRS 워크플로 -->";

export function renderIndexTemplate(input: InitTemplateInput = {}): string {
  const product = input.product ?? "SpecKiwi Project";
  const target = input.target?.trim();
  const scope = parseScopeOption(input.scope);
  const targetRows = target ? [`| ${target} | release | planned | Initial target |`] : [];
  const lines = [
    `# ${product} SRS Index`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | srs_index |",
    `| Product | ${product} |`,
    "| Product Version | 1.0.0 |",
    "| Active Target |  |",
    "| Status | draft |",
    renderIndexRulesRow(),
    "",
    "## 1. Purpose",
    "",
    "Describe this product.",
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| ${scope.name} | [${scope.document}](./${scope.document}) | ${scope.prefix} | ${scope.name} |`,
    "",
    "## 3. Target Map",
    "",
    "| Target | Type | Status | Description |",
    "|---|---|---|---|",
    ...targetRows,
    "",
    "## 4. Scope Map",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| ${scope.name} | [${scope.document}](./${scope.document}) | ${scope.prefix} | ${scope.name} |`,
    "",
    "## 5. Status Summary",
    "",
    "| Status | Count |",
    "|---|---:|",
    "| planned | 0 |",
    "| in_progress | 0 |",
    "| blocked | 0 |",
    "| implemented | 0 |",
    "| verified | 0 |",
    "| discarded | 0 |",
    "",
    "## 6. Requirement Type Summary",
    "",
    "| Type | Prefix | Count |",
    "|---|---|---:|",
    "",
    "## 7. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
    "|---|---|---|---|---|---|",
    "",
    "## 8. Cross-scope Dependencies",
    "",
    "| From | To | Relation | Notes |",
    "|---|---|---|---|",
    "",
    "## 9. Open Questions",
    "",
    "| ID | Question | Impact | Status |",
    "|---|---|---|---|",
    "",
    "## 10. Reference Documents",
    "",
    `- [SRS-MD Authoring Rules v${BUNDLED_RULES_VERSION}](../rule/${BUNDLED_SRS_RULES_FILENAME})`,
    "",
    "## 11. Change Notes",
    "",
    "| Date | Change | Reason |",
    "|---|---|---|",
    "| 2026-05-10 | Initial SRS index created | SpecKiwi init |"
  ];
  return lines.join("\n");
}

export function renderAppendixTemplate(): string {
  return [
    "# SRS Appendix",
    "",
    "## Command Reference",
    "",
    "Use `speckiwi validate`, `speckiwi list`, `speckiwi show`, and `speckiwi summary`.",
    "",
    "`speckiwi add-completed-work` accepts repeatable `--report <path>` options.",
    "",
    "## Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
    "|---|---|---|---|---|---|",
    "",
    "The trailing `Report Paths` column is optional for legacy indexes. Parsed completed-work records expose `reportPaths` as a string array; blank or missing cells return `[]`.",
    "",
    "Report paths are repository-relative POSIX paths stored as comma-separated values. They cannot be blank, absolute, start with `./` or `../`, contain a `..` segment, URL scheme, backslash, pipe, comma, CR/LF, or `#`.",
    "",
    "Malformed report path tokens are reported as `SRS-W024` warnings. Report paths are Completed Work Log summary metadata, not Verification Evidence.",
    "",
    "## MCP",
    "",
    "`add_completed_work` accepts optional `reportPaths?: string[]` and `allowIncomplete?: boolean` fields."
  ].join("\n");
}

export interface ScopeTemplateInfo {
  name: string;
  prefix: string;
  document: string;
}

export function parseScopeOption(value?: string): ScopeTemplateInfo {
  if (!value) return { name: "Product Architecture", prefix: "ARCH", document: "10.product-architecture.srs.md" };
  const [namePart, prefixPart] = value.includes(":") ? value.split(":", 2) : [value, value];
  const name = (namePart ?? "Product Architecture").trim() || "Product Architecture";
  const prefix = (prefixPart ?? name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-");
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || prefix.toLowerCase();
  return { name, prefix, document: `10.${slug}.srs.md` };
}

export function renderEmptyScopeTemplate(scope: ScopeTemplateInfo = parseScopeOption()): string {
  return [
    `# ${scope.name}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    `| Scope | ${scope.prefix} |`,
    `| Scope Name | ${scope.name} |`,
    "",
    "## 1. Scope Overview",
    "",
    "Describe the scope.",
    "",
    "## 2. Scope Boundaries",
    "",
    "### In Scope",
    "",
    "- SRS requirements",
    "",
    "### Out of Scope",
    "",
    "- None",
    "",
    "## 3. Assumptions and Constraints",
    "",
    "- None",
    "",
    "## 4. Requirements",
    ""
  ].join("\n");
}

export async function loadBundledRulesDocument(): Promise<string> {
  const candidate = fileURLToPath(new URL(`../../../docs/rule/${BUNDLED_SRS_RULES_FILENAME}`, import.meta.url));
  try {
    return await readFile(candidate, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [
      `# SRS-MD Authoring Rules v${BUNDLED_RULES_VERSION}`,
      "",
      "## Agent Instruction Snippet",
      "",
      renderAgentInstructionSnippet()
    ].join("\n");
  }
}

// @req FR-NODE-076
/**
 * The bundled SDS-MD Authoring Rules the tdd work-mode snippet references. Loaded from the
 * packaged docs/rule copy with a minimal ENOENT fallback (parity with loadBundledRulesDocument).
 */
export async function loadBundledSdsRulesDocument(): Promise<string> {
  const candidate = fileURLToPath(new URL(`../../../docs/rule/${BUNDLED_SDS_RULES_FILENAME}`, import.meta.url));
  try {
    return await readFile(candidate, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [
      `# SDS-MD Authoring Rules v${BUNDLED_SDS_RULES_VERSION}`,
      "",
      "The tdd work-mode SDS lives at `docs/spec/steps/<task>/design.md` with the headings",
      "Context & Scope, Goals / Non-goals, Architecture Decisions, Interfaces,",
      "Acceptance Contracts (EARS `SDS-AC-n` statements), Test Plan, and Open Questions,",
      "capped at 200 lines. See the packaged SpecKiwi documentation for the full rules."
    ].join("\n");
  }
}

// @req FR-NODE-080
/**
 * The scaffolded step SDS stub (SDS-MD Rules v1.0.0 §8 template): metadata table with
 * Status=draft plus the seven required headings, rendered from the validator's
 * REQUIRED_SDS_HEADINGS so the scaffold and the SDS-W051 advisory can never drift.
 * Content stays a skeleton — the SDS body is still directly authored.
 */
export function renderSdsDesignTemplate(options: { task: string; target?: string; date?: string }): string {
  const sections: Record<string, string[]> = {
    "Context & Scope": ["<background and boundary, five lines or fewer>"],
    "Goals / Non-goals": ["- Goal:", "- Non-goal:"],
    "Architecture Decisions": ["- **Decision**: <what> / basis: <why> / trade-off: <cost> / rejected: <alternative>"],
    "Interfaces": ["- `<signature>` — <contract, one line>"],
    "Acceptance Contracts": ["- SDS-AC-1: WHEN <condition> THE SYSTEM SHALL <observable behavior>."],
    "Test Plan": ["| SDS-AC | Test file (planned) | Case summary |", "|---|---|---|", "| SDS-AC-1 | test/... | ... |"],
    "Open Questions": ["- (none)"]
  };
  const lines = [
    `# SDS: ${options.task}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    `| Task | ${options.task} |`,
    `| Target | ${options.target ?? "-"} |`,
    "| Status | draft |",
    `| Date | ${options.date ?? new Date().toISOString().slice(0, 10)} |`,
    ""
  ];
  REQUIRED_SDS_HEADINGS.forEach((heading, index) => {
    lines.push(`## ${index + 1}. ${heading}`, "", ...(sections[heading] ?? ["- -"]), "");
  });
  return lines.join("\n");
}

// @req FR-NODE-080
/** The scaffolded step intent stub (what/why; design.md carries the how). */
export function renderStepIntentTemplate(task: string): string {
  return [`# Intent: ${task}`, "", "<what this step changes and why, a few lines>", ""].join("\n");
}

export function renderAgentInstructionSnippet(options: AgentInstructionOptions = {}): string {
  const version = options.version ?? AGENT_INSTRUCTION_VERSION;
  return [
    `${AGENT_INSTRUCTION_HEADING_PREFIX}${version}`,
    "",
    "This repository uses `docs/spec/` as the required source of truth for requirements.",
    "",
    "Before making any code, test, CLI, MCP, or documentation change, agents MUST:",
    "1. Read `docs/spec/00.index.md`.",
    "2. Find the relevant Requirement ID in the scope SRS files.",
    "3. Mention the Requirement ID in the work summary.",
    "4. If no matching requirement exists, stop and ask whether to create/update an SRS requirement first.",
    "",
    "Requirement metadata has two separate lifecycle fields:",
    "- `Status` tracks implementation and verification progress.",
    "- `Stability` tracks requirement maturity and change-control maturity.",
    "",
    "Agents MUST stop before implementing a non-discarded requirement with `Stability=draft` or `Stability=deprecated` unless the user explicitly overrides that workflow.",
    "",
    "TDD principle:",
    "- Agents MUST follow TDD for behavior changes: write or update a failing automated test for the relevant Requirement ID before implementation, make the smallest change to pass, then refactor while keeping tests green.",
    "- If no meaningful automated test can be written, agents MUST stop before implementation and explain the exception and alternative verification evidence.",
    "",
    "Work-mode and the TDD First (tdd) workflow:",
    "1. Before starting work, read the persisted work-mode with the MCP `get_work_mode` tool, or CLI `speckiwi mode` when MCP is unavailable (stored in `docs/spec/steps/state.md`). When no mode is set the mode is wait and the sdd (SRS-first) rules in this document apply.",
    "2. Switch modes with the MCP `set_work_mode` tool (mode plus an optional activeTask for vibe/tdd) or CLI `speckiwi mode <value>`. Any mode may switch to any other of sdd, vibe, wait, and tdd; switching to sdd or wait drops a stale Active Task line, and an out-of-enum value is rejected with INVALID_MODE.",
    `3. When the mode is \`tdd\`, step-scoped work follows the TDD First cycle: author the step SDS at \`docs/spec/steps/<task>/design.md\` per the installed SDS-MD Authoring Rules (\`docs/rule/${BUNDLED_SDS_RULES_FILENAME}\`) with EARS acceptance contracts (SDS-AC), translate the SDS-ACs into failing tests and confirm they fail, implement the smallest change to green, run regression, then synthesize the step SRS and promote the step requirement with verification evidence.`,
    "4. tdd gates (all mandatory): do not write tests before the step's SDS exists; commit tests first and never weaken a test to reach green; never promote a step requirement without verification evidence.",
    "5. In tdd mode the rule \"do not implement behavior not covered by an SRS requirement\" is satisfied for step-scoped work by the agreed SDS plus the mandatory post-hoc promotion; body-scope work keeps the sdd rules in this document.",
    "6. Edits to existing body requirements and large architecture changes stay in sdd mode — never route them through a tdd step.",
    "",
    "Agents MUST NOT:",
    "- Implement behavior that is not covered by an SRS requirement.",
    "- Create an alternate requirements source outside `docs/spec/`.",
    "- Change requirement IDs manually.",
    "- Mark requirements as verified without evidence.",
    "- Introduce or invoke bulk-archive / bulk-finalize tooling that flips multiple requirements to `verified` or empties Active Target without per-requirement evidence and stability gate checks.",
    "",
    "When SpecKiwi MCP tools are available, agents MUST use them for requirement lookup and safe SRS updates. If MCP is unavailable, use the `speckiwi` CLI.",
    "",
    "Current work status workflow:",
    "1. Read the active target with MCP `get_active_target`, or CLI `speckiwi active-target --json` if MCP is unavailable.",
    "2. If `activeTarget` is empty, report that no active target is set and ask which target to use before making target-scoped changes.",
    "3. Read `summary.countsByStatus`, `summary.countsByStability`, `summary.stabilityBlockers`, `summary.stabilityWarnings`, and `summary.newWorkCandidates` before selecting work.",
    "4. Read open work with MCP `list_requirements` for `status=in_progress`, `status=blocked`, and `status=implemented`; CLI fallback is `speckiwi list --status <status> --json`.",
    "5. Check missing verification evidence through `summary` or MCP `summarize_target` before saying work is complete.",
    "6. Read recent completed work with MCP `list_completed_work`; CLI fallback is `speckiwi completed-work --json`.",
    "",
    "Next target authoring workflow:",
    "1. If the user asks to set the next target, first read the current Active Target and Target Map.",
    "2. If the target is not registered, use a supported target-registration mutation such as MCP `set_active_target` with creation support, or CLI `speckiwi set-active-target <target> --create` when that option is available.",
    "3. If the configured MCP/CLI cannot register the target, stop before target-scoped SRS changes and report the tool gap, unless the user explicitly authorizes a minimal SRS-MD patch.",
    "4. After target assignment, confirm the resolved Active Target with MCP `get_active_target`, or CLI `speckiwi active-target --json` if MCP is unavailable.",
    "5. When the user provides a target goal, record it with MCP `set_target_goal`, or CLI `speckiwi set-target-goal <target> --goal <text>` if MCP is unavailable.",
    "6. For later SRS creation, omit the target only when the tool supports Active Target defaulting; otherwise pass the confirmed Active Target explicitly.",
    "7. If the user provides an explicit different target for a requirement, the explicit target wins over Active Target.",
    "",
    "Merge-time duplicate Requirement ID repair workflow:",
    "1. Run `speckiwi validate --json` or MCP `validate_spec` first. Use repair only when `SRS-E002` duplicate Requirement ID diagnostics exist, or when a named duplicate ID is confirmed in parsed diagnostics.",
    "2. Resolve normal Git conflict markers before repair. Then run MCP `diagnose_requirement_id_collisions` or CLI `speckiwi repair requirement-id-collisions diagnose --json`.",
    "3. Select explicit keep and rename occurrences by `filePath`, `headingLine`, and `blockHash`. A duplicate ID alone is never enough to write.",
    "4. Create a dry-run plan with MCP `plan_requirement_id_collision_repair` or CLI `speckiwi repair requirement-id-collisions plan --duplicate-id <id> --keep <file:line:blockHash> --rename <file:line:blockHash> [--replacement-id <id>|--allocate-next] --write-plan <path> --json`.",
    "5. Apply only from the explicit plan or equivalent explicit mapping with MCP `apply_requirement_id_collision_repair` or CLI `speckiwi repair requirement-id-collisions apply --plan <path> --json`. `--ignore-lock` is allowed only on apply and bypasses only the SRS mutation lock.",
    "6. Do not use collision repair for general renumbering, gap filling, ID beautification, bulk archive, bulk finalize, or Status/Stability changes. When two duplicate logical requirements should be merged or discarded, first repair IDs to uniqueness, then use separate guarded SRS mutations for discard, supersedes, Status, Stability, AC, or evidence changes.",
    "7. When implemented runtime CLI or MCP repair tooling is available, do not hand-edit Requirement IDs. If tooling is unavailable and the user explicitly authorizes a degraded SRS-MD patch, limit it to the selected occurrence and explicitly mapped references.",
    "8. Finish with `speckiwi validate --fail-on-warning --json`, `speckiwi summary --target <target> --json`, and `speckiwi links check --json` or MCP equivalents. Evidence must show duplicate IDs are zero and ambiguous references were reported or explicitly mapped.",
    "",
    "Completed Work Log is a read-only summary for agents. Requirement Block status, Acceptance Criteria, Verification Evidence, and Change Notes remain the source of truth for completion.",
    "",
    AGENT_INSTRUCTION_END_MARKER
  ].join("\n");
}
