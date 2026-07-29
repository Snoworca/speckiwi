import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fail, ok, type Result } from "../result.js";
import {
  SKILL_AGENTS,
  type McpPreflight,
  type SkillAgent,
  type SkillIdentity,
  type SkillInstallItemResult,
  type SkillInstallOptions,
  type SkillInstallPlan,
  type SkillInstallScope,
  type SkillPackage,
  type SkillPackageFile
} from "./types.js";

class SkillInstallError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const SOURCE_ROOT_BY_AGENT: Record<SkillAgent, "codex" | "claude" | "etc"> = {
  codex: "codex",
  claude: "claude",
  opencode: "etc",
  hermes: "etc"
};

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CATEGORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const INSTALL_METADATA_FILE = ".speckiwi-skill-install.json";
const execFileAsync = promisify(execFile);

interface SkillInstallMetadata {
  name?: string;
  agent?: string;
  category?: string;
  installedAt?: string;
  installMode?: string;
  sourceAgent?: string;
  sourceRoot?: string;
  sourcePath?: string;
  installedPath?: string;
  sourceRevision?: string;
  sourceChecksum?: string;
  installedChecksum?: string;
  sourceFileCount?: number;
  installedFileCount?: number;
  sharedResourceRoot?: string;
  sharedResourceValidation?: string;
  sharedResourceReferences?: string[];
  refreshCommand?: string;
  noManualEdit?: boolean;
}

export async function planSkillInstall(options: SkillInstallOptions): Promise<Result<SkillInstallPlan>> {
  try {
    const normalized = normalizeOptions(options);
    const sourceRoot = await resolveSourceRoot(normalized);
    const names = await resolveSkillNames(sourceRoot, normalized.selector, normalized.agent);
    const destinationRoot = await resolveDestinationRoot(normalized, names);
    await assertDestinationRootSafe(destinationRoot);
    const results: SkillInstallItemResult[] = [];
    for (const name of names) {
      const sourcePackage = await readSourcePackage(sourceRoot, name, normalized.agent);
      results.push(await planOne(sourcePackage, normalized, sourceRoot, destinationRoot));
    }
    return ok({
      agent: normalized.agent,
      scope: normalized.scope,
      sourceRoot,
      destinationRoot,
      requiresMcp: true,
      mcpPreflight: defaultMcpPreflight(),
      dryRun: Boolean(normalized.dryRun),
      results
    });
  } catch (error) {
    if (error instanceof SkillInstallError) return fail(error.code, error.message);
    throw error;
  }
}

export async function installSkill(options: SkillInstallOptions): Promise<Result<SkillInstallPlan>> {
  const planned = await planSkillInstall(options);
  if (!planned.ok) return planned;
  if (planned.value.dryRun) return planned;
  const conflicts = planned.value.results.filter((result) => result.operation === "conflict");
  if (conflicts.length > 0) {
    return fail(
      "SKILL_INSTALL_CONFLICT",
      `skill install has ${conflicts.length} conflict(s) and made no changes`,
      conflicts.flatMap((result) =>
        result.conflicts.map((message) => ({
          code: "SKILL_INSTALL_CONFLICT",
          severity: "error" as const,
          message: `${result.name}: ${message}`
        }))
      )
    );
  }

  const executedResults: SkillInstallItemResult[] = [];
  try {
    for (const result of planned.value.results) {
      if (result.operation === "skip") {
        executedResults.push(result);
        continue;
      }
      const sourcePackage = await readSourcePackage(planned.value.sourceRoot, result.name, planned.value.agent);
      await executeOne(sourcePackage, result.destination, result.identity);
      executedResults.push(result);
    }
    await syncSharedMirror(planned.value.sourceRoot, planned.value.destinationRoot);
    return ok({ ...planned.value, results: executedResults });
  } catch (error) {
    if (error instanceof SkillInstallError) return fail(error.code, error.message);
    throw error;
  }
}

// FR-NODE-069 — orphaned kiwi-* skill prune. Removes only kiwi-* directories that are speckiwi-managed
// runtime mirrors (carry .speckiwi-skill-install.json for the matching agent), are absent from the newly
// resolved source set, are not symlinks (nor contain symlinked entries), and whose on-disk contents match
// the recorded install checksum. A drifted (locally edited) or user-authored directory is warned, not
// deleted. Non-kiwi directories are never touched.
export interface OrphanSkillPruneOptions {
  destinationRoot: string;
  agent: SkillAgent;
  sourceSkillNames: string[];
  dryRun?: boolean;
}

export interface OrphanSkillPruneResult {
  removed: string[];
  warnings: string[];
}

export async function pruneOrphanKiwiSkills(options: OrphanSkillPruneOptions): Promise<OrphanSkillPruneResult> {
  const removed: string[] = [];
  const warnings: string[] = [];
  const keep = new Set(options.sourceSkillNames);
  if (!(await directoryExists(options.destinationRoot))) return { removed, warnings };
  const entries = await readdir(options.destinationRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.startsWith("kiwi-")) continue;
    if (keep.has(entry.name)) continue;
    const candidate = path.join(options.destinationRoot, entry.name);
    try {
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) {
        warnings.push(`Skipped ${candidate}: refusing to remove a symlinked skill directory.`);
        continue;
      }
      if (!stats.isDirectory()) continue;
      const metadata = await readInstallMetadata(candidate);
      if (!metadata) continue; // user-authored (no speckiwi metadata) — never remove
      // The metadata must positively identify THIS directory as a speckiwi-managed mirror for this
      // agent AND this exact name. The directory name is not part of the checksum, so a verbatim copy
      // of a managed dir to a new name would otherwise pass the checksum gate — guard against deleting it.
      if (metadata.installMode !== "generated-runtime-mirror" || metadata.agent !== options.agent || metadata.name !== entry.name) continue;
      const currentChecksum = await destinationDigest(candidate);
      if (currentChecksum !== metadata.installedChecksum) {
        warnings.push(`Skipped ${candidate}: on-disk contents differ from the recorded install checksum (local edits).`);
        continue;
      }
      // Only report a directory as removed once the delete has actually succeeded (in dry-run there is
      // no delete, so record the intended removal). A failing rm falls through to the catch as a warning.
      if (options.dryRun) {
        removed.push(candidate);
      } else {
        await rm(candidate, { recursive: true, force: true });
        removed.push(candidate);
      }
    } catch (error) {
      // Any filesystem error (unreadable entry, a symlink nested inside caught by destinationDigest, an
      // rm failure, or a readdir/lstat race) degrades to a warning — the prune never aborts init.
      warnings.push(`Skipped ${candidate}: ${(error as Error).message}`);
    }
  }
  return { removed, warnings };
}

/** Recomputes the install checksum (packageDigest format) over a destination skill directory's files. */
async function destinationDigest(directory: string): Promise<string> {
  const relativePaths: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", `installed skill contains a symlink: ${absolutePath}`);
      }
      if (stats.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!stats.isFile()) continue;
      const relativePath = toPosix(path.relative(directory, absolutePath));
      if (relativePath === INSTALL_METADATA_FILE) continue;
      relativePaths.push(relativePath);
    }
  }
  await walk(directory);
  relativePaths.sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(createHash("sha256").update(await readFile(path.join(directory, relativePath))).digest("hex"));
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

function normalizeOptions(options: SkillInstallOptions): Required<Pick<SkillInstallOptions, "projectRoot" | "agent" | "selector" | "scope" | "dryRun">> &
  Omit<SkillInstallOptions, "projectRoot" | "agent" | "selector" | "scope" | "dryRun"> {
  assertSupportedAgent(options.agent);
  const scope: SkillInstallScope = options.dest ? "custom" : options.scope ?? "project";
  if (options.dest && options.scope === "global") {
    throw new SkillInstallError("SKILL_INSTALL_INVALID_OPTIONS", "--dest and --global scope are mutually exclusive");
  }
  if (options.category && !(options.agent === "hermes" && scope === "global")) {
    throw new SkillInstallError("SKILL_INSTALL_INVALID_OPTIONS", "--category is only valid for Hermes global installs");
  }
  if (options.agent === "hermes" && scope === "project" && !options.dest) {
    throw new SkillInstallError("SKILL_INSTALL_UNSUPPORTED_SCOPE", "Hermes project installs require --dest");
  }
  if (options.category) validateCategory(options.category);
  return { ...options, scope, dryRun: Boolean(options.dryRun) };
}

async function resolveSourceRoot(options: SkillInstallOptions): Promise<string> {
  const sourceSubdir = SOURCE_ROOT_BY_AGENT[options.agent];
  const sourceBaseDir = options.sourceBaseDir ? path.resolve(options.sourceBaseDir) : await locateBundledSkillsRoot(options.projectRoot.root, sourceSubdir);
  if (isDeprecatedLlmSourceBaseDir(sourceBaseDir)) {
    throw new SkillInstallError("SKILL_INSTALL_DEPRECATED_SOURCE", "skills/llm is not a canonical source root");
  }
  const sourceRoot = path.join(sourceBaseDir, sourceSubdir);
  if (path.basename(sourceRoot).toLowerCase() === "llm") {
    throw new SkillInstallError("SKILL_INSTALL_DEPRECATED_SOURCE", "skills/llm is not a canonical source root");
  }
  await assertDirectory(sourceRoot, "SKILL_SOURCE_UNAVAILABLE", `skill source root not found: ${sourceRoot}`);
  return sourceRoot;
}

async function locateBundledSkillsRoot(projectRoot: string, sourceSubdir: string): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const starts = [projectRoot, process.cwd(), moduleDir];
  for (const start of starts) {
    const found = await findAncestorWithSkills(start, sourceSubdir);
    if (found) return found;
  }
  throw new SkillInstallError("SKILL_SOURCE_UNAVAILABLE", "bundled skills source roots are unavailable");
}

async function findAncestorWithSkills(start: string, sourceSubdir: string): Promise<string | undefined> {
  let current = path.resolve(start);
  for (;;) {
    const candidate = path.join(current, "skills");
    if (await directoryExists(path.join(candidate, sourceSubdir))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function resolveSkillNames(sourceRoot: string, selector: string, agent: SkillAgent): Promise<string[]> {
  if (selector === "all") {
    const entries = await readdir(sourceRoot, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      if (await hasSupportedEntrypoint(path.join(sourceRoot, entry.name), agent)) names.push(entry.name);
    }
    return names.sort((left, right) => left.localeCompare(right));
  }
  assertSafeSkillName(selector);
  return [selector];
}

async function resolveDestinationRoot(options: SkillInstallOptions, names: string[]): Promise<string> {
  if (options.dest) return path.resolve(options.projectRoot.root, options.dest);
  if (options.scope === "custom") {
    throw new SkillInstallError("SKILL_INSTALL_INVALID_OPTIONS", "custom scope requires --dest");
  }
  if (options.scope === "project") {
    switch (options.agent) {
      case "codex":
        return path.join(options.projectRoot.root, ".agents", "skills");
      case "claude":
        return path.join(options.projectRoot.root, ".claude", "skills");
      case "opencode":
        return path.join(options.projectRoot.root, ".opencode", "skills");
      case "hermes":
        throw new SkillInstallError("SKILL_INSTALL_UNSUPPORTED_SCOPE", "Hermes project installs require --dest");
    }
  }
  const homeDir = options.homeDir ? path.resolve(options.homeDir) : process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!homeDir) throw new SkillInstallError("SKILL_INSTALL_INVALID_OPTIONS", "home directory is unavailable");
  switch (options.agent) {
    case "codex":
      await rejectAmbiguousCodexGlobal(options, homeDir, names);
      return path.join(options.env?.CODEX_HOME ? path.resolve(options.env.CODEX_HOME) : path.join(homeDir, ".codex"), "skills");
    case "claude":
      return path.join(homeDir, ".claude", "skills");
    case "opencode":
      return path.join(homeDir, ".config", "opencode", "skills");
    case "hermes":
      return path.join(homeDir, ".hermes", "skills", options.category ?? "kiwi");
  }
}

async function rejectAmbiguousCodexGlobal(options: SkillInstallOptions, homeDir: string, names: string[]): Promise<void> {
  const codexHomeRoot = path.join(options.env?.CODEX_HOME ? path.resolve(options.env.CODEX_HOME) : path.join(homeDir, ".codex"), "skills");
  const agentsRoot = path.join(homeDir, ".agents", "skills");
  if (path.resolve(codexHomeRoot) === path.resolve(agentsRoot)) return;
  for (const name of names) {
    if (await directoryExists(path.join(codexHomeRoot, name)) && await directoryExists(path.join(agentsRoot, name))) {
      throw new SkillInstallError("SKILL_INSTALL_AMBIGUOUS_DESTINATION", `Codex skill ${name} exists in multiple global roots; use --dest`);
    }
  }
}

async function planOne(sourcePackage: SkillPackage, options: SkillInstallOptions, sourceRoot: string, destinationRoot: string): Promise<SkillInstallItemResult> {
  const destination = safeDestination(destinationRoot, sourcePackage.name);
  const identity = buildIdentity(sourcePackage.name, options.agent, sourceRoot, options);
  const fileOperations = sourcePackage.files.map((file) => ({
    source: file.sourceRelativePath,
    destination: file.destinationRelativePath,
    ...(file.sourceRelativePath !== file.destinationRelativePath ? { normalized: true } : {})
  }));
  const existing = await classifyExistingDestination(destination, sourcePackage, identity, options.scope ?? "project");
  return {
    name: sourcePackage.name,
    identity,
    operation: existing.operation,
    changed: existing.changed,
    source: sourcePackage.sourceDirectory,
    destination,
    entrypoint: "SKILL.md",
    sourceEntrypoint: sourcePackage.sourceEntrypoint,
    entrypointNormalized: sourcePackage.entrypointNormalized,
    filesCopied: existing.operation === "install" || existing.operation === "update" ? sourcePackage.files.length : 0,
    filesRemoved: existing.removedFiles,
    fileOperations,
    conflicts: existing.conflicts,
    validationFindings: existing.validationFindings
  };
}

function buildIdentity(name: string, agent: SkillAgent, sourceRoot: string, options: SkillInstallOptions): SkillIdentity {
  const identity: SkillIdentity = { name, agent, sourceRoot };
  if (agent === "hermes" && options.scope === "global") identity.category = options.category ?? "kiwi";
  return identity;
}

async function classifyExistingDestination(destination: string, sourcePackage: SkillPackage, identity: SkillIdentity, scope: SkillInstallScope): Promise<{
  operation: "install" | "update" | "skip" | "conflict";
  changed: boolean;
  removedFiles: number;
  conflicts: string[];
  validationFindings: string[];
}> {
  if (!await pathExists(destination)) return { operation: "install", changed: true, removedFiles: 0, conflicts: [], validationFindings: [] };
  const stat = await lstat(destination);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return { operation: "conflict", changed: false, removedFiles: 0, conflicts: ["destination is not a normal directory"], validationFindings: [] };
  }
  const symlink = await findFirstSymlink(destination);
  if (symlink) {
    return { operation: "conflict", changed: false, removedFiles: 0, conflicts: [`destination contains symlink: ${symlink}`], validationFindings: [] };
  }
  const destinationPackage = await readDestinationPackage(destination);
  if (!destinationPackage) {
    return { operation: "conflict", changed: false, removedFiles: 0, conflicts: ["destination does not contain a valid skill entrypoint"], validationFindings: [] };
  }
  if (path.basename(destination) !== sourcePackage.name || destinationPackage.name !== identity.name) {
    return { operation: "conflict", changed: false, removedFiles: 0, conflicts: ["destination skill identity does not match source skill"], validationFindings: [] };
  }
  const metadata = await readInstallMetadata(destination);
  if (metadata) {
    if (metadata.name !== identity.name || metadata.agent !== identity.agent || (metadata.category ?? "") !== (identity.category ?? "")) {
      return { operation: "conflict", changed: false, removedFiles: 0, conflicts: ["destination install metadata identity does not match source skill"], validationFindings: [] };
    }
  } else if (scope === "custom") {
    return { operation: "conflict", changed: false, removedFiles: 0, conflicts: ["custom destination lacks SpecKiwi install metadata for same-identity update"], validationFindings: [] };
  }
  const comparison = await comparePackageToDestination(sourcePackage, destination);
  if (comparison.identical && metadata) {
    const expectedMetadata = await buildInstallMetadata(sourcePackage, destination, identity);
    if (metadataMatchesExpected(metadata, expectedMetadata)) {
      return { operation: "skip", changed: false, removedFiles: 0, conflicts: [], validationFindings: [] };
    }
  }
  return { operation: "update", changed: true, removedFiles: comparison.staleFiles, conflicts: [], validationFindings: [] };
}

async function readSourcePackage(sourceRoot: string, name: string, agent: SkillAgent): Promise<SkillPackage> {
  assertSafeSkillName(name);
  const sourceDirectory = path.join(sourceRoot, name);
  await assertDirectory(sourceDirectory, "SKILL_INSTALL_INVALID_SOURCE", `skill source is not a directory: ${name}`);
  const symlink = await findFirstSymlink(sourceDirectory);
  if (symlink) throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", `skill source contains symlink: ${symlink}`);
  const entrypoint = await findSupportedEntrypoint(sourceDirectory, agent);
  if (!entrypoint) throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", `skill source ${name} does not contain SKILL.md`);
  const entryText = await readFile(path.join(sourceDirectory, entrypoint), "utf8");
  const frontmatter = parseFrontmatter(entryText);
  if (frontmatter.name !== name) {
    throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", `skill frontmatter name must match folder: ${name}`);
  }
  const files = await listPackageFiles(sourceDirectory, entrypoint);
  await validateReferencedResources(sourceDirectory, files);
  await collectSharedResourceReferences(sourceRoot, files);
  return {
    name,
    sourceDirectory,
    sourceEntrypoint: entrypoint,
    entrypointNormalized: entrypoint === "skill.md",
    files
  };
}

async function readDestinationPackage(destination: string): Promise<{ name: string } | undefined> {
  const entrypoint = await findExactFile(destination, ["SKILL.md", "skill.md"]);
  if (!entrypoint) return undefined;
  try {
    const text = await readFile(path.join(destination, entrypoint), "utf8");
    return parseFrontmatter(text);
  } catch {
    return undefined;
  }
}

async function readInstallMetadata(destination: string): Promise<SkillInstallMetadata | undefined> {
  const metadataPath = path.join(destination, INSTALL_METADATA_FILE);
  if (!await pathExists(metadataPath)) return undefined;
  try {
    return JSON.parse(await readFile(metadataPath, "utf8")) as SkillInstallMetadata;
  } catch {
    return undefined;
  }
}

async function listPackageFiles(root: string, sourceEntrypoint: "SKILL.md" | "skill.md"): Promise<SkillPackageFile[]> {
  const files: SkillPackageFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", `skill source contains symlink: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const sourceRelativePath = toPosix(path.relative(root, absolutePath));
      const destinationRelativePath = sourceRelativePath === sourceEntrypoint ? "SKILL.md" : sourceRelativePath;
      files.push({ sourceRelativePath, destinationRelativePath, absolutePath, mode: stat.mode });
    }
  }
  await walk(root);
  return files.sort((left, right) => left.destinationRelativePath.localeCompare(right.destinationRelativePath));
}

async function validateReferencedResources(root: string, files: SkillPackageFile[]): Promise<void> {
  const fileSet = new Set(files.map((file) => file.sourceRelativePath));
  const resourcePattern = /\]\(((?:scripts|references|assets)\/[A-Za-z0-9._/-]+)\)/g;
  for (const file of files) {
    if (!file.sourceRelativePath.toLowerCase().endsWith(".md")) continue;
    const text = await readFile(file.absolutePath, "utf8");
    for (const match of text.matchAll(resourcePattern)) {
      const candidate = match[1]?.replace(/[),.;:]+$/g, "");
      if (!candidate) continue;
      const target = safeRelativeDestination(root, candidate);
      if (!fileSet.has(toPosix(path.relative(root, target))) && !await pathExists(target)) {
        throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", `referenced skill resource is missing: ${candidate}`);
      }
    }
  }
}

async function collectSharedResourceReferences(sourceRoot: string, files: SkillPackageFile[]): Promise<string[]> {
  const references = new Set<string>();
  const sharedRoot = path.join(sourceRoot, "_shared", "kiwi");
  const pattern = /(?:^|[\s('"`])((?:\.\.\/)+_shared\/kiwi\/[A-Za-z0-9._/-]+)/g;
  for (const file of files) {
    if (!file.sourceRelativePath.toLowerCase().endsWith(".md")) continue;
    const text = await readFile(file.absolutePath, "utf8");
    for (const match of text.matchAll(pattern)) {
      const reference = match[1]?.replace(/[),.;:'"`]+$/g, "");
      if (!reference) continue;
      const target = path.resolve(path.dirname(file.absolutePath), reference);
      const relativeToShared = path.relative(sharedRoot, target);
      if (relativeToShared.startsWith("..") || path.isAbsolute(relativeToShared)) {
        throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", `shared Kiwi resource reference escapes shared root: ${reference}`);
      }
      const sourceRelativePath = toPosix(path.relative(sourceRoot, target));
      if (!await pathExists(target)) {
        throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", `referenced shared Kiwi resource is missing: ${sourceRelativePath}`);
      }
      references.add(sourceRelativePath);
    }
  }
  return [...references].sort((left, right) => left.localeCompare(right));
}

async function comparePackageToDestination(sourcePackage: SkillPackage, destination: string): Promise<{ identical: boolean; staleFiles: number }> {
  const sourceFiles = new Map(sourcePackage.files.map((file) => [file.destinationRelativePath, file]));
  const destinationFiles = await listDestinationFiles(destination);
  destinationFiles.delete(INSTALL_METADATA_FILE);
  if (destinationFiles.size !== sourceFiles.size) {
    return { identical: false, staleFiles: [...destinationFiles.keys()].filter((file) => !sourceFiles.has(file)).length };
  }
  for (const [relativePath, sourceFile] of sourceFiles) {
    const destinationFile = destinationFiles.get(relativePath);
    if (!destinationFile) return { identical: false, staleFiles: 0 };
    const [left, right] = await Promise.all([readFile(sourceFile.absolutePath), readFile(destinationFile)]);
    if (!left.equals(right)) return { identical: false, staleFiles: 0 };
  }
  return { identical: true, staleFiles: 0 };
}

async function listDestinationFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new SkillInstallError("SKILL_INSTALL_CONFLICT", `destination contains symlink: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile()) files.set(toPosix(path.relative(root, absolutePath)), absolutePath);
    }
  }
  await walk(root);
  return files;
}

async function executeOne(sourcePackage: SkillPackage, destination: string, identity: SkillIdentity): Promise<void> {
  const destinationRoot = path.dirname(destination);
  await mkdir(destinationRoot, { recursive: true });
  const stage = await mkdtemp(path.join(destinationRoot, `.speckiwi-${sourcePackage.name}-stage-`));
  const backup = path.join(destinationRoot, `.speckiwi-${sourcePackage.name}-backup-${Date.now()}`);
  try {
    await copyPackageTo(sourcePackage, stage, identity, destination);
    await validateInstalledPackage(stage, sourcePackage.name);
    const destinationExists = await pathExists(destination);
    if (destinationExists) await rename(destination, backup);
    await rename(stage, destination);
    await validateInstalledPackage(destination, sourcePackage.name);
    if (destinationExists) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    if (await pathExists(backup)) {
      await rm(destination, { recursive: true, force: true }).catch(() => undefined);
      await rename(backup, destination).catch(() => undefined);
    }
    if (error instanceof SkillInstallError) throw error;
    throw new SkillInstallError("SKILL_INSTALL_FAILED", error instanceof Error ? error.message : "skill install failed");
  }
}

async function copyPackageTo(sourcePackage: SkillPackage, destination: string, identity: SkillIdentity, finalDestination = destination): Promise<void> {
  for (const file of sourcePackage.files) {
    const target = safeRelativeDestination(destination, file.destinationRelativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file.absolutePath, target, fsConstants.COPYFILE_FICLONE).catch(async () => copyFile(file.absolutePath, target));
    await chmod(target, file.mode & 0o777).catch(() => undefined);
  }
  const metadata = await buildInstallMetadata(sourcePackage, finalDestination, identity);
  await writeFile(path.join(destination, INSTALL_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function syncSharedMirror(sourceRoot: string, destinationRoot: string): Promise<void> {
  const desired = await collectDesiredSharedResources(sourceRoot, destinationRoot);
  if (desired.size === 0) return;
  const sharedSourceRoot = path.join(sourceRoot, "_shared", "kiwi");
  const sharedMirrorRoot = path.join(destinationRoot, "_shared", "kiwi");
  for (const relativePath of desired) {
    const source = safeRelativeDestination(sharedSourceRoot, relativePath);
    const stat = await lstat(source).catch(() => undefined);
    if (!stat?.isFile()) continue;
    const target = safeRelativeDestination(sharedMirrorRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    const existingTarget = await lstat(target).catch(() => undefined);
    if (existingTarget?.isSymbolicLink()) await rm(target, { force: true });
    await copyFile(source, target, fsConstants.COPYFILE_FICLONE).catch(async () => copyFile(source, target));
    await chmod(target, stat.mode & 0o777).catch(() => undefined);
  }
  await pruneSharedMirror(sharedMirrorRoot, desired);
}

async function collectDesiredSharedResources(sourceRoot: string, destinationRoot: string): Promise<Set<string>> {
  const desired = new Set<string>();
  const entries = await readdir(destinationRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || !SKILL_NAME_PATTERN.test(entry.name)) continue;
    const skillDir = path.join(destinationRoot, entry.name);
    if (!await pathExists(path.join(skillDir, "SKILL.md"))) continue;
    await collectSkillSharedReferences(destinationRoot, skillDir, desired);
  }
  // @req FR-NODE-090 — a skill the workspace excludes from the mirror is never in the destination,
  // so its references are read from the source tree instead. Without this the prune deletes the
  // contracts an excluded skill depends on, and it deletes them on every install.
  for (const name of await readMirrorExclusions(destinationRoot)) {
    if (!SKILL_NAME_PATTERN.test(name)) continue;
    const skillDir = path.join(sourceRoot, name);
    if (!await pathExists(path.join(skillDir, "SKILL.md"))) continue;
    await collectSkillSharedReferences(sourceRoot, skillDir, desired);
  }
  return desired;
}

/**
 * @req FR-NODE-090 — the workspace-committed manifest naming skills that are intentionally not
 * mirrored. An absent or unparseable manifest yields an empty set, so a workspace that never
 * excluded anything prunes exactly as it did before.
 */
async function readMirrorExclusions(destinationRoot: string): Promise<Set<string>> {
  const raw = await readFile(path.join(destinationRoot, ".speckiwi-mirror-exclusions.json"), "utf8").catch(() => undefined);
  if (raw === undefined) return new Set();
  try {
    const parsed = JSON.parse(raw) as { excluded?: unknown };
    if (!Array.isArray(parsed.excluded)) return new Set();
    return new Set(parsed.excluded.filter((name): name is string => typeof name === "string"));
  } catch {
    return new Set();
  }
}

async function collectSkillSharedReferences(destinationRoot: string, skillDir: string, desired: Set<string>): Promise<void> {
  const sharedMirrorRoot = path.resolve(destinationRoot, "_shared", "kiwi");
  const pattern = /(?:^|[\s('"`])((?:\.\.\/)+_shared\/kiwi\/[A-Za-z0-9._/-]+)/g;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const text = await readFile(absolutePath, "utf8");
      for (const match of text.matchAll(pattern)) {
        const reference = match[1]?.replace(/[),.;:'"`]+$/g, "");
        if (!reference) continue;
        const resolved = path.resolve(path.dirname(absolutePath), reference);
        const relativePath = path.relative(sharedMirrorRoot, resolved);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;
        desired.add(toPosix(relativePath));
      }
    }
  }
  await walk(skillDir);
}

async function pruneSharedMirror(sharedMirrorRoot: string, desired: Set<string>): Promise<void> {
  if (!await directoryExists(sharedMirrorRoot)) return;
  const existing = await listSharedMirrorFiles(sharedMirrorRoot);
  for (const relativePath of existing) {
    if (desired.has(relativePath)) continue;
    await rm(safeRelativeDestination(sharedMirrorRoot, relativePath), { force: true });
  }
}

async function listSharedMirrorFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile()) files.push(toPosix(path.relative(root, absolutePath)));
    }
  }
  await walk(root);
  return files;
}

async function buildInstallMetadata(sourcePackage: SkillPackage, destination: string, identity: SkillIdentity): Promise<Required<Omit<SkillInstallMetadata, "category">> & { category?: string }> {
  const projectRoot = inferProjectRoot(identity.sourceRoot);
  const sourceDigest = await packageDigest(sourcePackage);
  const sharedResourceReferences = await collectSharedResourceReferences(identity.sourceRoot, sourcePackage.files);
  const installedPath = projectRoot ? toProjectPath(projectRoot, destination) : toPosix(path.resolve(destination));
  const sourceRoot = projectRoot ? toProjectPath(projectRoot, identity.sourceRoot) : toPosix(path.resolve(identity.sourceRoot));
  const sourcePath = projectRoot ? toProjectPath(projectRoot, sourcePackage.sourceDirectory) : toPosix(path.resolve(sourcePackage.sourceDirectory));
  const destinationRoot = path.dirname(destination);
  return {
    name: identity.name,
    agent: identity.agent,
    ...(identity.category ? { category: identity.category } : {}),
    installedAt: new Date().toISOString(),
    installMode: "generated-runtime-mirror",
    sourceAgent: path.basename(identity.sourceRoot),
    sourceRoot,
    sourcePath,
    installedPath,
    sourceRevision: await resolveSourceRevision(projectRoot),
    sourceChecksum: sourceDigest.checksum,
    installedChecksum: sourceDigest.checksum,
    sourceFileCount: sourceDigest.fileCount,
    installedFileCount: sourceDigest.fileCount,
    sharedResourceRoot: projectRoot ? toProjectPath(projectRoot, path.join(destinationRoot, "_shared", "kiwi")) : toPosix(path.resolve(destinationRoot, "_shared", "kiwi")),
    sharedResourceValidation: sharedResourceReferences.length > 0 ? "source-references-validated" : "not-required",
    sharedResourceReferences,
    refreshCommand: buildRefreshCommand(identity, projectRoot, destinationRoot),
    noManualEdit: true
  };
}

async function packageDigest(sourcePackage: SkillPackage): Promise<{ checksum: string; fileCount: number }> {
  const hash = createHash("sha256");
  for (const file of sourcePackage.files) {
    hash.update(file.destinationRelativePath);
    hash.update("\0");
    hash.update(createHash("sha256").update(await readFile(file.absolutePath)).digest("hex"));
    hash.update("\n");
  }
  return { checksum: `sha256:${hash.digest("hex")}`, fileCount: sourcePackage.files.length };
}

function metadataMatchesExpected(metadata: SkillInstallMetadata, expected: SkillInstallMetadata): boolean {
  return (
    metadata.name === expected.name &&
    metadata.agent === expected.agent &&
    (metadata.category ?? "") === (expected.category ?? "") &&
    metadata.installMode === expected.installMode &&
    metadata.sourceAgent === expected.sourceAgent &&
    metadata.sourceRoot === expected.sourceRoot &&
    metadata.sourcePath === expected.sourcePath &&
    metadata.installedPath === expected.installedPath &&
    metadata.sourceRevision === expected.sourceRevision &&
    metadata.sourceChecksum === expected.sourceChecksum &&
    metadata.installedChecksum === expected.installedChecksum &&
    metadata.sourceFileCount === expected.sourceFileCount &&
    metadata.installedFileCount === expected.installedFileCount &&
    metadata.sharedResourceRoot === expected.sharedResourceRoot &&
    metadata.sharedResourceValidation === expected.sharedResourceValidation &&
    JSON.stringify(metadata.sharedResourceReferences ?? []) === JSON.stringify(expected.sharedResourceReferences ?? []) &&
    metadata.refreshCommand === expected.refreshCommand &&
    metadata.noManualEdit === true
  );
}

function inferProjectRoot(sourceRoot: string): string | undefined {
  const skillsRoot = path.dirname(sourceRoot);
  if (path.basename(skillsRoot) !== "skills") return undefined;
  return path.dirname(skillsRoot);
}

async function resolveSourceRevision(projectRoot: string | undefined): Promise<string> {
  if (!projectRoot) return "unknown";
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, "rev-parse", "HEAD"]);
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function buildRefreshCommand(identity: SkillIdentity, projectRoot: string | undefined, destinationRoot: string): string {
  const args = ["node", "bin/speckiwi"];
  if (projectRoot) args.push("--root", ".");
  args.push("skills", "install", identity.agent, identity.name);
  if (identity.category) args.push("--category", identity.category);
  const defaultDestination = projectRoot ? defaultProjectDestination(projectRoot, identity.agent) : undefined;
  if (!defaultDestination || path.resolve(defaultDestination) !== path.resolve(destinationRoot)) {
    args.push("--dest", projectRoot ? toProjectPath(projectRoot, destinationRoot) : toPosix(path.resolve(destinationRoot)));
  }
  args.push("--json");
  return args.map(shellToken).join(" ");
}

function defaultProjectDestination(projectRoot: string, agent: SkillAgent): string | undefined {
  switch (agent) {
    case "codex":
      return path.join(projectRoot, ".agents", "skills");
    case "claude":
      return path.join(projectRoot, ".claude", "skills");
    case "opencode":
      return path.join(projectRoot, ".opencode", "skills");
    case "hermes":
      return undefined;
  }
}

function toProjectPath(projectRoot: string, target: string): string {
  const relative = path.relative(projectRoot, target);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return toPosix(relative || ".");
  return toPosix(path.resolve(target));
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

async function validateInstalledPackage(directory: string, expectedName: string): Promise<void> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillInstallError("SKILL_INSTALL_FAILED", "installed skill is not a normal directory");
  const entry = await findExactFile(directory, ["SKILL.md"]);
  if (!entry) throw new SkillInstallError("SKILL_INSTALL_FAILED", "installed skill is missing SKILL.md");
  const frontmatter = parseFrontmatter(await readFile(path.join(directory, entry), "utf8"));
  if (frontmatter.name !== expectedName) throw new SkillInstallError("SKILL_INSTALL_FAILED", "installed skill identity mismatch");
}

async function hasSupportedEntrypoint(directory: string, agent: SkillAgent): Promise<boolean> {
  return (await findSupportedEntrypoint(directory, agent)) !== undefined;
}

async function findSupportedEntrypoint(directory: string, agent: SkillAgent): Promise<"SKILL.md" | "skill.md" | undefined> {
  const exact = await findExactFile(directory, ["SKILL.md"]);
  if (exact === "SKILL.md") return "SKILL.md";
  if (agent === "claude") {
    const legacy = await findExactFile(directory, ["skill.md"]);
    if (legacy === "skill.md") return "skill.md";
  }
  return undefined;
}

async function findExactFile(directory: string, candidates: Array<"SKILL.md" | "skill.md">): Promise<"SKILL.md" | "skill.md" | undefined> {
  const entries: string[] = await readdir(directory).catch(() => [] as string[]);
  for (const candidate of candidates) {
    if (entries.includes(candidate)) return candidate;
  }
  return undefined;
}

function parseFrontmatter(text: string): { name: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", "skill entrypoint is missing frontmatter");
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", "skill entrypoint frontmatter is not closed");
  const body = normalized.slice(4, end);
  for (const line of body.split("\n")) {
    const match = /^name:\s*(.+)\s*$/.exec(line);
    if (match?.[1]) return { name: match[1].trim().replace(/^["']|["']$/g, "") };
  }
  throw new SkillInstallError("SKILL_INSTALL_INVALID_SOURCE", "skill entrypoint frontmatter is missing name");
}

function safeDestination(destinationRoot: string, name: string): string {
  assertSafeSkillName(name);
  return safeRelativeDestination(destinationRoot, name);
}

function safeRelativeDestination(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SkillInstallError("SKILL_INSTALL_INVALID_DESTINATION", `destination escapes root: ${relativePath}`);
  }
  return resolved;
}

function assertSafeSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) throw new SkillInstallError("SKILL_INSTALL_INVALID_SKILL", `invalid skill name: ${name}`);
}

function assertSupportedAgent(agent: unknown): asserts agent is SkillAgent {
  if (typeof agent !== "string" || !(SKILL_AGENTS as readonly string[]).includes(agent)) {
    throw new SkillInstallError("SKILL_INSTALL_UNSUPPORTED_AGENT", `unsupported skill target agent: ${String(agent)}`);
  }
}

function isDeprecatedLlmSourceBaseDir(directory: string): boolean {
  const parts = path.normalize(directory).split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
  return parts.at(-1) === "llm" && parts.at(-2) === "skills";
}

function validateCategory(category: string): void {
  if (!CATEGORY_PATTERN.test(category)) throw new SkillInstallError("SKILL_INSTALL_INVALID_OPTIONS", `invalid Hermes category: ${category}`);
}

async function findFirstSymlink(root: string): Promise<string | undefined> {
  async function walk(directory: string): Promise<string | undefined> {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink()) return directory;
    if (!stat.isDirectory()) return undefined;
    const entries = await readdir(directory);
    for (const entry of entries) {
      const found = await walk(path.join(directory, entry));
      if (found) return found;
    }
    return undefined;
  }
  return walk(root);
}

async function assertDirectory(directory: string, code: string, message: string): Promise<void> {
  const stat = await lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new SkillInstallError(code, message);
}

async function assertDestinationRootSafe(destinationRoot: string): Promise<void> {
  const stat = await lstat(destinationRoot).catch(() => undefined);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SkillInstallError("SKILL_INSTALL_INVALID_DESTINATION", `destination root is not a normal directory: ${destinationRoot}`);
  }
}

async function directoryExists(directory: string): Promise<boolean> {
  const stat = await lstat(directory).catch(() => undefined);
  return Boolean(stat?.isDirectory() && !stat.isSymbolicLink());
}

async function pathExists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function defaultMcpPreflight(): McpPreflight {
  return {
    status: "not_checked",
    remediation: "Run speckiwi mcp and ensure the coding agent is connected before normal Kiwi skill workflows."
  };
}
