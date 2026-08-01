// @req FR-NODE-140 — the executable `kiwi/waves.jsonl` reader: run-scoped, engine-filtered, and
// spanning schema versions 1.0.0 through 1.4.0.
//
// Written fresh against the shipped mainline contract `skills/claude/_shared/kiwi/waves-event.md`
// v1.3.0 plus 05 §4.2's v1.4.0 additions, carrying only the transition table from the deferred
// multiroot branch (06 audit ruling A2). Line parsing comes from the existing workflow JSONL reader
// rather than a second implementation.
import { parseWorkflowJsonl } from "../workflow/jsonl.js";
import type { Diagnostic, ProjectRoot } from "../types.js";
import { DEFAULT_ENGINE, WAVES_SCHEMA_VERSIONS, waveNumber, type Engine, type WavesEvent } from "./journal-schema.js";

/** The journal's repo-relative path (waves-event.md §1's run-root pin resolves the root, not this). */
export const WAVES_JOURNAL_PATH = "kiwi/waves.jsonl";

export interface ParseWavesJournalOptions {
  runId: string;
  engine: Engine;
  /** Overridable so a caller can read a journal that is not at the canonical path. */
  relativePath?: string;
}

export interface WavesJournalView {
  runId: string;
  engine: Engine;
  lines: WavesEvent[];
  /** Keyed `verb|wave|stage|lane`, so two lines differing only in lane or stage never collide. */
  byVerb: Map<string, WavesEvent[]>;
  /** `wave-{n}` only: `wave="all"` run-scope events are excluded (waves-event.md §3, §4). */
  latestPerWave: Map<number, WavesEvent>;
  schemaVersions: string[];
  diagnostics: Diagnostic[];
}

/** The engine a line was produced by. An absent field means `kiwi-wave-master` (05 §4.2). */
export function engineOf(event: WavesEvent): Engine {
  return event.engine === "kiwi-orchestrator" ? "kiwi-orchestrator" : DEFAULT_ENGINE;
}

/** The `byVerb` index key. Absent components collapse to an empty segment rather than being dropped. */
export function verbKey(event: WavesEvent): string {
  const stage = typeof event.stage === "number" ? String(event.stage) : "";
  return [event.verb ?? "", event.wave ?? "", stage, event.lane ?? ""].join("|");
}

export async function parseWavesJournal(root: ProjectRoot, options: ParseWavesJournalOptions): Promise<WavesJournalView> {
  const relativePath = options.relativePath ?? WAVES_JOURNAL_PATH;
  const parsed = await parseWorkflowJsonl(root, relativePath, {
    // @req FR-NODE-125 — append-only keying: many lines per run is the contract here, so a duplicate
    // `${skill}|${run_id}` key is not a defect and a CORRECTION chain is not resolved.
    eventKeying: "none",
    supportedSchemaVersions: [...WAVES_SCHEMA_VERSIONS]
  });

  const lines: WavesEvent[] = [];
  const includedLineNumbers = new Set<number>();
  for (const entry of parsed.entries) {
    const event: WavesEvent = { ...(entry.event as Record<string, unknown>), journalLine: entry.line };
    if (event.run_id !== options.runId) continue;
    if (engineOf(event) !== options.engine) continue;
    lines.push(event);
    includedLineNumbers.add(entry.line);
  }

  const byVerb = new Map<string, WavesEvent[]>();
  const latestPerWave = new Map<number, WavesEvent>();
  const schemaVersions: string[] = [];
  for (const event of lines) {
    if (typeof event.verb === "string" && event.verb.length > 0) {
      const key = verbKey(event);
      const bucket = byVerb.get(key);
      if (bucket) bucket.push(event);
      else byVerb.set(key, [event]);
    }

    const wave = waveNumber(event.wave);
    if (wave !== null) latestPerWave.set(wave, event);

    const version = typeof event.schema_version === "string" ? event.schema_version : "";
    if (version.length > 0 && !schemaVersions.includes(version)) schemaVersions.push(version);
  }

  // A line-scoped diagnostic belongs to the run whose line raised it. A line that did not parse
  // carries no `run_id` to attribute it by, and a file-scoped diagnostic (a missing trailing LF) has
  // no line at all; both are reported to every reader rather than being silently dropped.
  const unattributable = new Set(parsed.invalidLines.map((invalid) => invalid.line));
  const diagnostics = parsed.diagnostics.filter(
    (item) => typeof item.line !== "number" || includedLineNumbers.has(item.line) || unattributable.has(item.line)
  );

  return {
    runId: options.runId,
    engine: options.engine,
    lines,
    byVerb,
    latestPerWave,
    schemaVersions: schemaVersions.sort(),
    diagnostics
  };
}
