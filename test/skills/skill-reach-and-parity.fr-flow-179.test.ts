import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, markdownFiles, readRepoFile } from "./kiwi-renderings.js";
import {
  readSkillWithReferences,
  referenceFilesOnDisk,
  referenceRefs
} from "../support/resolved-skill.js";
import {
  MARKER,
  buildProgram,
  countOccurrences,
  extractInvocations,
  resolveCitation
} from "../support/skill-citations.js";
import { renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";

// @req FR-FLOW-179 — a shipped skill carries what its reader reaches, and says the same thing in
// every rendering.
//
// Three separable defects, one requirement, because they are all the same failure of a skill body
// to be the thing its reader is actually given: prose nobody in this mode can act on is paid for
// anyway, a sibling rendering says something else about the same procedure, and an artifact is
// written that nothing opens.
//
// WHAT THIS FILE DOES NOT HOLD. Nothing here observes a run. The saving AC-1 claims is a property
// of the calling harness — a body arrives whole and a reference arrives when read — and this
// repository cannot demonstrate it; what it can demonstrate is that the moved text is out of the
// body, still reachable from it, and still inside the checks that read skill text. Everything else
// is instruction text: a skill that carries a rule and ignores it at run time is not caught here.

const VARIANTS = ["skills/claude", "skills/codex", "skills/etc"] as const;
const CLAUDE = "skills/claude";

function variantName(rendering: string): string {
  return rendering.slice("skills/".length);
}

function skillBody(rendering: string, skill: string): string {
  return readRepoFile(`${rendering}/${skill}/SKILL.md`);
}

function referenceBody(rendering: string, skill: string): string {
  const dir = path.join(REPO_ROOT, rendering, skill, "references");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => readFileSync(path.join(dir, entry), "utf8"))
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// AC-1 — a section a caller cannot reach from its own entry leaves the body it is loaded with.
// ---------------------------------------------------------------------------------------------

/**
 * The move set. Each row is a section whose entry condition the section itself states, and which
 * `skills/codex` has ALREADY placed under `references/` — that second half is the whole of AC-1's
 * "limited to the sections another rendering has already moved", and it is asserted rather than
 * asserted-about, so a row added here without a precedent fails.
 */
const MOVED = [
  {
    skill: "kiwi-commit-auto-push",
    heading: "### 11.6 `/kiwi-coder` / `/kiwi-pm` 와의 인계 프로토콜",
    /** What the reader has to be in for the section to apply, as the pointer must name it. */
    condition: "child",
    /** A marker of the same section in the codex reference — the precedent. */
    precedent: "11.6"
  },
  {
    skill: "kiwi-review-fix-loop",
    heading: "### 4.1.p PR 모드 — gh CLI 수집",
    condition: "PR 모드",
    precedent: "PR Response"
  },
  {
    skill: "kiwi-review-fix-loop",
    heading: "### 6.6 Phase 7.5 — REQ verified 일괄 승급 (`--close-reqs` 활성 시)",
    condition: "--close-reqs",
    precedent: "Close Requirements"
  },
  {
    skill: "kiwi-review-fix-loop",
    heading: "### 7.2 PR 응답 코멘트 (PR 모드 + 응답 활성, §0.13)",
    condition: "PR 모드",
    precedent: "PR Response"
  }
] as const;

const MOVED_SKILLS = [...new Set(MOVED.map((entry) => entry.skill))];

describe("FR-FLOW-179 AC-1 — unreachable prose leaves the body, and the body still points at it", () => {
  it.each(MOVED)("$skill: $heading is out of the claude body", ({ skill, heading }) => {
    const body = skillBody(CLAUDE, skill);
    expect(body.length, `${CLAUDE}/${skill}/SKILL.md must exist`).toBeGreaterThan(0);
    expect(
      body.split("\n").some((line) => line.trim() === heading),
      `${CLAUDE}/${skill}/SKILL.md still carries "${heading}" in the body every call loads, though no caller in the default entry can act on it.`
    ).toBe(false);
  });

  it.each(MOVED)("$skill: $heading is in the claude reference", ({ skill, heading }) => {
    expect(
      referenceBody(CLAUDE, skill).split("\n").some((line) => line.trim() === heading),
      `${CLAUDE}/${skill}/references/ does not carry "${heading}". Moving a section out of a body and not into a reference deletes it.`
    ).toBe(true);
  });

  it.each(MOVED)("$skill: the body names the reference and the condition for $heading", ({ skill, heading, condition }) => {
    const body = skillBody(CLAUDE, skill);
    const section = heading.replace(/^#+\s*/, "").split(" ")[0] as string;
    const pointers = body
      .split("\n")
      .filter((line) => line.includes("references/") && line.includes(section));
    expect(
      pointers.length,
      `${CLAUDE}/${skill}/SKILL.md has no line naming both \`references/\` and ${section}. A reader that cannot see the pointer cannot reach the section, which is a deletion with extra steps.`
    ).toBeGreaterThan(0);
    expect(
      pointers.some((line) => line.includes(condition)),
      `${CLAUDE}/${skill}/SKILL.md points at ${section} without saying when to open it ("${condition}"). An unconditional pointer is read every call, which is the cost the move was made to avoid.`
    ).toBe(true);
  });

  it.each(MOVED)("$skill: codex had already moved $heading, which is what limits this set", ({ skill, precedent }) => {
    expect(
      referenceBody("skills/codex", skill).includes(precedent),
      `skills/codex/${skill}/references/ does not carry "${precedent}". AC-1 limits the move to sections another rendering has already moved; without that precedent this row is a new decision, not a port.`
    ).toBe(true);
  });

  it.each(MOVED_SKILLS)("%s: every claude reference file is reachable from the body", (skill) => {
    const pointedAt = referenceRefs(skillBody(CLAUDE, skill)).sort();
    expect(
      referenceFilesOnDisk(variantName(CLAUDE), skill),
      `${CLAUDE}/${skill} ships a reference the body never names, so it is unreachable prose that also costs a file.`
    ).toEqual(pointedAt);
  });
});

// ---------------------------------------------------------------------------------------------
// AC-2 — the move does not take a citation out of the reach of the checks that read skill bodies.
// ---------------------------------------------------------------------------------------------

/**
 * `speckiwi ` citations each skill carried in its `SKILL.md` BEFORE the move, measured on the
 * shipped tree. The floor is what the reader that follows the pointer has to still see; a reader
 * narrowed back to `SKILL.md` alone drops below it, which is the regression this pins.
 */
const CITATION_FLOOR: Record<string, number> = {
  "kiwi-commit-auto-push": 19,
  "kiwi-review-fix-loop": 3
};

/**
 * Of those, how many RESOLVE against the real command tree — measured the same way, on the same
 * bodies, before the move. The gap between the two floors is prose: `speckiwi MCP 연동` and
 * `speckiwi 연동 없음` are extracted by the same marker and resolve against nothing, which is why
 * the resolvable subset is pinned separately rather than being asserted to equal the total.
 */
const RESOLVED_FLOOR: Record<string, number> = {
  "kiwi-commit-auto-push": 1,
  "kiwi-review-fix-loop": 2
};

describe("FR-FLOW-179 AC-2 — the citation denominator does not fall", () => {
  it.each(MOVED_SKILLS)("%s: the reader that follows the pointer still sees every citation", (skill) => {
    const resolved = readSkillWithReferences(variantName(CLAUDE), skill);
    expect(
      countOccurrences(resolved, MARKER),
      `${CLAUDE}/${skill}: fewer \`speckiwi\` citations are reachable than before the move. A moved section takes its citations out of every check keyed on the body unless the reader follows.`
    ).toBeGreaterThanOrEqual(CITATION_FLOOR[skill] as number);
  });

  it.each(MOVED_SKILLS)("%s: the moved text carries citations, so following the pointer is load-bearing", (skill) => {
    // Without this the floor above would pass for the wrong reason: a move that took no citation
    // with it leaves the denominator whole whether or not the reader follows anything.
    expect(
      countOccurrences(referenceBody(CLAUDE, skill), MARKER),
      `${CLAUDE}/${skill}: the reference carries no \`speckiwi\` citation, so the floor above says nothing about whether the reader follows the pointer.`
    ).toBeGreaterThan(0);
  });

  it.each(MOVED_SKILLS)("%s: the citations that resolved before still resolve", (skill) => {
    const program = buildProgram();
    const resolvable = extractInvocations(`${CLAUDE}/${skill}`, readSkillWithReferences(variantName(CLAUDE), skill)).filter(
      (invocation) => resolveCitation(program, invocation) === null
    );
    expect(
      resolvable.length,
      `${CLAUDE}/${skill}: fewer citations resolve against the real command tree than before the move. A fabricated option inside a moved section is exactly what stops being caught when a section leaves the denominator.`
    ).toBeGreaterThanOrEqual(RESOLVED_FLOOR[skill] as number);
  });
});

// ---------------------------------------------------------------------------------------------
// AC-3 / AC-4 — the renderings describe the pipeline event the same way, and the write site is
// unchanged.
// ---------------------------------------------------------------------------------------------

/** The skills whose renderings disagreed about which pipeline-event path is normal, measured. */
const EVENT_SKILLS = ["kiwi-coder", "kiwi-planner", "kiwi-pm", "kiwi-srs", "kiwi-pipeline"] as const;

const EMIT_TOOL = "workflow_pipeline_emit";
const READ_TOOLS = ["workflow_pipeline_tail", "workflow_pipeline_status", "get_next_work_order"] as const;
/** How far apart the tool name and the degraded-path wording may be and still be one instruction. */
const REACH = 600;

/**
 * What one skill's OWN text says — its body plus the references that body points at, and NOT the
 * shared modules its section-zero table defers to.
 *
 * Measured while writing this: reading through the shared modules made every skill "name the emit
 * tool", because `_shared/kiwi/pipeline-event.md` names it in the sentence that carves the
 * orchestrator OUT of the rule. The agreement would then have been satisfied by the one file that
 * says the opposite of what is being asserted.
 */
function resolved(rendering: string, skill: string): string {
  return `${skillBody(rendering, skill)}\n${referenceBody(rendering, skill)}`;
}

/** Whether the rendering names the emit tool at all. */
function namesEmitTool(rendering: string, skill: string): boolean {
  return resolved(rendering, skill).includes(EMIT_TOOL);
}

/**
 * Whether the rendering, within reach of the emit tool, calls the raw append the degraded path.
 * Keyed on the two together: naming the tool somewhere and calling raw append degraded somewhere
 * else are two facts, and a rendering can hold one without telling a reader which path is normal.
 */
function marksRawAppendDegraded(rendering: string, skill: string): boolean {
  const text = resolved(rendering, skill);
  for (let index = text.indexOf(EMIT_TOOL); index >= 0; index = text.indexOf(EMIT_TOOL, index + 1)) {
    const window = text.slice(Math.max(0, index - REACH), index + REACH);
    if (/degraded|폴백|fallback|대체 경로/i.test(window)) return true;
  }
  return false;
}

/** Whether the rendering names a workflow READ tool — the half that appeared in one rendering only. */
function namesReadTools(rendering: string, skill: string): boolean {
  const text = resolved(rendering, skill);
  return READ_TOOLS.some((tool) => text.includes(tool));
}

describe("FR-FLOW-179 AC-3 — the renderings are compared with each other, not read alone", () => {
  it.each(EVENT_SKILLS)("%s: all three renderings agree on which emit path is normal", (skill) => {
    const verdicts = VARIANTS.map((rendering) => `${rendering}=${namesEmitTool(rendering, skill)}`);
    expect(
      new Set(verdicts.map((entry) => entry.split("=")[1])).size,
      `${skill}: the renderings disagree about whether the pipeline event is emitted through the tool — ${verdicts.join(", ")}. A reader is told one thing by the rendering it happens to be given, and nothing compared them, which is how this drift grew.`
    ).toBe(1);
    expect(
      namesEmitTool(CLAUDE, skill),
      `${skill}: the renderings agree, but on silence. Agreement that no rendering names the tool would satisfy the comparison above while leaving the instruction absent everywhere.`
    ).toBe(true);
  });

  it.each(EVENT_SKILLS)("%s: all three renderings agree that the raw append is the degraded path", (skill) => {
    const verdicts = VARIANTS.map((rendering) => `${rendering}=${marksRawAppendDegraded(rendering, skill)}`);
    expect(
      new Set(verdicts.map((entry) => entry.split("=")[1])).size,
      `${skill}: the renderings disagree about whether the hand-written append is the fallback — ${verdicts.join(", ")}.`
    ).toBe(1);
    expect(marksRawAppendDegraded(CLAUDE, skill), `${skill}: no rendering says which path is the fallback`).toBe(true);
  });

  it("kiwi-pipeline: all three renderings agree on naming the workflow read tools", () => {
    const verdicts = VARIANTS.map((rendering) => `${rendering}=${namesReadTools(rendering, "kiwi-pipeline")}`);
    expect(
      new Set(verdicts.map((entry) => entry.split("=")[1])).size,
      `kiwi-pipeline: reading instructions appear in one rendering and not the others — ${verdicts.join(", ")}.`
    ).toBe(1);
    expect(namesReadTools(CLAUDE, "kiwi-pipeline"), "kiwi-pipeline: no rendering names a workflow read tool").toBe(true);
  });
});

describe("FR-FLOW-179 AC-4 — the instruction is aligned without moving where the event is written", () => {
  it.each(VARIANTS)("%s: the location chain and the append survive verbatim", (rendering) => {
    const text = readRepoFile(`${rendering}/_shared/kiwi/pipeline-event.md`);
    expect(text.length, `${rendering}/_shared/kiwi/pipeline-event.md must exist`).toBeGreaterThan(0);
    // The three rungs, in order, and the append itself. The home rung is the one the tool cannot
    // express at all — measured, it refuses a path outside the project root — so an alignment that
    // made the tool the only path would delete a reachable case rather than tidy a description.
    expect(text, `${rendering}: the git-root rung of the location chain is gone`).toContain("git rev-parse --show-toplevel");
    expect(text, `${rendering}: the cwd rung of the location chain is gone`).toContain('elif [ -d "./kiwi" ]');
    expect(text, `${rendering}: the home rung of the location chain is gone, and the tool cannot express it`).toContain(
      'PIPE_DIR="$HOME/.kiwi"'
    );
    expect(text, `${rendering}: the append itself is gone`).toContain('>> "$PIPE_DIR/pipeline.jsonl"');
  });

  it.each(EVENT_SKILLS)("%s: every rendering still names the shell path as a path", (skill) => {
    for (const rendering of VARIANTS) {
      const text = resolved(rendering, skill);
      expect(
        /pipeline-event\.md|pipeline\.jsonl/.test(text),
        `${rendering}/${skill}: the shell emit path is named nowhere, so the tool has become the only path — which the run-root contract forbids.`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// AC-5 — an artifact nothing reads is removed; the two that are read are corrected in place.
// ---------------------------------------------------------------------------------------------

/** Assembled rather than written, so this file is not its own counter-example. */
const DEAD_ARTIFACT = `preflight${"."}json`;

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((extension) => entry.endsWith(extension))) out.push(full);
    }
  };
  walk(path.join(REPO_ROOT, dir));
  return out;
}

describe("FR-FLOW-179 AC-5 — the artifact is removed only because its consumers were counted", () => {
  it("counts the consumers rather than assuming them", () => {
    // Re-derived here rather than quoted from the investigation: the removal is only safe while the
    // count is zero, and a reader added later has to make this fail rather than pass unnoticed.
    const consumers = [
      ...filesUnder("src", [".ts"]),
      ...filesUnder("test", [".ts", ".mjs"]),
      ...filesUnder("docs/spec", [".md"])
    ]
      .filter((file) => !file.endsWith("skill-reach-and-parity.fr-flow-179.test.ts"))
      .filter((file) => readFileSync(file, "utf8").includes(DEAD_ARTIFACT))
      .map((file) => path.relative(REPO_ROOT, file).split(path.sep).join("/"));
    expect(
      consumers,
      `something reads ${DEAD_ARTIFACT} after all — the write instruction cannot be removed while a consumer names it.`
    ).toEqual([]);
  });

  it.each(RENDERINGS)("%s: no skill is told to write it any more", (rendering) => {
    const writers = markdownFiles(rendering).filter((relPath) => readRepoFile(relPath).includes(DEAD_ARTIFACT));
    expect(
      writers,
      `${rendering}: still instructs a write of ${DEAD_ARTIFACT}, which nothing opens. The preflight decision and its HALT are untouched; only the file the decision was asked to leave behind is.`
    ).toEqual([]);
  });

  it.each(VARIANTS)("%s: the option wording two verified requirements demand is NOT removed", (rendering) => {
    // AC-7's second half, held mechanically. The saving would be about seventy tokens a call and
    // the cost is two verified requirements' proximity assertions.
    const carriers = markdownFiles(rendering).filter((relPath) => {
      const text = readRepoFile(relPath);
      return text.includes("--loops") && text.includes("--mini");
    });
    expect(carriers.length, `${rendering}: the loop-option wording has been thinned out`).toBeGreaterThanOrEqual(10);
  });

  it.each(RENDERINGS)("%s: the routing table a verified requirement asserts is corrected, not replaced", (rendering) => {
    const text = readRepoFile(`${rendering}/_shared/kiwi/pipeline-v1.md`);
    expect(text.length, `${rendering}/_shared/kiwi/pipeline-v1.md must exist`).toBeGreaterThan(0);
    expect(
      /\|\s*`kiwi-pm`[^|]*\|[^|]*TASK_DONE/.test(text),
      `${rendering}: the kiwi-pm routing row is gone. A third verified requirement asserts that row by name, so this table is corrected in place rather than replaced by a pointer.`
    ).toBe(true);
    expect(
      /\|\s*`kiwi-pipeline`\s*\|/.test(text),
      `${rendering}: the kiwi-pipeline responsibility row is gone, which the same requirement asserts.`
    ).toBe(true);
  });
});

/** `last skill -> the kiwi-* names its success row hints at`, read from a markdown routing table. */
function routingHints(text: string, headerNeedle: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes(headerNeedle));
  for (let index = start + 1; index < lines.length && start >= 0; index++) {
    const line = lines[index] as string;
    if (!line.trim().startsWith("|")) {
      if (out.size > 0) break;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    if (!/TASK_DONE/.test(cells[1] as string)) continue;
    const names = (cells[2] as string).match(/kiwi-[a-z-]+/g) ?? [];
    for (const last of (cells[0] as string).match(/kiwi-[a-z-]+/g) ?? []) {
      out.set(last, new Set(names));
    }
  }
  return out;
}

describe("FR-FLOW-179 AC-5 — the three declarations of one routing table say the same thing", () => {
  it("Table T1 itself says the same thing in every rendering", () => {
    // The declaration the other two defer to has to be one declaration. Found while correcting the
    // summary: the shared contract file disagreed with itself across renderings on exactly one row,
    // and a reader given `skills/codex` was told a solo coder run may go straight to commit-and-push
    // while a reader given `skills/claude` was told it goes through the review hop first.
    const perRendering = RENDERINGS.map((rendering) => ({
      rendering,
      hints: routingHints(readRepoFile(`${rendering}/_shared/kiwi/pipeline-event.md`), "next_hint 결정표")
    }));
    const keys = [...new Set(perRendering.flatMap(({ hints }) => [...hints.keys()]))];
    const disagreements: string[] = [];
    for (const key of keys) {
      const spellings = perRendering.map(
        ({ rendering, hints }) => `${rendering}=[${[...(hints.get(key) ?? new Set())].sort().join(",")}]`
      );
      if (new Set(spellings.map((entry) => entry.split("=")[1])).size > 1) disagreements.push(`${key}: ${spellings.join(" ")}`);
    }
    expect(keys.length, "Table T1 was not read at all").toBeGreaterThan(5);
    expect(disagreements, "the renderings of one shared contract file route the same skill differently").toEqual([]);
  });

  it.each(RENDERINGS)("%s: every row the summary carries agrees with Table T1", (rendering) => {
    const t1 = routingHints(readRepoFile(`${rendering}/_shared/kiwi/pipeline-event.md`), "next_hint 결정표");
    const summary = routingHints(readRepoFile(`${rendering}/_shared/kiwi/pipeline-v1.md`), "Last skill");
    expect(t1.size, `${rendering}: Table T1 was not read at all`).toBeGreaterThan(5);
    expect(summary.size, `${rendering}: the routing summary was not read at all`).toBeGreaterThan(5);
    const disagreements: string[] = [];
    for (const [last, hints] of summary) {
      const authoritative = t1.get(last);
      if (!authoritative) continue;
      const a = [...hints].sort().join(",");
      const b = [...authoritative].sort().join(",");
      if (a !== b) disagreements.push(`${last}: summary says [${a}], Table T1 says [${b}]`);
    }
    expect(
      disagreements,
      `${rendering}: the routing summary contradicts the table it says it summarises. A reader given one is told something the other denies.`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// AC-6 — the banner and the table stop contradicting each other, in three copies.
// ---------------------------------------------------------------------------------------------

/** CLI verbs that mutate the specification. A table cell offering one contradicts the banner. */
const MUTATION_VERBS = [
  "add-requirement",
  "update-status",
  "update-stability",
  "add-trace",
  "add-evidence",
  "set-target-goal",
  "check-ac",
  "add-completed-work"
] as const;

const BANNER_SKILLS = ["kiwi-srs", "kiwi-srs-from-code", "kiwi-srs-feasibility"] as const;

describe("FR-FLOW-179 AC-6 — the table stops offering what the banner forbids", () => {
  it.each(BANNER_SKILLS)("claude/%s: no CLI cell offers a mutation command", (skill) => {
    const offenders = skillBody(CLAUDE, skill)
      .split("\n")
      .filter((line) => line.trim().startsWith("|") && MUTATION_VERBS.some((verb) => line.includes(`speckiwi ${verb}`)))
      .map((line) => line.trim().slice(0, 110));
    expect(
      offenders,
      `${CLAUDE}/${skill}: the banner says the CLI is not a normal replacement for MCP mutations and the table below it lists mutation commands for the command line. A sibling rendering fixed this by narrowing the cell rather than deleting the row, which keeps "this one is MCP-only" sayable.`
    ).toEqual([]);
  });

  it("claude/kiwi-srs keeps exactly the one row that has no tool equivalent", () => {
    // Narrowing every cell would delete the recovery path for an unregistered target, which is the
    // single case the tool cannot serve. The sibling rendering kept it and named it an exception.
    const rows = skillBody(CLAUDE, "kiwi-srs")
      .split("\n")
      .filter((line) => line.trim().startsWith("|") && line.includes("speckiwi set-active-target"));
    expect(rows.length, `${CLAUDE}/kiwi-srs: the target-registration exception is gone or duplicated`).toBe(1);
    expect(
      /예외|exception/i.test(rows[0] as string),
      `${CLAUDE}/kiwi-srs: the surviving row does not say it is the exception, so it reads as a general fallback.`
    ).toBe(true);
  });

  it.each(["kiwi-srs", "kiwi-srs-from-code", "kiwi-srs-sync"] as const)(
    "claude/%s: the section-zero rule takes the same stance as its sibling",
    (skill) => {
      const stance = (rendering: string): boolean =>
        skillBody(rendering, skill)
          .split("\n")
          .some((line) => /^\|\s*§0\.\d+\s*\|/.test(line) && /speckiwi MCP/.test(line) && /진단/.test(line));
      expect(
        stance(CLAUDE),
        `${CLAUDE}/${skill}: section zero still makes the CLI the ordinary path when MCP is absent, which is the opposite of the banner three lines above it.`
      ).toBe(stance("skills/codex"));
      expect(stance("skills/codex"), `skills/codex/${skill}: the sibling this is compared against lost its own rule`).toBe(true);
    }
  );

  it("the template `speckiwi init` installs ships the same advice, not the opposite", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(snippet.length, "the agent instruction template must not be empty").toBeGreaterThan(1000);
    expect(
      /CLI[^.]{0,120}not a normal replacement|정상 대체 경로가 아니다/.test(snippet),
      "the template `speckiwi init` writes into a consumer's own instructions never says the CLI is not the normal mutation path, so every consumer is told the opposite of what the skills say."
    ).toBe(true);
    const offenders = snippet
      .split("\n")
      .filter((line) => MUTATION_VERBS.some((verb) => line.includes(`speckiwi ${verb}`)) && /unavailable|fallback/i.test(line))
      .map((line) => line.trim().slice(0, 120));
    expect(offenders, "the template offers a CLI mutation as the thing to do when MCP is unavailable").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// AC-7 — what this does not do, held mechanically rather than only recorded.
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-179 AC-7 — the three things deliberately not done stay not done", () => {
  it.each(RENDERINGS)("%s: the largest skill's sections are not moved", (rendering) => {
    expect(
      existsSync(path.join(REPO_ROOT, rendering, "kiwi-orchestrator", "references")),
      `${rendering}/kiwi-orchestrator now has a references/ directory. The rendering held up as its precedent has none either, and the two differ by less than a fifth of a percent — so this move would be a new decision with no precedent and seven goldens keyed on the file paths it changes.`
    ).toBe(false);
  });

  it("the pipeline event is not made tool-only", () => {
    // The same fact AC-4 asserts, stated as the decision it is: the home rung cannot be expressed
    // through the tool, so the shell path is not redundant.
    for (const rendering of VARIANTS) {
      expect(readRepoFile(`${rendering}/_shared/kiwi/pipeline-event.md`)).toContain('PIPE_DIR="$HOME/.kiwi"');
    }
  });
});
