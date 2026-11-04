import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPrdCursor, prdCursorItems } from "../../../src/core/prd/cursor.js";
import { parsePrd } from "../../../src/core/prd/parse.js";
import { mcp, PRD_PATH, prdWorkspace, writePrd } from "../../cli/prd-surface-fixture.js";

// Round 11 of the 5.2.0 PRD tool verification: surfaces outside the citation grammar.

describe("verify 5.2.0 round 11 — PRD cursor and surfaces", () => {
  // @req FR-NODE-241 AC-4
  it("restarts at index 1 when the round holds lines of another hash, also after the PRD returns to earlier bytes", async () => {
    const root = await prdWorkspace();
    const file = path.join(root, ...PRD_PATH.split("/"));
    const original = await readFile(file);
    const cursorFor = (doc: ReturnType<typeof parsePrd>) =>
      createPrdCursor({ root, runId: "r11", direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) });
    const before = parsePrd(original, PRD_PATH);
    await cursorFor(before).next({ verdict: "accepted" });
    await cursorFor(before).next({ verdict: "accepted" });

    // The PRD is edited and one item is judged against the edit.
    const editedBytes = Buffer.concat([original, Buffer.from("\nedited\n")]);
    await writePrd(root, PRD_PATH, editedBytes);
    const edited = parsePrd(editedBytes, PRD_PATH);
    await cursorFor(edited).next({ verdict: "violated" });

    // The edit is undone (git checkout, an editor's undo): the PRD hash differs from the hash on the
    // round's latest lines, so the cursor reports `invalidated` — and AC-4 then restarts at index 1.
    await writePrd(root, PRD_PATH, original);
    const position = await cursorFor(before).current();
    expect(position.ok && position.value.invalidated).toBeTruthy();
    expect(position.ok && position.value.index).toBe(1);
  });

  // @req FR-NODE-242 AC-2
  it("refuses a coverage call over MCP that names no target as a usage error, as the CLI and the cursor do", async () => {
    // `speckiwi prd coverage <file>` without --target exits 2 (usage), and `prd_cursor` refuses a
    // srs-to-prd call without a target with USAGE. check_prd_coverage turns the missing target into
    // the empty string and answers TARGET_NOT_FOUND ("Target  is not in the Target Map"), exit class 5.
    const root = await prdWorkspace();
    const answer = await mcp(root, "check_prd_coverage", { path: PRD_PATH });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("USAGE");
  });

  // @req FR-NODE-240 AC-3
  it("refuses an item read over MCP that names no item ID as a usage error, as the CLI does", async () => {
    // `speckiwi prd show <path>` without <id> exits 2 (usage); get_prd_item reads the missing ID as ""
    // and answers PRD_ITEM_NOT_FOUND ("holds no item "), exit class 5.
    const root = await prdWorkspace();
    const answer = await mcp(root, "get_prd_item", { path: PRD_PATH });
    expect(answer.error?.code).toBe("USAGE");
  });
});
