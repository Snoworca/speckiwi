import { describe, expect, it } from "vitest";
import { loadBundledSdsRulesDocument } from "../../src/core/bootstrap/templates.js";
import { LITE_SDS_DIAGNOSTICS, LITE_SDS_LINE_CAP, parseLiteSds } from "../../src/core/sds/lite-sds.js";

// FR-NODE-209 AC-5 — the installed SDS rules document describes the lite profile.
//
// The document is read through the loader `init` installs from, so a whitelist or path mistake that
// ships the stub instead of the file fails here too. What the section must name is derived from the
// runtime (the line cap constant and the declared diagnostic codes) rather than transcribed, so a
// code added to the checker without a sentence in the rules makes this suite red.
//
// The raised bundled version (2.6.0) is held by FR-NODE-087 AC-7 in bundled-rules-completeness.

const LITE_HEADING = /^## \d+\. Lite Profile$/m;

async function liteSection(): Promise<string> {
  const text = (await loadBundledSdsRulesDocument()).replace(/\r\n/g, "\n");
  const match = LITE_HEADING.exec(text);
  expect(match, "the rules document has no '## N. Lite Profile' section").not.toBeNull();
  const start = match?.index ?? 0;
  const rest = text.slice(start + (match?.[0].length ?? 0));
  const next = rest.search(/^## \d+\. /m);
  return next < 0 ? text.slice(start) : text.slice(start, start + (match?.[0].length ?? 0) + next);
}

/** The body of the first fenced markdown block in the section — the copyable lite template. */
function template(section: string): string {
  const match = /```markdown\n([\s\S]*?)\n```/.exec(section);
  expect(match, "the lite section carries no ```markdown template").not.toBeNull();
  return match?.[1] ?? "";
}

describe("FR-NODE-209 AC-5 — the SDS rules document describes the lite profile", () => {
  it("FR-NODE-209 AC-5: states where a lite SDS lives and how it is recognised", async () => {
    const section = await liteSection();
    expect(section).toContain("docs/sds/<sds-id>.sds.md");
    expect(section).toContain("| Profile | lite |");
    // The optional scope field, and what it changes.
    expect(section).toContain("`Requirements`");
    expect(section).toMatch(/`Requirements`[^\n]*SDS-W068|SDS-W068[^\n]*`Requirements`/);
  });

  it("FR-NODE-209 AC-5: names the required sections and the four machine markers", async () => {
    const section = await liteSection();
    for (const heading of ["## Interfaces", "### Files", "### Depends", "## Acceptance Contracts", "## Test Plan"]) {
      expect(section, heading).toContain(heading);
    }
    for (const marker of ["@req", "←", "→", "SDS-AC-n (<REQ-ID> AC-m)"]) {
      expect(section, marker).toContain(marker);
    }
  });

  it("FR-NODE-209 AC-5: states the line cap the checker enforces and the command that checks it", async () => {
    const section = await liteSection();
    expect(section).toContain(`${LITE_SDS_LINE_CAP} lines`);
    expect(section).toContain("speckiwi sds check");
    expect(section).toContain("speckiwi validate");
  });

  it("FR-NODE-209 AC-5: names every lite diagnostic code with the severity the checker emits it at", async () => {
    const section = await liteSection();
    const rows = new Map<string, string>();
    for (const match of section.matchAll(/^\|\s*`(SDS-[EW]\d{3})`\s*\|\s*(error|warning)\s*\|/gm)) rows.set(match[1] as string, match[2] as string);
    const expected = new Map(Object.entries(LITE_SDS_DIAGNOSTICS).map(([code, definition]) => [code, definition.severity]));
    expect([...rows.entries()].sort()).toEqual([...expected.entries()].sort());
  });

  it("FR-NODE-209 AC-5: the embedded template is a lite SDS the parser accepts without a structural diagnostic", async () => {
    const parsed = parseLiteSds(template(await liteSection()), "docs/sds/example.sds.md");
    expect(parsed.isLite).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.contracts.length).toBeGreaterThan(0);
    expect(parsed.document.testPlan.length).toBeGreaterThan(0);
    expect(parsed.document.depends.length).toBeGreaterThan(0);
  });
});

// FR-FLOW-183 — kiwi-sds closes an SDS by moving its durable content into the SRS and marking it
// `closed` before the file is deleted. The skill cites the rules document for the SDS grammar, so the
// two pieces of that grammar the close-out reads — the durable marker and the `closed` state — are
// defined here rather than only in the skill that uses them.
describe("FR-FLOW-183 AC-2 · AC-4 — the rules document defines the durable marker and the closed state", () => {
  it("FR-FLOW-183 AC-2: a `## Durable Rules` section is the only durable marker, and it is not read by the checker", async () => {
    const section = await liteSection();
    const line = section.split(/\r?\n/).find((candidate) => candidate.includes("`## Durable Rules`"));
    expect(line, "no rule names the `## Durable Rules` section").toBeDefined();
    expect(line, "the durable marker names what close-out does with it").toMatch(/constraint requirement/);
    expect(line, "the rest of the structural notes are discarded").toMatch(/discarded|deleted/);
  });

  it("FR-FLOW-183 AC-4: the lifecycle names `closed` after `agreed`, and a closed SDS is not the current design", async () => {
    const section = await liteSection();
    expect(section).toMatch(/`draft` → `agreed` → `closed`|draft → agreed → closed/);
    const closedLine = section.split(/\r?\n/).find((candidate) => candidate.includes("`closed`") && /current design/.test(candidate));
    expect(closedLine, "no rule says a closed SDS is not the current design").toBeDefined();
  });
});
