import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { journalRoot, type Json } from "./waves-fixtures.js";

// @req FR-NODE-188
//
// The emit examples in the event contract are not illustrations — they are the literal command an
// agent copies to append a line, so a validator rule the shipped examples violate is a rule that
// refuses correct behaviour, and a shipped example the validator refuses is a producer defect that
// only shows up in a live run. This repository has recorded that failure from both directions: a
// gate whose exact documented producer it refused, and a gate at a version nothing wrote.
//
// Measured: nothing else in the suite parses these examples. The two parity tests over §2.2 compare
// FIELD NAMES, so an example missing a required field is invisible to them.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONTRACT_COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/_shared/kiwi/waves-event.md`
);

/** Every `echo '<json>' >> ...` append the contract ships, in document order. */
function examples(rel: string): Json[] {
  const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const found: Json[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = /^echo '(\{.*\})'\s*>>/.exec(raw);
    const captured = match?.[1];
    if (captured === undefined) continue;
    found.push(JSON.parse(captured) as Json);
  }
  return found;
}

describe.each(CONTRACT_COPIES)("the shipped emit examples validate (%s)", (copy) => {
  it("ships the three-line run the document describes", () => {
    // A count assertion, so deleting an example to make this file pass is not a silent option.
    expect(examples(copy)).toHaveLength(3);
  });

  it("produces no error diagnostic when appended as one run", async () => {
    const lines = examples(copy).map((line) => ({ ...(line as Record<string, unknown>), run_id: "run-a" }) as Json);
    const root = await journalRoot(lines);
    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });
    const errors = validateWavesJournal(view).filter((entry) => entry.severity === "error");

    expect(
      errors.map((entry) => `${entry.code}: ${entry.message}`),
      "an agent copying the documented command must not write a journal the tool refuses"
    ).toEqual([]);
  });
});

describe.each(CONTRACT_COPIES)("FR-NODE-188 AC-13 — the outcome field is declared where a writer reads it (%s)", (copy) => {
  it("carries its version marker and states what the token means", () => {
    // `outcome` is now the sole completion signal for two of the three rungs, and it arrived with a
    // §2.2 row that had neither a version marker nor a statement of its precedence. A field the tool
    // keys on and the contract under-describes is enforced nowhere a reader can see.
    const row = readFileSync(path.join(REPO_ROOT, copy), "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*\|\s*`outcome`\s*\|/.test(l));
    expect(row, `${copy}: §2.2 must carry an outcome row`).toBeDefined();
    expect(/delegated-complete/.test(row as string)).toBe(true);
    expect(/1\.5\.0~/.test(row as string), `${copy}: the row must say when the field arrived`).toBe(true);
    expect(
      /`status`/.test(row as string),
      `${copy}: the reader must be told an explicit status wins over the token`
    ).toBe(true);
  });
});
