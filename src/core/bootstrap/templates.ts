import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface InitTemplateInput {
  product?: string;
  target?: string;
  scope?: string;
}

export interface AgentInstructionOptions {
  version?: string;
}

export const AGENT_INSTRUCTION_VERSION = "1.1";
export const AGENT_INSTRUCTION_HEADING_PREFIX = "# SpecKiwi SRS 워크플로 v";
export const AGENT_INSTRUCTION_END_MARKER = "<!-- /SpecKiwi SRS 워크플로 -->";

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
    "| Rules | [SRS-MD Authoring Rules v1.0.0](../rule/SRS-MD-Rules-v1.0.0.md) |",
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
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
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
    "- [SRS-MD Authoring Rules v1.0.0](../rule/SRS-MD-Rules-v1.0.0.md)",
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
  return "# SRS Appendix\n\n## Command Reference\n\nUse `speckiwi validate`, `speckiwi list`, `speckiwi show`, and `speckiwi summary`.\n";
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
  const candidate = fileURLToPath(new URL("../../../docs/rule/SRS-MD-Rules-v1.0.0.md", import.meta.url));
  try {
    return await readFile(candidate, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [
      "# SRS-MD Authoring Rules v1.0.0",
      "",
      "## Agent Instruction Snippet",
      "",
      renderAgentInstructionSnippet()
    ].join("\n");
  }
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
    "Agents MUST NOT:",
    "- Implement behavior that is not covered by an SRS requirement.",
    "- Create an alternate requirements source outside `docs/spec/`.",
    "- Change requirement IDs manually.",
    "- Mark requirements as verified without evidence.",
    "",
    "When SpecKiwi MCP tools are available, agents MUST use them for requirement lookup and safe SRS updates. If MCP is unavailable, use the `speckiwi` CLI.",
    "",
    "Current work status workflow:",
    "1. Read the active target with MCP `get_active_target`, or CLI `speckiwi active-target --json` if MCP is unavailable.",
    "2. If `activeTarget` is empty, report that no active target is set and ask which target to use before making target-scoped changes.",
    "3. Read open work with MCP `list_requirements` for `status=in_progress`, `status=blocked`, and `status=implemented`; CLI fallback is `speckiwi list --status <status> --json`.",
    "4. Check missing verification evidence through `summary` or MCP `summarize_target` before saying work is complete.",
    "5. Read recent completed work with MCP `list_completed_work`; CLI fallback is `speckiwi completed-work --json`.",
    "",
    "Completed Work Log is a read-only summary for agents. Requirement Block status, Acceptance Criteria, Verification Evidence, and Change Notes remain the source of truth for completion.",
    "",
    AGENT_INSTRUCTION_END_MARKER
  ].join("\n");
}
