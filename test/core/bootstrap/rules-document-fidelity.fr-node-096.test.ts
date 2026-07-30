import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// FR-NODE-096 — six statements in the bundled rules document described behaviour the runtime does not
// have. A shipped rules document is a contract agents follow literally, so each of those is a defect
// in its own right; the fix is to make the sentence describe the runtime.
//
// Every assertion below is scoped to the section that owns the claim, so a matching phrase elsewhere
// in the document cannot satisfy it.

const RULES_DOCUMENT = path.join("docs", "rule", "SRS-MD-Rules-v2.5.0.md");

async function rulesText(): Promise<string> {
  return readFile(RULES_DOCUMENT, "utf8");
}

/**
 * Returns the text of one numbered section, from its heading to the next heading at the same or a
 * higher level. Scoping each assertion this way is what keeps it from passing on unrelated prose.
 */
function section(text: string, heading: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith(heading));
  if (start < 0) throw new Error(`section not found: ${heading}`);
  const level = (/^#+/.exec(lines[start]!.trim()) ?? ["#"])[0].length;
  let fenced = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    // These sections embed Markdown samples, whose `## 7. Completed Work Log` lines would otherwise
    // read as the end of the section.
    if (/^\s{0,3}```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#+)\s/.exec(line.trim());
    if (match && match[1]!.length <= level) return lines.slice(start, index).join("\n");
  }
  return lines.slice(start).join("\n");
}

describe("FR-NODE-096 AC-1 — the status transitions are stated as an unenforced convention", () => {
  it("says no tool call refuses a transition and names the gates the tool does enforce", async () => {
    const text = await rulesText();
    const transitions = section(text, "### 14.2");
    const implementedConditions = section(text, "### 14.3");

    expect(transitions).toContain("The list itself is not a gate");
    // What the section must now name is the write-time refusal, because that is what actually happens.
    expect(transitions).toContain("fails with `MUTATION_DENIED` unless the requirement already has");
    expect(transitions).toContain("confirmDiscardVerified");
    expect(transitions).toContain("`SRS-E010`");
    expect(transitions).toContain("`SRS-E033`");
    // The step-promotion gate applies only in tdd mode; stating it unqualified was a defect.
    expect(transitions).toContain("when the work-mode is `tdd`");
    expect(implementedConditions).toContain("No tool call refuses a transition to `implemented`");
    expect(implementedConditions).toContain("no write-time gate at all");
  });

  it("still lists the transitions, so the convention is not lost with the correction", async () => {
    const transitions = section(await rulesText(), "### 14.2");

    expect(transitions).toContain("implemented -> verified");
  });
});

describe("FR-NODE-096 AC-2 — the governing rules version is not a runtime switch", () => {
  it("says the version token aligns the row with the installed document and selects no behaviour", async () => {
    const governing = section(await rulesText(), "### 30.5");

    expect(governing).toContain("No runtime behaviour selects rules by that version");
    expect(governing).toContain("exactly one rules version");
  });
});

describe("FR-NODE-096 AC-3 — the atomicity claim is scoped to the requirement's own file", () => {
  it("names the index rollup as a separate follow-up write outside the transaction", async () => {
    const compliance = section(await rulesText(), "### 30.3");

    expect(compliance).toContain("separate follow-up write");
    expect(compliance).toContain("index rollup");
    // The old sentence promised the whole call could not be partially applied. It could.
    expect(compliance).not.toContain("so a partially applied result is not possible.");
  });
});

describe("FR-NODE-096 AC-4 — the index Required Structure carries the Rules row", () => {
  it("includes the row in the template and names the commands that write, insert and report it", async () => {
    const required = section(await rulesText(), "### 7.1");

    expect(required).toContain("| Rules |");
    expect(required).toContain("speckiwi init");
    expect(required).toContain("speckiwi upgrade");
    expect(required).toContain("speckiwi doctor");
  });
});

describe("FR-NODE-096 AC-5 — the compatibility-check tools take a requirement pair", () => {
  it("records that they take aReqId and bReqId rather than a single id", async () => {
    const compliance = section(await rulesText(), "### 30.3");

    expect(compliance).toContain("`aReqId`");
    expect(compliance).toContain("`bReqId`");
    expect(compliance).toContain("requirement pair");
  });
});

describe("FR-NODE-096 AC-6 — the legacy completed-work file's precedence is documented", () => {
  it("says the legacy file receives the appended row in preference to the history file", async () => {
    const completedWork = section(await rulesText(), "### 7.4");

    expect(completedWork).toContain("05.completed-work.md");
    expect(completedWork).toContain("in preference to");
  });
});
