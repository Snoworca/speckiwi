import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-104  waves-event.md v1.4.0 — the twenty added fields, additively
// @req FR-FLOW-105  the resume predicate filters by engine; an absent engine reads as kiwi-wave-master
// @req FR-FLOW-111  pipeline-event.md registers kiwi-orchestrator in the closed skill enum
// @req FR-FLOW-112  loop-option.md §6 records the orchestrator's propagation targets
//
// These are authored-text contracts, not executable modules, so their guarantees are asserted as
// raw-text contracts across every shipped copy. `waves-event.md`, `pipeline-event.md` and
// `loop-option.md` each ship in four renderings — the three skill variants plus the `.agents`
// mirror — and a stale copy silently restores the pre-extension contract with no other trace.
//
// Runtime lag: these assertions read the BUNDLED copies under `skills/**` and `.agents/skills/**`.
// The running agent reads `~/.claude/skills/…`, which `00.charter.md:303-304` forbids this
// repository from reinstalling into, so the installed copy stays behind until a consumer reinstalls.
// That lag is recorded as verification evidence on each requirement; it is not a reason to weaken
// anything here.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const SHARED_DIRS = [
  "skills/claude/_shared/kiwi",
  "skills/codex/_shared/kiwi",
  "skills/etc/_shared/kiwi",
  ".agents/skills/_shared/kiwi"
] as const;

const WAVES_COPIES = SHARED_DIRS.map((dir) => `${dir}/waves-event.md`);
const PIPELINE_COPIES = SHARED_DIRS.map((dir) => `${dir}/pipeline-event.md`);
const LOOP_COPIES = SHARED_DIRS.map((dir) => `${dir}/loop-option.md`);

function read(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

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

/** Hedges that turn a MUST into a SHOULD. Same list the sibling wave suites use. */
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라|가급적|지양/;

// ---------------------------------------------------------------------------------------------
// FR-FLOW-104 — waves-event.md v1.4.0
// ---------------------------------------------------------------------------------------------

/** The v1.4.0 additions, in the order FR-FLOW-104's requirement statement enumerates them.
 * The COUNT is load-bearing: AC-1 says twenty, and the schema is asserted set-equal against this
 * list elsewhere, so a field a gate requires and this list omits produces a schema that drops it. */
const V140_FIELDS = [
  "engine",
  "writer",
  "event",
  "verb",
  "inputs_digest",
  "lane",
  "stage",
  "lane_plan",
  "partition_review",
  "isolation",
  "lane_layer",
  "wave_issues",
  "convergence",
  "allocation",
  "decision",
  "deadline_at",
  "postmortem",
  "coverage_residual",
  "lane_disposition",
  "card_digest"
] as const;

/** Top-level optional fields reused verbatim from v1.3.0 (AC-6). A v1.4.0 that quietly drops one of
 * these is not additive. `frozen_denominator` is deliberately NOT here: it is a key of the
 * `verification` object (§2.3), not a top-level row, and is asserted there instead. */
const V130_FIELDS_KEPT = [
  "verification",
  "design_baseline",
  "diff_window",
  "plan_run_id",
  "pipeline_run_ids",
  "run_diff_window"
] as const;

describe("FR-FLOW-104 — waves-event v1.4.0 additive field set across all four shipped copies", () => {
  it("enumerates exactly twenty added fields", () => {
    expect(V140_FIELDS).toHaveLength(20);
    expect(new Set(V140_FIELDS).size, "the enumeration must carry no duplicate").toBe(20);
    expect(WAVES_COPIES, "exactly four copies of waves-event.md ship").toHaveLength(4);
  });

  // AC-1: the document version reads v1.4.0 and the emit examples carry it.
  it.each(WAVES_COPIES)("%s declares schema version 1.4.0", (copy) => {
    const text = read(copy);
    expect(text, `${copy} must declare the minor-bumped contract version in its title`).toMatch(
      /^#\s*kiwi waves event v1\.4\.0/m
    );
    expect(text, `${copy} emit and schema examples must carry the bumped schema_version`).toMatch(
      /"schema_version"\s*:\s*"1\.4\.0"/
    );
    expect(text, `${copy} must not leave a stale pre-1.4.0 schema_version example behind`).not.toMatch(
      /"schema_version"\s*:\s*"1\.(?:0|1|2|3)\.0"/
    );
  });

  // AC-1: every added field is its own row, with a type and a purpose, in the optional-field table.
  // Cell-level, not substring-level: a field name appearing only inside another row's prose would
  // satisfy `text.includes(field)` while giving the schema author nothing to copy.
  it.each(WAVES_COPIES)("%s declares all twenty fields with a type and a purpose", (copy) => {
    const optional = section(read(copy), /^###\s.*선택 필드/);
    expect(optional, `${copy} must have an optional-fields section`).not.toBe("");
    for (const field of V140_FIELDS) {
      const row = cells(optional, new RegExp(`^\\s*\\|\\s*\`${field}\`\\s*\\|`));
      expect(row.length, `${copy} optional fields must declare ${field} as its own row`).toBeGreaterThan(3);
      expect(row[2].length, `${copy} the ${field} row must state a type`).toBeGreaterThan(0);
      expect(row[3].length, `${copy} the ${field} row must state a purpose`).toBeGreaterThan(0);
    }
  });

  // AC-1 corollary: none of the twenty may be promoted into the required table. A new required
  // field is a breaking change, which is exactly what "additive minor" forbids.
  it.each(WAVES_COPIES)("%s keeps all twenty additions optional", (copy) => {
    const required = section(read(copy), /^###\s.*필수 필드/);
    expect(required, `${copy} must have a required-fields section`).not.toBe("");
    for (const field of V140_FIELDS) {
      expect(
        cells(required, new RegExp(`^\\s*\\|\\s*\`${field}\`\\s*\\|`)).length > 3,
        `${copy} must NOT promote ${field} into the required fields; that would be a breaking change`
      ).toBe(false);
    }
  });

  // AC-2: additive, and the downgrade guard that keeps the version honest.
  it.each(WAVES_COPIES)("%s states the change is additive and guards the downgrade", (copy) => {
    const text = read(copy);
    // Anchored to the version, not to the phrase alone: the file's own SemVer sentence has carried
    // "이미 기록된 이벤트의 해석을 바꾸지 않는" since v1.1.0, so an unanchored search matches that
    // line and the v1.4.0 claim could be missing entirely while this stayed green.
    const additive = line(text, /v1\.4\.0[^\n]*이미 기록된 이벤트의 해석을/);
    expect(additive, `${copy} must state that the v1.4.0 extension changes no recorded event`).not.toBe("");
    expect(
      /바꾸지 않는다/.test(additive),
      `${copy} the additive claim must be stated as an absolute, not as an aspiration`
    ).toBe(true);

    const downgrade = line(text, /journal-version-downgrade/);
    expect(downgrade, `${copy} must define the downgrade diagnostic`).not.toBe("");
    expect(
      /1\.4\.0/.test(downgrade),
      `${copy} the downgrade guard must be scoped to a run containing a 1.4.0 line`
    ).toBe(true);
    expect(
      /낮은|lower/.test(downgrade),
      `${copy} the guard must fire on a LATER line carrying a LOWER schema_version`
    ).toBe(true);
    expect(HEDGE.test(downgrade), `${copy} the downgrade guard must be absolute, not hedged`).toBe(false);
  });

  // AC-3: the artifact is wave-scoped, so the field is `wave_issues`. Renaming it after v1.4.0
  // ships is not an additive minor, which is why the old spelling must be gone now.
  it.each(WAVES_COPIES)("%s names the field wave_issues and retires stage_issues", (copy) => {
    const text = read(copy);
    expect(text.includes("wave_issues"), `${copy} must carry the wave-scoped field name`).toBe(true);
    expect(
      text.includes("stage_issues"),
      `${copy} must not carry the superseded stage-scoped spelling anywhere`
    ).toBe(false);
  });

  // AC-4: the producer discriminator and the writer stamp, including their compatibility rules.
  it.each(WAVES_COPIES)("%s defines engine and writer with their compatibility rules", (copy) => {
    const optional = section(read(copy), /^###\s.*선택 필드/);

    const engine = cells(optional, /^\s*\|\s*`engine`\s*\|/);
    expect(engine.length, `${copy} must declare engine`).toBeGreaterThan(3);
    const engineCell = `${engine[2]} ${engine[3]}`;
    expect(
      engineCell.includes("kiwi-wave-master") && engineCell.includes("kiwi-orchestrator"),
      `${copy} engine must be the two-member producer enum`
    ).toBe(true);
    expect(
      /부재[^|]*`kiwi-wave-master`/.test(engineCell),
      `${copy} an absent engine must read as kiwi-wave-master, or the discriminator is not additive`
    ).toBe(true);

    const writer = cells(optional, /^\s*\|\s*`writer`\s*\|/);
    expect(writer.length, `${copy} must declare writer`).toBeGreaterThan(3);
    expect(
      writer[3].includes("speckiwi-orchestrate/{pkgVersion}"),
      `${copy} writer must carry the stamped tool identity and its version`
    ).toBe(true);
    expect(
      /매 write|every write|모든 write/.test(writer[3]),
      `${copy} the stamp must be applied on every write, not opportunistically`
    ).toBe(true);
    expect(
      /1\.4\.0 이상/.test(writer[3]),
      `${copy} the writer requirement must be scoped to schema_version >= 1.4.0 lines`
    ).toBe(true);
    expect(
      writer[3].includes("unstamped"),
      `${copy} an older line must report unstamped rather than being rejected`
    ).toBe(true);
    expect(
      /실패하지 않는다|never fail/.test(writer[3]),
      `${copy} an unstamped older line must never fail; otherwise the stamp is a breaking change`
    ).toBe(true);
  });

  // AC-5: the object-valued fields carry their declared members. A field typed `object` with no
  // member list is a schema hole: the gate that reads it has nothing to key on.
  const OBJECT_MEMBERS: Record<string, readonly string[]> = {
    isolation: ["profile", "reason", "rejected"],
    allocation: ["target", "pre_snapshot_digest", "requirement_ids", "design_item_map"],
    partition_review: ["doc_path", "digest", "lane_plan_digest", "reviewer", "verdict"],
    coverage_residual: ["req_id", "reason", "owner"],
    lane_disposition: ["kind", "reason", "at"]
  };

  it.each(WAVES_COPIES)("%s declares the members of every object-valued field", (copy) => {
    const optional = section(read(copy), /^###\s.*선택 필드/);
    for (const [field, members] of Object.entries(OBJECT_MEMBERS)) {
      const row = cells(optional, new RegExp(`^\\s*\\|\\s*\`${field}\`\\s*\\|`));
      expect(row.length, `${copy} must declare ${field}`).toBeGreaterThan(3);
      for (const member of members) {
        expect(row[3].includes(member), `${copy} ${field} must carry the member ${member}`).toBe(true);
      }
    }
  });

  // AC-5: coverage_residual rides on the R-PLAN dispatch-route RESULT line, which is what keeps the
  // plan-coverage reason off the digest-pinned route lock.
  it.each(WAVES_COPIES)("%s places coverage_residual on the R-PLAN dispatch-route result line", (copy) => {
    const row = cells(section(read(copy), /^###\s.*선택 필드/), /^\s*\|\s*`coverage_residual`\s*\|/);
    expect(row.length, `${copy} must declare coverage_residual`).toBeGreaterThan(3);
    expect(row[3].includes("R-PLAN"), `${copy} coverage_residual is an R-PLAN artifact`).toBe(true);
    expect(
      row[3].includes("dispatch-route"),
      `${copy} coverage_residual must name the verb whose result line carries it`
    ).toBe(true);
  });

  // AC-5: lane_disposition's kind is a CLOSED four-value enum. Left open, a resumed session reads a
  // refuted lane as integrable and merges work the run had discarded.
  it.each(WAVES_COPIES)("%s closes the lane_disposition kind enum at four values", (copy) => {
    const row = cells(section(read(copy), /^###\s.*선택 필드/), /^\s*\|\s*`lane_disposition`\s*\|/);
    expect(row.length, `${copy} must declare lane_disposition`).toBeGreaterThan(3);
    for (const kind of ["demoted", "quarantined", "coupling-reset", "refuted"]) {
      expect(row[3].includes(kind), `${copy} the lane_disposition kind enum must define ${kind}`).toBe(true);
    }
    expect(
      /닫힌|closed/.test(row[3]),
      `${copy} the kind enum must be stated as closed; an open enum is not an enum`
    ).toBe(true);
  });

  // AC-6: the phase enum grows by eight, and the four v1.3.0 members survive.
  it.each(WAVES_COPIES)("%s extends the phase enum by the eight orchestrator phases", (copy) => {
    const row = cells(section(read(copy), /^###\s.*선택 필드/), /^\s*\|\s*`phase`\s*\|/);
    expect(row.length, `${copy} must keep a phase enum row`).toBeGreaterThan(3);
    for (const member of ["pipeline", "srs-authoring", "wave-verify", "final-verify"]) {
      expect(row[3].includes(member), `${copy} the phase enum must keep the v1.3.0 member ${member}`).toBe(true);
    }
    for (const member of [
      "intake",
      "design",
      "wave-design",
      "schedule",
      "handoff",
      "lane",
      "integrate",
      "stage-close"
    ]) {
      expect(row[3].includes(member), `${copy} the phase enum must gain ${member}`).toBe(true);
    }
  });

  // AC-6: reason_class gains the two values the orchestrator's own budget and oscillation stops write.
  it.each(WAVES_COPIES)("%s extends reason_class with oscillation and budget-exhausted", (copy) => {
    const verification = section(read(copy), /^###\s.*`verification` object/);
    const rule = line(verification, /`reason_class`/);
    expect(rule, `${copy} residual entries must carry a reason_class`).not.toBe("");
    for (const member of ["oscillation", "budget-exhausted"]) {
      expect(rule.includes(member), `${copy} the reason_class enum must define ${member}`).toBe(true);
    }
    // The v1.3.0 members must survive: dropping one silently retypes every already-recorded residual.
    for (const member of ["draft-stability-skip", "design-gap", "cross-wave-carry-forward"]) {
      expect(rule.includes(member), `${copy} the reason_class enum must keep ${member}`).toBe(true);
    }
  });

  // AC-6: every other v1.3.0 field is reused verbatim.
  it.each(WAVES_COPIES)("%s reuses the v1.3.0 field set verbatim", (copy) => {
    const optional = section(read(copy), /^###\s.*선택 필드/);
    for (const field of V130_FIELDS_KEPT) {
      expect(
        cells(optional, new RegExp(`^\\s*\\|\\s*\`${field}\`\\s*\\|`)).length > 3,
        `${copy} must keep the v1.3.0 field ${field}`
      ).toBe(true);
    }
    // The verification object's own v1.3.0 keys survive too; `frozen_denominator` is the one the
    // round-count invalidation rule compares against, so losing it disarms that rule silently.
    const verification = section(read(copy), /^###\s.*`verification` object/);
    for (const key of ["frozen_denominator", "constraint_layer", "preservation_layer", "regression"]) {
      expect(
        cells(verification, new RegExp(`^\\s*\\|\\s*\`${key}\`\\s*\\|`)).length > 3,
        `${copy} the verification object must keep the v1.3.0 key ${key}`
      ).toBe(true);
    }
  });

  // AC-7: one change, four copies, and the field set identical across them. A set comparison, not a
  // presence check: a presence check stays green while one copy carries an extra row the others lack.
  it("declares an identical optional-field set in all four copies", () => {
    const fieldSets = WAVES_COPIES.map((copy) => {
      const optional = section(read(copy), /^###\s.*선택 필드/);
      const names = optional
        .split("\n")
        .map((l) => l.match(/^\s*\|\s*`([a-z_]+)`\s*\|/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => m[1]);
      return [...new Set(names)].sort();
    });
    expect(fieldSets[0].length, "the optional-field table must not be empty").toBeGreaterThan(0);
    for (let i = 1; i < fieldSets.length; i++) {
      expect(fieldSets[i], `${WAVES_COPIES[i]} must declare the same field set as the claude copy`).toEqual(
        fieldSets[0]
      );
    }
    // And that shared set must actually contain the twenty additions, or the four copies agree on
    // an unextended contract.
    for (const field of V140_FIELDS) {
      expect(fieldSets[0].includes(field), `the shared field set must contain ${field}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// FR-FLOW-105 — the engine-filtered resume predicate
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-105 — engine-filtered wave resume predicate", () => {
  // AC-1: the predicate itself, in the resume section, in every copy.
  it.each(WAVES_COPIES)("%s states the engine filter in the resume predicate", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    expect(resume, `${copy} must have a resume section`).not.toBe("");
    const rule = line(resume, /`engine`/);
    expect(rule, `${copy} the resume predicate must name the engine filter`).not.toBe("");
    expect(HEDGE.test(rule), `${copy} the engine filter must be absolute, not hedged`).toBe(false);
  });

  // AC-2: absent reads as kiwi-wave-master, AND the ground is stated. The default is only additive
  // because it is a fact about the corpus; without the ground it reads as a guess.
  it.each(WAVES_COPIES)("%s reads an absent engine as kiwi-wave-master and states the ground", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    const rule = line(resume, /`engine` (?:필드가 )?(?:없는|부재)/);
    expect(rule, `${copy} must define how a line with no engine field reads`).not.toBe("");
    expect(
      /`kiwi-wave-master`/.test(rule),
      `${copy} an absent engine must read as kiwi-wave-master`
    ).toBe(true);
    expect(
      /v1\.4\.0 이전에 기록된 (?:모든|전)/.test(resume),
      `${copy} the ground must be stated: every pre-1.4.0 line was written by that engine`
    ).toBe(true);
  });

  // AC-3: the defect this closes is recorded, and it closes for both skills.
  it.each(WAVES_COPIES)("%s records the defect the engine filter closes", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    expect(
      /생산자 판별자|producer discriminator/.test(resume),
      `${copy} must record that the journal has no producer discriminator today`
    ).toBe(true);
    const defect = line(resume, /생산자 판별자|producer discriminator/);
    expect(
      /`kiwi-wave-master --resume`|--resume/.test(defect),
      `${copy} the defect must name the resume that mis-selects`
    ).toBe(true);
    expect(
      /현존 결함|live defect|가설이 아니/.test(resume),
      `${copy} the defect must be recorded as live, not hypothetical`
    ).toBe(true);
    const both = line(resume, /양쪽|both skills/);
    expect(both, `${copy} the closure must be stated to apply to both skills`).not.toBe("");
    expect(
      /`kiwi-wave-master`/.test(both) && /`kiwi-orchestrator`/.test(both),
      `${copy} both producers must be named where the closure is stated`
    ).toBe(true);
  });

  // AC-4: composition, not replacement. Replacing the run filter reopens R2-C1 — a second epic
  // inheriting the first epic's completion.
  it.each(WAVES_COPIES)("%s composes the engine filter with the run-scoped filter", (copy) => {
    const resume = section(read(copy), /^##\s*4\./);
    const rule = line(resume, /`run_id`[^\n]*`engine`|`engine`[^\n]*`run_id`/);
    expect(rule, `${copy} the two filters must be stated together`).not.toBe("");
    expect(
      /모두|둘 다|함께|both/.test(rule),
      `${copy} a resume must read only lines matching BOTH the run and the engine`
    ).toBe(true);
    expect(
      /대체하지 않는다|replace/.test(resume),
      `${copy} the engine filter must be stated as additional to the run filter, never as a replacement`
    ).toBe(true);
    // The run-scoping rule the sibling suite pins must survive verbatim.
    expect(
      /일치하는 이벤트만/.test(resume),
      `${copy} the run-scoped filter itself must remain`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// FR-FLOW-111 — pipeline-event.md registrations
// ---------------------------------------------------------------------------------------------

/** The §3 fenced skill enum of a pipeline-event copy. */
function skillEnumMembers(copy: string): string[] {
  const enumBlock = read(copy).split(/^## 3\. skill enum$/m)[1] ?? "";
  const fenced = enumBlock.split("```")[1] ?? "";
  return fenced
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The §4 T1 table row whose first cell names `skill`; [] when absent. */
function t1Row(copy: string, skill: string): string[] {
  const table = section(read(copy), /^##\s*4\.\s*next_hint/);
  return cells(table, new RegExp(`^\\s*\\|\\s*${skill}\\s*\\|`));
}

describe("FR-FLOW-111 — pipeline-event.md registers kiwi-orchestrator and closes the T1 holes", () => {
  // AC-1: an out-of-enum skill value is WARN-skipped, so without this entry every orchestrator event
  // is silently discarded and the run leaves no pipeline-layer record at all.
  it.each(PIPELINE_COPIES)("%s lists kiwi-orchestrator in the closed skill enum", (copy) => {
    expect(skillEnumMembers(copy), `${copy} skill enum must accept kiwi-orchestrator`).toContain(
      "kiwi-orchestrator"
    );
    // The rule that makes membership load-bearing must survive.
    expect(
      read(copy),
      `${copy} must keep the out-of-enum WARN+skip rule that makes the registration necessary`
    ).toMatch(/위 외 값은 invalid/);
  });

  it("declares an identical skill enum in all four copies", () => {
    const sets = PIPELINE_COPIES.map((copy) => [...new Set(skillEnumMembers(copy))].sort());
    expect(sets[0].length, "the skill enum must not be empty").toBeGreaterThan(0);
    for (let i = 1; i < sets.length; i++) {
      expect(sets[i], `${PIPELINE_COPIES[i]} skill enum must equal the claude copy's`).toEqual(sets[0]);
    }
  });

  // AC-2: the orchestrator's own terminal hint is null, and the reason is recorded rather than left
  // to inference — an auto-chained commit/push to the base branch is exactly what §5.12 forbids.
  it.each(PIPELINE_COPIES)("%s gives kiwi-orchestrator a null T1 hint with its reason", (copy) => {
    const row = t1Row(copy, "kiwi-orchestrator");
    expect(row.length, `${copy} T1 must carry a kiwi-orchestrator row`).toBeGreaterThan(3);
    expect(row[2], `${copy} the orchestrator row must key on the terminal status`).toContain("TASK_DONE");
    expect(
      /`null`/.test(row[3]),
      `${copy} the orchestrator's next hint must be null — the run terminates on its own branch`
    ).toBe(true);
    expect(
      /통합 브랜치|integration branch/.test(row[3]),
      `${copy} the reason must name the integration branch the run terminates on`
    ).toBe(true);
    expect(
      /의도적으로|deliberate/.test(row[3]),
      `${copy} not auto-chaining commit, push and PR creation must be recorded as deliberate`
    ).toBe(true);
  });

  // AC-3: kiwi-wave-master has sat in the enum with no routing hint since it shipped.
  it.each(PIPELINE_COPIES)("%s gives kiwi-wave-master the T1 row it lacks today", (copy) => {
    const row = t1Row(copy, "kiwi-wave-master");
    expect(row.length, `${copy} T1 must carry a kiwi-wave-master row`).toBeGreaterThan(3);
    expect(row[2], `${copy} the wave-master row must key on the terminal status`).toContain("TASK_DONE");
    expect(/`null`/.test(row[3]), `${copy} the wave-master's next hint must be null`).toBe(true);
  });

  // The mandatory `any x FAILED` and `any x NEEDS_USER` gates must survive both additions. This is
  // the protection FR-FLOW-043 AC-6 exists for, and neither new row may override it.
  it.each(PIPELINE_COPIES)("%s keeps the mandatory any-status gates unoverridden", (copy) => {
    const table = section(read(copy), /^##\s*4\.\s*next_hint/);
    for (const status of ["NEEDS_USER", "FAILED"]) {
      const row = cells(table, new RegExp(`^\\s*\\|\\s*any\\s*\\|\\s*${status}\\s*\\|`));
      expect(row.length, `${copy} the mandatory any x ${status} row must survive`).toBeGreaterThan(3);
      expect(/`null`/.test(row[3]), `${copy} any x ${status} must still route to null`).toBe(true);
    }
    // No skill-specific row may key on a non-terminal status and thereby shadow the any-row.
    for (const skill of ["kiwi-orchestrator", "kiwi-wave-master", "kiwi-tdd"]) {
      for (const status of ["NEEDS_USER", "FAILED"]) {
        expect(
          cells(table, new RegExp(`^\\s*\\|\\s*${skill}\\s*\\|\\s*${status}\\s*\\|`)).length > 3,
          `${copy} ${skill} must not carry a ${status} row that overrides the any-status gate`
        ).toBe(false);
      }
    }
  });

  // AC-4: the orchestrator emits through the MCP tool. This is the one place the no-duplication
  // instruction is discharged by REMOVING a hand-rolled append rather than avoiding one.
  it.each(PIPELINE_COPIES)("%s routes the orchestrator's emit through the MCP tool", (copy) => {
    // Scoped to the orchestrator's own emit subsection. The file already contains the word
    // "fallback" at §1 (the home journal fallback), so an unscoped search for it would pass with
    // the shell fallback clause absent.
    const own = section(read(copy), /^###\s*5\.6/);
    expect(own, `${copy} must document the orchestrator's emit path in its own subsection`).not.toBe("");
    const rule = line(own, /workflow_pipeline_emit/);
    expect(rule, `${copy} must name the MCP pipeline-emit tool`).not.toBe("");
    expect(
      /`kiwi-orchestrator`/.test(own),
      `${copy} the MCP emit path must be attributed to kiwi-orchestrator`
    ).toBe(true);
    // The hand-rolled block is what every OTHER skill uses; the orchestrator does not, and the
    // subsection has to say so or the removal reads as an oversight.
    expect(
      /§5\.1/.test(own),
      `${copy} the subsection must name the hand-rolled append block it replaces`
    ).toBe(true);
    // The shell fallback stays: emit is best-effort, so removing the fallback would make a missing
    // MCP server a failure of the run rather than of the emit.
    const fallback = line(own, /fallback/i);
    expect(fallback, `${copy} the documented shell fallback must be retained`).not.toBe("");
    expect(
      /best-effort/.test(own),
      `${copy} emit must remain best-effort, which is what makes the fallback sufficient`
    ).toBe(true);
  });

  // AC-5: the run-level emit key. The tool dedupes on `${skill}|${run_id}` and returns success with
  // `written: false` on a repeat, so a key that collides produces silent no-ops.
  it.each(PIPELINE_COPIES)("%s pins the orchestrator's run-level emit key", (copy) => {
    const own = section(read(copy), /^###\s*5\.6/);
    const rule = line(own, /run-level|run 수준|실행 수준/);
    expect(rule, `${copy} must define the run-level emit key`).not.toBe("");
    expect(
      /bare|맨|`\{run_id\}`/.test(rule),
      `${copy} the run-level event must use the bare run id as its emit key`
    ).toBe(true);
    expect(
      /\{run_id\}#r\{n\}/.test(rule),
      `${copy} a resumed run must use the round-suffixed form`
    ).toBe(true);
    expect(
      /충돌하지 않는다|collide/.test(own),
      `${copy} the document must state that no other emit key collides with the run-level key`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// FR-FLOW-112 — loop-option.md §6 propagation row
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-112 — loop-option.md records the orchestrator's propagation targets", () => {
  // AC-1: the row exists in every copy. An orchestrator absent from the propagation table silently
  // propagates nothing, so a user who asked for a reduced cap gets the default in every child.
  it.each(LOOP_COPIES)("%s carries a kiwi-orchestrator row in section 6", (copy) => {
    const six = section(read(copy), /^##\s*6\./);
    expect(six, `${copy} must have a propagation section`).not.toBe("");
    const row = cells(six, /^\s*\|\s*kiwi-orchestrator\s*\|/);
    expect(row.length, `${copy} section 6 must carry a kiwi-orchestrator row`).toBeGreaterThan(3);
  });

  // AC-2: the routed children are propagation targets too — on two of three rungs the whole run is
  // a delegation, so omitting them drops the flag on those rungs entirely.
  it.each(LOOP_COPIES)("%s names the routed child on each delegated rung", (copy) => {
    const row = cells(section(read(copy), /^##\s*6\./), /^\s*\|\s*kiwi-orchestrator\s*\|/);
    expect(row.length, `${copy} section 6 must carry a kiwi-orchestrator row`).toBeGreaterThan(3);
    const targets = row[2];
    expect(targets.includes("kiwi-tdd"), `${copy} the step rung's routed child must be named`).toBe(true);
    expect(targets.includes("kiwi-pm"), `${copy} the plan rung's routed child must be named`).toBe(true);
    expect(/step/i.test(targets), `${copy} the step rung must be identified`).toBe(true);
    expect(/plan/i.test(targets), `${copy} the plan rung must be identified`).toBe(true);
  });

  // AC-3: the per-wave set on the orchestrated rung, in full.
  it.each(LOOP_COPIES)("%s names the full per-wave propagation set", (copy) => {
    const row = cells(section(read(copy), /^##\s*6\./), /^\s*\|\s*kiwi-orchestrator\s*\|/);
    for (const child of ["kiwi-srs", "kiwi-planner", "kiwi-pm", "kiwi-review-fix-loop"]) {
      expect(row[2].includes(child), `${copy} the per-wave set must include ${child}`).toBe(true);
    }
  });

  // AC-4: the propagated options and the orchestrator's OWN cap list. Five, not six: listing a cap
  // for the deferred per-lane loop would pin a contract with nothing behind it.
  it.each(LOOP_COPIES)("%s names the propagated options and the five own loop caps", (copy) => {
    const row = cells(section(read(copy), /^##\s*6\./), /^\s*\|\s*kiwi-orchestrator\s*\|/);
    expect(row[3].includes("--mini"), `${copy} --mini must be named as propagated`).toBe(true);
    expect(row[3].includes("--loops N"), `${copy} --loops N must be named as propagated`).toBe(true);
    expect(
      /D\s*\/\s*W\s*\/\s*H\s*\/\s*P\s*\/\s*F|D, W, H, P (?:and|,) F/.test(row[3]),
      `${copy} the orchestrator's own cap list must name the D, W, H, P and F loops`
    ).toBe(true);
    expect(
      /5\s*개|five/.test(row[3]),
      `${copy} the cap list must state its count; the number is what makes a sixth entry detectable`
    ).toBe(true);
    expect(
      /per-lane|레인/.test(row[3]),
      `${copy} the absent per-lane loop must be named as absent, not silently omitted`
    ).toBe(true);
    expect(
      /이연|deferred/.test(row[3]),
      `${copy} the reason the per-lane loop is absent must be recorded`
    ).toBe(true);
  });
});
