import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORCHESTRATOR_MIRROR,
  ORCHESTRATOR_VARIANTS,
  offsetOf,
  readVariant,
  stripFrontmatter,
  tiedTogether,
  verbSection
} from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-155 AC-3 — every rendering names the validator in its terminal-verify section: when it
// is called, what is called, and what happens when it refuses.
// @req FR-FLOW-155 AC-4 — what this file does and does not guarantee, stated here rather than left to
// the next reader to infer from a green run.
// @req FR-FLOW-155 AC-5 — the wording this change introduces, counted in the shipped tree first.
//
// ─── WHAT THIS FILE GUARANTEES ──────────────────────────────────────────────────────────────────
// That the instruction is PRESENT in all four renderings of `kiwi-orchestrator/SKILL.md`, that it
// sits within one window of the terminal-review contract it guards, that deleting it from a single
// rendering turns this file red, and that the span it governs — from the terminal-review contract to
// the end of §V.final-verify — is byte-identical to `orchestrate-validate-wiring.fr-flow-155.golden.md`
// in every rendering. The golden is what makes the coverage UNIFORM. The presence and proximity
// assertions below read tokens, and a token survives its own inversion: each of them was satisfied by
// a paragraph whose main instruction had been flipped to "do not put the line through the validator".
// Pinning the span settles every clause in it at once — the four normative ones (call it after the
// write / route kiwi-orchestrator journals to MCP with `runId` and `strict: true` / never route a
// wave-master journal there / halt on refusal without rewriting the line), the sentence that grounds
// the third of them, and the validator's own name — instead of settling whichever clause the last
// probe happened to hit and leaving its neighbours open.
//
// ─── WHAT THIS FILE DOES NOT GUARANTEE ──────────────────────────────────────────────────────────
// That an agent reading the instruction actually calls `orchestrate_validate`. Nothing here observes
// a run. A run whose agent skipped the call completes normally and this file is still green. The
// machine guarantee of FR-FLOW-155 is the append-path refusal, and it lives in
// `test/cli/orchestrate-journal-engine.fr-flow-155.test.ts`; a green here is not evidence for it.
// AC-7 records the further limits that neither file closes.
//
// Nor is the span self-defending. The golden can be edited in the same commit as the text it pins,
// and so can a ledger row. Neither mechanism makes a contradiction impossible; both make it LOUD, and
// they are loud in different files: `orchestrator-mutation-ledger.json` names each of the six
// normative clauses as a rule with an owning requirement and pins its bytes, the rule_id set it
// declares for FR-FLOW-155 is frozen in `orchestrator-mutation-ledger.test.ts` so a row cannot be
// deleted to make its clause free, and that set is named again HERE so the declaration cannot be
// deleted alongside the rows.
//
// The two coordinated-edit costs are NOT the same and were measured separately. Inverting one of the
// six named clauses costs the body, the golden and that clause's row — three file kinds, and the row
// makes the diff name the rule. Appending a NEW permitting sentence inside the span costs only the
// body and the golden, because a row pins the bytes of the clause it quotes and sees nothing added
// beside it. Each row must therefore quote the whole rule it names, trigger included: three probes
// found a rule inverted for two file kinds because a row stopped short — a bold fragment without its
// subject, a consequence without its trigger, and a fallback whose condition no row named at all.
//
// Outside the golden span the cover is not a comparison but a CLOSED VOCABULARY. The section's front
// half — the run-window review hop, roughly the first 43% of it — must not name any of the eleven
// nouns this instruction is made of: the tool, the function, the gate, the flags, `MCP`, `CLI`,
// `wave-master`, `검증`, `진단`. Every one of them was zero up there before this, because the review
// hop is about a commit range and a child skill. The two polarity bans still read the whole section,
// but they were never the cover up there: they key on one axis each, and a sentence permitting the
// MCP route for a wave-master journal contradicted this instruction from 500 characters above it
// while every assertion in this file stayed green.
//
// What is still open, therefore, is narrower than a paraphrase: a contradiction that names the
// terminal line only by pronoun, uses a verb outside the closed list, AND avoids all eleven nouns —
// so it must be written with no antecedent for anything it refers to, because the front half is
// forbidden to have supplied one. The AC-4 block below asserts exactly that shape, once inside the
// span where it fails and once before it where it does not.
//
// The same closed-vocabulary rule covers `_shared/kiwi/waves-event.md`, which §0.1 of the skill names
// as the journal's event SSOT while keeping the orchestration procedure for itself. A contradiction
// planted there was invisible to every layer, and it was the worse place for one: an agent reading a
// file the skill deferred to does not read it as a conflict.
//
// ─── BASELINE, MEASURED BEFORE THE SKILL TEXT WAS TOUCHED ───────────────────────────────────────
// Over `skills/` and `.agents/skills/` in the shipped tree:
//   `orchestrate_validate`            0        `orchestrate validate`               0
//   `speckiwi orchestrate validate`   0        `--engine`                           0
//   `종료 줄을 쓴 직후`               0        `종료 줄을 다시 쓰지 않는다`         0
//   `MCP 로 검증하지 않는다`          0        `CLI 로만 검증하며`                  0
//   `strict: true`                    0        `runId`                              0
//   `terminal-review-loop-missing` inside §V.final-verify: 0 in each of the four copies
// `--strict` was NOT zero: 8 occurrences, and none of them was the bare flag — all eight were
// `--strict-grounding`, four of them inside this very skill (claude `:974`) and four in
// `_shared/kiwi/waves-event.md`. That is why `CLI_STRICT` below excludes the suffixed spelling
// rather than keying on `--strict` alone, which `--strict-grounding` would satisfy for free.

const COPIES = [...ORCHESTRATOR_VARIANTS.map((variant) => variant.relPath), ORCHESTRATOR_MIRROR];

/** The MCP tool name. `orchestrate validate` alone would also match the CLI spelling below. */
const CALL = /orchestrate_validate/;
/**
 * The contract paragraph's own signature — the sentence that puts `terminal_review` on the line.
 *
 * Keyed on the full backticked field list rather than on a bare `terminal_review`: the instruction
 * paragraph writes that token itself, so a window keyed on it is satisfied by the paragraph's own
 * text wherever the paragraph sits, and measures nothing about proximity. This signature appears
 * only in the contract paragraph.
 */
const CONTRACT = /`terminal_review \{skill, base, head, verdict\}`/;

const WINDOW_RADIUS = 400;
/**
 * The call may sit this far after the contract it guards. Larger than `WINDOW_RADIUS` because the
 * contract paragraph and the instruction are separated by the verdict enumeration, which belongs
 * between them. What this radius still excludes is measured directly, below.
 */
const CONTRACT_RADIUS = 600;

/** The three parts AC-3 requires, each keyed on a token that was zero in the shipped tree. */
const WHEN = /종료 줄을 쓴 직후/;
const CLI_FALLBACK = /speckiwi orchestrate validate/;
/** The CLI flag, not `--strict-grounding`, which is the only spelling the shipped tree already had. */
const CLI_STRICT = /--strict(?![-\w])/;
/** The MCP call's own arguments. `CLI_STRICT` is satisfied by the fallback command and says nothing about these. */
const MCP_RUN_ID = /`runId`/;
const MCP_STRICT = /`strict: true`/;
const ENGINE_FLAG = /--engine kiwi-wave-master/;
/** The MCP tool has no engine argument, so a wave-master journal validated through it reads clean. */
const MCP_NOT_FOR_WAVE_MASTER = /MCP 로 검증하지 않는다/;
const CLI_ONLY_FOR_WAVE_MASTER = /CLI 로만 검증하며/;
const GATE = /terminal-review-loop-missing/;
const NO_REWRITE = /종료 줄을 다시 쓰지 않는다/;
/** The function the paragraph hands the judgement to. Descriptive, not normative — pinned by the golden alone. */
const VALIDATOR_NAME = /`validateWavesJournal`/;
/** The ground of the wave-master routing rule: what the MCP path actually answers for such a journal. */
const MCP_READS_NOTHING = /한 줄도 보지 않은 채 깨끗하다고 답한다/;

const HEDGE =
  /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면|필요 시|것이 좋다|편이 (안전|낫)|선택적|해도 무방|권한다/;

/**
 * Rewriting the terminal line, stated as permitted. Positive conjugations only: the prohibition is
 * `…다시 쓰지 않는다`, which none of these match, and the write instruction `종료 줄을 쓴다` carries
 * no `다시`/`고쳐`/`재작성`. Subject-scoped on purpose — `--close-reqs 는 주지 않는다` and the
 * verdict enumeration live in the same section and are not about this rule.
 */
const REWRITE_PERMITTED =
  /종료 줄[^\n]{0,24}?(다시 쓴다|다시 써|다시 쓸|고쳐 쓴다|고쳐 다시|재작성한다|재작성해|재발행|덮어쓴다|덮어써|덮어 쓴다|덮어쓸|재기록한다|재기록해)/;
/**
 * Retiring the rule without naming the line — the other shape a token-preserving inversion takes.
 *
 * The tail alternations are the blanket form: a sentence that voids the section's instructions
 * wholesale rather than contradicting any one of them. It names no clause, so a ban keyed on a clause
 * cannot see it, and it is the cheapest inversion there is — one line, and nothing the golden holds
 * is touched.
 */
const RULE_RETRACTED =
  /철회|취소된다|더 이상 적용되지|옛 규칙|이 규칙은 예외|무시하고 (run|진행)|무시한다|무효|따르지 않는다|적용하지 않는다|효력(이 없|을 잃)|폐기(된다|한다)/;

/**
 * The nouns this instruction is made of. Every one of them occurs ZERO times in §V.final-verify
 * BEFORE the governed span, in all four renderings — measured, not assumed — and that is not luck of
 * phrasing. The section has two subjects and they do not overlap: its front half is the run-window
 * review hop, which routes a commit range to a child skill (FR-FLOW-131 AC-7/AC-8/AC-10 read exactly
 * that text), and its back half is the terminal line and the validator that judges it. The review hop
 * has no use for the word `MCP`, the word `검증`, or the name of a gate.
 *
 * So the front half is held CLOSED on this subject rather than policed for polarity. Before this, two
 * lexical bans read it and both keyed on one axis — the terminal line being rewritten, the rule being
 * retired — so `wave-master 저널도 MCP 로 검증해도 된다.` placed above the contract paragraph
 * contradicted the routing rule while every assertion in this file stayed green. Widening the bans to
 * the other four clauses would have been an arms race against paraphrase; refusing the SUBJECT is one
 * rule and it does not care how the sentence is worded, because a sentence that rules on this
 * instruction cannot avoid naming what it rules on.
 *
 * What this deliberately does NOT do is freeze the front half's bytes. The golden could simply have
 * been widened to the whole section — same mechanism, no new device — but the text it would then
 * freeze belongs to FR-FLOW-131, so every edit that requirement owns would fail HERE, under a message
 * about a terminal-line contract it is not about. A closed vocabulary constrains what the front half
 * may TALK about and leaves FR-FLOW-131 free to say its own thing however it likes.
 */
const SUBJECT_NOUNS: Array<[string, RegExp]> = [
  ["the MCP tool", /orchestrate[_ ]validate/],
  ["the validator function", /validateWavesJournal/],
  ["the gate it raises", /terminal-review-loop-missing/],
  ["the engine flag", /--engine/],
  ["the run-id argument", /runId|--run-id/],
  ["the strictness argument", /strict/],
  ["the MCP caller", /MCP/],
  ["the CLI caller", /CLI/],
  ["the engine that may not be judged over MCP", /wave-master/],
  ["validation itself", /검증/],
  ["a diagnostic", /진단/]
];

/**
 * The four renderings of the file `§0.1` of the skill names as the journal's event SSOT.
 *
 * Not derived from `ORCHESTRATOR_VARIANTS`, because the mirror's path is not `.agents/skills/<same
 * relative path>` for shared files — `_shared` sits at the root of each tree — and a derivation that
 * silently produced a wrong path would read "" and pass. The length assertion below is what makes a
 * wrong path fail rather than pass.
 */
const EVENT_CONTRACT = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/_shared/kiwi/waves-event.md`
);

/**
 * The five ways a sentence can rule on the terminal line's validation without being able to hide it.
 * Narrower than `SUBJECT_NOUNS` on purpose: this file legitimately talks about `terminal_review`,
 * `final-verify`, verification records and version gates all through, so a wide vocabulary would be
 * a false positive on every second paragraph. These five name the VALIDATOR, and the validator is
 * the thing this file has no business ruling on.
 */
const PROCEDURE_NOUNS: Array<[string, RegExp]> = [
  ["the MCP tool", /orchestrate[_ ]validate/],
  ["the validator function", /validateWavesJournal/],
  ["the gate it raises", /terminal-review-loop-missing/],
  ["the engine flag", /--engine/],
  ["the validator by common noun", /검증기/]
];

const finalVerify = (relPath: string): string => verbSection(stripFrontmatter(readVariant(relPath)), "final-verify");

/** From the contract signature to the end of the section: the span the terminal-line rule governs. */
const ruleSpan = (section: string): string => section.slice(offsetOf(section, CONTRACT));

/**
 * Where the compared span begins: the start of the LINE carrying the contract signature. Everything
 * before this offset is the section's front half, which no byte comparison reads.
 *
 * A missing signature returns the section's length, so the front half becomes the whole section and
 * the vocabulary assertion below reports on all of it rather than silently reporting on nothing.
 */
const spanStart = (section: string): number => {
  const at = offsetOf(section, CONTRACT);
  return at < 0 ? section.length : section.lastIndexOf("\n", at) + 1;
};

const GOLDEN_PATH = path.resolve(__dirname, "orchestrate-validate-wiring.fr-flow-155.golden.md");

/** Line endings only, so a checkout under `core.autocrlf` is not read as a contradiction. */
const normalise = (text: string): string => text.replace(/\r\n/g, "\n").replace(/\s+$/, "");

/**
 * The governed span as the golden holds it: whole lines from the one carrying the contract signature
 * to the end of §V.final-verify.
 *
 * Whole lines rather than `ruleSpan`'s mid-line slice, because the contract sentence opens the span
 * and half of it is not a thing a golden can be diffed against by a human. The trailing blank line
 * the section carries before the next heading is trimmed on both sides: it is markdown spacing, and
 * a red that says "you changed a blank line" teaches nobody anything.
 */
const governedSpan = (section: string): string => {
  if (offsetOf(section, CONTRACT) < 0) return "";
  return normalise(section.slice(spanStart(section)));
};

/** ENOENT-to-empty-string, the convention `readVariant` already uses: a deleted golden must fail as an
 * assertion naming the fixture, not as a thrown ENOENT at import that reads like a broken harness. */
const GOLDEN = ((): string => {
  try {
    return normalise(readFileSync(GOLDEN_PATH, "utf8"));
  } catch {
    return "";
  }
})();

it("the corpus is not empty — four renderings, or every assertion below is vacuous", () => {
  // `describe.each([])` registers nothing and reports green. The mirror is generated from `codex`
  // and is NOT excluded for this skill, so four is the number; kiwi-wave-master's three-copy rule
  // does not apply here.
  expect(COPIES).toHaveLength(4);
  for (const copy of COPIES) {
    expect(finalVerify(copy), `${copy}: §V.final-verify must exist for this suite to read anything`).not.toBe("");
  }
});

it("the golden still says the thing it is holding, so gutting it cannot buy a green", () => {
  // The comparison below is symmetric: emptying the golden AND the four bodies would satisfy it. The
  // presence assertions read the bodies, so they close half of that; this closes the other half by
  // reading the golden. Every clause the requirement is about must be findable in the fixture itself.
  expect(GOLDEN, "the golden fixture is empty").not.toBe("");
  const clauses: Array<[string, RegExp]> = [
    ["the terminal-review contract signature", CONTRACT],
    ["the MCP tool name", CALL],
    ["when it is called", WHEN],
    ["the MCP arguments", MCP_RUN_ID],
    ["strict over MCP", MCP_STRICT],
    ["the CLI fallback", CLI_FALLBACK],
    ["strict at the CLI", CLI_STRICT],
    ["the engine flag", ENGINE_FLAG],
    ["the wave-master MCP refusal", MCP_NOT_FOR_WAVE_MASTER],
    ["the wave-master CLI routing", CLI_ONLY_FOR_WAVE_MASTER],
    ["the gate raised on refusal", GATE],
    ["the rewrite prohibition", NO_REWRITE],
    ["the validator's name", VALIDATOR_NAME],
    ["why MCP cannot judge a wave-master journal", MCP_READS_NOTHING]
  ];
  for (const [what, re] of clauses) expect(re.test(GOLDEN), `the golden no longer carries ${what}`).toBe(true);
});

it("neither radius can be widened into a no-op: each is smaller than the text it searches", () => {
  // A window as wide as the section is not a window — it reports proximity for every arrangement.
  // Both radii are constants in this file, so without this the cheapest way past a proximity failure
  // is to raise the number, and nothing says the check stopped measuring anything.
  for (const copy of COPIES) {
    const section = finalVerify(copy);
    const contract = offsetOf(section, CONTRACT);
    expect(contract, `${copy}: the contract signature must be present`).toBeGreaterThan(-1);
    expect(WINDOW_RADIUS, `${copy}: WINDOW_RADIUS spans the whole section`).toBeLessThan(section.length);
    expect(
      CONTRACT_RADIUS,
      `${copy}: CONTRACT_RADIUS reaches the end of the section, so no placement of the call can fail it`
    ).toBeLessThan(section.length - contract);
  }
});

describe.each(COPIES)("FR-FLOW-155 AC-3 — the terminal-verify section names the validator (%s)", (copy) => {
  it("names the MCP tool inside §V.final-verify", () => {
    const section = finalVerify(copy);
    expect(
      /orchestrate_validate|orchestrate validate/.test(section),
      `${copy}: the section describes a refusal it never tells anyone to obtain`
    ).toBe(true);
  });

  it("puts the call within one window AFTER the terminal-review contract it guards", () => {
    // Distance from the contract paragraph, not from any `terminal_review` token: the instruction
    // writes that token itself, so keying on it would make this assertion measure the paragraph's
    // own integrity and pass for a paragraph parked at the end of the section.
    const section = finalVerify(copy);
    const contract = offsetOf(section, CONTRACT);
    const call = offsetOf(section, CALL);
    expect(contract, `${copy}: the terminal-line write instruction must survive`).toBeGreaterThan(-1);
    expect(call, `${copy}: the call must be present`).toBeGreaterThan(-1);
    expect(call - contract, `${copy}: a validation ordered before the line it validates verifies the previous run`).toBeGreaterThan(0);
    expect(
      call - contract,
      `${copy}: the call must sit within ${CONTRACT_RADIUS} chars after the contract it guards, not merely somewhere in the section`
    ).toBeLessThanOrEqual(CONTRACT_RADIUS);
  });

  it("keeps the gate it raises in the call's own window", () => {
    const section = finalVerify(copy);
    expect(
      tiedTogether(section, CALL, [GATE], WINDOW_RADIUS),
      `${copy}: the call must sit within ${WINDOW_RADIUS} chars of the gate it raises`
    ).toBe(true);
  });

  it("states what is called: the MCP tool with its arguments, the CLI fallback, strict, and the wave-master engine flag", () => {
    // `orchestrate validate` defaults `--engine` to `kiwi-orchestrator`, so a wave-master journal
    // validated without the flag reports a clean run over zero lines — the same empty-candidate-set
    // failure the append path had. An instruction that omits the flag reproduces it at the CLI.
    const section = finalVerify(copy);
    expect(
      tiedTogether(section, CALL, [MCP_RUN_ID, MCP_STRICT], WINDOW_RADIUS),
      `${copy}: the window must say what the MCP tool is called WITH, not only that it is called`
    ).toBe(true);
    expect(
      tiedTogether(section, CALL, [CLI_FALLBACK, CLI_STRICT, ENGINE_FLAG], WINDOW_RADIUS),
      `${copy}: the window must carry the CLI fallback, --strict and --engine kiwi-wave-master`
    ).toBe(true);
  });

  it("says the MCP path cannot validate a wave-master journal, because it has no engine argument", () => {
    // `orchestrate_validate`'s MCP binding declares `--run-id`, `--journal` and `--strict` and the
    // input schema is derived from that list (the `orchestrate_validate` binding in `src/cli/commands/orchestrate.ts`), so an MCP
    // caller cannot pass an engine and always parses under the `kiwi-orchestrator` default. Told to
    // reach for MCP first, an agent validating a wave-master journal gets a clean answer over zero
    // lines — the exact failure this requirement closed at the append path, reopened at the call.
    const section = finalVerify(copy);
    expect(
      tiedTogether(section, CALL, [MCP_NOT_FOR_WAVE_MASTER, CLI_ONLY_FOR_WAVE_MASTER], WINDOW_RADIUS),
      `${copy}: the instruction must route the wave-master journal to the CLI and say why`
    ).toBe(true);
  });

  it("states when it is called", () => {
    const section = finalVerify(copy);
    expect(
      tiedTogether(section, CALL, [WHEN], WINDOW_RADIUS),
      `${copy}: "run this at some point" is not an instruction anyone can be found not to have followed`
    ).toBe(true);
  });

  it("states what happens on refusal: halt on the gate, and do not rewrite the terminal line", () => {
    // Without the second half the obvious response to a refusal is to edit the line until it is
    // accepted, which converts a refused judgement into a recorded pass.
    const section = finalVerify(copy);
    expect(
      tiedTogether(section, CALL, [GATE, NO_REWRITE], WINDOW_RADIUS),
      `${copy}: the refusal branch must name the gate and forbid rewriting the line`
    ).toBe(true);
  });

  it("says nothing at all about the validator before the span that is compared", () => {
    // The section's front half is read by no byte comparison, and until this assertion the only
    // things reading it were two polarity bans on ONE axis — rewriting the terminal line, retiring
    // the rule. The other four normative clauses had no defence at any position up there, and a
    // sentence contradicting the wave-master routing rule 500 characters above the paragraph that
    // states it left every assertion in this file green.
    //
    // The rule here is not "do not contradict it" — it is "do not speak about it". A contradiction
    // can be paraphrased; a subject cannot be discussed without naming it. Eleven nouns, each of
    // them zero in the front half of all four renderings at the time this was written.
    const section = finalVerify(copy);
    expect(
      offsetOf(section, CONTRACT),
      `${copy}: the contract signature must be present, or nothing marks where the compared span begins`
    ).toBeGreaterThan(-1);
    const front = section.slice(0, spanStart(section));
    const spoken = SUBJECT_NOUNS.filter(([, re]) => re.test(front)).map(([what]) => what);
    expect(
      spoken,
      `${copy}: §V.final-verify names ${JSON.stringify(spoken)} BEFORE the terminal-review contract paragraph, where no byte comparison reads. That half of the section is the run-window review hop — it hands a commit range to a child skill and has no business ruling on the journal validator, and every rule about the validator lives inside the compared span so that it cannot be contradicted from a distance. If this edit genuinely belongs to the validator, move the sentence INTO the span and re-copy the golden; if it belongs to the review hop, say it without these words. Widening this list is the wrong repair — it is what closes the front half at all.`
    ).toEqual([]);
  });

  it("never permits, anywhere in §V.final-verify, what the refusal branch forbids", () => {
    // Every assertion above is a presence check, and presence survives inversion: the paragraph can
    // be rewritten to say "ignore the diagnostic and rewrite the line until it is accepted" while
    // still carrying `orchestrate_validate`, `terminal-review-loop-missing` and the very words
    // `종료 줄을 다시 쓰지 않는다` inside a clause that retires them. It can also be left untouched
    // with a permitting sentence appended below it. Both land the same thing in the journal — a pass
    // nobody obtained — so both are refused here rather than only the deletions.
    //
    // Read over the whole section, not from the contract onward. Scoping the ban to the span the
    // golden pins would have left it doing nothing the comparison does not already do, while the one
    // place it is the only reader — the section's earlier half — went unwatched.
    const section = finalVerify(copy);
    expect(ruleSpan(section), `${copy}: the rule span must be non-empty for this assertion to mean anything`).not.toBe("");
    const permits = REWRITE_PERMITTED.exec(section);
    expect(permits?.[0] ?? null, `${copy}: the terminal line is rewritten in a section that forbids rewriting it`).toBe(null);
    const retracts = RULE_RETRACTED.exec(section);
    expect(retracts?.[0] ?? null, `${copy}: the section retires its own refusal rule`).toBe(null);
  });

  it("holds the whole governed span byte-exact, so no clause in it is settled and its neighbour left open", () => {
    // The one assertion here that does not read a token. Every other check in this file names what it
    // is looking for, and therefore protects exactly what someone thought to name; this one protects
    // the rest. It is the reason the main instruction, the MCP routing, the wave-master refusal, the
    // refusal branch and the sentence grounding them are covered to the same depth rather than to the
    // depth of the last probe that happened to hit each one.
    //
    // The price is real and is meant: splitting the paragraph, appending an explanatory sentence to
    // it, translating a clause or reordering one all turn this red, and none of those is an attack.
    // The failure is not "the rule is broken" — it is "the contract text moved, so re-read it and
    // re-copy it here". For a paragraph whose subject is what may be written into a permanent journal
    // after a refusal, that is the right question to be asked on every edit. FR-NODE-199 AC-4 turns
    // on the same friction: the grounding sentence stops being true the day MCP gains an engine
    // argument, and this comparison is what refuses to let that day pass quietly.
    expect(
      governedSpan(finalVerify(copy)),
      `${copy}: the governed span of §V.final-verify no longer matches ${path.basename(GOLDEN_PATH)}. This says the contract text moved, not that the rule broke. Read the diff below as an edit under review: if it changes what an agent is told to do about the terminal line, that is the finding; if it does not, re-copy the span into the golden and re-read FR-NODE-199 AC-4, which turns on the grounding sentence in this paragraph.`
    ).toBe(GOLDEN);
  });

  it("gives the instruction unhedged", () => {
    const sentence = finalVerify(copy)
      .split("\n")
      .filter((line) => CALL.test(line))
      .join("\n");
    // Guarded, because `HEDGE.test("")` is false: without this the assertion below passes loudest
    // exactly when the instruction has been deleted.
    expect(sentence, `${copy}: the call must be present for this assertion to mean anything`).not.toBe("");
    expect(HEDGE.test(sentence), `${copy}: a hedged gate is an optional gate: ${sentence.slice(0, 120)}`).toBe(false);
  });
});

describe("FR-FLOW-155 AC-4 — where the cover ends, asserted rather than described", () => {
  // AC-4 asks this file to say what it does not guarantee. A comment saying so decays: the sentence
  // stays while the mechanism under it moves, and nobody notices because prose does not run. So the
  // boundary is executed. The probe is a permission phrased the way NONE of the three mechanisms can
  // see it — the terminal line named by pronoun (the rewrite ban is subject-scoped), the act by a verb
  // outside the closed list, and not one of the eleven subject nouns anywhere in it — and it is
  // placed once inside the golden span and once before it.
  //
  // Spliced into the golden rather than into a live rendering, so the probe measures the mechanism
  // and nothing else. Built from a body, it would turn red for every edit anywhere in the section and
  // stop being a statement about where the cover ends.
  //
  // The earlier probe sentence was `다만 진단이 반복되면 그 줄을 덮어쓴다.` and it no longer evades: `진단`
  // is a subject noun and `덮어쓴다` is now in the verb list. What survives is narrower and worth
  // seeing plainly — a sentence with no antecedent for either `그 줄` or `거부`, because the front
  // half is forbidden to have introduced one.
  const EVASIVE = "다만 거부가 반복되면 그 줄을 손본다.";

  it("catches the evasive permission when it lands inside the span, because the span is compared and not read", () => {
    const spliced = GOLDEN.replace(NO_REWRITE, `${NO_REWRITE.source} ${EVASIVE}`);
    expect(spliced, "the splice did not change the golden, so this proves nothing").not.toBe(GOLDEN);
    expect(REWRITE_PERMITTED.test(spliced), "if the ban had caught it, this probe would be measuring the wrong thing").toBe(false);
    expect(RULE_RETRACTED.test(spliced), "same").toBe(false);
    expect(governedSpan(spliced), "an appended sentence inside the golden span must not compare equal").not.toBe(GOLDEN);
  });

  it("does NOT catch it before the contract paragraph, which is exactly how far the cover reaches", () => {
    // Red here means someone widened the cover — the golden span, the bans, or the noun list. That is
    // a good change and this assertion is the last thing to update, not the reason to stop. What it
    // must never do is stay green while AC-4 claims the gap was closed.
    const outside = `${EVASIVE}\n\n${GOLDEN}`;
    expect(governedSpan(outside), "the splice landed inside the span, so it is not testing the outside").toBe(GOLDEN);
    expect(REWRITE_PERMITTED.test(outside), "the rewrite ban").toBe(false);
    expect(RULE_RETRACTED.test(outside), "the retraction ban").toBe(false);
    expect(
      SUBJECT_NOUNS.filter(([, re]) => re.test(EVASIVE)).map(([what]) => what),
      "the probe must name none of the subject nouns, or it is measuring the noun list instead of the residual"
    ).toEqual([]);
  });
});

describe("FR-FLOW-155 AC-3 — the four renderings carry one spelling of the instruction", () => {
  // This replaces a line count — `exactly one line may name the tool inside §V.final-verify` — which
  // refused `복구: 라운드를 다시 하고 orchestrate_validate 를 다시 부른다.`, a completely
  // sound instruction, under a message that said neither why nor what to do instead. The count was a
  // proxy for the real rule — no SECOND, DIFFERING spelling of the instruction — and the proxy is
  // now unnecessary in both halves of the section. Before the span: naming the tool there is one of
  // the eleven subject nouns and fails with a message that says where the sentence belongs. Inside
  // the span: a second mention is frozen by the golden, so it cannot drift into a different spelling,
  // and an edit that adds one fails the comparison with the instruction to re-copy the span.
  //
  // What is given up by dropping the count: a rendering may now name the tool twice INSIDE the span
  // provided the golden and all four bodies agree on both mentions. That is a three-file edit whose
  // diff shows the second sentence in full, not a quiet one.
  it("names the tool inside the compared span in every rendering, and only there", () => {
    for (const copy of COPIES) {
      const section = finalVerify(copy);
      expect(CALL.test(section.slice(spanStart(section))), `${copy}: the tool must be named inside the compared span`).toBe(true);
      expect(CALL.test(section.slice(0, spanStart(section))), `${copy}: the tool is named where no comparison reads it`).toBe(false);
    }
  });
});

describe.each(EVENT_CONTRACT)("FR-FLOW-155 AC-8 — the event SSOT does not rule on this procedure (%s)", (copy) => {
  // §0.1 of the skill hands this file the journal's schema, its file location and its `complete`
  // rules, and keeps the orchestration logic: *"본 문서는 오케스트레이션 로직만 담당한다"*. When to
  // put the terminal line through the validator, which caller may judge which engine, and what to do
  // when it refuses are orchestration logic, and they live in §V.final-verify under a golden.
  //
  // Nothing enforced that split. Planting `종료 줄은 기록 직후 검증기에 통과시키지 않는다 — 검증은
  // 선택이며 진단이 반복되면 종료 줄을 덮어써서 통과시킨다.` in all four renderings of this file
  // left every assertion under `test/skills/` green and `skills mirror --check` at zero divergence.
  // The golden, the ledger rows and both polarity bans are scoped to `kiwi-orchestrator/SKILL.md`.
  //
  // The rule is the boundary itself rather than the polarity of any sentence: this file may define
  // what `terminal_review` IS, and may not say what is done about it. A sentence that rules on the
  // procedure cannot avoid naming the validator, by tool name, by function name, by the gate it
  // raises, by the flag that routes it, or by the common noun `검증기` — and all five are absent
  // here today. `종료 줄` itself is NOT on that list: this file legitimately says three times when
  // the line is written relative to the review's own commit, which is schema, not procedure.
  it("is present and non-trivial, so a deleted or emptied rendering cannot pass by carrying nothing", () => {
    expect(
      readVariant(copy).length,
      `${copy}: the event SSOT is missing or empty, so every assertion below would report clean over no text`
    ).toBeGreaterThan(5000);
  });

  it("leaves the terminal line's validation to the skill that owns the procedure", () => {
    const text = readVariant(copy);
    const spoken = PROCEDURE_NOUNS.filter(([, re]) => re.test(text)).map(([what]) => what);
    expect(
      spoken,
      `${copy}: the event SSOT names ${JSON.stringify(spoken)}. This file defines the journal's schema and §0.1 of kiwi-orchestrator defers to it for that; the procedure around the terminal line — when it is validated, by which caller, and what happens on refusal — belongs to §V.final-verify, where a golden holds it byte-exact. A rule stated here is a rule stated where nothing compares it, in the file an agent reads as authoritative. Move the sentence into §V.final-verify and re-copy the golden.`
    ).toEqual([]);
    expect(
      REWRITE_PERMITTED.exec(text)?.[0] ?? null,
      `${copy}: the event SSOT permits rewriting the terminal line, which §V.final-verify forbids`
    ).toBe(null);
  });
});

describe("FR-FLOW-155 AC-3 — the ledger layer cannot be removed whole", () => {
  // `orchestrator-mutation-ledger.test.ts` freezes the rule_id set each requirement declares, so a
  // row can no longer be deleted to free the clause it pins. What that did NOT stop is deleting the
  // declaration alongside the rows: the frozen map and the rows it describes live in the same suite,
  // and removing `"FR-FLOW-155": […]` together with its fifteen rows fires nothing at all — after
  // which any clause in the paragraph inverts with an edit to the body and the golden only.
  //
  // Naming the five rules here puts that deletion in front of a second file whose subject is the
  // requirement rather than the ledger. It does not make the deletion impossible; it makes the diff
  // carry a test named after this requirement.
  const OWNED = [
    "R-FINAL-VERIFY-CLI-IS-THE-FALLBACK-WHEN-MCP-IS-ABSENT",
    "R-FINAL-VERIFY-ORCHESTRATOR-JOURNAL-IS-VALIDATED-WITH-RUN-ID-AND-STRICT",
    "R-FINAL-VERIFY-REFUSAL-HALTS-WITHOUT-REWRITING-THE-TERMINAL-LINE",
    "R-FINAL-VERIFY-TERMINAL-LINE-IS-PUT-THROUGH-THE-VALIDATOR-IMMEDIATELY",
    "R-FINAL-VERIFY-WAVE-MASTER-JOURNAL-CARRIES-THE-ENGINE-FLAG",
    "R-FINAL-VERIFY-WAVE-MASTER-JOURNAL-IS-NOT-VALIDATED-OVER-MCP"
  ];

  it("pins each normative clause as a ledger row in every shipped variant", () => {
    const ledger = JSON.parse(readFileSync(path.resolve(__dirname, "orchestrator-mutation-ledger.json"), "utf8")) as Array<{
      variant: string;
      rule_id: string;
      owning_requirement: string;
    }>;
    expect(ledger.length, "the ledger is empty, so every membership check below would be vacuous").toBeGreaterThan(0);
    for (const variant of ORCHESTRATOR_VARIANTS.map((entry) => entry.id)) {
      const mine = ledger.filter((row) => row.variant === variant && row.owning_requirement === "FR-FLOW-155").map((row) => row.rule_id);
      expect(
        [...mine].sort(),
        `skills/${variant}: FR-FLOW-155's clause rows in orchestrator-mutation-ledger.json are ${JSON.stringify([...mine].sort())}. Each of the six names one normative clause of §V.final-verify's validator paragraph and pins its bytes. Deleting a row — or the OWNED_RULES entry that declares them — releases that clause to be inverted with an edit to the body and the golden alone. If a clause was genuinely retired, retire it in the requirement first.`
      ).toEqual([...OWNED].sort());
    }
  });
});
