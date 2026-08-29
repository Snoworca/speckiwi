import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OwnedSubsection } from "./kiwi-orchestrator-variants.js";
import {
  ORCHESTRATOR_MIRROR,
  ORCHESTRATOR_VARIANTS,
  SUBSECTION_OWNER,
  normaliseEol,
  ownedSubsections,
  readVariant,
  stripFrontmatter,
  verbSection
} from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-157 AC-1 — §V.final-verify is two sections, each naming the requirement that owns it,
// and no prose sits outside the two, so every byte of the section has an owner.
// @req FR-FLOW-157 AC-2 — the terminal-line section is held byte-exact from its heading to its end.
// @req FR-FLOW-157 AC-3 — no lexical rule over text FR-FLOW-131 owns survives; the seven edits the
// closed vocabulary refused are measured green here rather than recorded as a claim.
// @req FR-FLOW-157 AC-4 — the six clauses the ledger names are still refused when inverted inside the
// new section, and the rows point at that section.
// @req FR-FLOW-157 AC-5 — where the boundary stops covering, executed rather than described.
//
// ─── WHY A SECTION BOUNDARY AND NOT A WIDER GOLDEN ──────────────────────────────────────────────
// `§V.final-verify` carried two subjects while two requirements owned it. FR-FLOW-131 owns the
// run-window review hop — its AC-7/AC-8/AC-10 read exactly that text — and FR-FLOW-155 owns the
// terminal line and the validator that judges it. No byte comparison could be drawn across the
// whole section: freezing it would have failed FR-FLOW-131's own edits under a message about a
// terminal-line contract, and freezing half of it left the other half to lexical rules. Those rules
// were measured on both sides and both measurements pointed here. They closed SPELLINGS rather than
// the subject — `mcp`, the full-width `ＭＣＰ`, `orchestrate-validate`, `run_id` and four
// plain-Korean inversions each carried a contradiction past every assertion — while costing
// FR-FLOW-131 seven of seven legitimate edits, one of them adding `--strict-grounding`, a flag this
// same skill defines in its own options table.
//
// So the boundary is a heading. Each subsection names its owner in its own text, and the one
// FR-FLOW-155 owns is compared whole. An edit is then judged by the requirement that owns the
// section it landed in, which is what the vocabulary was trying to approximate.
//
// ─── MEASURED BEFORE THE SPLIT ─────────────────────────────────────────────────────────────────
// One section of 1924 characters in which the compared span began at offset 832 — 43.2% of it read
// by no byte comparison. Measured through `verbSection`, which is what the suites read. AC-1 first
// recorded 1925; that was an off-by-one and the criterion now carries the measured value.
//
// The first split then left 112 characters above BOTH `####` headings — the recovery class, the
// phase, the loop denominator — owned by neither requirement and read by nothing: a retraction
// planted there was green in all four renderings. That line now sits under the first heading, and
// AC-1 requires that no prose sit outside the two subsections at all.

const COPIES = [...ORCHESTRATOR_VARIANTS.map((variant) => variant.relPath), ORCHESTRATOR_MIRROR];

const GOLDEN_PATH = path.resolve(__dirname, "orchestrate-validate-wiring.fr-flow-155.golden.md");
const LEDGER_PATH = path.resolve(__dirname, "orchestrator-mutation-ledger.json");

const bodyOf = (copy: string): string => stripFrontmatter(readVariant(copy));

/** The subsection a requirement id declares itself the owner of, or `null`. */
const ownedBy = (body: string, requirement: string): OwnedSubsection | null =>
  ownedSubsections(body, "final-verify").find((sub) => sub.owner === requirement) ?? null;

const terminalText = (body: string): string => ownedBy(body, "FR-FLOW-155")?.text ?? "";

/** ENOENT-to-empty-string: a deleted golden must fail as an assertion naming the fixture. */
const GOLDEN = ((): string => {
  try {
    return normaliseEol(readFileSync(GOLDEN_PATH, "utf8"));
  } catch {
    return "";
  }
})();

/**
 * Add one paragraph at the END of the subsection a requirement owns, leaving every other byte alone.
 *
 * Anchored on the section boundary and on NOTHING the section says. The first draft of these probes
 * quoted a sentence of the review hop and required it to occur exactly once — which is a lexical
 * rule over text FR-FLOW-131 owns, the very thing AC-3 says must not survive. Rewording the hop
 * would have turned this file red under a message about a boundary the reword did not touch. What
 * the probes measure is that a token appearing anywhere in that section does not move the compared
 * one, and position within the section is irrelevant to that.
 */
function appendToSection(body: string, requirement: string, paragraph: string): string {
  const sub = ownedBy(body, requirement);
  if (sub === null) return body;
  return `${body.slice(0, sub.end)}${paragraph}\n\n${body.slice(sub.end)}`;
}

/**
 * Replace quoted bytes INSIDE the subsection a requirement owns.
 *
 * Quoting is legitimate here and not in `appendToSection`'s callers: its only caller quotes the
 * ledger's `mutation.find`, which the ledger suite already requires to resolve exactly once in the
 * body, and which the golden pins byte for byte. A reword that breaks the quote breaks the row too,
 * and the row is where that failure belongs.
 */
function replaceInside(body: string, requirement: string, find: string, replace: string): string {
  const sub = ownedBy(body, requirement);
  if (sub === null) return body;
  const region = body.slice(sub.start, sub.end);
  const occurrences = region.split(find).length - 1;
  expect(occurrences, `the probe text ${JSON.stringify(find.slice(0, 40))} occurs ${occurrences} times inside the section ${requirement} owns`).toBe(1);
  return body.slice(0, sub.start) + region.replace(find, replace) + body.slice(sub.end);
}

describe("FR-FLOW-157 AC-1 — §V.final-verify is two sections and each names its owner", () => {
  it("reads four renderings, or every assertion below is vacuous", () => {
    expect(COPIES).toHaveLength(4);
    for (const copy of COPIES) expect(verbSection(bodyOf(copy), "final-verify"), `${copy}: §V.final-verify must exist`).not.toBe("");
  });

  it("the owner tag is a statement of ownership, not a heading that merely cites a requirement", () => {
    // AC-1 requires the ownership to be stated in the section's own text rather than inferred from
    // the requirement that reads it. `SUBSECTION_OWNER` is the only thing holding that `소유한다`
    // clause, and every assertion above consumes the regex without reading it: dropping the clause
    // would leave a heading that merely cites `FR-FLOW-155` passing as a declaration of ownership,
    // and nothing in this repository would have gone red.
    const declares = "#### run 종료 줄과 그것을 판정하는 검증기 — 이 절이 진술하는 규칙은 `FR-FLOW-155` 가 소유한다";
    const cites = "#### run 종료 줄과 그것을 판정하는 검증기 — `FR-FLOW-155` 의 계약을 여기서 설명한다";
    expect(SUBSECTION_OWNER.exec(declares)?.[1], "a heading that declares an owner must resolve to that requirement").toBe("FR-FLOW-155");
    expect(SUBSECTION_OWNER.test(cites), "a heading that only cites a requirement must not read as a declaration of ownership").toBe(false);
  });

  it.each(COPIES)("%s: declares exactly two subsections, owned by FR-FLOW-131 then FR-FLOW-155", (copy) => {
    const subs = ownedSubsections(bodyOf(copy), "final-verify");
    expect(
      subs.map((sub) => sub.heading),
      `${copy}: §V.final-verify must be split into two subsections — the run-window review hop and the terminal line with the validator that judges it. One section carrying both subjects is what no byte comparison could be drawn across.`
    ).toHaveLength(2);
    expect(
      subs.map((sub) => sub.owner),
      `${copy}: each subsection must name the requirement that owns it in its own heading, so a later edit is judged by the requirement that owns the section it landed in rather than by whichever suite happens to read it.`
    ).toEqual(["FR-FLOW-131", "FR-FLOW-155"]);
  });

  it.each(COPIES)("%s: no prose sits above the first subsection, so every byte of the section has an owner", (copy) => {
    // The first split left the section's opening line — its recovery class, its phase and the loop's
    // denominator — above both `####` headings. `ownedSubsections` counts `####` blocks, so that text
    // was owned by neither requirement, held by no comparison, and absent from AC-5's list of what
    // the boundary does not reach: a sentence retracting this section's rules planted there was
    // green in all four renderings. Ownership is what AC-1 buys, and a byte outside both subsections
    // does not have it. Derived from the body rather than from a literal, so a preamble reintroduced
    // later fires here instead of being swept past.
    const lines = verbSection(bodyOf(copy), "final-verify").split("\n");
    const firstHeading = lines.findIndex((line, index) => index > 0 && /^####\s/.test(line));
    const preamble = lines.slice(1, firstHeading === -1 ? lines.length : firstHeading);
    expect(
      preamble.filter((line) => line.trim() !== ""),
      `${copy}: §V.final-verify carries prose above its first \`####\` heading. Neither requirement owns it and no comparison reads it — move it under the subsection that should own it rather than leaving the section with an unowned head.`
    ).toEqual([]);
  });

  it.each(COPIES)("%s: the terminal-line section begins at the terminal-review contract signature", (copy) => {
    // The signature the golden already keyed on. Before the split it sat 832 characters into the
    // section; the boundary is drawn at exactly that sentence so the compared text is unchanged and
    // only its extent moves.
    const CONTRACT = /`terminal_review \{skill, base, head, verdict\}`/;
    const body = bodyOf(copy);
    const terminal = ownedBy(body, "FR-FLOW-155");
    const hop = ownedBy(body, "FR-FLOW-131");
    expect(terminal, `${copy}: no subsection declares FR-FLOW-155 as its owner`).not.toBeNull();
    expect(hop, `${copy}: no subsection declares FR-FLOW-131 as its owner`).not.toBeNull();
    const firstProse = terminal!.text.split("\n").slice(1).find((line) => line.trim() !== "") ?? "";
    expect(CONTRACT.test(firstProse), `${copy}: the terminal-line section must open on the contract paragraph, not on prose placed above it`).toBe(true);
    expect(CONTRACT.test(hop!.text), `${copy}: the contract signature must not remain in the review-hop section`).toBe(false);
  });
});

describe("FR-FLOW-157 AC-2 — the terminal-line section is held byte-exact from its heading to its end", () => {
  it("the golden is a whole section and still says what it holds, so gutting it cannot buy a green", () => {
    // The comparison is symmetric: emptying the golden AND the four bodies would satisfy it.
    expect(GOLDEN, `the golden fixture ${path.basename(GOLDEN_PATH)} is empty`).not.toBe("");
    expect(/^####\s/.test(GOLDEN), "the golden must begin at the section heading, not partway into the section").toBe(true);
    expect(SUBSECTION_OWNER.exec(GOLDEN.split("\n")[0] as string)?.[1], "the golden's own heading must declare FR-FLOW-155 as owner").toBe("FR-FLOW-155");
  });

  it.each(COPIES)("%s: matches the golden byte for byte", (copy) => {
    expect(
      terminalText(bodyOf(copy)),
      `${copy}: the terminal-line section of §V.final-verify no longer matches ${path.basename(GOLDEN_PATH)}. This says the contract text moved, not that the rule broke. Read the diff as an edit under review: if it changes what an agent is told to do about the terminal line, that is the finding; if it does not, re-copy the section into the golden and re-read FR-NODE-199 AC-4, which turns on the grounding sentence in this paragraph.`
    ).toBe(GOLDEN);
  });

  // The three shapes AC-2 names, each measured separately rather than inferred from the fact that a
  // comparison exists. Each is planted in a BODY and read back through the path the live assertion
  // uses — `ownedSubsections`, then `normaliseEol`, then the comparison — so an extraction that grew
  // a habit of swallowing one of the shapes fires here. An earlier draft spliced the FIXTURE
  // instead, which measured JavaScript's string inequality and touched none of that path: deleting a
  // non-empty substring always shortens a string, so two of the three could not have failed.
  const plantInBody = (copy: string, find: string, replace: string): string => {
    const body = bodyOf(copy);
    expect(terminalText(body), `${copy}: the baseline must be green for a planted edit to mean anything`).toBe(GOLDEN);
    expect(body.split(find).length - 1, `${copy}: the probe must quote exactly one occurrence of ${JSON.stringify(find.slice(0, 40))}`).toBe(1);
    return body.replace(find, replace);
  };

  it.each(COPIES)("%s: a deleted sentence is refused", (copy) => {
    const SENTENCE = " 그 저널은 CLI 로만 검증하며 `--engine kiwi-wave-master` 를 함께 준다.";
    expect(terminalText(plantInBody(copy, SENTENCE, "")), `${copy}: deleting a whole sentence from the compared section must be refused`).not.toBe(GOLDEN);
  });

  it.each(COPIES)("%s: an appended permitting sentence is refused", (copy) => {
    // Carries no banned verb and no retraction word: this is the shape a lexical rule cannot see and
    // the byte comparison can. It is why the comparison is the cover and the bans are not.
    const body = bodyOf(copy);
    expect(terminalText(body), `${copy}: the baseline must be green for a planted edit to mean anything`).toBe(GOLDEN);
    const appended = appendToSection(body, "FR-FLOW-155", "다만 거부가 반복되면 그 줄을 손본다.");
    expect(appended, `${copy}: the plant changed nothing, so this proves nothing`).not.toBe(body);
    expect(terminalText(appended), `${copy}: a permitting sentence appended inside the compared section must be refused`).not.toBe(GOLDEN);
  });

  it.each(COPIES)("%s: two sentences reordered without changing a byte of either is refused", (copy) => {
    const A = "복구: 라운드를 다시 한다.";
    const B = "게이트: `final-verify-residual-critical` · `wave-append-cap-exhausted`.";
    const reordered = terminalText(plantInBody(copy, `${A}\n${B}`, `${B}\n${A}`));
    expect(reordered, `${copy}: a pure reorder inside the compared section must be refused`).not.toBe(GOLDEN);
    // Proof that it IS a pure reorder: the same characters, in a different order. Without this the
    // probe could be passing because the plant quietly changed a byte.
    expect([...reordered].sort().join(""), `${copy}: the reorder probe changed more than the order`).toBe([...GOLDEN].sort().join(""));
  });
});

/**
 * The seven edits the closed vocabulary refused, each of them legitimate text FR-FLOW-131 owns.
 *
 * All seven were measured red before the split — `--strict-grounding` against `/strict/`,
 * `kiwi-wave-master` against `/wave-master/`, `orchestrate_round_record` against `/MCP/`, and the
 * bare nouns `진단`, `검증`, `--run-id` and `CLI` against their own entries. None of the seven says
 * anything about the terminal line, and the failure message forbade both available repairs at once —
 * it named the noun list and the sentence, so the two available repairs were renaming this skill's
 * own flag and widening the list.
 *
 * Carried as the SENTENCE each edit would add rather than as a find/replace over the hop's current
 * wording, so this file quotes nothing FR-FLOW-131 may reword. Each is appended as the section's
 * last paragraph; where inside the section it lands is irrelevant to what is being measured, because
 * the vocabulary it replaces read the whole half.
 */
const REVIEW_HOP_EDITS: Array<[string, string]> = [
  ["adds --strict-grounding to the hop's argument fence", "이 홉은 `--strict-grounding` 을 함께 준다."],
  ["names kiwi-wave-master's wave-window convention for contrast", "`kiwi-wave-master` 는 wave 창마다 따로 홉을 돈다."],
  ["records the round through the MCP tool orchestrate_round_record", "이 홉의 라운드는 MCP `orchestrate_round_record` 로 남긴다."],
  ["calls the review's output 진단", "이 홉이 낸 진단은 다음 라운드의 입력이다."],
  ["calls a child's regression result 검증", "자식이 돌린 회귀 검증 결과를 그대로 받는다."],
  ["passes --run-id {run_id} on resume", "재개할 때에는 `--run-id {run_id}` 를 함께 준다."],
  ["names the CLI as the fallback when the Skill call is unavailable", "Skill 호출을 쓸 수 없으면 CLI 로 같은 홉을 돈다."]
];

describe("FR-FLOW-157 AC-3 — an edit to the text FR-FLOW-131 owns does not move the compared section", () => {
  it("carries all seven edits AC-3 enumerates", () => {
    // AC-3 states seven as an explicit denominator, so the denominator is frozen here. Deleting an
    // entry would shrink the run from 28 cases to 24 and stay green — the shape this repository has
    // been caught by before, and the reason `COPIES` and `OWNED` each carry a count of their own.
    expect(REVIEW_HOP_EDITS, "AC-3 enumerates seven edits; this list is that denominator").toHaveLength(7);
    expect(new Set(REVIEW_HOP_EDITS.map(([what]) => what)).size, "two entries describe the same edit, so the seven are not seven").toBe(7);
  });

  it.each(COPIES.flatMap((copy) => REVIEW_HOP_EDITS.map((edit) => [copy, ...edit] as [string, string, string])))(
    "%s: %s",
    (copy, _what, paragraph) => {
      const body = bodyOf(copy);
      // Without this the assertion below reports a pre-existing drift of the compared section as an
      // edit that crossed the boundary — the opposite of the cause — because a drifted baseline makes
      // every one of these probes fail on a comparison neither the probe nor the boundary touched.
      expect(terminalText(body), `${copy}: the baseline must be green for this measurement to mean anything`).toBe(GOLDEN);
      const edited = appendToSection(body, "FR-FLOW-131", paragraph);
      expect(edited, "the edit changed nothing, so it measures nothing").not.toBe(body);
      expect(
        ownedBy(edited, "FR-FLOW-131")?.text.includes(paragraph),
        `${copy}: the probe must land inside the section FR-FLOW-131 owns, or it measures the wrong boundary`
      ).toBe(true);
      expect(
        terminalText(edited),
        `${copy}: an edit inside the section FR-FLOW-131 owns changed the section FR-FLOW-155 owns. The boundary is the heading; if this fires, the two subjects are sharing a section again.`
      ).toBe(GOLDEN);
    }
  );
});

describe("FR-FLOW-157 AC-5 — where the boundary stops covering, executed rather than described", () => {
  // (a) A whole-section golden reads one section. `§V.emit-and-finish` and `§V.halt` were already
  // outside it, and after the split the review-hop section JOINS them: a sentence there saying the
  // terminal line's validation is optional is compared by nothing. That is the price of drawing the
  // boundary at a section rather than at a vocabulary, and it is asserted here so the next reader
  // meets it as a measurement instead of finding it in a run that passed while doing nothing.
  //
  // (b) Nothing here observes a run, so an agent that reads the instruction and does not call the
  // tool is not caught; that limit is FR-FLOW-155 AC-4's and is unchanged. (c) `_shared/kiwi/**` is
  // FR-FLOW-158's. (d) The coordinated edit is not closed: changing the body and the golden together
  // still lands, and a ledger row raises that to four file kinds — measured, the fourth being the
  // contract test itself — and only for the clause the row names.
  const RETRACTION = "이 절의 검증 규칙은 더 이상 적용되지 않는다.";

  /**
   * A second mention of the tool, spelled differently from the one the golden freezes.
   *
   * FR-FLOW-155 removed `exactly one line may name the tool inside §V.final-verify` — a proxy for
   * `no second, differing spelling` — on the stated ground that the front half was closed on eleven
   * nouns. This requirement removed those nouns, so that ground went with them. The loss belongs in
   * the same list as the retraction and is measured the same way rather than reasoned about.
   */
  const SECOND_SPELLING = "이 홉의 결과를 `orchestrate-validate` 가 판정하지는 않는다.";

  it.each(COPIES)("%s: a retraction placed in the review-hop section is compared by nothing", (copy) => {
    const body = bodyOf(copy);
    expect(terminalText(body), `${copy}: the baseline must be green for this measurement to mean anything`).toBe(GOLDEN);
    const planted = appendToSection(body, "FR-FLOW-131", RETRACTION);
    expect(planted, "the plant changed nothing, so this proves nothing").not.toBe(body);
    expect(terminalText(planted), `${copy}: red here means the cover was widened past one section — a good change, and this assertion is the last thing to update`).toBe(GOLDEN);
  });

  it.each(COPIES)("%s: a second, differently-spelled mention of the tool in the review-hop section is compared by nothing", (copy) => {
    const body = bodyOf(copy);
    expect(terminalText(body), `${copy}: the baseline must be green for this measurement to mean anything`).toBe(GOLDEN);
    const planted = appendToSection(body, "FR-FLOW-131", SECOND_SPELLING);
    expect(planted, "the plant changed nothing, so this proves nothing").not.toBe(body);
    expect(terminalText(planted), `${copy}: red here means the cover was widened past one section — a good change, and this assertion is the last thing to update`).toBe(GOLDEN);
  });

  it.each(COPIES)("%s: a retraction placed in §V.emit-and-finish is compared by nothing", (copy) => {
    const body = bodyOf(copy);
    expect(terminalText(body), `${copy}: the baseline must be green for this measurement to mean anything`).toBe(GOLDEN);
    const anchor = "### §V.emit-and-finish";
    expect(body.includes(anchor), `${copy}: the neighbouring section must exist for this to measure anything`).toBe(true);
    const planted = body.replace(anchor, `${anchor}\n\n${RETRACTION}`);
    expect(terminalText(planted), `${copy}: a whole-section golden reads one section`).toBe(GOLDEN);
  });
});

interface LedgerRow {
  variant: string;
  rule_id: string;
  owning_requirement: string;
  sentence: string;
  mutation: { find: string; replace: string };
}

describe("FR-FLOW-157 AC-4 — the clauses the split moves are not weakened by moving", () => {
  const OWNED = [
    "R-FINAL-VERIFY-CLI-IS-THE-FALLBACK-WHEN-MCP-IS-ABSENT",
    "R-FINAL-VERIFY-ORCHESTRATOR-JOURNAL-IS-VALIDATED-WITH-RUN-ID-AND-STRICT",
    "R-FINAL-VERIFY-REFUSAL-HALTS-WITHOUT-REWRITING-THE-TERMINAL-LINE",
    "R-FINAL-VERIFY-TERMINAL-LINE-IS-PUT-THROUGH-THE-VALIDATOR-IMMEDIATELY",
    "R-FINAL-VERIFY-WAVE-MASTER-JOURNAL-CARRIES-THE-ENGINE-FLAG",
    "R-FINAL-VERIFY-WAVE-MASTER-JOURNAL-IS-NOT-VALIDATED-OVER-MCP"
  ];
  const LEDGER = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerRow[];
  const rowsFor = (variant: string): LedgerRow[] => LEDGER.filter((row) => row.variant === variant && row.owning_requirement === "FR-FLOW-155");

  it.each(ORCHESTRATOR_VARIANTS.map((variant) => variant.id))("%s: the six rows survive the split and point at the section that now holds them", (variant) => {
    const rows = rowsFor(variant);
    expect(
      rows.map((row) => row.rule_id).sort(),
      `skills/${variant}: the split must re-point FR-FLOW-155's ledger rows, not delete them — a clause released by deleting its row is released more quietly than one released by editing it`
    ).toEqual([...OWNED].sort());
    const title = ownedBy(bodyOf(`skills/${variant}/kiwi-orchestrator/SKILL.md`), "FR-FLOW-155")?.title ?? "";
    expect(title, `skills/${variant}: the terminal-line section must have a title for a row to point at`).not.toBe("");
    for (const row of rows) {
      expect(
        row.sentence.startsWith(`§V.final-verify > ${title} — `),
        `skills/${variant}/${row.rule_id}: the row still names the undivided section. Point it at ${JSON.stringify(title)}, which is where the clause it pins now lives.`
      ).toBe(true);
    }
  });

  it.each(ORCHESTRATOR_VARIANTS.map((variant) => variant.id))("%s: each clause is inside the compared section and its inversion is refused there", (variant) => {
    const copy = `skills/${variant}/kiwi-orchestrator/SKILL.md`;
    const body = bodyOf(copy);
    expect(terminalText(body), `${copy}: the baseline must be green for an inversion to mean anything`).toBe(GOLDEN);
    const rows = rowsFor(variant);
    // Without this floor an empty result passes the loop below vacuously, and the six inversions this
    // criterion is about would go unmeasured while the test reported green.
    expect(rows, `${copy}: the ledger must carry a row for each of the six clauses, or the loop below asserts nothing`).toHaveLength(OWNED.length);
    for (const row of rows) {
      const inverted = replaceInside(body, "FR-FLOW-155", row.mutation.find, row.mutation.replace);
      expect(inverted, `${row.rule_id}: the mutation changed nothing`).not.toBe(body);
      expect(
        terminalText(inverted),
        `${copy}/${row.rule_id}: inverting this clause inside the new section is NOT refused. The split moved the clause out from under the comparison that held it.`
      ).not.toBe(GOLDEN);
    }
  });
});
