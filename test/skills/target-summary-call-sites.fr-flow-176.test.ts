import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, enclosingSection, flat, markdownFiles, readRepoFile, skillDirs } from "./kiwi-renderings.js";

// @req FR-FLOW-176 — a shipped skill never instructs a target summary without naming the target.
//
// The rule is structural on purpose. "Do not call both `get_active_target` and `summarize_target`"
// cannot be decided from a line, because the two names sit in different sections of the same phase
// in `kiwi-srs` and `kiwi-planner`, and because naming a target that is NOT the active one is the
// correct thing to do there. What CAN be decided from a line is whether the summary call names its
// target: the argument-less form is the one that answers with the active-target summary
// `get_active_target` already returned, and it is the only form that duplicates anything.
//
// WHAT THIS FILE DOES NOT HOLD, stated so it is not read into the green:
//  - that a skill actually makes fewer calls. The artifact is instruction; nothing here runs an
//    agent. What is held is that the instruction no longer asks for the redundant one.
//  - that an exempt line is harmless. An exemption records a reading, and a wrong reading stays
//    wrong; it only stops the line from being silently ignored.
//  - `get_active_target`. No rule below constrains it, because calling it is never the redundant
//    half — it is the call the duplicate was redundant WITH.
//  - AC-3's "records that the summary carries no trace link" is checked as the presence of an
//    authored phrase. Presence is not truth: the measurement that makes it true is in the
//    requirement's evidence (`src/core/query/summary.ts` returns counts and identifier lists only).
//  - AC-4's report-object rule reaches one rendering, not four. Measured: `extraction_basis` is
//    written in `skills/claude` alone and was in `skills/claude` alone at HEAD, so the other three
//    renderings satisfy it by carrying no such object rather than by carrying a correct one. The
//    recorded count below fixes that, so a rendering that gains one arrives as a case to check.
//  - a forbidden call written without naming the tool. The unit here is an occurrence of the name,
//    so a sentence that says "call it again without a target" using a pronoun is not reached by any
//    rule in this file.

const SKILL = "kiwi-review-fix-loop";
const TOOL = "summarize_target";
const SRS_PATH = path.join("docs", "spec", "60.workflow-release.srs.md");
const REQUIREMENT_ID = "FR-FLOW-176";

/** `summarize_target` followed by an object literal that names a target. */
const NAMES_A_TARGET = /summarize_target`?\s*\{\s*target:/;

/**
 * What marks a line that names the reader in order to REFUSE it.
 *
 * A third admitted class beside "names a target" and "exempt", and a structural one: the sentence
 * telling an agent not to make the call necessarily names the call. Without this class the fix for
 * this requirement would itself violate it, and the exemption table would fill with the very
 * sentences the requirement asked for — keyed on a wrapped fragment, so a rewrap would unclassify a
 * line whose meaning never moved.
 */
const REFUSES_THE_CALL = /(부르지 않는다|Do not call)/;

/**
 * Lines that name the tool without naming a target and are nonetheless allowed, with the reading
 * that allows them.
 *
 * Keyed by skill and by the line's exact text: edit an exempt line and it stops matching, so the
 * edit arrives as an unclassified candidate rather than inheriting the old exemption. A path is not
 * part of the key because the same sentence ships in up to four renderings and one row should cover
 * all of them; the count assertion below holds the multiplicity instead.
 */
const EXEMPT: ReadonlyArray<{ skill: string; text: string; reason: string }> = [
  {
    skill: "kiwi-hot-fix",
    text: "입력: 영향 가능 파일 목록 + 코드베이스 import graph + 활성 target REQ 인벤토리 (`list_requirements` 또는 `summarize_target`)",
    reason: "서브에이전트 입력의 출처를 열거하는 줄이고, 호출을 지시하지 않는다"
  },
  {
    skill: "kiwi-orchestrator",
    text: "스냅샷 파일은 이 wave target 의 `list_requirements` 응답과 `summarize_target` 응답을 한 JSON 문서로 합친 것이며, 레코드는 요약 투영이 아니라 전체 투영으로 받는다 — 기본 투영은 요구마다의 수용 기준과 검증 증거를 빼고 답하므로 그 응답으로 만든 문서는 게이트에 닿지 못한 채 스냅샷 해석 오류로 끝난다.",
    reason: "요약할 대상을 같은 문장이 wave target 으로 지명하고, 이 줄은 산출물의 구성을 설명한다"
  },
  {
    skill: "kiwi-srs",
    text: "신규 REQ 기본 status: **`planned`** (Status enum 에 미승인을 뜻하는 값은 없다). 사용자 미승인은 Status 가 아니라 `Stability=draft` 가 나타낸다 — `add_requirement` 의 기본 stability 가 `draft` 이고, 그 값이 남아 있는 동안 그 요구는 `summarize_target` 의 `newWorkCandidates` 에 오르지 않는다.",
    reason: "응답의 한 필드가 무엇을 담는지 설명하는 산문이고, 호출을 지시하지 않는다"
  },
  {
    skill: "kiwi-srs-feasibility",
    text: "- 11.4 validate_spec + summarize_target + sync 점검",
    reason: "목차 항목이다"
  },
  {
    skill: "kiwi-srs-feasibility",
    text: "### 11.4 validate_spec + summarize_target + sync 점검",
    reason: "절 제목이며, 그 절 본문이 `{ target: TARGET }` 로 대상을 지명한다"
  },
  {
    skill: "kiwi-srs-from-code",
    text: "- 11.3 summarize_target",
    reason: "목차 항목이다"
  },
  {
    skill: "kiwi-srs-from-code",
    text: "### 11.3 summarize_target",
    reason: "절 제목이며, 그 절 본문이 `{ target: TARGET }` 로 대상을 지명한다"
  },
  {
    skill: "kiwi-srs-from-code",
    text: "- `summarize_target` 은 미등록 target 에 대해 silently `total: 0` 의 ok 응답을 반환하므로(summary.ts:42 `records.filter`) 등록/미등록을 구분 못함.",
    reason: "도구가 미등록 target 에 어떻게 답하는지 설명하는 산문이고, 호출을 지시하지 않는다"
  }
];

// --- the bounds, read out of the requirement rather than written here ---------------------------

/**
 * Floors this file runs under, taken from the requirement's own AC-6.
 *
 * A floor written as a literal here is a floor a change to this file can lower, and lowering it
 * leaves no trace outside this file. `FR-MCP-060` AC-7 already paid for that lesson in this
 * repository and moved every one of its bounds into the requirement; this follows it.
 */
let floors: Map<string, number> | undefined;
let floorsFailure: unknown;

function floor(name: string): number {
  if (floorsFailure !== undefined) throw floorsFailure;
  const found = floors?.get(name);
  if (typeof found !== "number") {
    throw new Error(`${REQUIREMENT_ID} AC-6 names no floor \`${name}\`, and this assertion has nothing to run under`);
  }
  return found;
}

beforeAll(async () => {
  try {
    const workspace = await parseWorkspace({ root: REPO_ROOT });
    const record = workspace.records.find((item) => item.id === REQUIREMENT_ID);
    if (!record) throw new Error(`${SRS_PATH}: ${REQUIREMENT_ID} is not there, so this suite has no bounds to run under`);
    const ac6 = record.acceptanceCriteria.find((item) => item.id === "AC-6");
    if (!ac6) throw new Error(`${REQUIREMENT_ID} declares no AC-6, and this suite reads its bounds out of it`);
    floors = new Map([...ac6.text.matchAll(/`([A-Za-z]+) (\d+)`/g)].map((match) => [match[1] as string, Number(match[2])]));
  } catch (error) {
    floorsFailure = error;
  }
});

// --- the classification, total over every occurrence ---------------------------------------------

type Bucket = "phase-map" | "reference-row" | "names-target" | "refuses" | "exempt" | "unclassified";

interface Occurrence {
  readonly relPath: string;
  readonly skill: string;
  readonly line: number;
  readonly text: string;
  readonly bucket: Bucket;
}

const EXEMPT_KEYS = new Set(EXEMPT.map((row) => `${row.skill} ${row.text}`));

/**
 * Every line naming the tool anywhere in the shipped corpus, each in exactly one bucket.
 *
 * The two mechanical buckets are named for what they were MEASURED to hold, not for what a fenced
 * block or a table row might hold in general. All 12 fenced lines are ASCII phase maps — the
 * `Phase 0 : Bootstrap (…)` diagrams in `kiwi-srs` and `kiwi-srs-from-code` — and not one of them
 * is a sample payload; all 24 table rows are MCP/CLI reference grids and gate tables. Neither is an
 * instruction to make a call, and both are recognised structurally, by a fence delimiter and a
 * leading pipe, so neither depends on reading what a line means.
 *
 * Nothing falls outside: an occurrence in none of the five admitted buckets is `unclassified` and
 * the assertions below fail on it, and the bucket sizes are required to add back up to the whole.
 */
/**
 * The verdict for ONE OCCURRENCE of the tool name, as a function so the controls below can run it on
 * inputs the corpus does not contain — including ones that must come back unclassified.
 *
 * The unit is the occurrence, not the line, and `ordinal` is why. Every one of the shipped lines
 * names the tool exactly once (measured: the occurrences-per-line histogram is {1: 98}), and the
 * line-level verdicts below — an exemption keyed on the whole line, a table row, a phase map — are
 * about the line rather than about a position in it. So a SECOND occurrence on such a line is not
 * covered by the reading that admitted the first, and admitting it would let a forbidden call be
 * appended to an admitted line and inherit its verdict. That is exactly what happens with a line
 * whose first occurrence refuses the call: the refusal would launder a new call sitting beside it.
 * A classifier whose last branch is folded into an admitted bucket, or which admits any fenced line,
 * looks identical over a clean corpus and different here.
 */
function classify(skill: string, text: string, inFence: boolean, ordinal: number): Bucket {
  // The exemption is read FIRST, ahead of the ordinal guard, so a line that legitimately names the
  // tool twice has a way in. Without that order the ordinal rule is a wall with no door: a
  // comparison row showing both forms, a refusal that also shows the allowed form, a phase map
  // covering two phases — all correct, all unreachable. An exemption is keyed on the WHOLE line, so
  // appending a call to an exempt line changes the text and the exemption stops matching; the door
  // opens only for a line someone wrote down and gave a reason for.
  if (EXEMPT_KEYS.has(`${skill} ${text}`)) return "exempt";
  if (ordinal > 0) return "unclassified";
  if (inFence) return /^Phase\s/.test(text) ? "phase-map" : "unclassified";
  if (text.startsWith("|")) return "reference-row";
  if (NAMES_A_TARGET.test(text)) return "names-target";
  if (REFUSES_THE_CALL.test(text)) return "refuses";
  return "unclassified";
}

function occurrences(): Occurrence[] {
  const found: Occurrence[] = [];
  for (const rendering of RENDERINGS) {
    for (const skill of skillDirs(rendering)) {
      for (const relPath of markdownFiles(rendering, skill)) {
        let inFence = false;
        readRepoFile(relPath).split(/\r?\n/).forEach((raw, index) => {
          const text = raw.trim();
          if (/^(?:`{3,}|~{3,})/.test(text)) {
            inFence = !inFence;
            return;
          }
          const total = raw.split(TOOL).length - 1;
          for (let ordinal = 0; ordinal < total; ordinal += 1) {
            found.push({ relPath, skill, line: index + 1, text, bucket: classify(skill, text, inFence, ordinal) });
          }
        });
      }
    }
  }
  return found;
}

const ALL = occurrences();
const inBucket = (bucket: Bucket): Occurrence[] => ALL.filter((item) => item.bucket === bucket);

// --- AC-6 (read first: everything below divides by a bound it supplies) --------------------------

describe("FR-FLOW-176 AC-6 — the suite runs under bounds the requirement sets, not its own", () => {
  it("reads every floor from the requirement and refuses an empty set of them", () => {
    expect(floorsFailure, "the requirement could not be read, so nothing bounds this file").toBeUndefined();
    expect(floors?.size ?? 0, "floors read out of AC-6").toBeGreaterThanOrEqual(1);
  });

  it("hands back the value the requirement wrote, and refuses a floor of zero", () => {
    // Two ways a bound stops bounding. `floor()` can stop reading the map — measured: a version of
    // it that answered 0 to everything left the whole file green — and the requirement can carry a
    // zero, which is a lower bound every set meets.
    for (const [name, written] of floors ?? []) {
      expect(floor(name), `floor ${name} must be the number the requirement wrote`).toBe(written);
      expect(written, `floor ${name} is zero, which bounds nothing`).toBeGreaterThan(0);
    }
  });

  it("reads every floor the requirement names, so one that bounds nothing fails", () => {
    const source = readRepoFile(path.join("test", "skills", "target-summary-call-sites.fr-flow-176.test.ts"));
    const consumed = new Set([...source.matchAll(/\bfloor\("([A-Za-z]+)"\)/g)].map((match) => match[1] as string));
    expect(consumed.size, "no floor call was found, so the extraction has stopped matching").toBeGreaterThan(0);
    const unread = [...(floors?.keys() ?? [])].filter((name) => !consumed.has(name));
    expect(unread, "a floor the requirement names bounds nothing here, so deleting its assertion leaves no trace").toEqual([]);
  });

  it("walks the whole corpus rather than a corner of it", () => {
    expect(RENDERINGS.length, "renderings walked").toBe(floor("renderings"));
    expect(ALL.length, "occurrences of the tool name").toBe(floor("occurrences"));
    for (const rendering of RENDERINGS) {
      const here = ALL.filter((item) => item.relPath.startsWith(`${rendering}/`));
      expect(here.length, `${rendering} contributed no occurrence`).toBeGreaterThan(0);
    }
  });
});

// --- AC-1 --------------------------------------------------------------------------------------

describe("FR-FLOW-176 AC-1 — every occurrence lands in one admitted bucket, and the buckets are the whole", () => {
  it("leaves nothing unclassified", () => {
    const unclassified = inBucket("unclassified").map((item) => `${item.relPath}:${item.line} ${item.text}`);
    expect(unclassified, "each line must name a target, refuse the call, or carry an exemption").toEqual([]);
  });

  it("keeps every bucket above the size the requirement records, and adds them back up to the whole", () => {
    expect(inBucket("phase-map").length, "phase-map lines").toBe(floor("phaseMaps"));
    expect(inBucket("reference-row").length, "reference rows").toBe(floor("referenceRows"));
    expect(inBucket("names-target").length, "calls naming their target").toBe(floor("namesTarget"));
    expect(inBucket("refuses").length, "lines refusing the call").toBe(floor("refusals"));
    expect(inBucket("exempt").length, "exempt lines").toBe(floor("exempt"));
    const summed =
      inBucket("phase-map").length +
      inBucket("reference-row").length +
      inBucket("names-target").length +
      inBucket("refuses").length +
      inBucket("exempt").length +
      inBucket("unclassified").length;
    expect(summed, "the buckets must partition the occurrences, with nothing counted twice or dropped").toBe(ALL.length);
  });

  it("holds the two mechanical buckets to what they were measured to hold", () => {
    // The phase-map bucket exists because an ASCII phase diagram names tools without instructing a
    // call, and every one of the fenced lines is such a diagram. A fenced line that is NOT one is
    // unclassified rather than admitted, so a payload appearing inside a fence arrives as a failure.
    for (const item of inBucket("phase-map")) {
      expect(item.text, `${item.relPath}:${item.line} is fenced but is not a phase map`).toMatch(/^Phase\s/);
    }
    for (const item of inBucket("reference-row")) {
      expect(item.text.startsWith("|"), `${item.relPath}:${item.line} is in the row bucket without being a row`).toBe(true);
    }
  });

  it("returns each verdict on an input built here, including ones that must stay unclassified", () => {
    expect(classify("kiwi-srs", "Phase 0   : Bootstrap (preflight, summarize_target 로드)", true, 0)).toBe("phase-map");
    expect(classify("kiwi-srs", '{ "tool": "summarize_target" }', true, 0)).toBe("unclassified");
    expect(classify("kiwi-srs", "| 요약 | `summarize_target` | speckiwi summary |", false, 0)).toBe("reference-row");
    expect(classify("kiwi-srs", "- `summarize_target { target: TARGET }` — 총수", false, 0)).toBe("names-target");
    expect(classify("kiwi-srs", "`summarize_target` 을 여기서 **부르지 않는다**", false, 0)).toBe("refuses");
    expect(classify("kiwi-srs-from-code", "- 11.3 summarize_target", false, 0)).toBe("exempt");
    expect(classify("kiwi-srs", "MCP `summarize_target` 를 한 번 더 부른다.", false, 0)).toBe("unclassified");
    expect(classify("kiwi-srs-from-code", "- 11.3 summarize_target ", false, 0)).toBe("unclassified");
  });

  it("refuses to let an admitted line launder a second call sitting on it", () => {
    // The three shapes measured to slip past a line-level verdict, each now unclassified at ordinal
    // 1: appended to the refusal sentence, appended to a call that names its target, and inserted
    // into a fenced phase map. Ordinal 0 keeps the verdict the line earned, so the shipped corpus
    // is untouched by this rule.
    const laundered = [
      { skill: "kiwi-review-fix-loop", text: "`summarize_target` 을 여기서 **부르지 않는다** — 그 뒤 `summarize_target` 을 인자 없이 한 번 더 호출한다.", inFence: false },
      { skill: "kiwi-srs", text: "- `summarize_target { target: TARGET }` — 이어서 `summarize_target` 을 인자 없이 한 번 더 호출한다.", inFence: false },
      { skill: "kiwi-srs-from-code", text: "Phase 7   : validate_spec + summarize_target 최종 보고, 그리고 `summarize_target` 을 인자 없이 호출해 교차 확인", inFence: true }
    ] as const;
    for (const item of laundered) {
      expect(classify(item.skill, item.text, item.inFence, 0), `${item.skill} ordinal 0`).not.toBe("unclassified");
      expect(classify(item.skill, item.text, item.inFence, 1), `${item.skill} ordinal 1`).toBe("unclassified");
    }
  });

  it("leaves a door for a line that legitimately names the tool twice", () => {
    // The ordinal rule would otherwise be unappealable: an exemption row could not admit the second
    // occurrence, and the only remaining move would be to edit the classifier. The exemption is read
    // first, so a written-down line with a reason is admitted at every ordinal — and only that line,
    // because the key is the whole text.
    // The door shut: a line no exemption row names is walled out at its second occurrence, whatever
    // else it looks like.
    const both = "- `summarize_target` / `summarize_target { target: TARGET }` — 두 형태 대조";
    expect(classify("kiwi-srs", both, false, 1)).toBe("unclassified");
    // The door open, asserted on a line the exemption table really holds rather than on a set built
    // here — `classify` reads EXEMPT_KEYS and nothing else, so a locally widened set would decide
    // nothing and the assertion would hold no matter what the classifier did.
    expect(EXEMPT_KEYS.has("kiwi-srs-from-code - 11.3 summarize_target")).toBe(true);
    expect(classify("kiwi-srs-from-code", "- 11.3 summarize_target", false, 0)).toBe("exempt");
    expect(classify("kiwi-srs-from-code", "- 11.3 summarize_target", false, 1)).toBe("exempt");
    // And the door is only ever open on the exact line: one character more and it shuts again.
    expect(classify("kiwi-srs-from-code", "- 11.3 summarize_target ", false, 1)).toBe("unclassified");
  });

  it("names the tool once per shipped line, which is what makes the ordinal rule cost nothing", () => {
    const perLine = new Map<string, number>();
    for (const item of ALL) {
      const key = `${item.relPath}:${item.line}`;
      perLine.set(key, (perLine.get(key) ?? 0) + 1);
    }
    expect(perLine.size, "distinct lines naming the tool").toBeGreaterThan(0);
    const multiple = [...perLine.entries()].filter(([, count]) => count > 1).map(([key]) => key);
    expect(multiple, "a shipped line names the tool more than once, so the ordinal rule now reports it").toEqual([]);
  });

  it("gives every exemption a reason and uses every one of them", () => {
    for (const row of EXEMPT) {
      expect(row.reason.trim().length, `${row.skill} exemption needs a reason`).toBeGreaterThan(0);
      const uses = ALL.filter((item) => item.bucket === "exempt" && item.skill === row.skill && item.text === row.text);
      expect(uses.length, `${row.skill} exemption matches no shipped line: ${row.text.slice(0, 60)}`).toBeGreaterThan(0);
    }
  });

  it("admits a call that names its target and refuses the same call without one", () => {
    expect(NAMES_A_TARGET.test("- `summarize_target { target: TARGET }` — 기존 REQ 총수/scope 분포")).toBe(true);
    expect(NAMES_A_TARGET.test("MCP `summarize_target { target: TARGET }` 호출. 결과를 보고에 포함.")).toBe(true);
    expect(NAMES_A_TARGET.test("**선결 호출**: MCP `summarize_target` 호출 → trace link 인덱스 수집.")).toBe(false);
    expect(NAMES_A_TARGET.test("2. Call `summarize_target` for the trace-link index.")).toBe(false);
    expect(REFUSES_THE_CALL.test("**선결 호출**: MCP `summarize_target` 호출 → trace link 인덱스 수집.")).toBe(false);
    expect(REFUSES_THE_CALL.test("2. Call `summarize_target` for the trace-link index.")).toBe(false);
    expect(REFUSES_THE_CALL.test("Do not call `summarize_target` for it")).toBe(true);
    expect(REFUSES_THE_CALL.test("`summarize_target` 을 여기서 **부르지 않는다**")).toBe(true);
    // Measured, not assumed: an earlier spelling of this pattern also admitted `싣지 않` and
    // `carries no`, which describe what the RESPONSE lacks rather than refusing the CALL. A
    // mutation that inverted the refusal to `한 번 더 부른다` stayed green on the unrelated clause
    // in the same line, so the class was narrowed to the two phrasings that refuse a call.
    expect(REFUSES_THE_CALL.test("`summarize_target` 을 여기서 **한 번 더 부른다** — 그 도구는 trace link 은 하나도 싣지 않으며")).toBe(false);
    expect(REFUSES_THE_CALL.test("Call `summarize_target`; that reader carries no trace link")).toBe(false);
  });
});

// --- AC-2 --------------------------------------------------------------------------------------

describe("FR-FLOW-176 AC-2 — the denominator is measured and refuses to be empty", () => {
  it("counts the calls this rule actually judges, not only the ones it admits", () => {
    const judged = ALL.filter((item) => item.bucket !== "phase-map" && item.bucket !== "reference-row");
    expect(judged.length, "candidate lines the rule judges").toBe(floor("candidates"));
    expect(judged.every((item) => item.bucket !== "unclassified"), "a judged line is unclassified").toBe(true);
  });
});

// --- AC-3 --------------------------------------------------------------------------------------

/**
 * The extraction section, derived rather than listed: the section that names the denominator call.
 * Listing four paths would simply not read a fifth rendering; deriving makes a new one arrive as a
 * section the assertions below run over.
 */
function extractionSections(): Array<{ relPath: string; text: string; lines: string[] }> {
  const found: Array<{ relPath: string; text: string; lines: string[] }> = [];
  for (const rendering of RENDERINGS) {
    for (const relPath of markdownFiles(rendering, SKILL)) {
      const lines = readRepoFile(relPath).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.includes("list_requirements")) return;
        const section = enclosingSection(lines, index);
        if (section === null) return;
        const text = flat(section.text);
        if (!/status: ?\\?"implemented\\?"/.test(text)) return;
        if (found.some((item) => item.relPath === relPath && item.text === text)) return;
        found.push({ relPath, text, lines: section.text.split("\n") });
      });
    }
  }
  return found;
}

const EXTRACTION = extractionSections();

describe("FR-FLOW-176 AC-3 — the extraction section takes trace references from the reader that carries them", () => {
  it("finds one extraction section per rendering", () => {
    expect(EXTRACTION.length).toBe(floor("extractionSections"));
  });

  for (const rendering of RENDERINGS) {
    it(`${rendering} names traceReferences in its extraction section`, () => {
      const sections = EXTRACTION.filter((item) => item.relPath.startsWith(`${rendering}/`));
      expect(sections.length, `${rendering} has no extraction section`).toBeGreaterThan(0);
      for (const section of sections) {
        expect(section.text, `${section.relPath} must name the field that carries the links`).toContain("traceReferences");
      }
    });

    it(`${rendering} records that the summary reader carries no trace link`, () => {
      const sections = EXTRACTION.filter((item) => item.relPath.startsWith(`${rendering}/`));
      // The same guard its two siblings carry. Without it this case passes on an empty section list,
      // which is the one way a check over a derived set reports clean by finding nothing.
      expect(sections.length, `${rendering} has no extraction section`).toBeGreaterThan(0);
      for (const section of sections) {
        expect(section.text, `${section.relPath} must say what the summary reader does not carry`).toMatch(
          /(trace link 은 하나도 싣지 않|carries no trace link)/
        );
      }
    });

    it(`${rendering} names the summary reader only to refuse it`, () => {
      const sections = EXTRACTION.filter((item) => item.relPath.startsWith(`${rendering}/`));
      expect(sections.length, `${rendering} has no extraction section`).toBeGreaterThan(0);
      for (const section of sections) {
        const asking = section.lines.filter((line) => line.includes(TOOL) && !REFUSES_THE_CALL.test(line));
        expect(asking, `${section.relPath} still asks for a target summary`).toEqual([]);
      }
    });
  }
});

// --- AC-4 --------------------------------------------------------------------------------------

/** Files carrying the report object the extraction section emits, derived rather than listed. */
function reportObjectFiles(): string[] {
  const found: string[] = [];
  for (const rendering of RENDERINGS) {
    for (const relPath of markdownFiles(rendering, SKILL)) {
      if (readRepoFile(relPath).includes("extraction_basis")) found.push(relPath);
    }
  }
  return found;
}

const REPORT_FILES = reportObjectFiles();

describe("FR-FLOW-176 AC-4 — the emitted report names the source it actually reads", () => {
  it("finds the report object where the requirement records it, so a rendering that gains one is checked", () => {
    // Measured, and the honest denominator: one rendering writes this object and one wrote it at
    // HEAD. The three that do not satisfy the rule by silence, which is why the count is fixed here
    // — a second rendering gaining the object arrives as a case rather than as an unchecked file.
    expect(REPORT_FILES.length, "renderings carrying an extraction_basis object").toBe(floor("reportObjects"));
  });

  it("has every report object name the reader it takes trace references from", () => {
    for (const relPath of REPORT_FILES) {
      const text = readRepoFile(relPath);
      const basis = /"extraction_basis":\s*\{[^}]*\}/.exec(text);
      expect(basis, `${relPath} carries extraction_basis but not as an object this check can read`).not.toBeNull();
      expect(basis?.[0], `${relPath} must name the field it reads`).toContain("trace_references_used");
    }
  });

  it("ships no field claiming a target summary was consulted", () => {
    const offenders: string[] = [];
    for (const rendering of RENDERINGS) {
      for (const relPath of markdownFiles(rendering, SKILL)) {
        readRepoFile(relPath).split(/\r?\n/).forEach((line, index) => {
          if (/summarize_target_(used|consulted|read|called)/.test(line)) offenders.push(`${relPath}:${index + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
