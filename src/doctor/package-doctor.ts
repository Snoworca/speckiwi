import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpServer, toolSchemas } from "../mcp/server.js";
import { getServerMetadata, type PackageInfo } from "../mcp/metadata.js";
import type { ProjectRoot } from "../core/types.js";

export type DoctorCheckStatus = "pass" | "fail" | "warn" | "skip";

export interface DoctorCheck {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  remediation?: string;
  details?: Record<string, unknown>;
}

export interface PackageDoctorReport {
  ok: boolean;
  package: {
    root: string;
    name: string;
    version: string;
  };
  workspace: {
    root: string;
    activeTarget: string | null;
  };
  mcp: {
    metadata: ReturnType<typeof getServerMetadata>;
    tools: string[];
  };
  checks: DoctorCheck[];
  summary: {
    pass: number;
    fail: number;
    warn: number;
    skip: number;
  };
}

interface PackageJson extends PackageInfo {
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
}

interface PackageLockJson {
  name?: string;
  version?: string;
  packages?: Record<string, { name?: string; version?: string; dependencies?: Record<string, string> }>;
}

export interface PackageDoctorOptions {
  packageRoot?: string;
}

/**
 * The bundled kiwi skills, in the order they ship. Exported so the requirement's own test measures
 * the real expectation set rather than a copy of it. @req FR-NODE-130
 */
export const EXPECTED_KIWI_SKILLS = [
  "kiwi-coder",
  "kiwi-commit-auto-pr",
  "kiwi-commit-auto-push",
  "kiwi-hot-fix",
  // @req FR-NODE-130 — 05 §14 registration 4: absent from this list, the orchestrator skill would
  // ship missing from a variant with no check firing.
  "kiwi-orchestrator",
  "kiwi-pipeline",
  "kiwi-planner",
  "kiwi-pm",
  "kiwi-review-fix-loop",
  "kiwi-srs",
  "kiwi-srs-feasibility",
  "kiwi-srs-from-code",
  "kiwi-srs-research",
  "kiwi-srs-sync",
  "kiwi-step",
  "kiwi-tdd",
  "kiwi-wave-master"
];

export const EXPECTED_SKILL_ENTRYPOINTS = ["codex", "claude", "etc"].flatMap((agent) => EXPECTED_KIWI_SKILLS.map((skill) => `skills/${agent}/${skill}/SKILL.md`));

function defaultPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function check(id: string, status: DoctorCheckStatus, message: string, remediation?: string, details?: Record<string, unknown>): DoctorCheck {
  return {
    id,
    status,
    message,
    ...(remediation ? { remediation } : {}),
    ...(details ? { details } : {})
  };
}

function isOkToolResult(value: unknown): value is { ok: true; value: unknown } {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true;
}

function activeTargetFromMcp(value: unknown): string | null {
  if (!isOkToolResult(value)) return null;
  const payload = value.value as { activeTarget?: unknown };
  return typeof payload.activeTarget === "string" && payload.activeTarget.trim() ? payload.activeTarget : null;
}

function validateResultIsClean(value: unknown): boolean {
  if (!isOkToolResult(value)) return false;
  const payload = value.value as { summary?: { errors?: unknown } };
  return payload.summary?.errors === 0;
}

function summarize(checks: DoctorCheck[]): PackageDoctorReport["summary"] {
  return {
    pass: checks.filter((item) => item.status === "pass").length,
    fail: checks.filter((item) => item.status === "fail").length,
    warn: checks.filter((item) => item.status === "warn").length,
    skip: checks.filter((item) => item.status === "skip").length
  };
}

export async function runPackageDoctor(root: ProjectRoot, options: PackageDoctorOptions = {}): Promise<PackageDoctorReport> {
  const packageRoot = options.packageRoot ?? defaultPackageRoot();
  const pkg = await readJson<PackageJson>(path.join(packageRoot, "package.json"));
  const checks: DoctorCheck[] = [];

  checks.push(
    pkg.name === "speckiwi" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version)
      ? check("package-json-version", "pass", `package.json reports ${pkg.name}@${pkg.version}`)
      : check("package-json-version", "fail", "package.json name or version is invalid", "Set package.json name to speckiwi and version to a semver-like value.")
  );
  checks.push(
    pkg.bin?.speckiwi === "./bin/speckiwi"
      ? check("cli-bin-entrypoint", "pass", "package exposes bin/speckiwi")
      : check("cli-bin-entrypoint", "fail", "package bin.speckiwi is missing or stale", "Set package.json bin.speckiwi to ./bin/speckiwi.")
  );

  const lockPath = path.join(packageRoot, "package-lock.json");
  if (await exists(lockPath)) {
    const lock = await readJson<PackageLockJson>(lockPath);
    const rootLock = lock.packages?.[""];
    const aligned = lock.name === pkg.name && lock.version === pkg.version && rootLock?.name === pkg.name && rootLock.version === pkg.version;
    checks.push(
      aligned
        ? check("package-lock-version", "pass", "package-lock release identity matches package.json")
        : check("package-lock-version", "fail", "package-lock release identity is stale", "Run npm install --package-lock-only or npm install to refresh package-lock.json.")
    );
  } else {
    checks.push(check("package-lock-version", "skip", "package-lock.json is not present in this installed package", "Run the release smoke gate from the repository checkout before publishing."));
  }

  const missingSkillFiles: string[] = [];
  for (const relativePath of EXPECTED_SKILL_ENTRYPOINTS) {
    if (!(await exists(path.join(packageRoot, relativePath)))) missingSkillFiles.push(relativePath);
  }
  checks.push(
    missingSkillFiles.length === 0
      ? check("packed-skill-entrypoints", "pass", "Codex, Claude, and etc skill entrypoints are present with SKILL.md casing")
      : check("packed-skill-entrypoints", "fail", "one or more packaged skill entrypoints are missing", "Ensure package.json files includes skills/codex, skills/claude, and skills/etc.", { missingSkillFiles })
  );

  const metadata = getServerMetadata(pkg);
  checks.push(
    metadata.name === pkg.name && metadata.version === pkg.version
      ? check("mcp-server-metadata", "pass", `MCP metadata reports ${metadata.name}@${metadata.version}`)
      : check("mcp-server-metadata", "fail", "MCP metadata does not match package.json", "Bind MCP metadata from package.json instead of hard-coding a version.")
  );

  const server = createMcpServer({ root: root.root });
  const tools = Object.keys(server.tools).filter((name) => !name.startsWith("resource:")).sort();
  const missingSchemas = tools.filter((name) => toolSchemas[name] === undefined);
  checks.push(
    missingSchemas.length === 0
      ? check("mcp-tool-schema-listing", "pass", `MCP registered ${tools.length} tools with schemas`)
      : check("mcp-tool-schema-listing", "fail", "registered MCP tools are missing schemas", "Add missing toolSchemas entries before release.", { missingSchemas })
  );

  const activeTargetRead = await server.callTool("get_active_target", {});
  const activeTarget = activeTargetFromMcp(activeTargetRead);
  checks.push(
    isOkToolResult(activeTargetRead)
      ? check("mcp-active-target-read", "pass", activeTarget ? `MCP read active target ${activeTarget}` : "MCP read active target; value is empty")
      : check("mcp-active-target-read", "fail", "MCP get_active_target failed", "Run speckiwi init or fix docs/spec/00.index.md before starting MCP.")
  );

  const validationRead = await server.callTool("validate_spec", {});
  checks.push(
    validateResultIsClean(validationRead)
      ? check("mcp-validation-read", "pass", "MCP validate_spec completed with zero errors")
      : check("mcp-validation-read", "fail", "MCP validate_spec reported errors or failed", "Run speckiwi validate --json and fix reported SRS diagnostics.")
  );

  const dryRunMutation = await server.callTool("set_active_target", {
    target: "doctor-smoke",
    create: true,
    type: "version",
    description: "SpecKiwi doctor dry-run smoke",
    dryRun: true
  });
  checks.push(
    isOkToolResult(dryRunMutation)
      ? check("mcp-dry-run-mutation", "pass", "MCP dry-run target lifecycle mutation completed without writing")
      : check("mcp-dry-run-mutation", "fail", "MCP dry-run mutation path failed", "Check mutation schemas and SRS mutation lock state, then retry with speckiwi doctor --json.")
  );

  const summary = summarize(checks);
  return {
    ok: summary.fail === 0,
    package: { root: packageRoot, name: pkg.name, version: pkg.version },
    workspace: { root: root.root, activeTarget },
    mcp: { metadata, tools },
    checks,
    summary
  };
}
