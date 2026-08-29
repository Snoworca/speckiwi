import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORCHESTRATOR_MIRROR,
  ORCHESTRATOR_VARIANTS,
  PROCEDURE_NOUNS,
  REWRITE_PERMITTED,
  normaliseEol,
  offsetOf,
  ownedSubsections,
  readVariant,
  stripFrontmatter,
  tiedTogether
} from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-155 AC-3 — every rendering names the validator in its terminal-verify section: when it
// is called, what is called, and what happens when it refuses.
// @req FR-FLOW-155 AC-4 — what this file does and does not guarantee, stated here rather than left to
// the next reader to infer from a green run.
// @req FR-FLOW-155 AC-5 — the wording this change introduces, counted in the shipped tree first.
// @req FR-FLOW-155 AC-8 — the event SSOT does not rule on the procedure the skill keeps for itself.
//
// ─── WHAT THIS FILE GUARANTEES ──────────────────────────────────────────────────────────────────
// That the instruction is PRESENT in all four renderings of `kiwi-orchestrator/SKILL.md`, that it
// sits within one window of the terminal-review contract it guards, and that deleting it from a
// single rendering turns this file red. Every assertion here reads the subsection whose heading
// declares `FR-FLOW-155` as its owner — the second half of `§V.final-verify`, which FR-FLOW-157
// split off so that a byte comparison could be drawn across a section with ONE subject.
//
// The byte comparison itself is FR-FLOW-157's, in `final-verify-section-split.fr-flow-157.test.ts`:
// it holds that section from its heading to its end against
// `orchestrate-validate-wiring.fr-flow-155.golden.md`, which is what makes the coverage UNIFORM.
// The presence and proximity assertions below read tokens, and a token survives its own inversion:
// each of them was satisfied by a paragraph whose main instruction had been flipped to "do not put
// the line through the validator". Pinning the section settles every clause in it at once — the four
// normative ones (call it after the write / route kiwi-orchestrator journals to MCP with `runId` and
// `strict: true` / never route a wave-master journal there / halt on refusal without rewriting the
// line), the sentence that grounds the third of them, and the validator's own name — instead of
// settling whichever clause the last probe happened to hit and leaving its neighbours open.
//
// ─── WHAT THIS FILE DOES NOT GUARANTEE ──────────────────────────────────────────────────────────
// That an agent reading the instruction actually calls `orchestrate_validate`. Nothing here observes
// a run. A run whose agent skipped the call completes normally and this file is still green. The
// machine guarantee of FR-FLOW-155 is the append-path refusal, and it lives in
// `test/cli/orchestrate-journal-engine.fr-flow-155.test.ts`; a green here is not evidence for it.
// AC-7 records the further limits that neither file closes.
//
// Nor is the section self-defending. The golden can be edited in the same commit as the text it
// pins, and so can a ledger row. Neither mechanism makes a contradiction impossible; both make it
// LOUD, and they are loud in different files: `orchestrator-mutation-ledger.json` names each of the
// six normative clauses as a rule with an owning requirement and pins its bytes, the rule_id set it
// declares for FR-FLOW-155 is frozen in `orchestrator-mutation-ledger.test.ts` so a row cannot be
// deleted to make its clause free, and that set is named again HERE so the declaration cannot be
// deleted alongside the rows.
//
// The coordinated-edit costs are NOT the same, and every count below was measured to green over
// `test/skills` at 66 files / 3424 tests. Each count names the clause it belongs to, because an
// earlier draft of this comment reported one clause's numbers under another clause's name.
// Inverting one of the six named clauses costs FOUR file kinds — the body, the golden, that clause's
// rows, and THIS file, whose presence and hedge assertions still refuse the weakened sentence after
// the first three agree. On `…TERMINAL-LINE-IS-PUT-THROUGH-THE-VALIDATOR-IMMEDIATELY`: bodies alone
// 73 failed, plus the golden 13, plus the three rows 4, plus the hedge assertion below green. The
// neighbouring `…REFUSAL-HALTS-WITHOUT-REWRITING-THE-TERMINAL-LINE` costs more at the first two
// steps — 77 failed, then 23 — because more assertions here read it, and it is where the 77 and 23
// once misfiled against the clause above were measured. Appending a NEW permitting sentence inside
// the section costs only the body and the golden — 63 failed, then green — because a row pins the
// bytes of the clause it quotes and sees nothing added beside it.
// Deleting a row buys silence, not a cheaper edit: its id is declared in three test files, so the
// rows come out only with those declarations (10 failed, then green with no body touched), and the
// clause is still inside the compared section, so the inversion costs the same kinds afterwards.
// Each row must therefore quote the whole rule it names, trigger included: three probes
// found a rule inverted for two file kinds because a row stopped short — a bold fragment without its
// subject, a consequence without its trigger, and a fallback whose condition no row named at all.
//
// ─── WHAT WAS REMOVED WITH THE SPLIT, AND WHY ───────────────────────────────────────────────────
// This file used to hold the section's front half CLOSED on eleven nouns — the tool, the function,
// the gate, the flags, `MCP`, `CLI`, `wave-master`, `검증`, `진단` — because that half was read by no
// byte comparison and the two polarity bans key on one axis each. Both halves of that trade were
// then measured and both pointed at a boundary instead. On the defence side the vocabulary closed
// SPELLINGS rather than the subject: `mcp`, the full-width `ＭＣＰ`, `orchestrate-validate`, `run_id`,
// and four plain-Korean inversions carrying none of the eleven nouns each carried a contradiction
// past every assertion. On the cost side it refused seven legitimate FR-FLOW-131 edits, among them
// adding `--strict-grounding` — a flag this skill defines in its own options table — to the review
// hop's argument fence, under a message that forbade both available repairs at once.
//
// FR-FLOW-157 replaced it with the heading that now separates the two subjects, so nothing in this
// file reads text FR-FLOW-131 owns. The price is recorded rather than hidden: a sentence in the
// review-hop section saying the terminal line's validation is optional is compared by nothing, the
// same way `§V.emit-and-finish` and `§V.halt` already were. FR-FLOW-157 AC-5 asserts that price.
//
// The same closed-boundary shape still covers `_shared/kiwi/waves-event.md`, which §0.1 of the skill
// names as the journal's event SSOT while keeping the orchestration procedure for itself. A
// contradiction planted there was invisible to every layer, and it was the worse place for one: an
// agent reading a file the skill deferred to does not read it as a conflict. That file has no
// section boundary to draw — it discusses `terminal_review` throughout — so five names hold it.
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

const bodyOf = (relPath: string): string => stripFrontmatter(readVariant(relPath));

/** The subsection of `§V.final-verify` whose heading declares this requirement as its owner. */
const terminalSection = (body: string): string => ownedSubsections(body, "final-verify").find((sub) => sub.owner === "FR-FLOW-155")?.text ?? "";

/** The subsection FR-FLOW-131 owns, read only to place a probe OUTSIDE the compared one. */
const reviewHop = (body: string): { start: number; end: number } | null => {
  const sub = ownedSubsections(body, "final-verify").find((entry) => entry.owner === "FR-FLOW-131");
  return sub === undefined ? null : { start: sub.start, end: sub.end };
};

const GOLDEN_PATH = path.resolve(__dirname, "orchestrate-validate-wiring.fr-flow-155.golden.md");

/** ENOENT-to-empty-string, the convention `readVariant` already uses: a deleted golden must fail as an
 * assertion naming the fixture, not as a thrown ENOENT at import that reads like a broken harness. */
const GOLDEN = ((): string => {
  try {
    return normaliseEol(readFileSync(GOLDEN_PATH, "utf8"));
  } catch {
    return "";
  }
})();

it("the byte comparison AC-3 requires is declared here too, so deleting the suite that runs it is loud", () => {
  // AC-3 requires the subsection this requirement owns to be held byte-exact against a golden, and
  // after FR-FLOW-157 that comparison lives in another file. Deleting or stubbing that file would
  // release the clause with every assertion here still green — the exact hole the ledger closes by
  // declaring its rule_id set in two files. This is that second declaration for the comparison.
  const suitePath = path.resolve(__dirname, "final-verify-section-split.fr-flow-157.test.ts");
  const suite = ((): string => {
    try {
      return readFileSync(suitePath, "utf8");
    } catch {
      return "";
    }
  })();
  expect(suite, `${path.basename(suitePath)} holds AC-3's byte comparison and is missing`).not.toBe("");
  expect(suite.includes(path.basename(GOLDEN_PATH)), `${path.basename(suitePath)} no longer reads this requirement's golden`).toBe(true);
  expect(suite.includes("FR-FLOW-157 AC-2"), `${path.basename(suitePath)} no longer declares the criterion that holds the comparison`).toBe(true);
  expect(suite.includes("matches the golden byte for byte"), `${path.basename(suitePath)} no longer compares a rendering against the golden`).toBe(true);
});

it("the corpus is not empty — four renderings, or every assertion below is vacuous", () => {
  // `describe.each([])` registers nothing and reports green. The mirror is generated from `codex`
  // and is NOT excluded for this skill, so four is the number; kiwi-wave-master's three-copy rule
  // does not apply here.
  expect(COPIES).toHaveLength(4);
  for (const copy of COPIES) {
    expect(terminalSection(bodyOf(copy)), `${copy}: the terminal-line section of §V.final-verify must exist for this suite to read anything`).not.toBe("");
  }
});

it("the golden still says the thing it is holding, so gutting it cannot buy a green", () => {
  // FR-FLOW-157's comparison is symmetric: emptying the golden AND the four bodies would satisfy it.
  // The presence assertions read the bodies, so they close half of that; this closes the other half by
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
    const section = terminalSection(bodyOf(copy));
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
  it("names the MCP tool in the section that owns the terminal line", () => {
    const section = terminalSection(bodyOf(copy));
    expect(
      /orchestrate_validate|orchestrate validate/.test(section),
      `${copy}: the section describes a refusal it never tells anyone to obtain`
    ).toBe(true);
  });

  it("puts the call within one window AFTER the terminal-review contract it guards", () => {
    // Distance from the contract paragraph, not from any `terminal_review` token: the instruction
    // writes that token itself, so keying on it would make this assertion measure the paragraph's
    // own integrity and pass for a paragraph parked at the end of the section.
    const section = terminalSection(bodyOf(copy));
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
    const section = terminalSection(bodyOf(copy));
    expect(
      tiedTogether(section, CALL, [GATE], WINDOW_RADIUS),
      `${copy}: the call must sit within ${WINDOW_RADIUS} chars of the gate it raises`
    ).toBe(true);
  });

  it("states what is called: the MCP tool with its arguments, the CLI fallback, strict, and the wave-master engine flag", () => {
    // `orchestrate validate` defaults `--engine` to `kiwi-orchestrator`, so a wave-master journal
    // validated without the flag reports a clean run over zero lines — the same empty-candidate-set
    // failure the append path had. An instruction that omits the flag reproduces it at the CLI.
    const section = terminalSection(bodyOf(copy));
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
    const section = terminalSection(bodyOf(copy));
    expect(
      tiedTogether(section, CALL, [MCP_NOT_FOR_WAVE_MASTER, CLI_ONLY_FOR_WAVE_MASTER], WINDOW_RADIUS),
      `${copy}: the instruction must route the wave-master journal to the CLI and say why`
    ).toBe(true);
  });

  it("states when it is called", () => {
    const section = terminalSection(bodyOf(copy));
    expect(
      tiedTogether(section, CALL, [WHEN], WINDOW_RADIUS),
      `${copy}: "run this at some point" is not an instruction anyone can be found not to have followed`
    ).toBe(true);
  });

  it("states what happens on refusal: halt on the gate, and do not rewrite the terminal line", () => {
    // Without the second half the obvious response to a refusal is to edit the line until it is
    // accepted, which converts a refused judgement into a recorded pass.
    const section = terminalSection(bodyOf(copy));
    expect(
      tiedTogether(section, CALL, [GATE, NO_REWRITE], WINDOW_RADIUS),
      `${copy}: the refusal branch must name the gate and forbid rewriting the line`
    ).toBe(true);
  });

  it("never permits, inside the section it owns, what the refusal branch forbids", () => {
    // Every assertion above is a presence check, and presence survives inversion: the paragraph can
    // be rewritten to say "ignore the diagnostic and rewrite the line until it is accepted" while
    // still carrying `orchestrate_validate`, `terminal-review-loop-missing` and the very words
    // `종료 줄을 다시 쓰지 않는다` inside a clause that retires them. It can also be left untouched
    // with a permitting sentence appended below it. Both land the same thing in the journal — a pass
    // nobody obtained — so both are refused here rather than only the deletions.
    //
    // Scoped to the section this requirement owns. It used to read the whole of §V.final-verify,
    // which is text FR-FLOW-131 owns for its first half; the heading FR-FLOW-157 added is what draws
    // that line now, and reading past it would be the same overreach the closed vocabulary was.
    // Inside this section the byte comparison already refuses both shapes, so these two bans are the
    // rule stated directly rather than the cover — the cover is the golden.
    const section = terminalSection(bodyOf(copy));
    expect(section, `${copy}: the section must be non-empty for this assertion to mean anything`).not.toBe("");
    const permits = REWRITE_PERMITTED.exec(section);
    expect(permits?.[0] ?? null, `${copy}: the terminal line is rewritten in a section that forbids rewriting it`).toBe(null);
    const retracts = RULE_RETRACTED.exec(section);
    expect(retracts?.[0] ?? null, `${copy}: the section retires its own refusal rule`).toBe(null);
  });

  it("gives the instruction unhedged", () => {
    const sentence = terminalSection(bodyOf(copy))
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
  // boundary is executed. The probe is a permission phrased the way NEITHER polarity ban can see it —
  // the terminal line named by pronoun (the rewrite ban is subject-scoped) and the act by a verb
  // outside the closed list — and it is placed once inside the compared section and once outside it.
  //
  // The earlier probe sentence was `다만 진단이 반복되면 그 줄을 덮어쓴다.` and it no longer evades:
  // `덮어쓴다` is now in the verb list. What survives is narrower and worth seeing plainly — a
  // sentence with no antecedent for either `그 줄` or `거부`.
  const EVASIVE = "다만 거부가 반복되면 그 줄을 손본다.";

  it("catches the evasive permission when it lands inside the section, because the section is compared and not read", () => {
    // Spliced into the golden rather than into a body, so the probe measures the mechanism and
    // nothing else. Built from a body, it would turn red for every edit anywhere in the section and
    // stop being a statement about where the cover ends.
    const spliced = GOLDEN.replace(NO_REWRITE, `${NO_REWRITE.source} ${EVASIVE}`);
    expect(spliced, "the splice did not change the golden, so this proves nothing").not.toBe(GOLDEN);
    expect(REWRITE_PERMITTED.test(spliced), "if the ban had caught it, this probe would be measuring the wrong thing").toBe(false);
    expect(RULE_RETRACTED.test(spliced), "same").toBe(false);
    expect(normaliseEol(spliced), "an appended sentence inside the compared section must not compare equal").not.toBe(GOLDEN);
  });

  it.each(COPIES)("%s: does NOT catch it in the section FR-FLOW-131 owns, which is exactly how far the cover reaches", (copy) => {
    // Red here means someone widened the cover — the golden's extent or the bans' scope. That is a
    // good change and this assertion is the last thing to update, not the reason to stop. What it
    // must never do is stay green while AC-4 claims the gap was closed.
    //
    // Spliced into a body rather than a fixture, because after the split the outside IS a real
    // section of a real file: the price FR-FLOW-157 AC-5 records is that the review hop joined
    // `§V.emit-and-finish` and `§V.halt` in the set nothing compares.
    const body = bodyOf(copy);
    expect(terminalSection(body), `${copy}: the baseline must be green for this measurement to mean anything`).toBe(GOLDEN);
    const hop = reviewHop(body);
    expect(hop, `${copy}: the review-hop section must exist for this probe to have an outside to land in`).not.toBeNull();
    const planted = `${body.slice(0, hop!.end)}\n${EVASIVE}\n${body.slice(hop!.end)}`;
    expect(planted, "the plant changed nothing, so this proves nothing").not.toBe(body);
    const section = terminalSection(planted);
    expect(section, "the plant landed inside the compared section, so it is not testing the outside").toBe(GOLDEN);
    expect(REWRITE_PERMITTED.test(section), "the rewrite ban").toBe(false);
    expect(RULE_RETRACTED.test(section), "the retraction ban").toBe(false);
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
  //
  // `PROCEDURE_NOUNS` is defined in `kiwi-orchestrator-variants.ts` rather than here, because
  // FR-FLOW-158 reads the same five names over every file under `_shared/kiwi/` and two spellings of
  // one rule is two rules. Narrowing it narrows both corpora at once, which is the point: the
  // requirement each serves says what the set is, and neither suite may shrink it privately.
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
      `${copy}: the event SSOT names ${JSON.stringify(spoken)}. This file defines the journal's schema and §0.1 of kiwi-orchestrator defers to it for that; the procedure around the terminal line — when it is validated, by which caller, and what happens on refusal — belongs to the terminal-line section of §V.final-verify, where a golden holds it byte-exact. A rule stated here is a rule stated where nothing compares it, in the file an agent reads as authoritative. Move the sentence into that section and re-copy the golden.`
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
  // Naming the six rules here puts that deletion in front of a second file whose subject is the
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
        `skills/${variant}: FR-FLOW-155's clause rows in orchestrator-mutation-ledger.json are ${JSON.stringify([...mine].sort())}. Each of the six names one normative clause of the terminal-line section of §V.final-verify and pins its bytes. Deleting a row — or the OWNED_RULES entry that declares them — releases that clause to be inverted with an edit to the body and the golden alone. If a clause was genuinely retired, retire it in the requirement first.`
      ).toEqual([...OWNED].sort());
    }
  });
});
