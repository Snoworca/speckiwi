import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Independent verification of FR-FLOW-208..211 (5.3.0), round 6, bundle d1.
// The kiwi-pm lifecycle gate pseudocode is executed, not scanned: the guard of the active-target
// halt is read out of every shipped rendering and evaluated for each combination of `--sds` and
// `--req-filter`. Nothing in the repository is changed.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];

/** The file of a rendering that holds APPLY_LIFECYCLE_GATE. */
function gateFile(rendering: string): string {
  for (const rel of [`${rendering}/kiwi-pm/SKILL.md`, `${rendering}/kiwi-pm/references/extended-workflow.md`]) {
    const abs = path.join(REPO, rel);
    if (existsSync(abs) && readFileSync(abs, "utf8").includes("FUNCTION APPLY_LIFECYCLE_GATE")) return abs;
  }
  throw new Error(`no APPLY_LIFECYCLE_GATE in ${rendering}`);
}

/** The conditions of every IF that encloses the active-target HALT inside APPLY_LIFECYCLE_GATE. */
function guardsOfActiveTargetHalt(file: string): string[] {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const body = text.slice(text.indexOf("FUNCTION APPLY_LIFECYCLE_GATE"));
  const lines = body.split("\n");
  const at = lines.findIndex((line) => line.includes('HALT("활성 target 없음'));
  expect(at, "the active-target halt is in APPLY_LIFECYCLE_GATE").toBeGreaterThan(0);
  const indent = (line: string) => line.length - line.trimStart().length;
  const guards: string[] = [];
  let level = indent(lines[at] as string);
  for (let i = at - 1; i > 0; i -= 1) {
    const line = lines[i] as string;
    if (line.trim() === "" || indent(line) >= level) continue;
    level = indent(line);
    const match = /^\s*IF (.+?):/.exec(line);
    if (match) guards.push(match[1] as string);
    if (level === 4) break;
  }
  return guards;
}

/** Evaluates a pseudocode condition over `state` (`OR` / `AND` / `NOT`, `state.<field>` truthiness). */
function evaluate(condition: string, state: Record<string, unknown>): boolean {
  const js = condition
    .replace(/#.*$/, "")
    .replace(/\bNOT\b/g, "!")
    .replace(/\bAND\b/g, "&&")
    .replace(/\bOR\b/g, "||")
    .replace(/\bstate\.(\w+)/g, (_m, field: string) => JSON.stringify(Boolean(state[field])));
  // Only the halt's own guards matter; a guard on `target` (the read result) is the halt itself.
  if (/\btarget\b/.test(js)) return true;
  return Boolean(Function(`"use strict"; return (${js});`)());
}

describe("FR-FLOW-211 AC-1 — a --req-filter run is never stopped because no active target is set", () => {
  // @req FR-FLOW-211 AC-1 — WHEN `--req-filter` is given, THE lifecycle gate SHALL read each named
  // requirement by its ID and SHALL NOT drop a requirement because it is not in the active target.
  // With `--sds` and `--req-filter` together the run set is the `--req-filter` IDs (lead decision 2),
  // so AC-1 applies to that run too. Expected: for every run with `--req-filter`, the guards of the
  // "활성 target 없음" HALT evaluate false, so an empty active target cannot stop the run before the
  // named requirements are read by ID.
  for (const rendering of RENDERINGS) {
    it(`${rendering}: --sds + --req-filter with no active target does not reach the active-target HALT`, () => {
      const guards = guardsOfActiveTargetHalt(gateFile(rendering));
      const state = { sds_path: "docs/sds/s.sds.md", req_filter: ["FR-X-001"], req_ids: ["FR-X-001"] };
      const reached = guards.every((guard) => evaluate(guard, state));
      expect({ guards, reached }).toEqual({ guards, reached: false });
    });
  }
});
