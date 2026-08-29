import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_REQUIREMENT_STABILITY, renderRequirementBlock } from "../../src/core/mutation/render-requirement.js";
import { REPO_ROOT, criticalGateRows, normaliseEol, orderedOffsets, section, stripFrontmatter } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-165 — the promotion hop R-ORCH lacked, and the filter that would have emptied it.
//
// R-ORCH authors its own wave's requirements at Phase 3.b, `add_requirement` lands them at
// `DEFAULT_REQUIREMENT_STABILITY`, and Phase 3.c-prime then refuses them at `requirement-not-ready`
// — a gate `--auto` cannot pass. This file holds the hop that promotes them, its POSITION between
// those two phases, the removal of the sentence that said the rung has no such hop, and the filter
// correction without which the hop would evaluate nothing and stop identically.
//
// WHAT THIS FILE DOES NOT HOLD, stated so it is not read into the green:
//  - It reads instruction text. `kiwi-srs-feasibility` has no code implementation at all, so no
//    assertion here observes the hop running; a rendering carrying the hop and an agent ignoring it
//    are not distinguished. Every count below is the DOCUMENTED filter applied to a snapshot the
//    shipped renderer produced, not the skill executing.
//  - It does not hold that the promotion SUCCEEDS. The called skill may judge a requirement not
//    implementable and leave it at `draft`, and the gate then fires correctly.
//  - The hop paragraph is located STRUCTURALLY — the one prose block of the section that names the
//    called skill — and then compared byte-exact. A rewording inside that block is a golden diff a
//    person reads; a second prose block naming the skill fails the locator instead, which is what
//    catches the old sentence being left in place beside the new one.

const GOLDEN_PATH = "test/skills/stability-promotion-hop.fr-flow-165.golden.md";
const SEPARATOR = "\n\n=== hop ===\n\n";
const READINESS_PATH = "src/core/orchestrator/readiness.ts";

/** The wave size the AC-5 measurement is taken at, so the count in the requirement is reproducible. */
const WAVE_SIZE = 6;

const HOP_SECTION = /^####\s+4\.5\.3\b/mu;
const PHASE_MAP = /^##\s+3\.\s+Phase/mu;
const FILTER_SECTION = /^###\s+3\.3\b/mu;
const CALLED_SKILL = "kiwi-srs-feasibility";
const HOP_CALL = /Skill\(\{\s*skill:\s*"kiwi-srs-feasibility",\s*args:\s*"([^"]*)"/u;
/** The claim this requirement reverses, sigil-agnostic because claude writes `/` and the rest `$`. */
const NO_HOP_SENTENCE = /hop 이 \*\*없다\*\*/u;
/**
 * The sibling section the hop cites its condition from, as the hop paragraph itself names it.
 *
 * A HEADING TITLE rather than a section number, and read out of the shipped paragraph rather than
 * written here. The first draft of this hop cited `kiwi-pipeline` §3.2, which no rendering has: the
 * number had drifted while the section stayed. A number is a reference that goes stale silently —
 * the defect this whole requirement exists to stop, pointed back at itself.
 */
const CITED_SECTION = /`kiwi-pipeline` 의 `([^`]+)` 절/u;

interface Rendering {
  readonly relPath: string;
  readonly body: string;
}

/**
 * One skill's four shipped renderings, read from `RENDERINGS` rather than listed here.
 *
 * A list is an inclusion test one level above the corpus boundary: whatever it omits is never swept,
 * and a sweep over the survivors passes for the same reason a clean one does.
 */
function renderingsOf(skill: string): Rendering[] {
  return RENDERINGS.map((rendering) => {
    const relPath = `${rendering}/${skill}/SKILL.md`;
    return { relPath, body: stripFrontmatter(readRepoFile(relPath)) };
  });
}

const ORCHESTRATOR = renderingsOf("kiwi-orchestrator");
const FEASIBILITY = renderingsOf(CALLED_SKILL);
const PIPELINE = renderingsOf("kiwi-pipeline");

/** The heading lines of a rendering, which is where a cited section has to be found. */
function headings(body: string): string[] {
  return body.split("\n").filter((line) => /^#{1,6}\s/u.test(line));
}

/** Blank-line separated blocks, which is the boundary markdown itself draws between paragraphs. */
function blocks(text: string): string[] {
  return text.split(/\n[ \t]*\n/u).map((block) => block.replace(/^\s+|\s+$/gu, "")).filter((block) => block !== "");
}

/** Those blocks that are prose — a fenced call block carries no blank line, so it is one block. */
function proseBlocks(text: string): string[] {
  return blocks(text).filter((block) => !block.split("\n").some((line) => line.trimStart().startsWith("```")));
}

/** The `#### 4.5.3` prose blocks that name the called skill. Exactly one is the contract. */
function hopParagraphs(rendering: Rendering): string[] {
  return proseBlocks(section(rendering.body, HOP_SECTION)).filter((block) => block.includes(CALLED_SKILL));
}

function hopParagraph(rendering: Rendering): string {
  const found = hopParagraphs(rendering);
  return found.length === 1 ? normaliseEol(found[0] as string) : "";
}

function hopSites(): string {
  return ORCHESTRATOR.map((rendering) => `${rendering.relPath}\n---\n${hopParagraph(rendering)}`).join(SEPARATOR) + SEPARATOR;
}

interface Exclusion {
  readonly axis: "status" | "stability";
  readonly value: string;
}

/**
 * The evaluation-target filter of the called skill, PARSED OUT of its shipped text.
 *
 * Derived rather than restated: a suite carrying its own copy of the filter would stay green while
 * the shipped filter went back to excluding `draft`, which is the exact regression AC-5 is for.
 */
function exclusions(filterBlock: string): Exclusion[] {
  const found: Exclusion[] = [];
  const scan = /^\s*-\s*(status|stability)\s*=\s*`?([a-z_]+)`?\s*제외/gmu;
  for (let match = scan.exec(filterBlock); match; match = scan.exec(filterBlock)) {
    found.push({ axis: match[1] as Exclusion["axis"], value: match[2] as string });
  }
  return found;
}

/** The `--include-stable` clause, which is prose rather than an `axis = value` line. */
function excludesStableAndFrozen(filterBlock: string): boolean {
  return /--include-stable[^\n]*stable\/frozen\s*제외/u.test(filterBlock);
}

interface WaveRecord {
  readonly id: string;
  readonly status: string;
  readonly stability: string;
}

/**
 * A wave's requirements as Phase 3.b lands them: rendered by the shipped writer with no `stability`
 * argument, then read back off the metadata row the writer produced.
 */
function waveSnapshot(size: number): WaveRecord[] {
  return Array.from({ length: size }, (_unused, index) => {
    const id = `FR-WAVE-${String(index + 1).padStart(3, "0")}`;
    const lines = renderRequirementBlock({
      id,
      title: `wave requirement ${index + 1}`,
      type: "functional",
      target: "wave-1",
      status: "planned",
      statement: "The system SHALL do the thing.",
      acceptanceCriteria: ["AC-1: something"],
      verificationMethod: "test"
    });
    const row = lines.find((line) => /^\|\s*Stability\s*\|/u.test(line));
    return {
      id,
      status: "planned",
      stability: row === undefined ? "(absent)" : (row.split("|")[2] as string).trim()
    };
  });
}

/** The filter applied. The `--include-stable` clause first, then each parsed exclusion. */
function evaluated(records: readonly WaveRecord[], filterBlock: string): WaveRecord[] {
  const parsed = exclusions(filterBlock);
  return records
    .filter((record) => !excludesStableAndFrozen(filterBlock) || !["stable", "frozen"].includes(record.stability))
    .filter((record) => !parsed.some((rule) => record[rule.axis] === rule.value));
}

/** §3.3's N=0 branch, which is what an agent would record when the filter empties the snapshot. */
function emptyReason(before: number, after: number): string | null {
  if (before === 0) return "target_empty";
  if (after === 0) return "filter_excluded";
  return null;
}

/** The boolean fields the derivation declares, read from the interface rather than listed here. */
function derivedBooleanFields(): string[] {
  const source = readRepoFile(READINESS_PATH);
  const block = /export interface DerivedRequirementReadiness \{([\s\S]*?)\n\}/u.exec(source);
  if (block === null) return [];
  return [...(block[1] as string).matchAll(/readonly (\w+): boolean;/gu)].map((match) => match[1] as string);
}

/**
 * The backticked camelCase identifiers a `critical_gates[]` reason cell names.
 *
 * camelCase rather than any backticked token, so the cell can name the record fields the causes are
 * read off — `status`, `stability` — in the prose beside them without those being counted as
 * derived-readiness fields.
 */
function namedIdentifiers(cell: string): string[] {
  return [...cell.matchAll(/`([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)`/gu)].map((match) => match[1] as string);
}

describe("FR-FLOW-165 — the corpus this file sweeps", () => {
  it("reads four renderings of each skill, none of them empty", () => {
    expect(ORCHESTRATOR).toHaveLength(4);
    expect(FEASIBILITY).toHaveLength(4);
    expect(PIPELINE).toHaveLength(4);
    for (const rendering of [...ORCHESTRATOR, ...FEASIBILITY, ...PIPELINE]) {
      expect(rendering.body.length, rendering.relPath).toBeGreaterThan(10_000);
    }
  });
});

describe("FR-FLOW-165 AC-1 — the promotion hop is stated in every rendering", () => {
  it("calls the skill that owns the promotion judgement, scoped to the wave's target", () => {
    for (const rendering of ORCHESTRATOR) {
      const body = section(rendering.body, HOP_SECTION);
      expect(body, rendering.relPath).not.toBe("");
      const call = HOP_CALL.exec(body);
      expect(call, `${rendering.relPath}: no kiwi-srs-feasibility call in the 4.5.3 call fence`).not.toBeNull();
      expect((call as RegExpExecArray)[1], rendering.relPath).toContain("TARGET=wave-{n}");
    }
  });

  it("states the condition in exactly one prose block of that section", () => {
    for (const rendering of ORCHESTRATOR) {
      expect(hopParagraphs(rendering).length, `${rendering.relPath}: prose blocks naming ${CALLED_SKILL}`).toBe(1);
    }
  });

  it("cites a sibling section that resolves, in every rendering of the skill it cites", () => {
    for (const rendering of ORCHESTRATOR) {
      const cited = CITED_SECTION.exec(hopParagraph(rendering));
      expect(cited, `${rendering.relPath}: the hop names no kiwi-pipeline section to read the condition from`).not.toBeNull();
      const locator = (cited as RegExpExecArray)[1] as string;
      for (const pipeline of PIPELINE) {
        const matched = headings(pipeline.body).filter((heading) => heading.includes(locator));
        expect(matched.length, `${pipeline.relPath}: headings matching the cited '${locator}'`).toBe(1);
      }
    }
  });

  it("holds that block byte-exact against the golden", () => {
    const golden = readRepoFile(GOLDEN_PATH);
    const observed = hopSites();
    // Written on drift so a person reads the observed text rather than reconstructing it. A diff
    // here is a finding first — a weakened condition, a dropped scope, a retraction — and a golden
    // to refresh only once it has been read.
    if (observed !== golden) writeFileSync(path.join(REPO_ROOT, `${GOLDEN_PATH}.actual`), observed, "utf8");
    expect(golden, `${GOLDEN_PATH} is missing, which makes this comparison vacuous rather than red`).not.toBe("");
    expect(observed).toBe(golden);
  });
});

describe("FR-FLOW-165 AC-2 — the hop sits between Phase 3.b and Phase 3.c-prime", () => {
  it("orders the phase map 3.b, then the hop, then 3.c and 3.c-prime", () => {
    for (const rendering of ORCHESTRATOR) {
      const map = section(rendering.body, PHASE_MAP);
      expect(map, rendering.relPath).not.toBe("");
      // `3.c` is a needle rather than only `3.c′` because the requirement's boundary alone leaves the
      // map looser than the fence: with 3.c′ as the last needle the hop can be dropped below 3.c and
      // stay green, and the map then names a different place than the fence and the prose do. The
      // fence pins the hop between `kiwi-srs` and `kiwi-planner`; this pins the same span in the map.
      const offsets = orderedOffsets(map, [/^\s+3\.b\s/mu, /^\s+3\.b′\s/mu, /^\s+3\.c\s/mu, /^\s+3\.c′\s/mu]);
      expect(offsets.every((offset) => offset >= 0), `${rendering.relPath}: ${JSON.stringify(offsets)}`).toBe(true);
      expect([...offsets].sort((left, right) => left - right), rendering.relPath).toEqual(offsets);
    }
  });

  it("orders the call fence kiwi-srs, then the hop, then kiwi-planner", () => {
    for (const rendering of ORCHESTRATOR) {
      const body = section(rendering.body, HOP_SECTION);
      const offsets = orderedOffsets(body, [
        /Skill\(\{ skill: "kiwi-srs",/u,
        /Skill\(\{ skill: "kiwi-srs-feasibility",/u,
        /Skill\(\{ skill: "kiwi-planner",/u
      ]);
      expect(offsets.every((offset) => offset >= 0), `${rendering.relPath}: ${JSON.stringify(offsets)}`).toBe(true);
      expect([...offsets].sort((left, right) => left - right), rendering.relPath).toEqual(offsets);
    }
  });
});

describe("FR-FLOW-165 AC-3 — the sentence saying the rung has no such hop is gone", () => {
  it("carries no such sentence in any rendering", () => {
    for (const rendering of ORCHESTRATOR) {
      expect(NO_HOP_SENTENCE.test(rendering.body), rendering.relPath).toBe(false);
    }
  });
});

describe("FR-FLOW-165 AC-4 — the evaluation-target filter names its axis and admits draft", () => {
  it("keeps the discarded exclusion and drops the draft one", () => {
    for (const rendering of FEASIBILITY) {
      const filterBlock = section(rendering.body, FILTER_SECTION);
      expect(filterBlock, rendering.relPath).not.toBe("");
      const parsed = exclusions(filterBlock);
      expect(parsed, rendering.relPath).toContainEqual({ axis: "status", value: "discarded" });
      // The two axes' TERMINAL values, one bullet each. `deprecated` is here rather than absent
      // because FR-FLOW-154 AC-5 requires this filter to state a stability predicate at all, and
      // because dropping the only one would let the hop promote a requirement someone deprecated
      // on purpose. Plan §7 forbids the other direction — widening the filter to everything.
      expect(parsed, rendering.relPath).toContainEqual({ axis: "stability", value: "deprecated" });
      expect(
        parsed.filter((rule) => rule.value === "draft"),
        `${rendering.relPath}: the hop would evaluate nothing while reporting a clean run`
      ).toEqual([]);
      expect(excludesStableAndFrozen(filterBlock), rendering.relPath).toBe(true);
    }
  });

  it("says in its own words that draft is admitted on purpose, and what excluding it would cost", () => {
    for (const rendering of FEASIBILITY) {
      const filterBlock = section(rendering.body, FILTER_SECTION);
      // Without this the line is unheld: nothing else reads it, so a later session can delete it as
      // a redundant remark and leave the filter with no record of why `draft` survives — which is
      // the state the draft exclusion came back from. Held by the CONSEQUENCE it names rather than
      // by the intent it declares, so a restatement that drops the reason does not satisfy it.
      const admission = [...filterBlock.matchAll(/^[ \t]*-[ \t]*`draft`[^\n]*제외하지 않는다[^\n]*$/gmu)].map((match) => match[0]);
      expect(admission.length, `${rendering.relPath}: bullets stating draft is deliberately admitted`).toBe(1);
      expect(admission[0] as string, rendering.relPath).toContain("filter_excluded");
    }
  });

  it("names the surviving exclusions in the N=0 guidance row", () => {
    for (const rendering of FEASIBILITY) {
      const filterBlock = section(rendering.body, FILTER_SECTION);
      expect(filterBlock, rendering.relPath).not.toContain("discarded/draft");
      expect(filterBlock, rendering.relPath).toContain("discarded/deprecated {y}");
    }
  });
});

describe("FR-FLOW-165 AC-5 — the hop evaluates the wave it was called for", () => {
  it("lands a wave's requirements at draft, through the shipped writer", () => {
    expect(DEFAULT_REQUIREMENT_STABILITY).toBe("draft");
    const wave = waveSnapshot(WAVE_SIZE);
    expect(wave).toHaveLength(WAVE_SIZE);
    expect([...new Set(wave.map((record) => record.stability))]).toEqual(["draft"]);
  });

  it("leaves every one of them in the evaluation set, with no empty_reason", () => {
    const wave = waveSnapshot(WAVE_SIZE);
    for (const rendering of FEASIBILITY) {
      const filterBlock = section(rendering.body, FILTER_SECTION);
      const after = evaluated(wave, filterBlock);
      expect(after.length, `${rendering.relPath}: 필터 전 ${WAVE_SIZE}, 필터 후 ${after.length}`).toBeGreaterThanOrEqual(1);
      expect(after.length, rendering.relPath).toBe(WAVE_SIZE);
      expect(emptyReason(wave.length, after.length), rendering.relPath).toBeNull();
    }
  });

  it("labels its empty branches the way the shipped section declares them", () => {
    // `emptyReason` is this file's model of §3.3's N=0 branch, and its two labels were literals here
    // with nothing tying them to the shipped text. AC-5 reasons from that branch, so a rename there
    // would leave the reasoning quietly false while the suite stayed green. The labels are taken off
    // the model itself rather than restated a third time.
    const labels = [emptyReason(0, 0), emptyReason(WAVE_SIZE, 0)];
    expect(labels).toEqual(["target_empty", "filter_excluded"]);
    for (const rendering of FEASIBILITY) {
      const filterBlock = section(rendering.body, FILTER_SECTION);
      for (const label of labels) {
        expect(filterBlock, `${rendering.relPath}: §3.3 does not declare the '${label as string}' label`).toContain(label as string);
      }
    }
  });

  it("would report filter_excluded if the draft exclusion came back", () => {
    const wave = waveSnapshot(WAVE_SIZE);
    const restored = `${section((FEASIBILITY[0] as Rendering).body, FILTER_SECTION)}\n  - stability = \`draft\` 제외\n`;
    const after = evaluated(wave, restored);
    expect(after).toHaveLength(0);
    expect(emptyReason(wave.length, after.length)).toBe("filter_excluded");
  });
});

describe("FR-FLOW-165 AC-8 — the gate row names lifecycle as a cause of its own", () => {
  it("names exactly the derivation's boolean fields, read from the interface", () => {
    const fields = derivedBooleanFields();
    expect(fields.length, `${READINESS_PATH}: no boolean fields found on DerivedRequirementReadiness`).toBeGreaterThan(0);
    expect([...fields].sort()).toEqual(["evidenceDrift", "hardDependenciesSatisfied", "lifecycleReady", "ownershipVerified"]);

    for (const rendering of ORCHESTRATOR) {
      const row = criticalGateRows(rendering.body).find((entry) => entry.gateId === "requirement-not-ready");
      expect(row, rendering.relPath).toBeDefined();
      expect((row as { location: string }).location, rendering.relPath).toContain("3.c′");
      expect([...namedIdentifiers((row as { reason: string }).reason)].sort(), rendering.relPath).toEqual([...fields].sort());
    }
  });
});
