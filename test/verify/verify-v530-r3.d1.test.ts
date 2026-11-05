import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Independent verification of FR-FLOW-208..211 (5.3.0), round 3, bundle d1.
// Every test here is meant to be red: it shows a place where the shipped skills do not hold an
// acceptance criterion. Nothing in the repository is changed.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
/** SKILL.md plus references/extended-workflow.md when the rendering splits the body. */
function skillText(root: string, skill: string): string {
  const files = [`${root}/${skill}/SKILL.md`, `${root}/${skill}/references/extended-workflow.md`];
  return files.filter((rel) => existsSync(path.join(REPO, rel))).map(read).join("\n");
}

describe("FR-FLOW-208 AC-1 — every kiwi-srs instruction writes depends_on from the dependent requirement", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-208 AC-1 — the link goes "from the dependent requirement to the one it depends on".
    // §0.18 ("방향 SSOT: trace_link 는 항상 id: {신규 REQ} → reference: {기존 REQ}") and the §9.2
    // new-feature sequence ("depends_on / extends, 방향: NEW-ID → 기존 REQ") fix the direction by
    // which requirement is new instead. When a run adds B and makes an existing A depend on it, the
    // author following them writes B depends_on A — the dependency reversed.
    it(`${root}: no kiwi-srs line fixes the depends_on direction as new → existing`, () => {
      const offenders = skillText(root, "kiwi-srs")
        .split("\n")
        .filter((line) => /depends_on/.test(line))
        .filter((line) => /항상 `id: \{신규 REQ\} → reference: \{기존 REQ\}`|방향: NEW-ID → 기존 REQ/.test(line))
        .filter((line) => !line.includes("의존하는 요구"))
        .map((line) => line.trim().slice(0, 120));
      expect(offenders).toEqual([]);
    });
  }
});

/** One pseudocode function: from its `FUNCTION <name>(` line to the closing fence. */
function fn(text: string, name: string): string[] {
  const start = text.indexOf(`FUNCTION ${name}(`);
  if (start < 0) return [];
  const end = text.indexOf("\n```", start);
  return text.slice(start, end < 0 ? undefined : end).split("\n");
}
function section(text: string, heading: string, next: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const end = text.indexOf(next, start + heading.length);
  return text.slice(start, end < 0 ? undefined : end);
}

describe("FR-FLOW-211 AC-1 — a run given --req-filter keeps reading by ID after --resume", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-211 AC-1 — WHEN --req-filter is given, the gate and the final promotion read each
    // named requirement by ID and SHALL NOT drop one because it is not in the active target.
    // APPLY_LIFECYCLE_GATE and T_FINAL_SRS_MUTATION choose the by-ID read on `args.req_filter`, the
    // flags of the current invocation, while pm-state.json (§2.2) records only `req_ids` and §5.4
    // `--resume` never says to give --req-filter again. A `--sds S --req-filter X` run (run_id =
    // sds-id, so `--sds S --resume` finds it) whose T-final was interrupted resumes with
    // `args.req_filter` unset: T-final reads `list_requirements(target=state.target_slug)` and
    // `IF NOT req: CONTINUE` skips X of another target without a word.
    it(`${root}: the by-ID branch of the gate and T-final does not hang on a flag a resume cannot restore`, () => {
      const text = skillText(root, "kiwi-pm");
      const guards = ["APPLY_LIFECYCLE_GATE", "T_FINAL_SRS_MUTATION"].flatMap((name) =>
        fn(text, name)
          .filter((line) => /^\s*IF .*args\.req_filter/.test(line))
          .map((line) => `${name}: ${line.trim().replace(/\s+#.*$/, "")}`)
      );
      const schema = section(text, "### 2.2 pm-state.json 스키마", "### 2.3 ");
      const resume = section(text, "### 5.4 `--resume` 동작", "\n### ");
      const persisted = /req_filter/.test(schema) || /--req-filter/.test(resume);
      expect(persisted ? [] : guards, `${root}: guards on args.req_filter with no persisted filter`).toEqual([]);
      // Lead decision (round 3): the fix branches on the persisted state, so no args.req_filter guard need remain;
      // the property kept is the defect's: the run's --req-filter survives a resume.
      expect(/req_filter/.test(schema), `${root}: pm-state persists req_filter`).toBe(true);
    });
  }
});
