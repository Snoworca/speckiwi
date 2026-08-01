import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VERBS } from "../../src/core/orchestrator/journal-schema.js";

/**
 * Shared reader and vocabulary for the four shipped `kiwi-orchestrator/SKILL.md` renderings.
 *
 * A skill body is agent instruction, not executable code, so FR-FLOW-074..103 are verified by
 * raw-text presence and window-proximity assertions over the bundled files — the FR-FLOW-025 /
 * FR-FLOW-061 precedent. One module holds the vocabulary so the three requirement suites that read
 * these files cannot drift into two spellings of one rule.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The three bundled variants FR-FLOW-074 AC-1 names, in the order `package-doctor` ships them. */
export const ORCHESTRATOR_VARIANTS = [
  { id: "claude", relPath: "skills/claude/kiwi-orchestrator/SKILL.md" },
  { id: "codex", relPath: "skills/codex/kiwi-orchestrator/SKILL.md" },
  { id: "etc", relPath: "skills/etc/kiwi-orchestrator/SKILL.md" }
] as const;

/** 05 §14 registration 6: the mirror is produced from the `codex` rendering and is not excluded. */
export const ORCHESTRATOR_MIRROR = ".agents/skills/kiwi-orchestrator/SKILL.md";

/**
 * ENOENT-to-empty-string, so a missing variant fails as an AssertionError naming the file rather
 * than as a thrown ENOENT that reads like a harness fault. @req FR-FLOW-074 AC-1
 */
export function readVariant(relPath: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  } catch {
    return "";
  }
}

export function stripFrontmatter(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/** Every bundled variant's body, keyed by id. */
export function variantBodies(): Array<{ id: string; relPath: string; body: string }> {
  return ORCHESTRATOR_VARIANTS.map((variant) => ({ id: variant.id, relPath: variant.relPath, body: stripFrontmatter(readVariant(variant.relPath)) }));
}

/**
 * The nine verbs 05 §4.4 marks `2.6.0-phase2-parallel-lanes`. `execute-unit` replaces the six lane
 * verbs in the phase-1 enum; `probe-isolation`, `run-serial-epilogue` and `replay-deferred-mutations`
 * name a probe, a distinct executor and a deferred-mutation queue phase 1 does not have.
 */
export const PHASE2_VERBS = [
  "probe-isolation",
  "dispatch-lane",
  "collect-lane",
  "verify-lane",
  "remediate-lane",
  "release-lane",
  "integrate-lane",
  "run-serial-epilogue",
  "replay-deferred-mutations"
] as const;

/**
 * The closed phase-1 verb enum, derived from the shipped `VERBS` constant rather than restated, so
 * a verb added to the runtime enum without a skill section fails here. @req FR-FLOW-074 AC-2
 */
export const PHASE1_VERBS: string[] = (VERBS as readonly string[]).filter((verb) => !(PHASE2_VERBS as readonly string[]).includes(verb));

/** Phase-2 gate ids named in FR-FLOW-074 AC-5, none of which may reach `critical_gates[]`. */
export const PHASE2_GATE_IDS = [
  "lane-lease-breach",
  "lane-timeout",
  "lane-workspace-dirty",
  "isolation-profile-unavailable",
  "isolation-profile-change-requested",
  "lane-non-code-write",
  "lane-srs-mutation-detected",
  "lane-external-side-effect",
  "lane-evidence-irreproducible",
  "lane-child-gate-halted",
  "lane-repeatedly-unrecoverable",
  "lane-verify-failed",
  "lane-merge-conflict",
  "merge-coupling-detected",
  "partition-quality-insufficient",
  "integration-cas-rejected",
  "integration-restore-failed",
  "epilogue-task-failed",
  "srs-mutation-replay-failed",
  "lane-state-harvest-failed"
] as const;

/** The four `business-decision` routing gates 05 §13 keeps out of `critical_gates[]`. */
export const ROUTING_GATE_IDS = ["route-proposal", "route-step-requires-mode-switch", "tdd-route-unattended", "route-downgrade-available"] as const;

/** The thirteen wave-semantic gates FR-FLOW-100 AC-4 requires the orchestrator to declare itself. */
export const WAVE_SEMANTIC_GATE_IDS = [
  "wave-verify-residual-critical",
  "wave-verify-fail-residual",
  "wave-verify-cross-wave-fix-required",
  "final-verify-residual-critical",
  "wave-decomposition-coverage-gap",
  "out-of-scope-user-consent",
  "wave-append-cap-exhausted",
  "decomposition-input-missing",
  "child-srs-needs-user-or-failed",
  "child-pipeline-needs-user-or-failed",
  "unsafe-option-refused",
  "wt-delegation-refused",
  "invalid-loop-option"
] as const;

/** `## <heading>` … up to the next heading of the same or shallower depth. */
export function section(body: string, heading: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return "";
  const depth = /^(#{1,6})/.exec(lines[start] as string)?.[1]?.length ?? 2;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const level = /^(#{1,6})\s/.exec(lines[index] as string)?.[1]?.length;
    if (level !== undefined && level <= depth) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export interface TableRow {
  cells: string[];
}

/** Data rows of every markdown table inside `text`, delimiter rows and headers dropped. */
export function tableRows(text: string): TableRow[] {
  const rows: TableRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    rows.push({ cells });
  }
  return rows;
}

/** A bare gate id: lower-kebab, at least one hyphen, backticks stripped. */
export function bareGateId(cell: string): string | null {
  const token = cell.replace(/`/g, "").trim();
  return /^[a-z][a-z0-9-]*$/.test(token) && token.includes("-") ? token : null;
}

/** The `## 0.G` section, which is where `critical_gates[]` is declared in every kiwi skill. */
export function criticalGatesSection(body: string): string {
  return section(body, /^##\s*0\.G\b/);
}

/** `{gateId, reason, location}` per row of the three-column `critical_gates[]` table. */
export function criticalGateRows(body: string): Array<{ gateId: string; reason: string; location: string; width: number }> {
  const rows: Array<{ gateId: string; reason: string; location: string; width: number }> = [];
  for (const row of tableRows(criticalGatesSection(body))) {
    const gateId = bareGateId(row.cells[0] ?? "");
    if (!gateId) continue;
    rows.push({ gateId, reason: row.cells[1] ?? "", location: row.cells[2] ?? "", width: row.cells.length });
  }
  return rows;
}

/** The gate-severity rows declared outside `critical_gates[]` — 05 §13's four routing gates. */
export function gateSeverityRows(body: string): Array<{ gateId: string; severity: string; condition: string }> {
  const rows: Array<{ gateId: string; severity: string; condition: string }> = [];
  for (const row of tableRows(section(body, /^##\s*0\.S\b/))) {
    const gateId = bareGateId(row.cells[0] ?? "");
    if (!gateId) continue;
    rows.push({ gateId, severity: (row.cells[1] ?? "").replace(/`/g, "").trim(), condition: row.cells[2] ?? "" });
  }
  return rows;
}

/** The `§V.<verb>` section names a variant declares, in document order. */
export function verbSectionNames(body: string): string[] {
  return [...body.matchAll(/^###\s+§V\.([a-z][a-z0-9-]*)/gm)].map((match) => match[1] as string);
}

/** One `§V.<verb>` section's text. */
export function verbSection(body: string, verb: string): string {
  return section(body, new RegExp(`^###\\s+§V\\.${verb.replace(/[-]/g, "\\-")}(?:\\s|$)`));
}

/** Text windows of +/- `radius` characters around every match of `re`. */
export function windowsAround(text: string, re: RegExp, radius = 400): string[] {
  const scan = new RegExp(re.source, `${re.flags.replace("g", "")}g`);
  const out: string[] = [];
  for (let match = scan.exec(text); match; match = scan.exec(text)) {
    out.push(text.slice(Math.max(0, match.index - radius), match.index + match[0].length + radius));
    if (scan.lastIndex === match.index) scan.lastIndex += 1;
  }
  return out;
}

/** True when some window around `anchor` satisfies every predicate in `required`. */
export function tiedTogether(text: string, anchor: RegExp, required: RegExp[], radius = 400): boolean {
  return windowsAround(text, anchor, radius).some((window) => required.every((re) => re.test(window)));
}

/** Character offset of the first line matching `re`, or -1. */
export function offsetOf(body: string, re: RegExp): number {
  const match = re.exec(body);
  return match ? match.index : -1;
}

/** Offsets of each needle, in the order given — used to prove a stated ordering. */
export function orderedOffsets(text: string, needles: RegExp[]): number[] {
  return needles.map((needle) => offsetOf(text, needle));
}
