import type { ProjectRoot } from "../types.js";

export const SKILL_AGENTS = ["codex", "claude", "opencode", "hermes"] as const;
export const SKILL_INSTALL_SCOPES = ["project", "global", "custom"] as const;
export const SKILL_INSTALL_OPERATIONS = ["install", "update", "skip", "conflict"] as const;
export const MCP_PREFLIGHT_STATUSES = ["satisfied", "missing", "not_checked"] as const;

export type SkillAgent = (typeof SKILL_AGENTS)[number];
export type SkillInstallScope = (typeof SKILL_INSTALL_SCOPES)[number];
export type SkillInstallOperation = (typeof SKILL_INSTALL_OPERATIONS)[number];
export type McpPreflightStatus = (typeof MCP_PREFLIGHT_STATUSES)[number];

export interface McpPreflight {
  status: McpPreflightStatus;
  remediation: string;
}

export interface SkillIdentity {
  name: string;
  agent: SkillAgent;
  sourceRoot: string;
  category?: string;
}

export interface SkillInstallOptions {
  projectRoot: ProjectRoot;
  agent: SkillAgent;
  selector: string;
  scope?: SkillInstallScope;
  dest?: string;
  category?: string;
  dryRun?: boolean;
  sourceBaseDir?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

export interface SkillFileOperation {
  source: string;
  destination: string;
  normalized?: boolean;
}

export interface SkillInstallItemResult {
  name: string;
  identity: SkillIdentity;
  operation: SkillInstallOperation;
  changed: boolean;
  source: string;
  destination: string;
  entrypoint: "SKILL.md";
  sourceEntrypoint: "SKILL.md" | "skill.md";
  entrypointNormalized: boolean;
  filesCopied: number;
  filesRemoved: number;
  fileOperations: SkillFileOperation[];
  conflicts: string[];
  validationFindings: string[];
}

export interface SkillInstallPlan {
  agent: SkillAgent;
  scope: SkillInstallScope;
  sourceRoot: string;
  destinationRoot: string;
  requiresMcp: true;
  mcpPreflight: McpPreflight;
  dryRun: boolean;
  results: SkillInstallItemResult[];
  /** @req FR-NODE-228 — present on a Codex global install; what it did (or, in a dry-run, would do) in the deprecated root. */
  deprecatedRootCleanup?: DeprecatedRootCleanup;
}

/**
 * @req FR-NODE-228 — Codex reads `${CODEX_HOME:-<home>/.codex}/skills` as a deprecated root beside
 * `<home>/.agents/skills` and lists a skill found in both twice, so a global install takes SpecKiwi's
 * own copies out of the old root.
 */
export interface DeprecatedRootCleanup {
  root: string;
  removed: string[];
  kept: Array<{ path: string; reason: string; detail?: string }>;
  warnings: string[];
}

export interface SkillPackageFile {
  sourceRelativePath: string;
  destinationRelativePath: string;
  absolutePath: string;
  mode: number;
}

export interface SkillPackage {
  name: string;
  sourceDirectory: string;
  sourceEntrypoint: "SKILL.md" | "skill.md";
  entrypointNormalized: boolean;
  files: SkillPackageFile[];
}
