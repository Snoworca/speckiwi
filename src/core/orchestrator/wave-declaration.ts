// @req FR-NODE-216 — the wave declaration file: the decomposition's waves, their dependencies, their
// declared write sets and requirements, as the one machine-read source `schedule waves --waves` and
// `wave status --waves` plan from.
//
// Pure: the document and the journal's wave statuses arrive as values. Reading the file, the journal
// and the SDS files stays in the command.
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { compareStrings } from "./conflict.js";
import { COMPLETION_STATUS, waveNumber, type EventStatus } from "./journal-schema.js";
import { findDependencyCycle } from "./lane-plan.js";
import { normalisedPath } from "../sds/lite-sds.js";

export const WAVE_DECLARATION_SCHEMA_VERSION = "1.0.0";

/** The only wave name the journal view parses (`waveNumber`): `wave-<n>`, n from 1, no leading zero. */
const WAVE_NAME = /^wave-[1-9][0-9]*$/;

const DOCUMENT_KEYS = ["schema_version", "waves"] as const;
const ENTRY_KEYS = ["wave", "depends_on", "files", "requirements", "sds"] as const;

export interface WaveDeclarationEntry {
  /** `wave-<n>`. */
  readonly wave: string;
  /** `n`, which is also the journal's `order` for the wave. */
  readonly order: number;
  /** The declared `depends_on`, or every entry with a smaller `n` when the entry declared none; sorted. */
  readonly dependsOn: readonly string[];
  readonly files: readonly string[];
  readonly requirements: readonly string[];
  readonly sds?: readonly string[];
}

/** The entries in ascending `n`. */
export interface WaveDeclaration {
  readonly waves: readonly WaveDeclarationEntry[];
}

/** The gates a parse refusal names; `null` for a shape error that belongs to no gate. */
export type WaveDeclarationGate = "lane-plan-incomplete" | "schedule-cycle";

export type WaveDeclarationParse =
  | { readonly ok: true; readonly declaration: WaveDeclaration }
  | { readonly ok: false; readonly gate: WaveDeclarationGate | null; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function refused(message: string, gate: WaveDeclarationGate | null = null): WaveDeclarationParse {
  return { ok: false, gate, message };
}

function unknownKey(record: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(record).find((key) => !allowed.includes(key));
}

interface RawEntry {
  readonly wave: string;
  readonly order: number;
  readonly dependsOn: readonly string[] | undefined;
  readonly files: readonly string[];
  readonly requirements: readonly string[];
  readonly sds: readonly string[] | undefined;
}

/** One entry's shape, or the message naming what is wrong with it. */
function readEntry(value: unknown, index: number): RawEntry | string {
  const at = `waves[${index}]`;
  if (!isRecord(value)) return `${at} must be an object`;
  const extra = unknownKey(value, ENTRY_KEYS);
  if (extra !== undefined) return `${at} has the unknown key ${extra}`;
  const wave = value.wave;
  if (typeof wave !== "string" || !WAVE_NAME.test(wave)) return `${at}.wave must match ${WAVE_NAME.source}, not ${JSON.stringify(wave)}`;
  const dependsOn = value.depends_on;
  if (dependsOn !== undefined && (!Array.isArray(dependsOn) || dependsOn.some((item) => typeof item !== "string" || !WAVE_NAME.test(item)))) {
    return `${wave}.depends_on must be a list of wave-<n> names, not ${JSON.stringify(dependsOn)}`;
  }
  if (!isPathList(value.files)) return `${wave}.files must be a list of paths`;
  if (!Array.isArray(value.requirements) || value.requirements.some((item) => typeof item !== "string" || item.length === 0)) {
    return `${wave}.requirements must be a list of requirement ids`;
  }
  if (value.sds !== undefined && !isPathList(value.sds)) return `${wave}.sds must be a list of SDS paths`;
  const sds = value.sds === undefined ? undefined : normalisedList(wave, "sds", value.sds);
  if (typeof sds === "string") return sds;
  const files = normalisedList(wave, "files", value.files);
  if (typeof files === "string") return files;
  return {
    wave,
    order: waveNumber(wave) as number,
    dependsOn: dependsOn as string[] | undefined,
    files,
    requirements: value.requirements as string[],
    sds
  };
}

/**
 * The SDS Files rule applied to a list: `\` and `/` are one separator, `.` segments vanish, and an
 * absolute path or one that leaves the root is refused — otherwise two spellings of one file would
 * land in one stage. `files` is also sorted and deduplicated, so its order is not part of the entry's
 * digest; `sds` keeps the declared order, which names a grouped wave's parts.
 */
function normalisedList(wave: string, key: "files" | "sds", raw: readonly string[]): string[] | string {
  const paths: string[] = [];
  for (const item of raw) {
    const normalised = normalisedPath(item);
    if ("reason" in normalised) return `${wave}.${key}: ${normalised.reason}`;
    paths.push(normalised.path);
  }
  return key === "files" ? [...new Set(paths)].sort(compareStrings) : paths;
}

/**
 * Parses a declaration document. Everything the plan could be wrong about is refused here, before a
 * journal is read or a lock is written: a name outside `wave-<n>`, an unknown key, a malformed entry,
 * a duplicate wave, a dependency naming no entry and a cycle. @req FR-NODE-216 AC-1
 */
export function parseWaveDeclaration(value: unknown): WaveDeclarationParse {
  if (!isRecord(value)) return refused("the wave declaration must be a JSON object");
  const extra = unknownKey(value, DOCUMENT_KEYS);
  if (extra !== undefined) return refused(`the wave declaration has the unknown key ${extra}`);
  if (value.schema_version !== WAVE_DECLARATION_SCHEMA_VERSION) {
    return refused(`the wave declaration schema_version must be ${WAVE_DECLARATION_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.waves)) return refused("the wave declaration needs a waves list");

  const raw: RawEntry[] = [];
  for (const [index, item] of value.waves.entries()) {
    const read = readEntry(item, index);
    if (typeof read === "string") return refused(read);
    if (raw.some((entry) => entry.wave === read.wave)) return refused(`${read.wave} is declared twice`, "lane-plan-incomplete");
    raw.push(read);
  }
  raw.sort((left, right) => left.order - right.order);

  const names = new Set(raw.map((entry) => entry.wave));
  const dependsOn = new Map<string, string[]>();
  for (const entry of raw) {
    const declared = entry.dependsOn ?? raw.filter((other) => other.order < entry.order).map((other) => other.wave);
    const missing = declared.find((name) => !names.has(name));
    if (missing !== undefined) return refused(`${entry.wave} depends on ${missing}, which the declaration does not name`);
    dependsOn.set(entry.wave, [...new Set(declared)].sort(compareStrings));
  }
  const cycle = findDependencyCycle([...names], dependsOn);
  if (cycle !== null) return refused(cycle, "schedule-cycle");

  return {
    ok: true,
    declaration: {
      waves: raw.map((entry) => ({
        wave: entry.wave,
        order: entry.order,
        dependsOn: dependsOn.get(entry.wave) as string[],
        files: entry.files,
        requirements: entry.requirements,
        ...(entry.sds === undefined ? {} : { sds: entry.sds })
      }))
    }
  };
}

/**
 * sha256 of the canonical JSON of the entry's `{wave, depends_on, files, sds}`. `requirements[]` is
 * left out: `unallocated-req-id` checks it, and a re-entry may revise it. @req FR-NODE-216 AC-7
 */
export function declarationEntryDigest(entry: WaveDeclarationEntry): string {
  const covered = { wave: entry.wave, depends_on: entry.dependsOn, files: entry.files, ...(entry.sds === undefined ? {} : { sds: entry.sds }) };
  return createHash("sha256").update(canonicalJson(covered)).digest("hex");
}

export interface WaveReadiness {
  /** Not complete, every dependency complete: what `schedule waves --waves` plans. */
  readonly ready: readonly WaveDeclarationEntry[];
  /** Not complete, some dependency not complete. */
  readonly deferred: readonly WaveDeclarationEntry[];
  readonly complete: readonly WaveDeclarationEntry[];
}

/**
 * Splits the declaration by the journal's latest wave statuses (`computeRunProgress(view).waveStatuses`,
 * the predicate resume and `wave status` read). The one function both `schedule waves --waves` and
 * `wave status --waves` call. @req FR-NODE-216 AC-2, IR-CLI-104 AC-2
 */
export function waveReadiness(declaration: WaveDeclaration, waveStatuses: ReadonlyMap<number, EventStatus>): WaveReadiness {
  const isComplete = (wave: string): boolean => waveStatuses.get(waveNumber(wave) as number) === COMPLETION_STATUS;
  const ready: WaveDeclarationEntry[] = [];
  const deferred: WaveDeclarationEntry[] = [];
  const complete: WaveDeclarationEntry[] = [];
  for (const entry of declaration.waves) {
    if (isComplete(entry.wave)) complete.push(entry);
    else if (entry.dependsOn.every(isComplete)) ready.push(entry);
    else deferred.push(entry);
  }
  return { ready, deferred, complete };
}
