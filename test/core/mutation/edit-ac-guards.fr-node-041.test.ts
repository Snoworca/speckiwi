import { describe, expect, it } from "vitest";
import { editAcceptanceCriteria } from "../../../src/core/mutation/check-ac.js";
import { replaceAcceptanceCriteria } from "../../../src/core/mutation/edit-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { acFixture, scopeText } from "../ac-expiry-fixture.js";

// FR-NODE-041 AC-4 (the text rules, which hold no length limit) and AC-5 (the verified guard) of
// edit_acceptance_criteria.

const ID = "FR-ARCH-001";
const LIVE = ["- [x] AC-1: first", "- [ ] AC-2: second"];

describe("FR-NODE-041 AC-4 — empty or control-character text is refused, long text is not", () => {
  // @req FR-NODE-041 AC-4
  it("writes a criterion of 30000 units, longer than the old 16384 limit", async () => {
    const rootPath = await acFixture({ acLines: LIVE });
    const text = "z".repeat(30000);
    const result = await editAcceptanceCriteria(await resolveProjectRoot(rootPath), { id: ID, acId: "AC-2", text });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await scopeText(rootPath)).toContain(`- [ ] AC-2: ${text}\n`);
  });

  // @req FR-NODE-041 AC-4
  it("refuses empty text, a newline, a carriage return and a control character with USAGE and writes nothing", async () => {
    const rootPath = await acFixture({ acLines: LIVE });
    const before = await scopeText(rootPath);
    for (const text of ["", "one\ntwo", "one\rtwo", `bell${String.fromCharCode(7)}`]) {
      const result = await editAcceptanceCriteria(await resolveProjectRoot(rootPath), { id: ID, acId: "AC-2", text });
      expect(result.error?.code, JSON.stringify(text)).toBe("USAGE");
    }
    expect(await scopeText(rootPath)).toBe(before);
  });
});

describe("FR-NODE-041 AC-5 — a verified block is refused as replace_acceptance_criteria refuses it", () => {
  // @req FR-NODE-041 AC-5
  it("gives the same refusal and writes nothing", async () => {
    const rootPath = await acFixture({ acLines: LIVE, status: "verified" });
    const root = await resolveProjectRoot(rootPath);
    const before = await scopeText(rootPath);
    const replace = await replaceAcceptanceCriteria(root, { id: ID, items: [{ text: "x" }], dryRun: true });
    const edit = await editAcceptanceCriteria(root, { id: ID, acId: "AC-2", text: "changed after verified" });
    expect(replace.ok).toBe(false);
    expect(edit.ok).toBe(false);
    expect(edit.error).toEqual(replace.error);
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-041 AC-5
  it("still edits a block at any other status", async () => {
    const rootPath = await acFixture({ acLines: LIVE, status: "implemented" });
    const result = await editAcceptanceCriteria(await resolveProjectRoot(rootPath), { id: ID, acId: "AC-2", text: "changed" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
  });
});
