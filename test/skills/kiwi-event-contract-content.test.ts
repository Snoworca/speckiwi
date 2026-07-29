import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-043
// The wave/pipeline event contracts are natural-language agent instructions, not executable
// modules, so their guarantees are asserted as raw-text contracts across every shipped copy.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const SHARED_DIRS = [
  "skills/claude/_shared/kiwi",
  "skills/codex/_shared/kiwi",
  "skills/etc/_shared/kiwi",
  ".agents/skills/_shared/kiwi"
] as const;

const WAVES_COPIES = SHARED_DIRS.map((dir) => `${dir}/waves-event.md`);
const PIPELINE_COPIES = SHARED_DIRS.map((dir) => `${dir}/pipeline-event.md`);
const ALL_COPIES = [...WAVES_COPIES, ...PIPELINE_COPIES];

const CONSUMER_TABLES = [
  "skills/claude/kiwi-pipeline/SKILL.md",
  "skills/codex/kiwi-pipeline/SKILL.md",
  "skills/etc/kiwi-pipeline/SKILL.md",
  ".agents/skills/kiwi-pipeline/SKILL.md"
] as const;

function read(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** The defect: `$(git rev-parse ...)/kiwi` is never empty, so every later `-z` guard is dead.
 * The terminator class accepts both command-substitution spellings — `$(...)` and the backtick
 * form `` `...` `` — so a backtick reintroduction fails here instead of only tripping the sibling
 * assertions. The `["']?\s*` after it also catches the quoted reintroduction forms
 * (`DIR="$(... 2>/dev/null)"/kiwi` and `DIR="$(... 2>/dev/null)/kiwi"`). */
const UNREACHABLE_FALLBACK = /--show-toplevel\s+2>\/dev\/null\s*[)`]\s*["']?\s*\/kiwi/;

/** The exact shipped copies that carry a PowerShell emit example. The claude copy has none, so a
 * `filter(...).length > 0` check would stay green even if two of the three examples disappeared;
 * pinning the set makes any drift (added or removed copy) fail. */
const POWERSHELL_COPIES = [
  "skills/codex/_shared/kiwi/pipeline-event.md",
  "skills/etc/_shared/kiwi/pipeline-event.md",
  ".agents/skills/_shared/kiwi/pipeline-event.md"
] as const;

describe("FR-FLOW-043 — run-root pinned wave and pipeline event journals", () => {
  // AC-3: every shipped copy is in scope (8 files).
  it("covers exactly the eight shipped event-contract copies", () => {
    expect(ALL_COPIES).toHaveLength(8);
    for (const copy of ALL_COPIES) {
      expect(() => read(copy), `${copy} must exist`).not.toThrow();
    }
  });

  // AC-1: the journal root is pinned at run start, not re-resolved per emit.
  it.each(ALL_COPIES)("%s states that the journal root is pinned at run start", (copy) => {
    const text = read(copy);
    expect(text, `${copy} must state run-start pinning`).toMatch(/run 시작 시[^\n]*pin/);
    expect(text, `${copy} must forbid per-emit re-resolution`).toMatch(/emit 마다 재해석하지 않는다/);
  });

  // AC-2 / AC-4: the POSIX example must leave the variable empty when git fails, so the
  // documented cwd and home fallbacks stay reachable.
  it.each(ALL_COPIES)("%s has no unreachable POSIX fallback", (copy) => {
    const text = read(copy);
    expect(
      UNREACHABLE_FALLBACK.test(text),
      `${copy} still assigns "<git-output>/kiwi" unconditionally, which makes every later -z guard dead code`
    ).toBe(false);
  });

  it.each(ALL_COPIES)("%s guards the POSIX fallback chain on a non-empty git root", (copy) => {
    const text = read(copy);
    expect(text, `${copy} must branch on a non-empty git root`).toMatch(/if \[ -n "\$[A-Z_]*ROOT" \]/);
    expect(text, `${copy} must keep the cwd fallback reachable`).toMatch(/elif \[ -d "\.\/kiwi" \]/);
    expect(text, `${copy} must keep the home fallback reachable`).toMatch(/\$HOME\/\.kiwi/);
  });

  // AC-2: PowerShell examples already guard on $LASTEXITCODE and must stay unchanged.
  it("leaves the PowerShell examples guarded on $LASTEXITCODE", () => {
    const withPowershell = PIPELINE_COPIES.filter((copy) => read(copy).includes("powershell"));
    expect(withPowershell, "the PowerShell emit example must stay in exactly the known copies").toEqual([
      ...POWERSHELL_COPIES
    ]);
    for (const copy of withPowershell) {
      expect(read(copy), `${copy} PowerShell example must keep its exit-code guard`).toMatch(
        /\$LASTEXITCODE -eq 0 -and \$gitRoot/
      );
    }
  });

  // AC-6: kiwi-wave-master must be a valid skill enum member, otherwise a halt event emitted
  // by the orchestrator is discarded by the consumer's "unknown skill -> WARN + skip" rule.
  it.each(PIPELINE_COPIES)("%s lists kiwi-wave-master in the skill enum", (copy) => {
    const text = read(copy);
    const enumBlock = text.split(/^## 3\. skill enum$/m)[1];
    expect(enumBlock, `${copy} must have a skill enum section`).toBeDefined();
    const fenced = enumBlock.split("```")[1] ?? "";
    const members = fenced
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(members, `${copy} skill enum must accept kiwi-wave-master`).toContain("kiwi-wave-master");
  });

  // AC-6: no skill-specific decision-table row may override the mandatory `any x FAILED` gate.
  it.each([...PIPELINE_COPIES, ...CONSUMER_TABLES])(
    "%s adds no kiwi-wave-master row to a decision table",
    (copy) => {
      const text = read(copy);
      expect(
        text,
        `${copy} must not add a skill-specific decision row that overrides the any x FAILED gate`
      ).not.toMatch(/^\|\s*kiwi-wave-master\s*\|/m);
    }
  );
});

// @req FR-FLOW-046
// The wave-event contract gains optional verification fields as an additive minor bump. The status
// enum must NOT grow: the resume rule keys on "latest status is not complete", which already expresses
// both a wave under verification (in_progress) and a wave whose verification failed (failed), so a new
// enum member would change the meaning of a documented field across all four mirrored copies for no
// gain. These assertions run over every shipped copy because a stale copy silently restores the old
// end-of-wave flow with no detectable trace.
describe("FR-FLOW-046 — wave verification record in the shared wave-event contract", () => {
  // AC-1: additive minor bump, enum untouched.
  // The §5 emit block is what an agent copies verbatim, so it must itself be a legal sequence:
  // the wave-verify line first, the complete line second, and both carrying verdict=pass. Desyncing
  // the example from the normative rules ships a snippet that emits an event §3 declares invalid.
  it.each(WAVES_COPIES)("%s ships an emit example that satisfies its own rules", (copy) => {
    const emit = read(copy).split(/^## /m).find((s) => /Emit 패턴/.test(s)) ?? "";
    expect(emit, `${copy} must have an emit section`).not.toBe("");
    const verifyLine = emit.indexOf('"phase":"wave-verify"');
    const completeLine = emit.indexOf('"status":"complete"');
    expect(verifyLine, `${copy} the emit example must show the wave-verify record`).toBeGreaterThan(-1);
    expect(
      verifyLine < completeLine,
      `${copy} the emit example must write the wave-verify record BEFORE the complete event`
    ).toBe(true);
    expect(
      (emit.match(/"verdict":"pass"/g) ?? []).length >= 2,
      `${copy} both example lines must carry verdict=pass; any other verdict makes the complete invalid`
    ).toBe(true);
    expect(emit, `${copy} the example must state that a non-pass verdict suppresses the complete line`).toMatch(
      /verdict 가 pass 가 아니면 이 줄을 쓰지 않는다/
    );
  });

  it.each(WAVES_COPIES)("%s declares schema version 1.3.0", (copy) => {
    const text = read(copy);
    expect(text, `${copy} must declare the minor-bumped contract version in its title`).toMatch(
      /^#\s*kiwi waves event v1\.3\.0/m
    );
    expect(text, `${copy} emit and schema examples must carry the bumped schema_version`).toMatch(
      /"schema_version"\s*:\s*"1\.3\.0"/
    );
    expect(text, `${copy} must not leave a stale pre-1.3.0 schema_version example behind`).not.toMatch(
      /"schema_version"\s*:\s*"1\.(?:0|1|2)\.0"/
    );
  });

  it.each(WAVES_COPIES)("%s keeps the status enum at exactly its four members", (copy) => {
    const text = read(copy);
    const enumRow = text.split("\n").find((line) => /\|\s*`status`\s*\|/.test(line)) ?? "";
    expect(enumRow, `${copy} must keep a status enum row`).not.toBe("");
    for (const member of ["pending", "in_progress", "complete", "failed"]) {
      expect(enumRow.includes(member), `${copy} status enum must keep ${member}`).toBe(true);
    }
    // A `verifying`-style member is the specific regression this guards: it would silently change the
    // resume predicate's surface for every consumer of a v1 contract.
    expect(
      /verifying|verified|reviewing/.test(enumRow),
      `${copy} status enum must not gain a verification member; the verification outcome is an optional field`
    ).toBe(false);
    // The enum row is not the whole story: the §3 transition diagram grew a `verifying` state in a
    // mutation and nothing failed, because no assertion read the diagram. AC-1 requires it unchanged.
    const diagram = text.split("```")[1] ?? "";
    expect(diagram, `${copy} must keep the status transition diagram in a fenced block`).toMatch(
      /pending\s*→\s*in_progress\s*→\s*complete/
    );
    expect(
      /verifying|verified|reviewing/.test(diagram),
      `${copy} the transition diagram must not gain a state the status enum does not define`
    ).toBe(false);
  });

  // AC-2: the optional fields that make an outcome auditable after the fact.
  it.each(WAVES_COPIES)("%s adds optional verification fields", (copy) => {
    const text = read(copy);
    // Split on the h3 sub-headings, not on `## `: the `## 2` chunk contains the REQUIRED table too,
    // so promoting `phase` into the required table stayed green — and a new required field is a
    // breaking change, exactly what the 1.1.0-vs-2.0.0 decision turns on.
    const subs = text.split(/^### /m);
    const optional = subs.find((s) => /선택 필드|optional field/i.test(s)) ?? "";
    const required = subs.find((s) => /필수 필드|required field/i.test(s)) ?? "";
    expect(optional, `${copy} must have an optional-fields section`).not.toBe("");
    expect(required, `${copy} must have a required-fields section`).not.toBe("");
    for (const field of ["phase", "verification"]) {
      expect(
        required.includes(`\`${field}\``),
        `${copy} must NOT promote ${field} into the required fields; that would be a breaking change`
      ).toBe(false);
    }
    for (const field of ["phase", "verification"]) {
      expect(optional.includes(field), `${copy} optional fields must record ${field}`).toBe(true);
    }
    // §2.3 is the LAST h3, so an unbounded chunk swallowed §3/§4/§5 including the emit example —
    // renaming ALL_MATCH and deleting the whole `rounds` row both stayed green off that example.
    // Cut the chunk at the next h2.
    const verification = (subs.find((s) => /`verification` object/i.test(s)) ?? "").split(/^## /m)[0];
    expect(verification, `${copy} must document the verification object`).not.toBe("");
    expect(
      /^## /m.test(subs.find((s) => /`verification` object/i.test(s)) ?? "") ||
        verification.length < (subs.find((s) => /`verification` object/i.test(s)) ?? "").length + 1,
      `${copy} the verification sub-section must be bounded before the next top-level section`
    ).toBe(true);
    // Field rows carry the exact roll-up token names the skill writes; a rename desyncs the two.
    expect(/`ALL_MATCH`|"ALL_MATCH"|ALL_MATCH/.test(verification), `${copy} axis_a must roll up as ALL_MATCH`).toBe(
      true
    );
    for (const field of ["rounds", "cap", "verdict", "residual", "report_path"]) {
      expect(verification.includes(field), `${copy} the verification object must record ${field}`).toBe(true);
    }
    // The cap gloss restates loop-option's numbers; letting them drift makes the contract contradict
    // both the shared SSOT and the skill.
    expect(verification, `${copy} the cap gloss must match the shared loop-option numbers`).toMatch(
      /기본 5 \/ `--max` 8 \/ `--mini` 3 \/ `--loops N`/
    );
    expect(
      /fail-cap/.test(verification) && /fail-residual/.test(verification),
      `${copy} the verdict must distinguish cap exhaustion from a residual failure`
    ).toBe(true);
    // A record is written every round, so a non-terminal value is required. Without it a mid-loop
    // round must claim a terminal verdict: `pass` satisfies the completion gate early and collapses
    // it, `fail-residual` makes resume read a running loop as failed.
    // Anchored to the enum VALUE list, not the row's prose: deleting it from the list while leaving
    // the trailing gloss ("`in-progress` 는 …") kept a bare token check green.
    expect(
      /`in-progress`\s*\/\s*`pass`\s*\/\s*`fail-residual`\s*\/\s*`fail-cap`/.test(verification),
      `${copy} the verdict enum must list a non-terminal value for a round that is not the last`
    ).toBe(true);
    expect(
      /ALL_MATCH/.test(verification) && /substantive_clean/.test(verification),
      `${copy} the verification object must carry both verifier roll-ups`
    ).toBe(true);
  });

  // AC-3: skipping the layer must be detectable rather than byte-identical to a pre-feature run.
  it.each(WAVES_COPIES)("%s invalidates a complete event with no preceding verification", (copy) => {
    const text = read(copy);
    // Two ways to fail the gate, both invalid: the latest record is not a pass, or there is none.
    expect(text, `${copy} must state that complete without a passing verification record is invalid`).toMatch(
      /`pass` 가 아니거나 그런 기록 자체가 없는 `complete` 이벤트는 \*\*무효\*\*/
    );
    expect(text, `${copy} must state that resume treats such a wave as incomplete`).toMatch(
      /재개[^\n]*미완료|resume[^\n]*incomplete/i
    );
    // With one record per round the gate cannot read "any preceding record": it must read the
    // LATEST one, or an early in-progress line would satisfy it for the whole run.
    expect(text, `${copy} the gate must read the latest wave-verify record, not any preceding one`).toMatch(
      /\*\*최신\*\* wave-verify 기록의 `verification\.verdict`/
    );
    // Unscoped, this rule retroactively invalidates every complete written before the feature
    // existed, so a user mid-epic would have wave-1..N re-run — contradicting the idempotent-resume
    // guarantee and the §2.3 bullet that says a legacy event is report-only.
    expect(
      text,
      `${copy} must scope the invalidation to 1.1.0+ events so pre-existing complete records still resume as done`
    ).toMatch(/1\.1\.0\s*(?:이상|미만|이전|and later|or later)/i);
    // The grandfather clause must not become a downgrade bypass: the version is written by the very
    // producer being policed, so a run that emits 1.0.0 events would otherwise be exempt and
    // reproduce the byte-identical undetectable journal the rule exists to prevent.
    expect(
      text,
      `${copy} must close the downgrade bypass by scoping the exemption per run, not per self-declared version`
    // Polarity matters: flipping the predicate to "적용을 받지 않는다" reopens the bypass while the
    // subject clause still matches. Assert the predicate, and reject its negation.
    ).toMatch(/1\.1\.0 이벤트가 하나라도 있으면[^\n]*본 조항의 적용을 받는다/);
    expect(text, `${copy} the per-run rule must not be negated`).not.toMatch(
      /본 조항의 적용을 받지 않는다/
    );
    // The pointer must resolve inside this file; §0.6 is a kiwi-wave-master section, not one of ours.
    expect(text, `${copy} must not cite a section number that does not exist in this file`).not.toMatch(
      /\(§0\.6[^)]*\)/
    );
  });

  // AC-3 corollary: status stays the only positive completion signal, but the verification record is
  // a necessary precondition — the two statements must not read as a contradiction.
  it.each(WAVES_COPIES)("%s reconciles status authority with the verification precondition", (copy) => {
    const text = read(copy);
    expect(
      text,
      `${copy} must say status is the only positive completion signal while verification can still invalidate it`
    ).toMatch(/유일한\s*\*?\*?(?:긍정|양성)[^\n]*신호|선행 조건[^\n]*무효화|necessary precondition/i);
  });

  // AC-4: silence must never read as clean.
  it.each(WAVES_COPIES)("%s requires a complete residual list and reads absence as unverified", (copy) => {
    const text = read(copy);
    // The completeness rule and the no-truncation rule must live in ONE sentence: a loose
    // alternation stayed green off the field table's own "전량" cell after the rule was deleted.
    // Absolute, not advisory: "전량인 것이 바람직하며 잘라내지 않는 것을 권장한다" keeps both anchor
    // tokens while downgrading MUST to SHOULD, and that mutation survived a token-based check.
    expect(text, `${copy} residual must be complete and never truncated`).toMatch(
      /`residual` 은 \*\*전량\*\*이어야 하며 잘라내지 않는다/
    );
    // Anchored to the sentence. The loose form was satisfied by an unrelated clause 16 lines away
    // ("이 조항이 없으면 … 미검증으로 보고만 한다"), so inverting this rule to "부재하면 통과로
    // 읽는다" — turning a skipped verification into a completion signal — stayed green.
    expect(text, `${copy} an absent verification object on a complete event means unverified, not clean`).toMatch(
      /`verification` 이[^\n]{0,20}\*\*부재\*\*하면[^\n]{0,20}clean 이 아니라[^\n]{0,20}\*\*미검증\*\*/
    );
  });

  // AC-5: persist consumption, never persist approval.
  it.each(WAVES_COPIES)("%s persists the round counter but not a passing verdict", (copy) => {
    const text = read(copy);
    // Bounded distance on purpose: an unbounded `[^\n]*` let the counter clause match the verdict
    // clause's own "영속" later in the same line, so deleting the counter rule stayed green.
    // `가로질러` was in the alternation and survives an inversion to 초기화, so it is dropped: the
    // accumulate verb itself must be present and the reset verb must be absent.
    expect(text, `${copy} the round counter must persist across resume`).toMatch(
      /(?:라운드\s*카운터|round counter)[^\n]{0,30}(?:누적|persist)/i
    );
    expect(text, `${copy} the round counter must not be reset on resume`).not.toMatch(
      /(?:라운드\s*카운터|round counter)[^\n]{0,30}(?:초기화|리셋|reset)/i
    );
    // Scope narrowing ("같은 세션 안에서만 누적된다 — 세션이 바뀌면 1 부터") reinstates the crash-loop
    // reset without using a reset verb, so the crossing-resume scope must be asserted directly.
    expect(text, `${copy} the counter must accumulate ACROSS resume, not only within a session`).toMatch(
      /라운드 카운터는 재개를 가로질러 \*\*누적\*\*된다/
    );
    expect(text, `${copy} the counter must not be scoped to a single session`).not.toMatch(
      /세션 안에서만|세션이 바뀌면|only within a session/i
    );
    // The gate is run-scoped while the counter crosses resume, so run_id identity must be stated or
    // the two live in different runs.
    expect(text, `${copy} a resumed orchestration must reuse the same run_id`).toMatch(
      /같은 `run_id` 를 그대로 재사용|reuses the same run_id/i
    );
    expect(text, `${copy} a passing verdict must not persist across resume`).toMatch(
      /verdict[^\n]{0,30}(?:영속되지 않|비영속|does not persist|not persist)/i
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Helpers for the v1.2.0 continuity fields. Section-scoped like the block above: the `## 2` chunk
// carries both the required and the optional field tables, and the last h3 of §2 otherwise swallows
// §3/§4/§5 including the emit example — two mutations survived off exactly that in earlier rounds.
// ---------------------------------------------------------------------------------------------

/** A heading and everything under it, down to the next same-or-higher-level heading. "" when absent. */
function section(text: string, headingRe: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && headingRe.test(l));
  if (start === -1) return "";
  const level = (lines[start].match(/^#+/) as RegExpMatchArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^#+/);
    if (m && m[0].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The single line containing the first match of `re`. "" when absent. */
function line(text: string, re: RegExp): string {
  return text.split("\n").find((l) => re.test(l)) ?? "";
}

/** Trimmed cells of the first table row matching `re`; [] when absent. */
function cells(text: string, re: RegExp): string[] {
  const row = text.split("\n").find((l) => /^\s*\|/.test(l) && re.test(l));
  return row ? row.split("|").map((c) => c.trim()) : [];
}

/** Hedges that turn a MUST into a SHOULD. See kiwi-wave-continuity-content.test.ts for the rationale. */
const V12_HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라|가급적/;

// @req FR-FLOW-047
// @req FR-FLOW-048
// @req FR-FLOW-049
// @req FR-FLOW-051
//
// The wave-event contract gains the design-baseline pointer, the SRS-authoring mark, the run-scoped
// final-verification event and the design/preservation/regression layers of the verification object.
// These are additive optional fields, so the file's own SemVer rule ("minor: 필드 추가") makes this a
// 1.2.0 minor bump — which retargets the version literals the FR-FLOW-046 block above pins at 1.1.0.
// See docs/plans/2026-07-29.speckiwi.v244.implementation-contract.md §0 for the exact edit that
// belongs with the implementation.
//
// Every assertion runs over all four shipped copies: a stale copy silently restores a contract in
// which a design gap, a skipped requirement or an unverified final pass leaves no trace at all.
describe("FR-FLOW-047/048/049/051 — waves-event v1.2.0 continuity fields", () => {
  // The version literal this block used to pin lives in the FR-FLOW-046 block above and in the
  // round-2 describe below, both at 1.3.0 and both forbidding every pre-1.3.0 example. A third
  // verbatim copy of the same three assertions is what round-2 contract §0 removes.

  // FR-FLOW-051 AC-4 / FR-FLOW-049 AC-4: the phase enum is the carrier for both new records.
  it.each(WAVES_COPIES)("%s extends the phase enum to four members", (copy) => {
    const optional = section(read(copy), /^###\s.*선택 필드/);
    expect(optional, `${copy} must have an optional-fields section`).not.toBe("");
    const row = cells(optional, /^\s*\|\s*`phase`\s*\|/);
    expect(row.length, `${copy} must keep a phase enum row`).toBeGreaterThan(3);
    for (const member of ["pipeline", "srs-authoring", "wave-verify", "final-verify"]) {
      expect(row[3].includes(member), `${copy} the phase enum CELL must list ${member}`).toBe(true);
    }
  });

  // FR-FLOW-047 AC-2/AC-6, FR-FLOW-048 AC-1, FR-FLOW-051 AC-4: three new optional fields. They must
  // stay optional — promoting any of them into the required table is a breaking change, which is
  // what the 1.2.0-vs-2.0.0 decision turns on.
  it.each(WAVES_COPIES)("%s adds the continuity fields as optional, not required", (copy) => {
    const text = read(copy);
    const optional = section(text, /^###\s.*선택 필드/);
    const required = section(text, /^###\s.*필수 필드/);
    expect(optional, `${copy} must have an optional-fields section`).not.toBe("");
    expect(required, `${copy} must have a required-fields section`).not.toBe("");
    for (const field of ["design_baseline", "constraints_path", "srs_authored"]) {
      expect(
        cells(optional, new RegExp(`^\\s*\\|\\s*\`${field}\``)).length > 3,
        `${copy} optional fields must declare ${field} as its own row`
      ).toBe(true);
      expect(
        required.includes(`\`${field}\``),
        `${copy} must NOT promote ${field} into the required fields; that would be a breaking change`
      ).toBe(false);
    }
  });

  // FR-FLOW-047 AC-2/AC-3/AC-4/AC-6.
  it.each(WAVES_COPIES)("%s defines the design_baseline object", (copy) => {
    const obj = section(read(copy), /^###\s.*`design_baseline` object/);
    expect(obj, `${copy} must document the design_baseline object`).not.toBe("");
    for (const key of ["path", "source_file", "heading_path", "line_start", "line_end"]) {
      expect(
        cells(obj, new RegExp(`^\\s*\\|\\s*\`${key}\``)).length > 3,
        `${copy} design_baseline must record ${key} as its own row`
      ).toBe(true);
    }
    // AC-3: the out-of-scope escape hatch has to be a recorded structure, not narrative, or the
    // coverage gate has nothing to read.
    for (const key of ["out_of_scope", "existing_modules"]) {
      expect(
        cells(obj, new RegExp(`^\\s*\\|\\s*\`${key}\``)).length > 3,
        `${copy} design_baseline must record ${key} as its own row`
      ).toBe(true);
    }
    const outOfScope = line(obj, /`out_of_scope`/);
    expect(
      /heading[^\n]*reason/.test(outOfScope),
      `${copy} each out_of_scope entry must carry both the heading and the reason`
    ).toBe(true);
    // AC-6: the pointer is the whole reason the field exists.
    expect(
      /`waves\.jsonl` 만으로 해소된다/.test(obj),
      `${copy} the baseline artifact must be resolvable from waves.jsonl alone`
    ).toBe(true);
  });

  // FR-FLOW-048 AC-3/AC-4/AC-5/AC-6 and FR-FLOW-054 AC-6: the verification object's new layers.
  it.each(WAVES_COPIES)("%s extends the verification object with the three new layers", (copy) => {
    const text = read(copy);
    const verification = section(text, /^###\s.*`verification` object/);
    expect(verification, `${copy} must document the verification object`).not.toBe("");

    // design_layer — counts plus the unmapped list.
    const designRow = cells(verification, /^\s*\|\s*`design_layer`/);
    expect(designRow.length, `${copy} the verification object must record design_layer`).toBeGreaterThan(3);
    for (const key of ["expected", "mapped", "unmapped"]) {
      expect(designRow[3].includes(key), `${copy} design_layer must carry ${key}`).toBe(true);
    }

    // preservation_layer — verifier 2's mechanically derived denominator.
    const preservationRow = cells(verification, /^\s*\|\s*`preservation_layer`/);
    expect(preservationRow.length, `${copy} the verification object must record preservation_layer`).toBeGreaterThan(3);
    for (const key of ["expected", "checked", "rows"]) {
      expect(preservationRow[3].includes(key), `${copy} preservation_layer must carry ${key}`).toBe(true);
    }
    expect(
      /intended-improvement/.test(preservationRow[3]) && /unapproved-damage/.test(preservationRow[3]),
      `${copy} each preservation row must be judged by the two-value enum, not by free text`
    ).toBe(true);

    // regression — the wave-head suite run.
    const regressionRow = cells(verification, /^\s*\|\s*`regression`/);
    expect(regressionRow.length, `${copy} the verification object must record regression`).toBeGreaterThan(3);
    for (const key of ["command", "exit_code", "failing_tests"]) {
      expect(regressionRow[3].includes(key), `${copy} regression must carry ${key}`).toBe(true);
    }

    // The rules that make the fields load-bearing rather than decorative. Each is anchored to its
    // own line and required to be unhedged: "미매핑이 있으면 ALL_MATCH 를 지양한다" keeps every token
    // while removing the gate.
    const allMatchRule = line(verification, /미매핑 설계 항목/);
    expect(allMatchRule, `${copy} must state what an unmapped design item does to the roll-up`).not.toBe("");
    expect(
      /\*\*1건이라도\*\*/.test(allMatchRule),
      `${copy} a single unmapped design item must be enough to forbid ALL_MATCH`
    ).toBe(true);
    expect(
      /`ALL_MATCH`[^\n]*(?:불가|기록할 수 없다|기록하지 않는다)/.test(allMatchRule),
      `${copy} an unmapped design item must forbid the ALL_MATCH roll-up`
    ).toBe(true);
    expect(V12_HEDGE.test(allMatchRule), `${copy} the ALL_MATCH prohibition must be absolute, not hedged`).toBe(false);

    const regressionRule = line(verification, /`regression\.exit_code`/);
    expect(regressionRule, `${copy} must state what the regression run does to the verdict`).not.toBe("");
    expect(
      /`verdict`[^\n]*`pass`|`pass`[^\n]*`regression\.exit_code`/.test(regressionRule),
      `${copy} a passing verdict must require the regression run to have succeeded`
    ).toBe(true);
    expect(V12_HEDGE.test(regressionRule), `${copy} the regression precondition must be absolute, not hedged`).toBe(
      false
    );

    // AC-6: the round-count reconciliation binds both axes, and an invalid round costs the streak.
    const rowCountRule = line(verification, /행 수/);
    expect(rowCountRule, `${copy} must state the row-count reconciliation rule`).not.toBe("");
    expect(
      /두 검증자 \*\*모두\*\*/.test(rowCountRule),
      `${copy} the row-count rule must bind BOTH verifiers, not only the intent axis`
    ).toBe(true);
    expect(/\*\*무효\*\*/.test(rowCountRule), `${copy} a round whose row count misses the denominator must be invalid`).toBe(
      true
    );

    // Silence must not read as clean here either: the unmapped list follows the residual rule.
    expect(
      /`unmapped` 은 \*\*전량\*\*이어야 하며 잘라내지 않는다/.test(verification),
      `${copy} the unmapped design item list must be complete and never truncated`
    ).toBe(true);
  });

  // FR-FLOW-053 AC-6 and FR-FLOW-055 AC-3: a skipped, deferred or carried-forward item has to be
  // distinguishable inside residual, or "reported as residual" degrades to an untyped free-text blob.
  it.each(WAVES_COPIES)("%s types the residual entries", (copy) => {
    const verification = section(read(copy), /^###\s.*`verification` object/);
    const reasonClass = line(verification, /`reason_class`/);
    expect(reasonClass, `${copy} residual entries must carry a reason_class`).not.toBe("");
    for (const member of [
      "draft-stability-skip",
      "task-failure-skip",
      "scope-boundary-deferred",
      "srs-level-unclosable",
      "design-gap",
      "cross-wave-carry-forward"
    ]) {
      expect(reasonClass.includes(member), `${copy} the reason_class enum must define ${member}`).toBe(true);
    }
    const crossWave = line(verification, /`cross_wave`/);
    expect(crossWave, `${copy} residual entries must carry a cross_wave marker`).not.toBe("");
    expect(
      verification.includes("`carried_into`"),
      `${copy} a carried-forward residual must record the wave it was carried into`
    ).toBe(true);
  });

  // FR-FLOW-051 AC-4/AC-5: the authoring-finished mark must be distinguishable from "merely running".
  it.each(WAVES_COPIES)("%s defines an SRS-authoring-finished record", (copy) => {
    const text = read(copy);
    const optional = section(text, /^###\s.*선택 필드/);
    const row = cells(optional, /^\s*\|\s*`srs_authored`/);
    expect(row.length, `${copy} must declare srs_authored`).toBeGreaterThan(3);
    expect(/bool/i.test(row[2]), `${copy} srs_authored must be a boolean`).toBe(true);
    // The discriminator: phase alone is written at authoring START too, so the boolean is what makes
    // "finished" distinguishable from "in progress".
    const rule = line(text, /`srs_authored`[^\n]*true/);
    expect(rule, `${copy} must state what marks authoring as finished`).not.toBe("");
    expect(/srs-authoring/.test(rule), `${copy} the finished mark must ride on the srs-authoring phase record`).toBe(
      true
    );
    expect(
      /진행 중인 것과 구분된다/.test(text),
      `${copy} the finished mark must be stated as distinguishable from a merely in-progress wave`
    ).toBe(true);
  });

  // FR-FLOW-049 AC-4/AC-5: the run-scoped final event and the overall-completion predicate.
  it.each(WAVES_COPIES)("%s defines the run-scoped final verification event", (copy) => {
    const text = read(copy);
    const rule = line(text, /`wave`[^\n]*"all"/);
    expect(rule, `${copy} must define the run-scoped sentinel for the final event`).not.toBe("");
    expect(
      /`order`[^\n]*0/.test(rule),
      `${copy} the run-scoped final event must carry order=0 alongside wave="all"`
    ).toBe(true);
    expect(/final-verify/.test(rule), `${copy} the run-scoped event must carry phase=final-verify`).toBe(true);
    // Without the exclusion the per-wave latest-status scan reads "all" as a wave and the resume
    // predicate reports an extra incomplete wave forever.
    expect(
      /wave 별[^\n]*최신[^\n]*`wave="all"`[^\n]*(?:제외|빼고)/.test(text),
      `${copy} the per-wave latest-status computation must exclude the run-scoped event`
    ).toBe(true);
  });

  it.each(WAVES_COPIES)("%s defines overall completion as all waves plus a passing final pass", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    expect(resume, `${copy} must have a resume section`).not.toBe("");
    const rule = line(resume, /전체 완료/);
    expect(rule, `${copy} must define overall completion`).not.toBe("");
    expect(
      /모든 wave 가 `complete`/.test(rule),
      `${copy} overall completion must still require every wave to be complete`
    ).toBe(true);
    // The conjunct that FR-FLOW-049 AC-5 adds. Its absence is what lets a run report completion
    // with an unverified final pass.
    expect(
      /최신 `final-verify`[^\n]*`verification\.verdict`[^\n]*`pass`/.test(rule),
      `${copy} overall completion must also require a passing final-verification verdict`
    ).toBe(true);
    expect(V12_HEDGE.test(rule), `${copy} the overall-completion predicate must be absolute, not hedged`).toBe(false);
    // And the run must resume INTO the final pass rather than reporting done.
    expect(
      /최종 검증(?:으로|부터) 재개한다/.test(resume),
      `${copy} a run whose final pass has not passed must resume into the final pass`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Round-2 evaluation findings — docs/analysis/wave-fit-eval/round2-findings.md.
// Test ids carry the finding id (R2-C1 … R2-L4) rather than a requirement tag; the SRS ids are
// assigned once these contracts are agreed.
//
// These are the shared-contract half of the round-2 repairs. The kiwi-wave-master half lives in
// test/skills/kiwi-wave-continuity-r2-content.test.ts, and
// docs/plans/2026-07-29.speckiwi.v244-r2.implementation-contract.md pins the field names both halves
// share. All four shipped copies are in scope: a stale copy silently restores a contract in which a
// second epic reads the first epic's completion as its own.
// ---------------------------------------------------------------------------------------------
describe("R2 — waves-event run-scoped resume, frozen denominators and preservation gate", () => {
  // The optional fields added below are field additions, which the file's own SemVer rule makes a
  // minor bump. The FR-FLOW-047 block above pins 1.2.0; see the round-2 contract §0 for the exact
  // retarget that belongs with the implementation.
  it.each(WAVES_COPIES)("%s declares schema version 1.3.0", (copy) => {
    const text = read(copy);
    expect(text, `${copy} must declare the minor-bumped contract version in its title`).toMatch(
      /^#\s*kiwi waves event v1\.3\.0/m
    );
    expect(text, `${copy} emit and schema examples must carry the bumped schema_version`).toMatch(
      /"schema_version"\s*:\s*"1\.3\.0"/
    );
    expect(text, `${copy} must not leave a stale pre-1.3.0 schema_version example behind`).not.toMatch(
      /"schema_version"\s*:\s*"1\.(?:0|1|2)\.0"/
    );
  });

  // R2-C1: the resume scan is the single most dangerous read in the contract — a repository-wide
  // latest-status scan lets a second epic inherit the first epic's completion and report "done"
  // with zero implementation.
  it.each(WAVES_COPIES)("%s scopes the resume computation to the current run_id", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    expect(resume, `${copy} must have a resume section`).not.toBe("");
    const rule = line(resume, /현재 run 의 `run_id`/);
    expect(rule, `${copy} the resume scan must state whose events it reads`).not.toBe("");
    expect(
      /일치하는 이벤트만/.test(rule),
      `${copy} only events whose run_id equals the current run may enter the computation`
    ).toBe(true);
    expect(V12_HEDGE.test(rule), `${copy} the run-scoping rule must be absolute, not hedged`).toBe(false);
    // The wave="all" exclusion is a different filter and must not be presented as the only one.
    expect(
      /필터는[^\n]*하나뿐|유일한 필터/.test(resume),
      `${copy} the wave="all" exclusion must not be described as the only filter on the scan`
    ).toBe(false);
  });

  it.each(WAVES_COPIES)("%s defines which run a bare resume picks", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    const rule = line(resume, /재개 대상 run/);
    expect(rule, `${copy} must define how the run to resume is chosen`).not.toBe("");
    expect(
      /가장 최근[^\n]*미완료/.test(rule),
      `${copy} a bare resume must pick the most recent INCOMPLETE run, not the most recent run`
    ).toBe(true);
    expect(
      /명시|`--run-id`/.test(rule),
      `${copy} an explicitly supplied run id must override the automatic choice`
    ).toBe(true);
  });

  // The two existing grandfather clauses are version-scoped; this one must not be, or the bypass
  // survives in every journal already on disk.
  it.each(WAVES_COPIES)("%s grants no version exemption to the run-scoping rule", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    const rule = line(resume, /버전 면제를 두지 않는다/);
    expect(rule, `${copy} the run-scoping rule must explicitly refuse a grandfather exemption`).not.toBe("");
    expect(
      /run_id|run 스코프|run-scop/i.test(rule),
      `${copy} the refusal must be attached to the run-scoping rule, not to some other clause`
    ).toBe(true);
    expect(V12_HEDGE.test(rule), `${copy} the refusal must be absolute, not hedged`).toBe(false);
  });

  // R2-C2: preservation_layer was recorded but wired to nothing, so an honestly recorded
  // unapproved-damage row still produced a passing verdict and an uncancellable complete.
  it.each(WAVES_COPIES)("%s blocks a passing verdict on an unapproved-damage row", (copy) => {
    const verification = section(read(copy), /^###\s.*`verification` object/);
    expect(verification, `${copy} must document the verification object`).not.toBe("");
    const rule = line(verification, /`unapproved-damage`[^\n]*`verdict`|`verdict`[^\n]*`unapproved-damage`/);
    expect(rule, `${copy} must state what an unapproved-damage row does to the verdict`).not.toBe("");
    // Same quantifier strength as the design_layer rule directly above it: one row is enough.
    expect(
      /\*\*1건이라도\*\*/.test(rule),
      `${copy} a single unapproved-damage row must be enough to forbid a passing verdict`
    ).toBe(true);
    expect(
      /`pass` 로 기록(?:하지 않는다|할 수 없다)/.test(rule),
      `${copy} an unapproved-damage row must forbid recording verdict=pass`
    ).toBe(true);
    expect(V12_HEDGE.test(rule), `${copy} the preservation gate must be absolute, not hedged`).toBe(false);
  });

  // R2-M16: without a recorded citation the two-value enum is still free discretion.
  it.each(WAVES_COPIES)("%s requires each preservation row to carry its evidence", (copy) => {
    const verification = section(read(copy), /^###\s.*`verification` object/);
    const row = cells(verification, /^\s*\|\s*`preservation_layer`/);
    expect(row.length, `${copy} the verification object must record preservation_layer`).toBeGreaterThan(3);
    expect(
      row[3].includes("evidence"),
      `${copy} each preservation row must carry an evidence key alongside item and verdict`
    ).toBe(true);
  });

  // R2-C3: design_layer.expected was self-assessed per round, so widening the item unit was the
  // cheapest way to reach unmapped=0.
  it.each(WAVES_COPIES)("%s pins design_layer.expected to the recorded design items", (copy) => {
    const text = read(copy);
    const baseline = section(text, /^###\s.*`design_baseline` object/);
    expect(baseline, `${copy} must document the design_baseline object`).not.toBe("");
    expect(
      cells(baseline, /^\s*\|\s*`design_items`/).length > 3,
      `${copy} design_baseline must record design_items as its own row`
    ).toBe(true);
    const itemRow = line(baseline, /`design_items`/);
    for (const key of ["id", "heading_path", "line_start", "line_end", "statement"]) {
      expect(itemRow.includes(key), `${copy} each design item must record ${key}`).toBe(true);
    }
    const verification = section(text, /^###\s.*`verification` object/);
    const pin = line(verification, /`design_layer\.expected`/);
    expect(pin, `${copy} must pin the design denominator to the recorded items`).not.toBe("");
    expect(
      /`design_items`/.test(pin),
      `${copy} design_layer.expected must equal the length of the recorded design_items`
    ).toBe(true);
    expect(V12_HEDGE.test(pin), `${copy} the external-denominator rule must be absolute, not hedged`).toBe(false);
  });

  // R2-H8: the bundle and the authoring input must point at the same artifact.
  it.each(WAVES_COPIES)("%s records the design excerpt path", (copy) => {
    const baseline = section(read(copy), /^###\s.*`design_baseline` object/);
    expect(
      cells(baseline, /^\s*\|\s*`excerpt_path`/).length > 3,
      `${copy} design_baseline must record excerpt_path so authoring reads prose, not a pointer`
    ).toBe(true);
  });

  // R2-H5: an absolute exit_code=0 requirement means no wave can ever complete in a repository that
  // already has a red test, which is the state kiwi-coder explicitly tolerates.
  it.each(WAVES_COPIES)("%s judges the wave regression as a baseline delta", (copy) => {
    const verification = section(read(copy), /^###\s.*`verification` object/);
    const row = cells(verification, /^\s*\|\s*`regression`/);
    expect(row.length, `${copy} the verification object must record regression`).toBeGreaterThan(3);
    expect(
      row[3].includes("baseline_failing_tests"),
      `${copy} the regression object must record the pinned baseline failures`
    ).toBe(true);
    const rule = line(verification, /baseline_failing_tests`?\s*\)?[^\n]*(?:verdict|pass)|신규 실패/);
    expect(rule, `${copy} must state the delta rule for a passing verdict`).not.toBe("");
    expect(
      /신규 실패 0\s*건/.test(rule),
      `${copy} the pass condition must be zero NEW failures, not zero failures`
    ).toBe(true);
    expect(
      /failing_tests\s*⊆\s*baseline_failing_tests/.test(rule),
      `${copy} the delta must be stated as the subset relation so it cannot be read loosely`
    ).toBe(true);
    expect(V12_HEDGE.test(rule), `${copy} the delta rule must be absolute, not hedged`).toBe(false);
    // The fallback must be the strict rule, never the other way round.
    const fallback = line(verification, /캡처(?:에)? 실패/);
    expect(fallback, `${copy} must state what happens when the baseline capture failed`).not.toBe("");
    expect(
      /`exit_code`/.test(fallback),
      `${copy} only a failed capture may fall back to requiring an absolutely green suite`
    ).toBe(true);
  });

  // R2-H10: a mandatory evidence row sourced from an optional field is unsatisfiable by design.
  it.each(WAVES_COPIES)("%s adds a constraint layer with a roll-up consequence", (copy) => {
    const verification = section(read(copy), /^###\s.*`verification` object/);
    const row = cells(verification, /^\s*\|\s*`constraint_layer`/);
    expect(row.length, `${copy} the verification object must record constraint_layer`).toBeGreaterThan(3);
    for (const key of ["expected", "checked", "violations"]) {
      expect(row[3].includes(key), `${copy} constraint_layer must carry ${key}`).toBe(true);
    }
    const rule = line(verification, /`constraint_layer\.violations`/);
    expect(rule, `${copy} must state what a constraint violation does to the roll-up`).not.toBe("");
    expect(
      /\*\*1건이라도\*\*/.test(rule),
      `${copy} a single violation must be enough to forbid ALL_MATCH`
    ).toBe(true);
    expect(
      /`ALL_MATCH`[^\n]*(?:불가|기록할 수 없다|기록하지 않는다)/.test(rule),
      `${copy} a constraint violation must forbid the ALL_MATCH roll-up`
    ).toBe(true);
    expect(V12_HEDGE.test(rule), `${copy} the constraint gate must be absolute, not hedged`).toBe(false);
    // The empty array is the falsifiable claim; an absent field is silence.
    const empty = line(verification, /빈 배열/);
    expect(
      /`constraints_path`|제약/.test(empty),
      `${copy} an undeclared constraint set must still be written as an empty artifact`
    ).toBe(true);
  });

  // R2-M1: every consumer of the diff presumes a window that the journal never records.
  it.each(WAVES_COPIES)("%s records the wave diff window as git refs", (copy) => {
    const optional = section(read(copy), /^###\s.*선택 필드/);
    expect(optional, `${copy} must have an optional-fields section`).not.toBe("");
    const row = cells(optional, /^\s*\|\s*`diff_window`/);
    expect(row.length, `${copy} the event must be able to carry a diff window`).toBeGreaterThan(3);
    for (const key of ["base_sha", "head_sha"]) {
      expect(row[3].includes(key), `${copy} diff_window must carry ${key}`).toBe(true);
    }
  });

  // R2-M4: a re-entry creates a new pipeline run, so a single-run window either re-verifies
  // pre-fix evidence or passes on stale clean evidence.
  it.each(WAVES_COPIES)("%s records every pipeline run of a wave", (copy) => {
    const text = read(copy);
    const optional = section(text, /^###\s.*선택 필드/);
    const row = cells(optional, /^\s*\|\s*`pipeline_run_ids`/);
    expect(row.length, `${copy} the event must record the full list of pipeline runs`).toBeGreaterThan(3);
    const rule = line(text, /`pipeline_run_ids`[^\n]*(?:전량|모든)/);
    expect(rule, `${copy} must state that the list is complete`).not.toBe("");
    expect(
      /`pipeline_run_id`/.test(rule),
      `${copy} the relationship to the existing single-value field must be stated, not left to inference`
    ).toBe(true);
  });

  // R2-M5: the row-count invalidation rule presumes a fixed denominator that nothing freezes.
  it.each(WAVES_COPIES)("%s freezes the denominator the row-count rule compares against", (copy) => {
    const verification = section(read(copy), /^###\s.*`verification` object/);
    const row = cells(verification, /^\s*\|\s*`frozen_denominator`/);
    expect(row.length, `${copy} the verification object must record frozen_denominator`).toBeGreaterThan(3);
    for (const key of ["round", "req_ac", "design_items", "preservation"]) {
      expect(row[3].includes(key), `${copy} frozen_denominator must carry ${key}`).toBe(true);
    }
    const rowCountRule = line(verification, /행 수/);
    expect(
      /`frozen_denominator`/.test(rowCountRule),
      `${copy} the row-count invalidation must compare against the frozen counts, not against a moving target`
    ).toBe(true);
  });

  // R2-M6: counters accumulate across resume while streaks reset, so a resume near the cap makes
  // PASS arithmetically unreachable and the loop burns the remaining rounds for nothing.
  it.each(WAVES_COPIES)("%s detects an arithmetically unreachable pass", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    const rule = line(resume, /남은 라운드/);
    expect(rule, `${copy} the resume-near-cap case must be handled`).not.toBe("");
    expect(
      /스트릭/.test(rule),
      `${copy} the comparison must be against the streak requirement of the active mode`
    ).toBe(true);
    expect(
      /`fail-cap`/.test(rule),
      `${copy} an unreachable pass must be recorded as fail-cap rather than burned through`
    ).toBe(true);
    // The two unsafe remedies. Extending the cap removes the escalation; persisting the streak
    // contradicts the "approval is never persisted" rule this file already carries.
    expect(
      /cap 을 (?:연장|늘린다)/.test(resume),
      `${copy} extending the cap must not be offered as the remedy`
    ).toBe(false);
    expect(
      /스트릭(?:을|은)[^\n]*영속(?!되지)/.test(resume),
      `${copy} persisting the streak must not be offered as the remedy`
    ).toBe(false);
  });

  // R2-M12: §3's gate requires a preceding wave-verify record, which a wave="all" event can never
  // have — so the run-scope complete is invalid by construction unless it is exempted.
  it.each(WAVES_COPIES)("%s exempts the run-scope event from the per-wave verification gate", (copy) => {
    const transitions = section(read(copy), /^##\s*3\./);
    expect(transitions, `${copy} must have a status-transition section`).not.toBe("");
    const rule = line(transitions, /적용하지 않는다/);
    expect(rule, `${copy} the per-wave gate must state its exemption for the run-scope event`).not.toBe("");
    expect(
      /`wave="all"`|run-scope/.test(rule),
      `${copy} the exemption must be scoped to the run-scope final event`
    ).toBe(true);
    expect(
      /§4/.test(rule),
      `${copy} the exemption must redirect to §4, which carries the run-scope completion predicate`
    ).toBe(true);
  });

  // R2-L4: the contract defines the passing final event but never the failing one, so a producer
  // has to guess — and `complete` is the guess that ends the run.
  it.each(WAVES_COPIES)("%s defines the status of a failing final verification", (copy) => {
    const text = read(copy);
    const rule = line(text, /`final-verify`[^\n]*(?:통과하지|pass 가 아니)/);
    expect(rule, `${copy} must define the status of a final pass that did not pass`).not.toBe("");
    expect(
      /`failed`/.test(rule),
      `${copy} a failing final verification must be recorded as failed`
    ).toBe(true);
    expect(
      /`complete`/.test(rule),
      `${copy} the sentence must contrast it with complete so the two are not conflated`
    ).toBe(true);
    expect(V12_HEDGE.test(rule), `${copy} the failing-status rule must be absolute, not hedged`).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Round-3 evaluation findings — docs/analysis/wave-fit-eval/round3-findings.md.
// Test ids carry the finding id (R3-H3 … R3-L1) rather than a requirement tag; the SRS ids are
// assigned once these contracts are agreed.
//
// These are the shared-contract half of the round-3 repairs. The kiwi-wave-master and per-skill half
// lives in test/skills/kiwi-wave-continuity-r3-content.test.ts, and
// docs/plans/2026-07-29.speckiwi.v244-r3.implementation-contract.md pins the field names both halves
// share. All four shipped copies are in scope: a stale copy silently restores a contract in which the
// preservation denominator of the final pass has no input at all.
//
// The version literals stay at 1.3.0. Round 3 adds optional fields (`plan_run_id`, `run_diff_window`,
// `integration_items`, `exclusion_class`) and version-scoped-free clarifications, which the file's own
// SemVer rule would make a 1.4.0 minor bump — but the two round-2 blocks above pin 1.3.0 in three
// places each, so the contract keeps 1.3.0 and records the new fields as `v1.3.0` additions. See the
// round-3 contract §0 for why that is the safe reading rather than a fourth version retarget.
// ---------------------------------------------------------------------------------------------

/** Hedges. Same list as the skill-side suite, including 지양, which V12_HEDGE predates. */
const R3_HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라|가급적|지양/;

/** R3-H6: the closed vocabulary an out-of-scope exclusion must be classified with. */
const R3_EXCLUSION_CLASSES = [
  "already-implemented",
  "superseded",
  "external-ownership",
  "user-excluded",
  "non-normative"
] as const;

describe("R3 — waves-event production duties, run-scope window and closed exclusion vocabulary", () => {
  // R3-H3: both fields have consumers in three places and no producer anywhere. The skill writes
  // them; the contract has to say they are not optional on the events the consumers read.
  it.each(WAVES_COPIES)("%s makes the window fields mandatory on the events that are read", (copy) => {
    const optional = section(read(copy), /^###\s.*선택 필드/);
    expect(optional, `${copy} must have an optional-fields section`).not.toBe("");
    const rule = line(optional, /`diff_window`[^\n]*`pipeline_run_ids`|`pipeline_run_ids`[^\n]*`diff_window`/);
    expect(rule, `${copy} must state the de-facto requirement for both window fields together`).not.toBe("");
    expect(
      /사실상 필수/.test(rule),
      `${copy} both fields must be de-facto required, the same status pipeline_run_id already has`
    ).toBe(true);
    expect(
      /wave-verify/.test(rule) && /`complete`/.test(rule),
      `${copy} the requirement must name the two event kinds the verifier reads`
    ).toBe(true);
    expect(R3_HEDGE.test(rule), `${copy} the requirement must be absolute, not hedged`).toBe(false);
  });

  // R3-H5: a resumed session cannot supply --plan-run-id if the journal never recorded it.
  it.each(WAVES_COPIES)("%s records the plan run id as its own field", (copy) => {
    const optional = section(read(copy), /^###\s.*선택 필드/);
    const row = cells(optional, /^\s*\|\s*`plan_run_id`/);
    expect(
      row.length,
      `${copy} the event must carry the plan run id; it is a different value from pipeline_run_id and the resume needs it`
    ).toBeGreaterThan(3);
    expect(
      /`pipeline_run_id`/.test(row[3]),
      `${copy} the field must state its relationship to pipeline_run_id, which is the value it is confused with`
    ).toBe(true);
  });

  // R3-H9: the final pass requires a preservation verdict, and its denominator is defined only over a
  // wave diff window that a run-scope event cannot have.
  it.each(WAVES_COPIES)("%s defines a run-scope diff window for the final event", (copy) => {
    const text = read(copy);
    const optional = section(text, /^###\s.*선택 필드/);
    const row = cells(optional, /^\s*\|\s*`run_diff_window`/);
    expect(
      row.length,
      `${copy} the run-scope final event needs its own window; without one the preservation denominator has no input`
    ).toBeGreaterThan(3);
    for (const key of ["base_sha", "head_sha"]) {
      expect(row[3].includes(key), `${copy} run_diff_window must carry ${key}`).toBe(true);
    }
    expect(
      /final-verify/.test(row[3]),
      `${copy} the field must be scoped to the final-verify event so it is not confused with the per-wave window`
    ).toBe(true);
    // The emit example is what an agent copies verbatim, so the final-verify line must carry it and
    // the comment that says a diff window is never carried there must be corrected with it.
    const emit = text.split(/^## /m).find((s) => /Emit 패턴/.test(s)) ?? "";
    expect(emit, `${copy} must have an emit section`).not.toBe("");
    const finalLine = emit.split("\n").find((l) => l.includes('"phase":"final-verify"')) ?? "";
    expect(finalLine, `${copy} the emit example must show the run-scope final event`).not.toBe("");
    expect(
      finalLine.includes("run_diff_window"),
      `${copy} the final-verify example line must carry the run-scope window it is required to record`
    ).toBe(true);
    expect(
      /diff 창은 wave 단위이므로 싣지 않는다/.test(emit),
      `${copy} the comment that forbids a window on the final event contradicts the new field and must be replaced`
    ).toBe(false);
  });

  // R3-H8: constraint_layer was the only layer with no external fixing and no freeze.
  it.each(WAVES_COPIES)("%s freezes and externally fixes the constraint denominator", (copy) => {
    const verification = section(read(copy), /^###\s.*`verification` object/);
    expect(verification, `${copy} must document the verification object`).not.toBe("");
    const row = cells(verification, /^\s*\|\s*`frozen_denominator`/);
    expect(row.length, `${copy} the verification object must record frozen_denominator`).toBeGreaterThan(3);
    for (const key of ["round", "req_ac", "design_items", "preservation", "constraints"]) {
      expect(
        row[3].includes(key),
        `${copy} frozen_denominator must carry ${key}; a layer outside it escapes the row-count invalidation`
      ).toBe(true);
    }
    const pin = line(verification, /`constraint_layer\.expected`/);
    expect(pin, `${copy} the constraint denominator must be pinned outside the verifier`).not.toBe("");
    expect(
      /`constraints_path`/.test(pin),
      `${copy} constraint_layer.expected must equal the item count of the recorded constraints artifact`
    ).toBe(true);
    expect(
      /검증자가 (?:스스로 )?산정하지 않는다/.test(pin),
      `${copy} the phrasing must match the design_layer rule it is being made symmetric with`
    ).toBe(true);
    expect(R3_HEDGE.test(pin), `${copy} the external-denominator rule must be absolute, not hedged`).toBe(false);
  });

  // R3-M4: design_layer.expected is defined as "that wave's design_items", which wave="all" has none of.
  it.each(WAVES_COPIES)("%s defines the design denominator for the run-scope event", (copy) => {
    const text = read(copy);
    const baseline = section(text, /^###\s.*`design_baseline` object/);
    expect(baseline, `${copy} must document the design_baseline object`).not.toBe("");
    const row = cells(baseline, /^\s*\|\s*`integration_items`/);
    expect(
      row.length,
      `${copy} the cross-wave integration items must be a recorded structure, or the final denominator is improvised`
    ).toBeGreaterThan(3);
    for (const key of ["id", "heading_path", "line_start", "line_end", "statement"]) {
      expect(row[3].includes(key), `${copy} each integration item must record ${key}`).toBe(true);
    }
    const verification = section(text, /^###\s.*`verification` object/);
    const rule = line(verification, /`wave="all"`[^\n]*`design_layer\.expected`|`design_layer\.expected`[^\n]*`wave="all"`/);
    expect(rule, `${copy} the run-scope denominator rule must exist`).not.toBe("");
    expect(
      /합집합/.test(rule),
      `${copy} the run-scope denominator must be the union of every wave's design items, not one wave's`
    ).toBe(true);
    expect(
      /`integration_items`/.test(rule),
      `${copy} the union must add the recorded integration items`
    ).toBe(true);
    expect(R3_HEDGE.test(rule), `${copy} the run-scope denominator rule must be absolute, not hedged`).toBe(false);
  });

  // R3-H6: out_of_scope removed an item from every denominator on one line of free text.
  it.each(WAVES_COPIES)("%s classifies an out-of-scope exclusion with a closed vocabulary", (copy) => {
    const baseline = section(read(copy), /^###\s.*`design_baseline` object/);
    const row = cells(baseline, /^\s*\|\s*`out_of_scope`/);
    expect(row.length, `${copy} design_baseline must record out_of_scope`).toBeGreaterThan(3);
    expect(
      row[3].includes("exclusion_class"),
      `${copy} each exclusion must carry a class alongside the free-text reason`
    ).toBe(true);
    // The enum members live in the object's own prose, next to the row that declares the key.
    const rule = line(baseline, /`exclusion_class`\s*∈|`exclusion_class` 는/);
    expect(rule, `${copy} the exclusion vocabulary must be enumerated, not left open`).not.toBe("");
    for (const member of R3_EXCLUSION_CLASSES) {
      expect(rule.includes(member), `${copy} the exclusion_class enum must define ${member}`).toBe(true);
    }
    expect(
      /자유 텍스트|free text/i.test(rule),
      `${copy} the sentence must say the class replaces free-text discretion, mirroring the reason_class rule`
    ).toBe(true);
  });

  // R3-L1: §4's unreachable-pass predicate compares against a streak requirement no document numbers.
  it.each(WAVES_COPIES)("%s gives the streak requirement a number for Normal", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    expect(resume, `${copy} must have a resume section`).not.toBe("");
    const rule = line(resume, /스트릭[^\n]*요구치/);
    expect(rule, `${copy} the unreachable-pass predicate must state what it compares against`).not.toBe("");
    expect(
      /Normal[^\n]*\*\*1\*\*|\*\*1\*\*[^\n]*Normal/.test(rule),
      `${copy} Normal must be 1 — the mode has no streak, so an unnumbered requirement makes the predicate unevaluable`
    ).toBe(true);
    expect(
      /kiwi-wave-master\s*§5\.5\.4/.test(rule),
      `${copy} the per-mode numbers vary by variant, so the contract must point at the skill table that owns them`
    ).toBe(true);
  });
});

describe("R3-H4 — the re-entry emit key is defined in the shared pipeline-event contract", () => {
  it.each(PIPELINE_COPIES)("%s defines the re-entry idempotency key", (copy) => {
    const text = read(copy);
    const reentry = section(text, /^###\s*5\.4/);
    expect(
      reentry,
      `${copy} the suffix convention lives in one skill today, so the two children that must honour it never read it`
    ).not.toBe("");
    expect(
      /\{run_id\}#r\{n\}/.test(reentry),
      `${copy} the re-entry key must be {run_id}#r{n}, the spelling kiwi-pipeline already publishes`
    ).toBe(true);
    const skipRule = line(reentry, /skip/i);
    expect(skipRule, `${copy} must state what the key does to the idempotency check`).not.toBe("");
    expect(
      /같은 키/.test(skipRule),
      `${copy} the skip must be scoped to the same key, or a re-entry still cannot leave a TASK_DONE`
    ).toBe(true);
    expect(R3_HEDGE.test(skipRule), `${copy} the key rule must be absolute, not hedged`).toBe(false);
  });

  it.each(PIPELINE_COPIES)("%s separates the emit key from the sidecar run_id id space", (copy) => {
    const reentry = section(read(copy), /^###\s*5\.4/);
    const rule = line(reentry, /\[a-z0-9\.-\]\{4,40\}/);
    expect(
      rule,
      `${copy} "#" is not in the sidecar run_id character class, so the separation must be stated or the children reject the key`
    ).not.toBe("");
    expect(
      /적용하지 않는다|대상이 아니다/.test(rule),
      `${copy} the sidecar regex must be stated as NOT applying to the emit key`
    ).toBe(true);
    expect(R3_HEDGE.test(rule), `${copy} the separation must be absolute, not hedged`).toBe(false);
  });

  it.each(PIPELINE_COPIES)("%s names the three skills that must honour the key", (copy) => {
    const reentry = section(read(copy), /^###\s*5\.4/);
    for (const skill of ["kiwi-pipeline", "kiwi-planner", "kiwi-pm"]) {
      expect(
        reentry.includes(skill),
        `${copy} ${skill} emits under a reused run id and must be named as a consumer of this rule`
      ).toBe(true);
    }
  });
});
