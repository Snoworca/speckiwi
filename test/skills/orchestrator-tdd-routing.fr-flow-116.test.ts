import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-116  kiwi-tdd declares critical_gates[] and joins the closed pipeline skill enum
// @req FR-FLOW-117  kiwi-pipeline §2.8 accepts a frozen route lock as its step-scoped conjunct
//
// `kiwi-tdd` ships in three variants plus the `.agents` mirror; the claude rendering is Korean and
// the codex / etc / mirror renderings are English, so every assertion below keys on the identifiers
// and structures the three share rather than on prose that legitimately differs.
//
// Runtime lag: these read the BUNDLED copies. The installed copies under `~/.claude/skills/…` stay
// at the old text because `00.charter.md:303-304` forbids reinstalling from this repository; that
// lag is recorded as verification evidence, not accommodated here.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function copies(skill: string): string[] {
  return [
    `skills/claude/${skill}/SKILL.md`,
    `skills/codex/${skill}/SKILL.md`,
    `skills/etc/${skill}/SKILL.md`,
    `.agents/skills/${skill}/SKILL.md`
  ];
}

const TDD_COPIES = copies("kiwi-tdd");
const PIPELINE_SKILL_COPIES = copies("kiwi-pipeline");
const PIPELINE_EVENT_COPIES = [
  "skills/claude/_shared/kiwi/pipeline-event.md",
  "skills/codex/_shared/kiwi/pipeline-event.md",
  "skills/etc/_shared/kiwi/pipeline-event.md",
  ".agents/skills/_shared/kiwi/pipeline-event.md"
];

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

/** The `critical_gates[]` declaration section, whatever heading level it carries. Same locator the
 * sibling wave suites use, so a section that this finds is a section they would find too. */
function gatesSection(text: string): string {
  return section(text, /^#{2,4}\s.*critical_gates/i);
}

/** Backticked gate ids in the first column of a gate table. */
function gateIds(gates: string): string[] {
  return gates
    .split("\n")
    .map((l) => l.match(/^\s*\|\s*`([a-z0-9-]+)`\s*\|/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);
}

/** The three gates `--auto` must never resolve on `kiwi-tdd`. Each is a user-interaction point that
 * survives a correctly dispatched step run (`09` §4.4): the mode halt and the missing-task query are
 * discharged by the dispatch preconditions and are deliberately not here.
 *
 * PROVENANCE — these three ids are a CHOICE, not a transcription. `09` §4.4 fixes the four surviving
 * interaction points and FR-FLOW-116 AC-1 fixes the table's three-column shape, but no design section
 * or acceptance criterion names the ids themselves; they were coined here to read as gates rather
 * than placeholders, and reviewed as such. Two consequences for a later reader:
 *   * renaming one is a contract change for any parent inheriting a child gate by id
 *     (`kiwi-pm` §0.G7's child-declaration inheritance rule), not a cosmetic edit;
 *   * `kiwi-tdd` is deliberately NOT a key in `CANONICAL_GATE_IDS`
 *     (test/skills/kiwi-wave-continuity-r2-content.test.ts), so the cross-variant set equality is
 *     asserted below rather than there. Adding the key is a legitimate follow-up and is out of scope
 *     for this target. */
const TDD_CRITICAL_GATES = [
  "step-claim-write-skew",
  "promote-evidence-required",
  "step-completion-gate-blocked"
] as const;

/** The fourth surviving interaction point. It is NOT critical — a substantive architecture decision
 * is exactly the class `--auto`'s committee is for — but it still needs a stated severity, or it
 * falls to the undeclared-gate default. */
const TDD_NON_CRITICAL_GATE = "sds-architecture-decision-approval";

describe("FR-FLOW-116 — kiwi-tdd critical gates and pipeline registration", () => {
  it("covers exactly the four shipped kiwi-tdd copies", () => {
    expect(TDD_COPIES).toHaveLength(4);
    for (const copy of TDD_COPIES) {
      expect(() => read(copy), `${copy} must exist`).not.toThrow();
    }
  });

  // AC-1: the table, in the three-column shape `auto-option.md:252` demands. The string does not
  // occur in the skill today, which is what makes `--auto` inactive for it by the safe default.
  it.each(TDD_COPIES)("%s declares a three-column critical_gates table", (copy) => {
    const gates = gatesSection(read(copy));
    expect(gates, `${copy} must declare a critical_gates section`).not.toBe("");
    const header = line(gates, /gate_id/);
    expect(header, `${copy} the gate table must have a header row`).not.toBe("");
    // Exactly three content columns: gate_id, reason, location. A two-column table drops the
    // location and an agent cannot find where the halt fires.
    const columns = header.split("|").map((c) => c.trim()).filter(Boolean);
    expect(columns.length, `${copy} the gate table must have exactly three columns`).toBe(3);
    expect(columns[0], `${copy} column 1 must be gate_id`).toContain("gate_id");
    expect(/reason/i.test(columns[1]), `${copy} column 2 must be the reason`).toBe(true);
    expect(
      /location|위치/i.test(columns[2]),
      `${copy} column 3 must be the location the gate fires at`
    ).toBe(true);
  });

  // AC-2: each of the three critical gates is its own row with a reason and a location.
  it.each(TDD_COPIES)("%s declares each critical gate as its own row", (copy) => {
    const gates = gatesSection(read(copy));
    for (const id of TDD_CRITICAL_GATES) {
      const row = cells(gates, new RegExp(`^\\s*\\|\\s*\`${id}\`\\s*\\|`));
      expect(row.length, `${copy} critical_gates must declare ${id} as a table row`).toBeGreaterThan(3);
      expect(row[2].length, `${copy} ${id} must state a reason`).toBeGreaterThan(0);
      expect(row[3].length, `${copy} ${id} must state where it fires`).toBeGreaterThan(0);
    }
  });

  // AC-2: the gate-id SET is identical across variants, per FR-FLOW-061. A presence check stays
  // green while one variant carries an extra halt the others do not.
  it("declares the same gate-id set in every kiwi-tdd copy", () => {
    const sets = TDD_COPIES.map((copy) => [...new Set(gateIds(gatesSection(read(copy))))].sort());
    expect(sets[0], "the claude gate set must equal the canonical three").toEqual(
      [...TDD_CRITICAL_GATES].sort()
    );
    for (let i = 1; i < sets.length; i++) {
      expect(sets[i], `${TDD_COPIES[i]} gate ids must equal the claude set`).toEqual(sets[0]);
    }
  });

  it.each(TDD_COPIES)("%s declares each gate exactly once", (copy) => {
    const ids = gateIds(gatesSection(read(copy)));
    expect(ids.length, `${copy} a duplicated gate row makes the interface ambiguous`).toBe(
      new Set(ids).size
    );
  });

  // AC-2: the fourth surviving interaction point must carry a stated severity too, or it falls to
  // the undeclared-gate default and an unattended run resolves it as a committee business-decision
  // without anyone having decided that it should.
  it.each(TDD_COPIES)("%s gives the architecture-decision gate a stated severity", (copy) => {
    const text = read(copy);
    const rule = line(text, new RegExp(`\`${TDD_NON_CRITICAL_GATE}\``));
    expect(rule, `${copy} must name the architecture-decision interaction point`).not.toBe("");
    expect(
      /business-decision/.test(rule),
      `${copy} the architecture-decision gate must carry an explicit severity`
    ).toBe(true);
    // And it must NOT be in the critical table — a critical architecture-decision gate would make
    // every SDS with a substantive decision an unattended dead stop.
    expect(
      gateIds(gatesSection(text)).includes(TDD_NON_CRITICAL_GATE),
      `${copy} the architecture-decision gate is business-decision, not critical`
    ).toBe(false);
  });

  // AC-2: each declared gate must point at the phase it fires in, so the four survivors of `09` §4.4
  // are traceable to the skill's own phases rather than named in the abstract.
  it.each(TDD_COPIES)("%s anchors each gate to the phase it fires in", (copy) => {
    const gates = gatesSection(read(copy));
    const anchors: Record<string, RegExp> = {
      "step-claim-write-skew": /Phase 1|§2\.2/,
      "promote-evidence-required": /Phase 6|§2\.7/,
      "step-completion-gate-blocked": /Phase 7|§2\.8/
    };
    for (const [id, anchor] of Object.entries(anchors)) {
      const row = cells(gates, new RegExp(`^\\s*\\|\\s*\`${id}\`\\s*\\|`));
      expect(
        anchor.test(row[3] ?? ""),
        `${copy} ${id} must name the phase it fires in, not only a prose description`
      ).toBe(true);
    }
  });

  // AC-3: with the table declared, `--auto` is no longer inactive by the safe default, and the body
  // says which gates it can and cannot resolve. "Inactive" means silent ignore, so leaving this
  // unstated leaves a reader unable to tell an unattended stall from a normal halt.
  it.each(TDD_COPIES)("%s states what --auto can and cannot resolve", (copy) => {
    const text = read(copy);
    const gates = gatesSection(text);
    expect(
      /--auto/.test(gates),
      `${copy} the gate section must state its relationship to --auto`
    ).toBe(true);
    const cannot = line(gates, /해결할 수 없|cannot resolve|resolve 하지 못|무관 항상|regardless of `--auto`/i);
    expect(cannot, `${copy} must state which gates --auto cannot resolve`).not.toBe("");
    const can = line(gates, /해결할 수 있|can resolve|자동 결정|committee|위원회/i);
    expect(can, `${copy} must state which gate --auto can resolve`).not.toBe("");
    // The safe default that used to apply must be named, or the change reads as unmotivated.
    expect(
      /안전 (?:기본값|디폴트)|safe default/i.test(gates),
      `${copy} the superseded safe default must be named so the change is legible`
    ).toBe(true);
  });

  // AC-4: the enum entry. Without it every kiwi-tdd event is WARN-skipped and a delegated step run
  // leaves exactly one journal line — the orchestrator's own.
  it.each(PIPELINE_EVENT_COPIES)("%s lists kiwi-tdd in the closed skill enum", (copy) => {
    const enumBlock = read(copy).split(/^## 3\. skill enum$/m)[1] ?? "";
    const members = (enumBlock.split("```")[1] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(members, `${copy} skill enum must accept kiwi-tdd`).toContain("kiwi-tdd");
  });

  // AC-5: the T1 row.
  //
  // PROVENANCE — the hint VALUE is a choice, not a transcription. FR-FLOW-116 AC-5 requires only that
  // the row exist; neither it nor `05` §14 registration 3-prime names a next step. `kiwi-review-fix-loop`
  // was chosen because it mirrors the two existing rows for skills that write production code
  // (`kiwi-pm` and standalone `kiwi-coder` both route there), and `kiwi-tdd` writes production code
  // at Phase 4. The assertion below therefore pins the row's SHAPE, and the value is pinned
  // separately so that changing it is a deliberate edit rather than an accident.
  it.each(PIPELINE_EVENT_COPIES)("%s gives kiwi-tdd a T1 routing-hint row", (copy) => {
    const table = section(read(copy), /^##\s*4\.\s*next_hint/);
    const row = cells(table, /^\s*\|\s*kiwi-tdd\s*\|/);
    expect(row.length, `${copy} T1 must carry a kiwi-tdd row`).toBeGreaterThan(3);
    expect(row[2], `${copy} the kiwi-tdd row must key on the terminal status`).toContain("TASK_DONE");
    expect(row[3].length, `${copy} the kiwi-tdd row must state a next hint`).toBeGreaterThan(0);
    expect(
      row[3],
      `${copy} the chosen hint must stay consistent across renderings; see the provenance note above`
    ).toContain("kiwi-review-fix-loop");
  });

  // AC-6: this requirement is additive and stands alone. The routing requirements must not have
  // been rewritten to depend on it — a parent recording on a child's behalf is what
  // `kiwi-pipeline:336` forbids, and the design states the hole rather than working around it.
  it.each(TDD_COPIES)("%s does not have a parent record its events on its behalf", (copy) => {
    const text = read(copy);
    expect(
      /부모가[^\n]*대신[^\n]*(?:기록|emit)|parent[^\n]*on (?:its|the child's) behalf/i.test(text),
      `${copy} a parent must not be instructed to record the child's pipeline event`
    ).toBe(false);
  });
});

describe("FR-FLOW-117 — kiwi-pipeline section 2.8 accepts a frozen route lock", () => {
  // AC-1: the sentence, in every rendering, naming the artifact and refusing to re-judge.
  it.each(PIPELINE_SKILL_COPIES)("%s names route.lock.json as the step-scoped conjunct", (copy) => {
    const two_eight = section(read(copy), /^##\s*2\.8/);
    expect(two_eight, `${copy} must have a section 2.8`).not.toBe("");
    const rule = line(two_eight, /route\.lock\.json/);
    expect(rule, `${copy} section 2.8 must name route.lock.json`).not.toBe("");
    expect(
      /`kiwi-orchestrator`/.test(rule),
      `${copy} the clause must be scoped to a kiwi-orchestrator run that froze a route`
    ).toBe(true);
    expect(
      /충족|satisf/i.test(rule),
      `${copy} the lock must SATISFY the step-scoped conjunct, not merely inform it`
    ).toBe(true);
    expect(
      /재판정하지 않는다|다시 (?:내리지|판정하지) 않는다|not re-judged/i.test(two_eight),
      `${copy} the conjunct must be stated as not re-judged; re-judging is what creates two routers`
    ).toBe(true);
  });

  // AC-2: nothing else about §2.8 moves. The work-mode conjunct and the non-step fallback chain are
  // the two things an amendment here could break, so both are pinned.
  it.each(PIPELINE_SKILL_COPIES)("%s leaves the work-mode conjunct and the fallback chain intact", (copy) => {
    const two_eight = section(read(copy), /^##\s*2\.8/);
    expect(
      /work-mode 가 \*\*`tdd`\*\* 이고 요청 작업이 \*\*step-scoped\*\*/.test(two_eight),
      `${copy} the conjunction the section routes on must be unchanged`
    ).toBe(true);
    expect(
      /body-scope[^\n]*sdd 체인을 그대로 \*\*유지\*\*/.test(two_eight),
      `${copy} the fallback for work that is not step-scoped must be unchanged`
    ).toBe(true);
    expect(
      /fail-open/.test(section(read(copy), /^###\s*2\.8\.1/)),
      `${copy} the work-mode read must stay MCP-first and fail-open`
    ).toBe(true);
  });

  // AC-3: why the amendment exists although §2.8 never runs inside an orchestrator run today. Left
  // unrecorded, a later change to the --cycle exclusion silently creates two live routers.
  it.each(PIPELINE_SKILL_COPIES)("%s records why the amendment exists today", (copy) => {
    const two_eight = section(read(copy), /^##\s*2\.8/);
    const rule = line(two_eight, /두 (?:개의 )?라우터|two (?:live )?routers/i);
    expect(rule, `${copy} must record the failure the amendment forestalls`).not.toBe("");
    // @req FR-FLOW-126 — this was `/`--cycle`|--from=/`, a disjunction over the whole section that
    // stayed green on `--from=` alone and would therefore have survived a regression to the
    // pre-flip `--cycle` key. The dormancy now rests on delegated entry, and that is what is named.
    expect(
      /위임 진입/.test(two_eight),
      `${copy} the exclusion that makes §2.8 dormant inside an orchestrator run must be named`
    ).toBe(true);
    expect(
      /`--cycle` \/ `--from=` 진입은 본 라우팅의 적용 대상이 아니다/.test(two_eight),
      `${copy} a regression to the flag key must fail here, not merely elsewhere`
    ).toBe(false);
    expect(
      /개별|individually|각각 호출/.test(two_eight),
      `${copy} the orchestrator calling the stages individually must be named as the other half`
    ).toBe(true);
  });

  // AC-4: where the missing conjunct is actually defined, and the direction of that definition.
  it.each(PIPELINE_SKILL_COPIES)("%s attributes the step-scoped conjunct to the disqualifier set", (copy) => {
    const two_eight = section(read(copy), /^##\s*2\.8/);
    const rule = line(two_eight, /disqualifier|실격/i);
    expect(rule, `${copy} must name the classifier's disqualifier set as the missing definition`).not.toBe(
      ""
    );
    const direction = line(two_eight, /좁히기만|좁힐 뿐|넓히지 않는다|narrows|widen/i);
    expect(direction, `${copy} must state the direction of the definition`).not.toBe("");
    expect(
      /넓히지 않는다|never widen/i.test(direction),
      `${copy} the definition must only ever narrow the step rung, never widen it`
    ).toBe(true);
  });
});
