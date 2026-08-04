import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertOpensNoBlockBoundary } from "../../../src/core/mutation/block-prose.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { appendSectionNote } from "../../../src/core/mutation/append-section-note.js";
import { replaceAcceptanceCriteria, updateRequirementFields } from "../../../src/core/mutation/edit-requirement.js";
import { scanRequirementBlocks } from "../../../src/core/parser/block-scanner.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { REPO_ROOT } from "../../skills/kiwi-orchestrator-variants.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import type { ProjectRoot, RequirementRecord } from "../../../src/core/types.js";

// @req FR-NODE-174 — the verified transition refuses evidence references it cannot resolve.
//
// A fifth verification round found the gate walked around again, and this time by three calls at once.
// `add_requirement` already refused a Markdown heading inside a prose field, because such a heading
// opens a *new* requirement block that the gate never inspects — it validates the record it is
// creating, not whatever the prose happens to contain. Three sibling mutations write caller-supplied
// text into the same block and never got the same guard: `edit_requirement_fields` via `statement`,
// `append_section_note` in `replace` mode, and `replace_acceptance_criteria` via an item's text. Each
// was measured end to end minting a second requirement block reading `| Status | verified |` with an
// evidence reference outside the checkout — the exact end state this requirement exists to prevent,
// and one that no granular edit can then repair.
//
// The bound these cases claim, stated rather than implied: they pin the four routes named below. A
// writer added later under a different name is outside what a fixed list can detect. AC-9's structural
// half narrows that gap by failing when a named route drops the guard, not when a new route appears.

const CARRIER = "FR-ARCH-001";
const INJECTED = "FR-ARCH-701";

/**
 * A payload whose first line is innocuous and whose remainder opens a requirement block already at
 * `verified`, carrying a reference the resolver cannot resolve. The heading is what does the damage:
 * the parser starts a new record at it, so the mutation's own validation never sees the row.
 */
function injectionPayload(id: string): string {
  return [
    "The system SHALL carry something ordinary.",
    "",
    `### ${id} — A block that was never validated`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | verified |",
    "",
    "#### Requirement",
    "",
    "Injected.",
    "",
    "#### Acceptance Criteria",
    "",
    "- [x] AC-1: Injected.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| VE-1 | inspection | ~/.claude/skills/kiwi-x/SKILL.md | AC-1 | - |"
  ].join("\n");
}

async function fixture(): Promise<ProjectRoot> {
  return resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));
}

async function recordOf(projectRoot: ProjectRoot, id: string): Promise<RequirementRecord | undefined> {
  const workspace = await parseWorkspace(projectRoot);
  return workspace.records.find((record) => record.id === id);
}

describe("FR-NODE-174 AC-9 — no mutation writes prose that opens a requirement block", () => {
  it("edit_requirement_fields refuses a statement carrying a Markdown heading", async () => {
    const projectRoot = await fixture();

    const result = await updateRequirementFields(projectRoot, { id: CARRIER, statement: injectionPayload(INJECTED) });

    expect(result.ok, "a statement opened a requirement block the gate never inspected").toBe(false);
    expect(await recordOf(projectRoot, INJECTED), "the injected block landed in the workspace").toBeUndefined();
  });

  it("append_section_note in replace mode refuses text carrying a Markdown heading", async () => {
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, {
      id: CARRIER,
      section: "rationale",
      mode: "replace",
      text: injectionPayload("FR-ARCH-702")
    });

    expect(result.ok, "a replaced Rationale opened a requirement block").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-702")).toBeUndefined();
  });

  it("append_section_note in append mode refuses text carrying a Markdown heading", async () => {
    // The appended form is prefixed with `- [date] `, so only the first line is inside the bullet;
    // every line after it lands at column zero exactly as in replace mode.
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, {
      id: CARRIER,
      section: "implementation_notes",
      text: injectionPayload("FR-ARCH-704")
    });

    expect(result.ok, "an appended note opened a requirement block").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-704")).toBeUndefined();
  });

  it("replace_acceptance_criteria refuses an item whose text carries a Markdown heading", async () => {
    const projectRoot = await fixture();

    const result = await replaceAcceptanceCriteria(projectRoot, {
      id: CARRIER,
      items: [{ text: injectionPayload("FR-ARCH-703"), checked: true }]
    });

    expect(result.ok, "an acceptance criterion opened a requirement block").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-703")).toBeUndefined();
  });

  it("add_requirement refuses the same payload — the route already closed, kept as the control", async () => {
    const projectRoot = await fixture();

    const result = await addRequirement(projectRoot, {
      scope: "ARCH",
      type: "functional",
      title: "A carrier",
      statement: injectionPayload("FR-ARCH-705"),
      target: "v1.0.0",
      acceptanceCriteria: ["Something."]
    });

    expect(result.ok).toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-705")).toBeUndefined();
  });

  it("the refusal names the field and quotes the heading, so the caller can find it", async () => {
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, {
      id: CARRIER,
      section: "rationale",
      mode: "replace",
      text: injectionPayload("FR-ARCH-706")
    });

    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.error.message;
    expect(message, "the refusal does not say which heading was found").toContain("### FR-ARCH-706");
  });

  it("ordinary multi-line prose is still accepted, so the guard bounds itself to headings", async () => {
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, {
      id: CARRIER,
      section: "rationale",
      mode: "replace",
      text: "One paragraph.\n\nA second paragraph, with a `#` inside a code span and a - bullet."
    });

    expect(result.ok, "the guard refused prose that opens no section").toBe(true);
  });
});

describe("FR-NODE-174 AC-9 — a status reason is a table cell and cannot open a block either", () => {
  // Round 5 landed the requirement's own worst case through three live routes. `reason` is
  // interpolated into a Change Notes row INSIDE the block, and its only validator allowed LF — and
  // never forbade a pipe at all, so the cell could be broken open two ways. Every other writer of a
  // table cell in this repository goes through `assertSafeMarkdownTableCell`; these did not.
  const REASON = `Recorded.\n\n### FR-ARCH-801 — Smuggled\n\n| Field | Value |\n| --- | --- |\n| Status | verified |`;

  it("update_status refuses a reason that opens a requirement block", async () => {
    const projectRoot = await fixture();
    const { updateStatus } = await import("../../../src/core/mutation/update-status.js");

    const result = await updateStatus(projectRoot, { id: CARRIER, status: "implemented", reason: REASON });

    expect(result.ok, "a status reason opened a requirement block").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-801")).toBeUndefined();
  });

  it("update_stability refuses a reason that opens a requirement block", async () => {
    const projectRoot = await fixture();
    const { updateStability } = await import("../../../src/core/mutation/update-stability.js");

    const result = await updateStability(projectRoot, { id: CARRIER, stability: "stable", reason: REASON });

    expect(result.ok, "a stability reason opened a requirement block").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-801")).toBeUndefined();
  });

  it("retarget refuses a reason that opens a requirement block", async () => {
    const projectRoot = await fixture();
    const { retarget } = await import("../../../src/core/mutation/retarget.js");

    const result = await retarget(projectRoot, { ids: [CARRIER], toTarget: "v1.0.0", reason: REASON, dryRun: false });

    expect(result.ok, "a retarget reason opened a requirement block").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-801")).toBeUndefined();
  });

  it("a multi-line reason that opens no heading is still accepted, because two criteria require it", async () => {
    // NOT an oversight. `20.parser-validation.srs.md:1148` AC-7 and `40.mcp-stdio-interface.srs.md:1416`
    // AC-4 both state that a reason rejects control characters *other than* TAB, LF and CR, and a
    // case named "accepts reason with TAB / LF / CR (Windows CRLF friendly)" asserts it. A first
    // attempt at this guard used `assertSafeMarkdownTableCell`, which forbids newline and pipe
    // outright; it closed the injection and falsified those two criteria at the same time. The
    // heading is what opens a block — the parser starts a record only at `### ID — title` — so the
    // narrow guard closes the hole without contradicting anything already asserted.
    //
    // Residual, recorded rather than left to be found: a newline or a pipe in a reason still breaks
    // the Change Notes row it is written into. That is a rendering defect, not an injection, and
    // repairing it means changing two criteria that are ticked today.
    const projectRoot = await fixture();
    const { updateStatus } = await import("../../../src/core/mutation/update-status.js");

    const result = await updateStatus(projectRoot, { id: CARRIER, status: "implemented", reason: "line1\r\nline2\tcol" });

    expect(result.ok, "the guard refused a multi-line reason two acceptance criteria permit").toBe(true);
  });

  it("a reason whose heading is indented past the CommonMark threshold is refused", async () => {
    // Round 7. The guard used CommonMark's rule — up to three leading spaces — while
    // `block-scanner.ts:74` matches its section pattern against `line.trim()`. Four spaces and a
    // `##` therefore passed the guard and was still a top-level section to the parser. Measured
    // consequence of the gap: one `update_status` deleted two requirements from the parsed model and
    // turned `ready: false` into `ready: true` with zero validation errors.
    const projectRoot = await fixture();
    const { updateStatus } = await import("../../../src/core/mutation/update-status.js");

    const result = await updateStatus(projectRoot, { id: CARRIER, status: "implemented", reason: "Recorded.\n\n    ## Notes\n" });

    expect(result.ok, "an indented heading in a reason passed the guard").toBe(false);
  });

  it("an indented heading is refused in a prose field as well as in a reason", async () => {
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, {
      id: CARRIER,
      section: "rationale",
      mode: "replace",
      text: "Fine.\n\n      ### FR-ARCH-707 — Indented past the threshold\n"
    });

    expect(result.ok, "an indented heading in a prose field passed the guard").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-707")).toBeUndefined();
  });

  it("the guard rejects every prefix the parser treats as a record boundary", async () => {
    // This case used to compare two REGEX SOURCE STRINGS: it asserted `!(guardBounded && scannerTrims)`
    // where `guardBounded` matched the literal `\s{0,3}` in the guard's text. The guard was changed to
    // `\s*` in the same session, which made `guardBounded` permanently false and the conjunction
    // permanently false — so the case passed no matter what the parser did. An audit measured it
    // unfalsifiable, and it was pinning the very defect it was written for.
    //
    // Measured on both sides instead. The parser side is not read from the source, it is RUN: the
    // payload is written straight into the file, bypassing the guard entirely, and the workspace is
    // re-parsed to see whether a record appeared. The property is one-directional on purpose — the
    // guard may be stricter than the parser, it may never be looser.
    const PREFIXES = ["", " ", "  ", "   ", "    ", "        ", "\t", " ", "　"];
    const looser: string[] = [];
    let boundaries = 0;

    // The parser's own scanner, run over a two-block document with the payload placed between the
    // blocks. `scanRequirementBlocks` is what decides where a requirement block starts and ends, so
    // it is the thing to compare the guard against — an earlier version of this case compared two
    // REGEX SOURCE STRINGS and a later one measured a damage population of one, both of which an
    // audit caught. Reading the scanner's own answer removes both failure modes.
    const document = (payload: string): string[] => [
      "## 4. Requirements",
      "",
      "### FR-ARCH-001 — First",
      "",
      "#### Requirement",
      "",
      "Something.",
      "",
      payload,
      "",
      "### FR-ARCH-002 — Second",
      "",
      "#### Requirement",
      "",
      "Something else."
    ];

    for (const prefix of PREFIXES) {
      const payload = `${prefix}## Notes`;
      const guardRejects = assertOpensNoBlockBoundary("probe", `Ordinary.\n\n${payload}\n`) !== undefined;
      const withPayload = scanRequirementBlocks(document(payload), "probe.srs.md").blocks.length;
      const withoutPayload = scanRequirementBlocks(document("Ordinary prose."), "probe.srs.md").blocks.length;

      if (withPayload < withoutPayload) boundaries += 1;
      if (withPayload < withoutPayload && !guardRejects) looser.push(JSON.stringify(prefix));
    }

    // Without this the loop could report "nothing is looser" because nothing was a boundary at all.
    expect(boundaries, "no prefix in this set is a boundary to the parser, so the case asserts nothing").toBeGreaterThan(0);
    expect(looser, "the parser ends the block on a prefix the guard lets through").toEqual([]);
  });

  it("the guard rejects every fence spelling the parser enters fence state on", async () => {
    // The same property for the parser's OTHER boundary. Measured the same way: written into the file
    // directly, then the record after it is looked for. If the parser swallowed it, the guard must
    // have refused it.
    const SPELLINGS = ["```", "~~~", " ```", "   ```", "    ```", "````", "~~~~~", "```ts"];
    const looser: string[] = [];

    for (const spelling of SPELLINGS) {
      const guardRejects = assertOpensNoBlockBoundary("probe", `Ordinary.\n${spelling}\n`) !== undefined;

      const projectRoot = await fixture();
      const file = (await parseWorkspace(projectRoot)).files.find((entry) => entry.relativePath.endsWith(".srs.md") && !entry.relativePath.endsWith("00.index.md"));
      const filePath = path.join(projectRoot.root, file?.relativePath ?? "");
      await writeFile(
        filePath,
        `${await readFile(filePath, "utf8")}\n\n${spelling}\n\n### FR-ARCH-910 — After the fence\n\n| Field | Value |\n| --- | --- |\n| Type | functional |\n| Target | v1.0.0 |\n| Status | verified |\n`,
        "utf8"
      );
      const parserSwallowed = !(await parseWorkspace(projectRoot)).records.some((record) => record.id === "FR-ARCH-910");

      if (parserSwallowed && !guardRejects) looser.push(JSON.stringify(spelling));
    }

    expect(looser, "the parser enters fence state on a spelling the guard lets through").toEqual([]);
  });

  it("an ordinary one-line reason is still accepted", async () => {
    const projectRoot = await fixture();
    const { updateStatus } = await import("../../../src/core/mutation/update-status.js");

    const result = await updateStatus(projectRoot, { id: CARRIER, status: "implemented", reason: "Ordinary prose, recorded." });

    expect(result.ok, "the guard refused a reason that opens nothing").toBe(true);
  });
});

describe("FR-NODE-174 AC-9 — the guard has one implementation and every named route uses it", () => {
  /**
   * Pins the shape rather than the behaviour: a route that drops the import fails here even if some
   * other case happens to cover it. It does NOT detect a route added later under a new name — that
   * bound is stated in AC-9 rather than left for a reader to discover.
   */
  const ROUTES = ["add-requirement.ts", "edit-requirement.ts", "append-section-note.ts"];
  const GUARD = "assertOpensNoBlockBoundary";

  it("exactly one source file defines the guard", async () => {
    const dir = path.join(REPO_ROOT, "src", "core", "mutation");
    const definers: string[] = [];
    for (const entry of await readdir(dir)) {
      if (!entry.endsWith(".ts")) continue;
      const body = await readFile(path.join(dir, entry), "utf8");
      if (new RegExp(`export function ${GUARD}\\b`).test(body)) definers.push(entry);
    }

    expect(definers, `${GUARD} must have exactly one definition`).toHaveLength(1);
  });

  it("every named route calls the shared guard rather than its own copy", async () => {
    const dir = path.join(REPO_ROOT, "src", "core", "mutation");
    const missing: string[] = [];
    for (const route of ROUTES) {
      const body = await readFile(path.join(dir, route), "utf8");
      if (!body.includes(GUARD)) missing.push(route);
    }

    expect(missing, "a route that writes caller prose into a block does not consult the guard").toEqual([]);
  });
});

// An eighth verification round measured the guard walked around again, and this time without a `#`
// anywhere in the payload. `scanRequirementBlocks` has TWO boundary mechanisms, not one: a heading,
// and a code fence. On a fence line it enters fence state and returns on every subsequent line, so
// each later `### FR-…` start and each `## ` section boundary stops existing. A guard written for
// headings alone models half of what decides where a requirement block ends.
//
// Measured on a three-requirement workspace with zero validation errors: a note of
// "Implementation detail.\n```" left TWO requirements out of the parsed model and turned
// `ready: false` into `ready: true`, with the mutation returning ok and the validator reporting
// nothing at all. Silent, unlike every other route in this class.
describe("FR-NODE-174 AC-9 — a code fence is a record boundary, and the guard must know it", () => {
  // The parser's own fence pattern is /^(?: {0,3})(`{3,}|~{3,})/ — both markers, three or more, up
  // to three leading spaces. Each spelling is a separate case because a guard that handled only
  // backticks would pass four of the five.
  const FENCES = ["```", "~~~", "   ```", "````", "~~~~~"];

  it.each(FENCES)("append_section_note refuses prose that opens a fence with %j", async (fence) => {
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, {
      id: CARRIER,
      section: "implementation_notes",
      text: `Implementation detail.\n${fence}`
    });

    expect(result.ok, "an unclosed fence entered the block and swallowed everything after it").toBe(false);
  });

  it("edit_requirement_fields refuses a statement that opens a fence", async () => {
    const projectRoot = await fixture();

    const result = await updateRequirementFields(projectRoot, { id: CARRIER, statement: "Ordinary.\n```" });

    expect(result.ok).toBe(false);
  });

  it("replace_acceptance_criteria refuses an item that opens a fence", async () => {
    const projectRoot = await fixture();

    const result = await replaceAcceptanceCriteria(projectRoot, { id: CARRIER, items: [{ text: "Ordinary.\n```", checked: false }] });

    expect(result.ok).toBe(false);
  });

  it("update_status refuses a reason that opens a fence", async () => {
    // The reason lands in a Change Notes table cell, where newline is deliberately permitted — two
    // ticked criteria elsewhere require it. So the cell guard cannot catch this and the prose guard
    // is the only thing that can.
    const projectRoot = await fixture();
    const { updateStatus } = await import("../../../src/core/mutation/update-status.js");

    const result = await updateStatus(projectRoot, { id: CARRIER, status: "in_progress", reason: "Recorded.\n```" });

    expect(result.ok).toBe(false);
  });

  it("no requirement disappears from the workspace when a fence payload is refused", async () => {
    // The assertion that matters. A refusal that still wrote would be worse than no guard, and a
    // guard measured only by its return value would not notice.
    const projectRoot = await fixture();
    // The fixture ships ONE requirement, and a fence deletes only what follows it — so on the bare
    // fixture this case could not fail whatever the guard did. The population is built first, and
    // the assertion below refuses to run against a population that cannot show the damage. The vacuity
    // guard is not decoration: it is what caught this case asserting nothing.
    for (const suffix of ["second", "third"]) {
      const added = await addRequirement(projectRoot, {
        scope: "ARCH",
        type: "functional",
        title: `A ${suffix} requirement, written after the carrier`,
        statement: "The system SHALL carry something ordinary.",
        target: "v1.0.0",
        acceptanceCriteria: ["Something."]
      });
      expect(added.ok, "the fixture could not be populated").toBe(true);
    }
    const before = (await parseWorkspace(projectRoot)).records.map((record) => record.id).sort();
    expect(before.length, "the fixture carries too few requirements for this to be able to fail").toBeGreaterThan(1);

    await appendSectionNote(projectRoot, { id: CARRIER, section: "research", text: "Ordinary.\n```" });

    const after = (await parseWorkspace(projectRoot)).records.map((record) => record.id).sort();
    expect(after, "the fence payload cost the workspace a requirement").toEqual(before);
  });

  it("a balanced pair is refused too, and the bound that makes that right is stated", async () => {
    // A balanced pair is inert to THIS parser, so refusing it is stricter than the parser requires.
    // It is refused anyway, for a measured reason: no requirement block in `docs/spec/*.srs.md`
    // contains a fence today, so the rule costs nothing, and matching the parser's parity model
    // would leave the guard correct only for as long as that model stays parity-based. When a
    // requirement genuinely needs fenced prose, the guard and the parser have to learn balance
    // together — which is the lesson of the round that preceded this one.
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, {
      id: CARRIER,
      section: "research",
      text: "Example:\n```\nsome code\n```\nDone."
    });

    expect(result.ok).toBe(false);
  });

  it("the refusal says a fence was found rather than blaming a heading", async () => {
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, { id: CARRIER, section: "research", text: "Ordinary.\n```" });

    const message = result.ok ? "" : result.error.message;
    expect(message.toLowerCase(), "the caller cannot tell what was rejected").toContain("fence");
  });

  it("prose that merely mentions backticks inline is still accepted", async () => {
    // The bound in the other direction: `code` spans are ordinary in this repository's prose and a
    // guard that rejected them would be unusable.
    const projectRoot = await fixture();

    const result = await appendSectionNote(projectRoot, {
      id: CARRIER,
      section: "research",
      text: "The helper `assertOpensNoBlockBoundary` is called by every route, and ``double`` spans are fine."
    });

    expect(result.ok, "an inline code span was mistaken for a fence").toBe(true);
  });
});

// The same round found the guard covering four prose fields of `add_requirement` and not the fifth
// caller-supplied string on the same call. `title` is written verbatim into `### ID — <title>`, so a
// newline in it puts everything after it at column zero — measured minting a body `verified` row
// whose evidence points outside the checkout, which no granular edit can then repair because
// `assertEditable` refuses `verified`. `edit_requirement_fields` has rejected exactly this since it
// was written; the create route never got the same rule.
describe("FR-NODE-174 AC-7 — a requirement's title cannot open anything either", () => {
  const forgedTitle = `A carrier\n\n${injectionPayload("FR-ARCH-801")}`;

  it("add_requirement refuses a title carrying a forged verified block", async () => {
    const projectRoot = await fixture();

    const result = await addRequirement(projectRoot, {
      scope: "ARCH",
      type: "functional",
      title: forgedTitle,
      statement: "The system SHALL do something ordinary.",
      target: "v1.0.0",
      acceptanceCriteria: ["Something."]
    });

    expect(result.ok, "a title opened a requirement block the gate never inspected").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-801"), "the forged verified block landed").toBeUndefined();
  });

  it("add_requirement refuses any newline in a title, because the heading line is one line", async () => {
    const projectRoot = await fixture();

    const result = await addRequirement(projectRoot, {
      scope: "ARCH",
      type: "functional",
      title: "First line\nsecond line",
      statement: "The system SHALL do something ordinary.",
      target: "v1.0.0",
      acceptanceCriteria: ["Something."]
    });

    expect(result.ok).toBe(false);
  });

  it("supersede_requirement refuses the same title, since it reaches the same writer", async () => {
    const projectRoot = await fixture();
    const { supersedeRequirement } = await import("../../../src/core/mutation/supersede-requirement.js");

    const result = await supersedeRequirement(projectRoot, {
      oldId: CARRIER,
      scope: "ARCH",
      target: "v1.0.0",
      title: forgedTitle,
      statement: "The system SHALL do something ordinary.",
      acceptanceCriteria: ["Something."]
    });

    expect(result.ok, "supersede walked around the guard its own creator applies").toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-801")).toBeUndefined();
  });

  it("add_requirement refuses an acceptance criterion that opens a fence", async () => {
    // The sibling writer of the same field, `replace_acceptance_criteria`, has refused this since the
    // guard existed. `add_requirement` renders `- [ ] AC-N: ${criterion}` from the same kind of value
    // and never got the rule — the third time in this requirement that one of two writers of one
    // field held it. Measured: `ready` false -> true, two requirements gone, ZERO validation errors.
    const projectRoot = await fixture();

    const result = await addRequirement(projectRoot, {
      scope: "ARCH",
      type: "functional",
      title: "A carrier",
      statement: "The system SHALL do something ordinary.",
      target: "v1.0.0",
      acceptanceCriteria: ["criterion text\n```"]
    });

    expect(result.ok, "an acceptance criterion opened a fence and ended the block").toBe(false);
  });

  it("add_requirement refuses an acceptance criterion carrying a forged verified block", async () => {
    const projectRoot = await fixture();

    const result = await addRequirement(projectRoot, {
      scope: "ARCH",
      type: "functional",
      title: "A carrier",
      statement: "The system SHALL do something ordinary.",
      target: "v1.0.0",
      acceptanceCriteria: ["legit criterion", injectionPayload("FR-ARCH-900")]
    });

    expect(result.ok).toBe(false);
    expect(await recordOf(projectRoot, "FR-ARCH-900")).toBeUndefined();
  });

  it("no requirement disappears when an acceptance-criterion payload is refused", async () => {
    const projectRoot = await fixture();
    for (const suffix of ["second", "third"]) {
      const added = await addRequirement(projectRoot, {
        scope: "ARCH",
        type: "functional",
        title: `A ${suffix} requirement`,
        statement: "The system SHALL carry something ordinary.",
        target: "v1.0.0",
        acceptanceCriteria: ["Something."]
      });
      expect(added.ok).toBe(true);
    }
    const before = (await parseWorkspace(projectRoot)).records.map((record) => record.id).sort();
    expect(before.length, "the fixture is too small for this to be able to fail").toBeGreaterThan(1);

    await addRequirement(projectRoot, {
      scope: "ARCH",
      type: "functional",
      title: "A carrier",
      statement: "The system SHALL do something ordinary.",
      target: "v1.0.0",
      acceptanceCriteria: ["criterion text\n```"]
    });

    expect((await parseWorkspace(projectRoot)).records.map((record) => record.id).sort()).toEqual(before);
  });

  it("an ordinary one-line title is still accepted", async () => {
    const projectRoot = await fixture();

    const result = await addRequirement(projectRoot, {
      scope: "ARCH",
      type: "functional",
      title: "An ordinary title with `code` and — punctuation",
      statement: "The system SHALL do something ordinary.",
      target: "v1.0.0",
      acceptanceCriteria: ["Something."]
    });

    expect(result.ok, "the guard refused a title that opens nothing").toBe(true);
  });
});

// Two more routes the same round measured writing caller text into `docs/spec/` with no guard at
// all. Both are loud — the validator reports errors afterwards — which is why they are recorded
// below the silent ones, not because a loud corruption is acceptable.
describe("FR-NODE-174 AC-9 — the index writers consult the guard as well", () => {
  it("set_target_goal refuses a goal that opens a section", async () => {
    // Measured: a goal carrying `## 4. Scope Map` and a forged table replaced the live Scope Map,
    // taking the index's registered scopes from ARCH to XXX.
    const projectRoot = await fixture();
    const { setTargetGoal } = await import("../../../src/core/mutation/set-target-goal.js");

    const result = await setTargetGoal(projectRoot, {
      target: "v1.0.0",
      goal: "Ship it.\n\n## 4. Scope Map\n\n| Scope | Document | Prefix | Description |\n| --- | --- | --- | --- |\n| Forged | [x.md](./x.md) | XXX | forged |"
    });

    expect(result.ok, "a target goal rewrote the index's Scope Map").toBe(false);
  });

  it("set_target_goal refuses a goal carrying a newline, not only one carrying a heading", async () => {
    // The goal renders as `**Goal:** <goal>` on ONE line, so a newline puts the remainder at column
    // zero whether or not it opens a heading. Measured: a goal of
    // "Ship it.\n| Alpha | Beta |\n| --- | --- |\n| forged | row |" returned ok and wrote a table into
    // the index. The heading guard cannot see it — this is the single-line rule's job, and `title`
    // and `scope name` had it while `goal` did not.
    const projectRoot = await fixture();
    const { setTargetGoal } = await import("../../../src/core/mutation/set-target-goal.js");

    const result = await setTargetGoal(projectRoot, {
      target: "v1.0.0",
      goal: "Ship it.\n| Alpha | Beta |\n| --- | --- |\n| forged | row |"
    });

    // Accepted, not refused — `20.parser-validation.srs.md:1209` AC-6 states that goal text accepts
    // CR/LF/TAB, and that criterion is ticked. A first attempt at this repair rejected the newline,
    // which turned that criterion false; the suite caught it and the guard was withdrawn in favour of
    // folding the value at the point it is rendered. What matters is the FILE, so that is what is
    // asserted: no line the caller wrote may begin at column zero.
    expect(result.ok).toBe(true);
    const index = await readFile(path.join(projectRoot.root, "docs", "spec", "00.index.md"), "utf8");
    const smuggled = index.split(/\r?\n/).filter((line) => line.startsWith("| Alpha") || line.startsWith("| forged"));
    expect(smuggled, "a goal wrote table rows at column zero of the index").toEqual([]);
    expect(index, "the goal itself was lost rather than folded").toContain("Ship it. | Alpha | Beta |");
  });

  it("set_target_goal still accepts an ordinary one-line goal", async () => {
    const projectRoot = await fixture();
    const { setTargetGoal } = await import("../../../src/core/mutation/set-target-goal.js");

    const result = await setTargetGoal(projectRoot, { target: "v1.0.0", goal: "Ship the thing, with `code` in the sentence." });

    expect(result.ok, "the guard refused a goal that opens nothing").toBe(true);
  });

  it("scaffold_scope refuses a scope name that opens a section", async () => {
    // Measured: the name is interpolated at two sites of the scope template, and a payload carrying
    // a `### FR-ZZZ-001` block with `| Status | verified |` minted the same forged record twice.
    const projectRoot = await fixture();
    const { scaffoldScope } = await import("../../../src/core/mutation/scaffold-scope.js");

    const result = await scaffoldScope(projectRoot, {
      name: "Forged\n\n### FR-ZZZ-001 — Forged verified block\n\n| Field | Value |\n| --- | --- |\n| Status | verified |",
      prefix: "ZZZ",
      apply: true
    });

    expect(result.ok, "a scope name minted a verified requirement").toBe(false);
    expect(await recordOf(projectRoot, "FR-ZZZ-001")).toBeUndefined();
  });
});
