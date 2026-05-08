import { readFile } from "node:fs/promises";
import path from "node:path";

export interface InitTemplateInput {
  product?: string;
  target?: string;
  scope?: string;
}

export interface AgentInstructionOptions {
  rulesPath?: string;
}

export function renderIndexTemplate(input: InitTemplateInput = {}): string {
  const product = input.product ?? "SpecKiwi Project";
  const target = input.target ?? "v1.0.0";
  const scope = parseScopeOption(input.scope);
  return [
    `# ${product} SRS Index`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | srs_index |",
    `| Product | ${product} |`,
    "| Product Version | 1.0.0 |",
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
    `| ${target} | release | active | Initial target |`,
    "",
    "## 4. Scope Map",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| ${scope.name} | [${scope.document}](./${scope.document}) | ${scope.prefix} | ${scope.name} |`
  ].join("\n");
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
  const candidate = path.resolve("docs", "rule", "SRS-MD-Rules-v1.0.0.md");
  try {
    return await readFile(candidate, "utf8");
  } catch {
    return [
      "# SRS-MD Authoring Rules v1.0.0",
      "",
      "## Agent Instruction Snippet",
      "",
      "Read docs/spec/00.index.md first and follow docs/rule/SRS-MD-Rules-v1.0.0.md."
    ].join("\n");
  }
}

export function renderAgentInstructionSnippet(options: AgentInstructionOptions = {}): string {
  const rulesPath = options.rulesPath ?? "docs/rule/SRS-MD-Rules-v1.0.0.md";
  return [
    "# SpecKiwi SRS workflow",
    "",
    `This repository stores requirements as Markdown SRS documents under \`docs/spec/\`. For detailed authoring and validation rules, read [the rules document](${rulesPath}).`,
    "",
    "Prefer SpecKiwi MCP tools when configured. Use the `speckiwi` CLI fallback when MCP is unavailable. Never bypass SRS-MD rules or create an alternate requirements source of truth."
  ].join("\n");
}
