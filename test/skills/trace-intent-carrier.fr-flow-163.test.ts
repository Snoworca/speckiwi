import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { toolSchemas } from "../../src/mcp/server.js";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, enclosingSection, markdownFiles, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-163 — `trace_intent` is a field the skills invented and no tool declares. What this
// file checks is not the value but the ROUTING: wherever a rendering names the field, it must also
// name the shipped argument the value is encoded into, and that argument must be one the schema
// actually has.
//
// The field name is written here as a literal, and that is deliberate rather than an oversight of
// the no-second-copy rule FR-FLOW-162 established. A literal under `src/` restated here would be a
// copy that can drift; `trace_intent` is the opposite — nothing under `src/` declares it at all
// (`grep -rn "trace_intent\|traceIntent" src/` returns no line), so there is no first copy for this
// one to drift from. What AC-2 asserts is the narrower half of that: `add_trace_link` does not
// declare the field under either spelling, which is the half that would retire this rule. The name
// is the subject of the requirement, not a duplicated answer to it.
//
// WHAT THIS FILE DOES NOT HOLD:
//  - The judge asks whether SOME declared argument is named, not whether the RIGHT one is. Which
//    argument carries the value is a skill-side decision, and code holds no fact to check it
//    against; swapping `notes` for another declared name passes the judge. AC-8's byte golden is
//    what bounds that — the swap lands in the diff a reader has to approve.
//  - The judge also accepts an argument name that is on the line for an unrelated reason. Measured:
//    deleting the destination sentence from `kiwi-srs` §0.14 while leaving its `id` · `type` ·
//    `reference` · `relation` enumeration in place passed the judge, and only the golden reported
//    it. Eight of the twenty-eight sites are of that shape.
//  - A site is a PHYSICAL LINE. A rendering that rewraps the declaration across two lines drops
//    that site: the half carrying the field is judged, the half carrying the carrier is not, so the
//    rewrap reads as a violation. That false red is the deliberate trade — flattening first would
//    let a line lose its carrier into an adjacent one and still be counted, which is a false clean.
//  - AC-9's retraction reader is a closed vocabulary over the site's own section. A retraction
//    phrased outside that vocabulary, or placed in a NEIGHBOURING section, is not reached. Both
//    limits are measured rather than inferred, and the alternative — freezing the section's bytes
//    instead of scanning it — is priced in AC-9 and refused.
//  - This reads instruction text. A skill carrying the corrected line and an agent ignoring it are
//    not distinguished here.

/** The invented field, and the whole subject of this requirement. */
const FIELD = "trace_intent";

/**
 * The field named as a WHOLE word, which is how a site is recognised.
 *
 * A bare `includes` accepts a truncation of the name: measured, `trace_inten` selected the same
 * twenty-eight lines and left every assertion green while the suite was no longer checking any name
 * a skill uses. The boundaries make the literal above answer for itself in both directions —
 * lengthening it finds nothing (three axes red), shortening it finds nothing either.
 */
const FIELD_MENTION = new RegExp(`(?<![A-Za-z0-9_])${FIELD}(?![A-Za-z0-9_])`);

/** The tool whose argument list bounds where the field's value may be encoded. */
const TOOL = "add_trace_link";

/**
 * A carrier name no schema declares, for the probe that must be refused (AC-5/AC-7).
 *
 * Deliberately unusable as a real argument. AC-7 asserts it is genuinely absent from the fact, so
 * a schema that ever grew this name would report that rather than leave the probe passing quietly.
 */
const NO_SUCH_CARRIER = "carrier_no_schema_declares";

const SELF_PATH = "test/skills/trace-intent-carrier.fr-flow-163.test.ts";
const GOLDEN_PATH = "test/skills/trace-intent-carrier.fr-flow-163.golden.md";
const SEPARATOR = "\n=== trace_intent site ===\n";

/** The argument names the shipped tool declares, read off the live zod record (AC-1). */
function declaredArguments(): string[] {
  return Object.keys(toolSchemas[TOOL as keyof typeof toolSchemas] ?? {});
}

/**
 * Whether a line names an argument the way skill text names one: backticked, or as a `key:`.
 *
 * Both forms are recognised, because the corpus writes carriers both ways: prose says
 * ``intent 는 `notes` 안에 적는다`` and a call example says `notes: "..."`. Measured on this tree,
 * the backticked form alone would already report zero violations and the `key:` form alone would
 * report 24 of 28 sites — so the `key:` branch changes no verdict today and is here for the line
 * that carries only a call example, which a backtick-only rule would report as carrier-less while
 * the text in front of it says exactly where the value goes.
 */
function namesArgument(line: string, argument: string): boolean {
  const escaped = argument.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("`" + escaped + "`|\\b" + escaped + "\\s*:").test(line);
}

interface Site {
  /** `<rendering> · <skill>`, the bucket this site counts toward. */
  bucket: string;
  /** `path:line`, so a failure names a place rather than a number. */
  where: string;
  /** The file the site was read from, and the lines of it, for the section AC-9 scans. */
  path: string;
  lines: readonly string[];
  /** 0-based index of the site within `lines`. */
  index: number;
  text: string;
}

interface CorpusFile {
  rendering: string;
  path: string;
  lines: string[];
}

/**
 * Every markdown file of every shipped rendering plus the mirror, read once.
 *
 * Derived through `kiwi-renderings.ts` rather than listed: a literal root list is an inclusion test
 * one level above the corpus boundary, and whatever it omits is never swept.
 */
const CORPUS: CorpusFile[] = RENDERINGS.flatMap((rendering) =>
  markdownFiles(rendering).map((file) => ({ rendering, path: file, lines: readRepoFile(file).split("\n") }))
);

/** The skill a repo-relative path belongs to — the segment right below its rendering root. */
function skillOf(rendering: string, filePath: string): string {
  return filePath.slice(rendering.length + 1).split("/")[0] as string;
}

/** Every physical line naming the field, wherever it lives (AC-3). */
function sites(): Site[] {
  const found: Site[] = [];
  for (const file of CORPUS) {
    file.lines.forEach((line, index) => {
      if (!FIELD_MENTION.test(line)) return;
      found.push({
        bucket: `${file.rendering} · ${skillOf(file.rendering, file.path)}`,
        where: `${file.path}:${index + 1}`,
        path: file.path,
        lines: file.lines,
        index,
        text: line
      });
    });
  }
  return found;
}

/**
 * The sites that name the field without naming anywhere to put it (AC-4, AC-5).
 *
 * One judge answers both criteria. A line naming only an undeclared name — `intent`, or the field
 * itself — produces no carrier and is reported for the same reason a line naming nothing is: what
 * the reader is told to do with the value cannot be done.
 */
function violations(declared: readonly string[], candidates: readonly Site[]): string[] {
  return candidates
    .filter((site) => !declared.some((argument) => namesArgument(site.text, argument)))
    .map(
      (site) =>
        `${site.where}: names \`${FIELD}\` but no argument \`${TOOL}\` declares, so the value has nowhere to go — ${site.text.trim().slice(0, 110)}`
    );
}

/**
 * Phrases that cancel a rule while leaving every word of it standing (AC-9).
 *
 * Assembled from the retractions this repository has actually measured rather than invented:
 * FR-FLOW-161 recorded `참고 지표일 뿐이며 강제하지 않는다` and `낡은 규칙은 폐기한다`, FR-FLOW-162
 * recorded `위 규칙은 이번 판에서 폐기한다`, and `drive-mode.fr-flow-119.test.ts` holds a list of the
 * same shape for a different subject. That list is not imported: it guards `--drive` semantics
 * document-wide, this one guards one encoding rule section-wide, and a shared list would have to be
 * widened for either subject at the other's cost.
 *
 * A closed vocabulary closes spellings, not the subject — that is FR-FLOW-155's recorded lesson, and
 * it applies here unchanged. What bounds this one is that it is a SCAN and not a verdict on wording:
 * a paraphrase evades it, and that residual is stated in AC-9 rather than papered over.
 */
const RETRACTION =
  /폐기|강제되지 않는다|강제하지 않는다|참고 사항|참고 지표|적용하지 않는다|무시해도|구속력|권고일 뿐|실제 규칙(이)? 아님|더 이상 (유효|적용)하지 않/;

/**
 * The lines a retraction of a site's rule would be read as attached to: the site's own section.
 *
 * AC-8's golden freezes the site LINE, so the edit that survives it is a sentence placed BESIDE the
 * line rather than on it. Measured: inserting a blank line and
 * `다만 바로 위 문단의 인코딩 규칙은 이번 판에서 폐기하며, 참고 사항일 뿐 강제되지 않는다.` after the
 * `kiwi-coder` site left all eight tests green, because a site is a physical line and the inserted
 * line names no field. Markdown puts a following sentence on the next line far more often than on
 * the same one, so that is the natural form of the attack, not the exotic one.
 *
 * The boundary is a heading, taken from the shared `enclosingSection`, because that is the smallest
 * span in which a sentence still reads as being about the rule above it. A file with no heading
 * above the site has no smaller boundary to draw, so the file is the section.
 */
function sectionOf(site: Site): { from: number; to: number } {
  const span = enclosingSection(site.lines, site.index);
  return span === null ? { from: 0, to: site.lines.length } : { from: span.start, to: span.end };
}

/** The sites whose section also carries a sentence cancelling the rule (AC-9). */
function retractions(candidates: readonly Site[]): string[] {
  const found: string[] = [];
  for (const site of candidates) {
    const { from, to } = sectionOf(site);
    for (let index = from; index < to; index += 1) {
      const line = site.lines[index] as string;
      if (!RETRACTION.test(line)) continue;
      found.push(
        `${site.path}:${index + 1}: cancels the rule the site at ${site.where} states, with every token the judge reads left in place — ${line.trim().slice(0, 110)}`
      );
    }
  }
  return found;
}

/**
 * Measured on the tree with the fix in place, by the bucket census the AC-6 · AC-7 `it` builds:
 * 28 sites, 7 per rendering. `kiwi-planner` declares the sidecar field and maps it (2);
 * `kiwi-coder` owns the flattening and states the destination (1); `kiwi-srs` holds the encoding
 * rule, its status cap and two call examples (4).
 */
const PER_SKILL: Record<string, number> = { "kiwi-coder": 1, "kiwi-planner": 2, "kiwi-srs": 4 };

/** Every rendering crossed with every skill that owes a mention, so a new rendering cannot skip one. */
const FLOORS: Record<string, number> = Object.fromEntries(
  RENDERINGS.flatMap((rendering) => Object.entries(PER_SKILL).map(([skill, floor]) => [`${rendering} · ${skill}`, floor]))
);

/**
 * The census the requirement records, as the number the floor table itself must still add up to.
 *
 * Measured: lowering one skill's floor from 4 to 1 left all eight tests green. A floor only refuses
 * zero, so a floor table can be drained one number at a time and go on passing; comparing its TOTAL
 * against the recorded census is what refuses that. A floor, not an equality, because the tree grows.
 */
const CENSUS_SITES = 28;

/** What the golden must hold: the derived sites, keyed on the file with the line number stripped. */
function renderSites(): string {
  return sites()
    .map((site) => `${site.where.replace(/:\d+$/, "")}\n---\n${site.text.trim()}`)
    .join(SEPARATOR);
}

/**
 * Why the shipped lines and the golden disagree, empty when they are byte-identical (AC-8, AC-10).
 *
 * Takes the golden's READER rather than its text, and derives the other side itself, so the two
 * sides cannot be made the same value at the call site. Measured with the comparison written inline
 * as `expect(actual).toBe(golden)`: changing `golden` to `actual` left all eight tests green, and
 * the carrier swap this golden exists to catch became invisible while every other axis stayed green.
 * `expect(goldenDrift()).toEqual([])` has no argument to re-point, and a comparison neutered INSIDE
 * this function is answered by the probes in AC-10.
 */
function goldenDrift(read: (relPath: string) => string = readRepoFile): string[] {
  const actual = renderSites();
  const golden = read(GOLDEN_PATH);
  if (golden.length === 0) {
    return [
      `${GOLDEN_PATH} is missing or empty, so this comparison would be vacuous. The observed lines are in ${GOLDEN_PATH}.actual — read them, then copy the file into place.`
    ];
  }
  if (actual === golden) return [];
  return [
    `${GOLDEN_PATH} no longer matches the lines in the tree. Read the diff: if the change alters which argument carries the value, or appends a sentence retracting the rule, that is a finding, not a golden to refresh.`
  ];
}

/**
 * The acceptance criteria this file owes a block to.
 *
 * Measured: deleting the AC-8 `describe` wholesale left the suite green at seven tests instead of
 * eight, and the byte golden — the only thing that catches a swapped carrier — was simply gone. A
 * lower test count is the only trace such a deletion leaves, and nothing reads it. These are this
 * file's own block titles, not values from `src/`, so listing them here is not the second copy
 * FR-FLOW-162 abolishes. AC-11 is absent on purpose: it records what this requirement does not
 * guarantee and owes no block.
 */
const DECLARED_CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-6", "AC-7", "AC-8", "AC-9", "AC-10"];

/**
 * The `it` titles this file declares, read off its own source.
 *
 * `it` and not `describe`: a `describe` runs nothing on its own, so a criterion named only by a
 * surrounding `describe` would go on being declared while the block inside it was deleted.
 */
function declaredTitles(): string[] {
  const titles: string[] = [];
  for (const line of readRepoFile(SELF_PATH).split("\n")) {
    const match = /^\s*it(?:\.each\([^)]*\))?\(\s*"([^"]*)"/.exec(line);
    if (match !== null) titles.push(match[1] as string);
  }
  return titles;
}

describe("FR-FLOW-163 — the code side of the carrier rule", () => {
  it("FR-FLOW-163 AC-1: the carrier vocabulary is a live zod record, not a list restated here", () => {
    const declared = declaredArguments();
    // Read off the live object: a `toolSchemas` reduced to a stub of empty records would make every
    // site a violation, which is loud, but this says which side moved before that happens.
    expect(declared.length, `${TOOL} must declare its arguments`).toBeGreaterThan(0);
  });

  it("FR-FLOW-163 AC-2: the encoding rule is still needed, because no tool declares the field", () => {
    const declared = declaredArguments();
    expect(
      declared,
      `${TOOL} now declares \`${FIELD}\` itself. Encoding it into another argument is no longer required, and every skill line instructing that encoding is stale — this suite must not go on approving them.`
    ).not.toContain(FIELD);
    // The other spelling too: a camelCase argument would carry the same meaning and retire the rule
    // just as completely, and a check that only knew the snake_case form would miss it.
    expect(declared, `${TOOL} now declares a camelCase form of the field`).not.toContain("traceIntent");
  });
});

describe("FR-FLOW-163 — every mention of the field names its carrier", () => {
  it("FR-FLOW-163 AC-4 · AC-5: no site leaves the value without a declared destination", () => {
    expect(violations(declaredArguments(), sites()), "sites are every physical line naming the field").toEqual([]);
  });

  it("FR-FLOW-163 AC-6 · AC-7: the sites are still being found, per rendering and per skill", () => {
    const counted: Record<string, number> = {};
    for (const site of sites()) counted[site.bucket] = (counted[site.bucket] ?? 0) + 1;
    // The floor table must cover every bucket the reader produces and no more: a bucket without a
    // floor is swept and measured against nothing, and a floor for a bucket that no longer exists
    // goes on passing while the thing it counted is gone. This is what makes a skill that drops
    // every mention — kiwi-coder saying nothing about the flattening destination — a failure rather
    // than a smaller corpus.
    expect(Object.keys(counted).sort(), "buckets found vs buckets with a floor").toEqual(Object.keys(FLOORS).sort());
    for (const [bucket, floor] of Object.entries(FLOORS)) {
      expect(floor, "a floor of zero is not a floor").toBeGreaterThan(0);
      expect(counted[bucket] ?? 0, `${bucket} (counted ${JSON.stringify(counted)})`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("FR-FLOW-163 AC-7: the judge still answers a known question in both directions", () => {
    const declared = declaredArguments();
    const own = declared[0] as string;
    // Every carrier name in the samples is tied to the fact rather than typed: the accepted one is
    // taken from the declared list, and the refused one is asserted absent from it before use, so a
    // schema that ever grew that name would say so rather than leave the probe passing quietly.
    expect(declared, `the refused probe needs a name no schema declares, and \`${NO_SUCH_CARRIER}\` is one`).not.toContain(
      NO_SUCH_CARRIER
    );
    const site = (text: string): Site => ({ bucket: "probe", where: "(probe)", path: "(probe)", lines: [text], index: 0, text });
    const cases: Array<{ what: string; verdict: "refused" | "passed"; site: Site }> = [
      {
        what: "a line naming the field and no argument at all",
        verdict: "refused",
        site: site(`  ${FIELD}?: "verifies"|"addition_site"|"negative";`)
      },
      {
        what: `a line offering \`${NO_SUCH_CARRIER}\`, which no schema declares, as the destination`,
        verdict: "refused",
        site: site(`the value goes in \`${NO_SUCH_CARRIER}\` as ${FIELD}=<value>`)
      },
      {
        what: `a line naming \`${own}\` in backticks as the destination`,
        verdict: "passed",
        site: site(`the value goes in \`${own}\` as ${FIELD}=<value>`)
      },
      {
        what: `a line naming \`${own}\` as a key, the form a call example uses`,
        verdict: "passed",
        site: site(`${TOOL} { ${own}: "${FIELD}=verifies" }`)
      }
    ];
    const failures: string[] = [];
    for (const probe of cases) {
      const found = violations(declared, [probe.site]);
      if (probe.verdict === "refused" && found.length === 0) {
        failures.push(`the judge passed ${probe.what}. It must refuse that, so it is no longer comparing anything.`);
      }
      if (probe.verdict === "passed" && found.length > 0) {
        failures.push(`the judge refused ${probe.what}. A judge that refuses everything reports no drift either.`);
      }
    }
    expect(
      failures,
      "the rule survives while its comparison does not. A judge that has stopped comparing reports an empty violation list, which is exactly what a clean tree reports."
    ).toEqual([]);
  });

  it("FR-FLOW-163 AC-9: no section carrying a site also carries a sentence cancelling the rule", () => {
    expect(
      retractions(sites()),
      "the golden freezes the site line, and this is the edit that goes around it: the rule left intact and cancelled from a line beside it."
    ).toEqual([]);
  });

  it("FR-FLOW-163 AC-9: the retraction reader still answers a known question in both directions", () => {
    const line = `값은 \`notes\` 에 ${FIELD}=<값> 으로 인코딩한다.`;
    const doc = (lines: string[], index: number): Site => ({
      bucket: "probe",
      where: "(probe)",
      path: "(probe)",
      lines,
      index,
      text: lines[index] as string
    });
    const cases: Array<{ what: string; verdict: "refused" | "passed"; site: Site }> = [
      {
        what: "a cancelling sentence one paragraph below the site, the form measured to survive the golden",
        verdict: "refused",
        site: doc(["### probe", line, "", "다만 바로 위 문단의 인코딩 규칙은 이번 판에서 폐기한다."], 1)
      },
      {
        what: "a cancelling sentence above the site",
        verdict: "refused",
        site: doc(["### probe", "위 인코딩 규칙은 참고 지표일 뿐이며 강제하지 않는다.", "", line], 3)
      },
      {
        what: "a section that states the rule and says nothing else about its force",
        verdict: "passed",
        site: doc(["### probe", line, "", "이 값은 kiwi-srs 가 status 상한을 걸 때 읽는다."], 1)
      },
      {
        // Pins the boundary rather than endorsing it. The reader stops at a heading, so a
        // cancellation one section away is not reached; AC-11 records that as a residual, and this
        // sample makes a later change to the boundary visible instead of silent.
        what: "a cancelling sentence in the NEXT section, which this reader does not reach",
        verdict: "passed",
        site: doc(["### probe", line, "", "### 다른 절", "위 인코딩 규칙은 폐기한다."], 1)
      }
    ];
    const failures: string[] = [];
    for (const probe of cases) {
      const found = retractions([probe.site]);
      if (probe.verdict === "refused" && found.length === 0) failures.push(`the reader passed ${probe.what}.`);
      if (probe.verdict === "passed" && found.length > 0) failures.push(`the reader refused ${probe.what}.`);
    }
    expect(
      failures,
      "a retraction reader that has stopped matching reports nothing, which is exactly what a clean tree reports."
    ).toEqual([]);
  });

  it("FR-FLOW-163 AC-3: the corpus is the files on disk now, not the files of the day it was written", () => {
    // A frozen path list is indistinguishable from the derivation on the day it is frozen, and no
    // floor or census can see the difference. Re-deriving and comparing EXACTLY turns the day a
    // skill file is added into a failure rather than into a file nobody sweeps.
    const derived = RENDERINGS.flatMap((rendering) => markdownFiles(rendering));
    expect(
      CORPUS.map((file) => file.path).sort(),
      "the corpus is no longer what is on disk. Files outside it are never swept, and the sweep above reports clean over the ones that remain."
    ).toEqual([...derived].sort());
    for (const file of CORPUS) {
      expect(file.lines.join("").length, `${file.path}: read as empty`).toBeGreaterThan(0);
    }
  });
});

describe("FR-FLOW-163 AC-8 — the shipped lines match the golden byte for byte", () => {
  it("FR-FLOW-163 AC-8: freezes the derived sites, so a carrier cannot be swapped unnoticed", () => {
    // Keyed on the FILE with the line number stripped: an edit anywhere above a site shifts its
    // number without touching the rule, and a golden that rewrites itself on unrelated edits is a
    // golden nobody reads. The DERIVED set is frozen, so a rendering that loses a site loses a
    // golden entry rather than passing a comparison over the survivors.
    const drift = goldenDrift();
    // Never written from the assertion: a golden that refreshes itself on failure records whatever
    // was done last, which is the one thing a golden must not do. The sibling suites record the
    // same rule.
    if (drift.length > 0) writeFileSync(path.join(REPO_ROOT, `${GOLDEN_PATH}.actual`), renderSites(), "utf8");
    expect(drift, `${GOLDEN_PATH}`).toEqual([]);
  });

  it("FR-FLOW-163 AC-10: the golden comparison still answers a known question in both directions", () => {
    // Handed a reader rather than a file, so the comparison is exercised on samples whose answer is
    // known. A comparison rewritten to hold one side against itself passes the first sample and
    // fails the other two, which is the whole point: a golden check that has stopped comparing
    // reports no drift, and so does a correct one.
    const cases: Array<{ what: string; verdict: "refused" | "passed"; read: () => string }> = [
      { what: "a golden byte-identical to the tree", verdict: "passed", read: () => renderSites() },
      { what: "an empty golden", verdict: "refused", read: () => "" },
      {
        what: "a golden whose first site names a different field",
        verdict: "refused",
        read: () => renderSites().replace(FIELD, NO_SUCH_CARRIER)
      }
    ];
    const failures: string[] = [];
    for (const probe of cases) {
      const found = goldenDrift(probe.read);
      if (probe.verdict === "refused" && found.length === 0) failures.push(`the comparison accepted ${probe.what}.`);
      if (probe.verdict === "passed" && found.length > 0) failures.push(`the comparison rejected ${probe.what}.`);
    }
    expect(failures, "the golden survives while the comparison over it does not.").toEqual([]);
  });
});

// AC-10. Two mutations of this FILE were measured to survive: neutering the golden comparison into a
// self-comparison, and deleting the golden block outright. Both leave a suite that reports no
// drift, which is what a correct tree reports too. The probe above separates the first reading from
// the second; the two assertions below cover the deletions no probe can see, because a deleted
// block runs nothing at all.
describe("FR-FLOW-163 AC-10 — the suite refuses its own quiet disablement", () => {
  it("FR-FLOW-163 AC-10: declares a block for every criterion the requirement names", () => {
    const titles = declaredTitles();
    expect(titles.length, `${SELF_PATH}: no block titles were read, so the extraction has stopped matching`).toBeGreaterThanOrEqual(
      DECLARED_CRITERIA.length
    );
    // Bounded on the right so `AC-1` is not answered by `AC-10`, which would leave the first
    // criterion's block deletable behind the last one's title.
    const missing = DECLARED_CRITERIA.filter((criterion) => !titles.some((title) => new RegExp(`${criterion}(?![0-9])`).test(title)));
    expect(
      missing,
      "a criterion no longer has a block in this file. Whatever it checked is no longer checked, and the only other trace is a lower test count."
    ).toEqual([]);
  });

  it("FR-FLOW-163 AC-10: keeps a floor table that still adds up to the census the requirement records", () => {
    const total = Object.values(FLOORS).reduce((sum, floor) => sum + floor, 0);
    expect(
      total,
      "the floor table no longer adds up to the recorded census. A floor only refuses zero, so lowering one without emptying it leaves every assertion green while the mentions it counted disappear."
    ).toBeGreaterThanOrEqual(CENSUS_SITES);
  });
});

describe("FR-FLOW-163 — census: what the sweep actually reached", () => {
  it("FR-FLOW-163 AC-3: the census matches what the requirement records", () => {
    // Floors, not equalities: the tree grows, and a suite that fails on growth gets its numbers
    // raised without anyone reading them, which is how a floor stops meaning anything.
    expect(CORPUS.length, "markdown files across the renderings").toBeGreaterThanOrEqual(153);
    expect(sites().length, "lines naming the field").toBeGreaterThanOrEqual(CENSUS_SITES);
    const perRendering: Record<string, number> = {};
    for (const file of CORPUS) perRendering[file.rendering] = (perRendering[file.rendering] ?? 0) + 1;
    expect(Object.keys(perRendering).sort(), "every rendering contributes files").toEqual([...RENDERINGS].sort());
  });
});
