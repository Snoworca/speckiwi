import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { diagnostic, summarizeDiagnostics } from "./diagnostic.js";
import { parseWorkspace } from "./parser/workspace-parser.js";
import { PREFIX_TYPE, TYPE_PREFIX, type Diagnostic, type MutationResult, type ParsedWorkspace, type ProjectRoot, type RequirementType, type SrsMutationLockMetadata } from "./types.js";

export const SRS_STATUS_CACHE_PATH = "kiwi/.status.json";
export const SRS_STATUS_CACHE_SCHEMA_VERSION = "1.0.0";

export interface SrsStatusCacheFileEntry {
  path: string;
  sha256?: string;
  size?: number;
  mtimeMs?: number;
}

export interface SrsStatusCacheFingerprint {
  algorithm: "sha256";
  value: string;
  files: SrsStatusCacheFileEntry[];
}

export interface SrsStatusCacheLockMirror {
  active: boolean;
  metadata: SrsMutationLockMetadata | null;
}

export interface SrsStatusCache {
  schemaVersion: "1.0.0";
  generatedAt: string;
  source: "speckiwi";
  specFingerprint: SrsStatusCacheFingerprint;
  idCounters: Record<string, Record<string, number>>;
  lock: SrsStatusCacheLockMirror;
}

export type ReadSrsStatusCacheResult =
  | { ok: true; value: SrsStatusCache; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

function statusCacheAbsolutePath(root: ProjectRoot): string {
  return path.join(root.root, SRS_STATUS_CACHE_PATH);
}

function cacheFileEntries(workspace: ParsedWorkspace): SrsStatusCacheFileEntry[] {
  return workspace.files
    .filter((file) => file.relativePath.startsWith("docs/spec/") || file.relativePath.startsWith("docs/rule/"))
    .map((file) => ({
      path: file.relativePath,
      ...(file.snapshot?.sha256 ? { sha256: file.snapshot.sha256 } : {}),
      ...(typeof file.snapshot?.size === "number" ? { size: file.snapshot.size } : {}),
      ...(typeof file.snapshot?.mtimeMs === "number" ? { mtimeMs: file.snapshot.mtimeMs } : {})
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function computeSrsSpecFingerprint(workspace: ParsedWorkspace): SrsStatusCacheFingerprint {
  const files = cacheFileEntries(workspace);
  const value = createHash("sha256").update(JSON.stringify(files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })))).digest("hex");
  return { algorithm: "sha256", value, files };
}

export function computeSrsIdCounters(workspace: ParsedWorkspace): Record<string, Record<string, number>> {
  const counters: Record<string, Record<string, number>> = {};
  for (const record of workspace.records) {
    const match = /^([A-Z]+)-([A-Z]+)-(\d{3,4})$/.exec(record.id);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    if (PREFIX_TYPE[match[1] as keyof typeof PREFIX_TYPE] !== record.type) continue;
    const typeBucket = (counters[record.type] ??= {});
    const value = Number.parseInt(match[3], 10);
    typeBucket[match[2]] = Math.max(typeBucket[match[2]] ?? 0, value);
  }
  return counters;
}

export function buildSrsStatusCache(workspace: ParsedWorkspace, lockMetadata: SrsMutationLockMetadata | null = null): SrsStatusCache {
  return {
    schemaVersion: SRS_STATUS_CACHE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: "speckiwi",
    specFingerprint: computeSrsSpecFingerprint(workspace),
    idCounters: computeSrsIdCounters(workspace),
    lock: { active: Boolean(lockMetadata), metadata: lockMetadata }
  };
}

function cacheFallbackDiagnostic(reason: string, details: Record<string, unknown> = {}): Diagnostic {
  return diagnostic("SRS-W065", "warning", `SRS status cache ignored: ${reason}`, { filePath: SRS_STATUS_CACHE_PATH }, { reason, fallback: "full-workspace-parse", ...details });
}

function validateCacheShape(raw: unknown): SrsStatusCache | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<SrsStatusCache>;
  if (value.schemaVersion !== SRS_STATUS_CACHE_SCHEMA_VERSION) return undefined;
  if (value.source !== "speckiwi") return undefined;
  if (!value.specFingerprint || value.specFingerprint.algorithm !== "sha256" || typeof value.specFingerprint.value !== "string" || !Array.isArray(value.specFingerprint.files)) return undefined;
  if (!isValidIdCounters(value.idCounters)) return undefined;
  if (!value.lock || typeof value.lock.active !== "boolean") return undefined;
  return value as SrsStatusCache;
}

function isRequirementType(value: string): value is RequirementType {
  return Object.prototype.hasOwnProperty.call(TYPE_PREFIX, value);
}

function isValidIdCounters(value: unknown): value is Record<string, Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [type, counters] of Object.entries(value)) {
    if (!isRequirementType(type)) return false;
    if (!counters || typeof counters !== "object" || Array.isArray(counters)) return false;
    for (const [scopePrefix, counter] of Object.entries(counters)) {
      if (!/^[A-Z0-9][A-Z0-9-]{1,24}$/.test(scopePrefix)) return false;
      if (typeof counter !== "number" || !Number.isInteger(counter) || counter < 0) return false;
    }
  }
  return true;
}

export async function readSrsStatusCache(root: ProjectRoot): Promise<ReadSrsStatusCacheResult> {
  try {
    const parsed = JSON.parse(await readFile(statusCacheAbsolutePath(root), "utf8")) as unknown;
    const cache = validateCacheShape(parsed);
    if (!cache) return { ok: false, diagnostics: [cacheFallbackDiagnostic("malformed-cache")] };
    return { ok: true, value: cache, diagnostics: [] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, diagnostics: [] };
    return { ok: false, diagnostics: [cacheFallbackDiagnostic("unreadable-cache", { error: (error as Error).message })] };
  }
}

export async function readFreshSrsStatusCache(root: ProjectRoot, workspace: ParsedWorkspace): Promise<ReadSrsStatusCacheResult> {
  const read = await readSrsStatusCache(root);
  if (!read.ok) return read;
  const expected = computeSrsSpecFingerprint(workspace);
  if (read.value.specFingerprint.value !== expected.value) {
    return { ok: false, diagnostics: [cacheFallbackDiagnostic("stale-fingerprint", { expected: expected.value, actual: read.value.specFingerprint.value })] };
  }
  return read;
}

export async function allocateRequirementIdFromStatusCache(
  root: ProjectRoot,
  workspace: ParsedWorkspace,
  type: RequirementType,
  scopePrefix: string
): Promise<{ id: string | null; diagnostics: Diagnostic[] }> {
  const read = await readFreshSrsStatusCache(root, workspace);
  if (!read.ok) return { id: null, diagnostics: read.diagnostics };
  const counter = read.value.idCounters[type]?.[scopePrefix];
  if (typeof counter !== "number" || !Number.isInteger(counter) || counter < 0) {
    return { id: null, diagnostics: [cacheFallbackDiagnostic("incomplete-counter", { type, scopePrefix })] };
  }
  const counterValue = Number(counter);
  const prefix = TYPE_PREFIX[type];
  const id = `${prefix}-${scopePrefix}-${String(counterValue + 1).padStart(3, "0")}`;
  return { id, diagnostics: read.diagnostics };
}

export async function writeSrsStatusCache(root: ProjectRoot, cache: SrsStatusCache): Promise<void> {
  const absolutePath = statusCacheAbsolutePath(root);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const tmp = path.join(path.dirname(absolutePath), `.status-${randomUUID()}.json.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    await rename(tmp, absolutePath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function refreshSrsStatusCache(root: ProjectRoot, lockMetadata: SrsMutationLockMetadata | null = null): Promise<MutationResult<SrsStatusCache>> {
  const workspace = await parseWorkspace(root);
  const cache = buildSrsStatusCache(workspace, lockMetadata);
  try {
    await writeSrsStatusCache(root, cache);
    return { ok: true, value: cache, diagnostics: [], diagnosticsSummary: summarizeDiagnostics([]) };
  } catch (error) {
    const warning = diagnostic("SRS-W066", "warning", `SRS status cache write failed: ${(error as Error).message}`, { filePath: SRS_STATUS_CACHE_PATH }, { rebuildable: true });
    return { ok: false, error: { code: "CACHE_WRITE_FAILED", message: warning.message, diagnostics: [warning] }, diagnostics: [warning], diagnosticsSummary: summarizeDiagnostics([warning]) };
  }
}
