import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_EXIT_CODES, exitCodeFor } from "../../src/cli/exit.js";
import { cliJson, PRD_PATH, prdWorkspace } from "./prd-surface-fixture.js";

// IR-CLI-018 for the PRD commands: every error code src/core/prd refuses with has its own row in the
// one CLI exit-code table, so none falls through to the validation code 1 by default.

const RUN = "exit";

/** Every `fail("PRD_…")` code under src/core/prd: the denominator, read from the source. */
async function prdErrorCodes(): Promise<string[]> {
  const directory = path.join("src", "core", "prd");
  const codes = new Set<string>();
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const match of text.matchAll(/fail\(\s*"(PRD_[A-Z_]+)"/g)) codes.add(match[1]!);
  }
  return [...codes].sort();
}

describe("IR-CLI-018 — PRD error codes in the CLI exit-code table", () => {
  // @req FR-NODE-241 AC-2
  it("gives every PRD error code its own row", async () => {
    const codes = await prdErrorCodes();
    expect(codes.length).toBeGreaterThanOrEqual(9);
    expect(codes.filter((code) => !Object.prototype.hasOwnProperty.call(CLI_EXIT_CODES, code))).toEqual([]);
  });

  // @req FR-NODE-241 AC-2
  it("maps argument errors to 2, a missing item and a finished round to 5, a corrupt ledger to 4 and duplicate item IDs to 1", () => {
    for (const code of ["PRD_CURSOR_INDEX_OUT_OF_RANGE", "PRD_CURSOR_VERDICT_INVALID", "PRD_CURSOR_VERDICT_REQUIRED", "PRD_CURSOR_DEFER_REASON_REQUIRED", "PRD_CURSOR_RUN_ID_INVALID"]) {
      expect(exitCodeFor(code), code).toBe(2);
    }
    expect(exitCodeFor("PRD_ITEM_NOT_FOUND")).toBe(exitCodeFor("NOT_FOUND"));
    expect(exitCodeFor("PRD_CURSOR_DONE")).toBe(5);
    expect(exitCodeFor("PRD_LEDGER_CORRUPT")).toBe(4);
    expect(exitCodeFor("PRD_CURSOR_DUPLICATE_ITEM")).toBe(1);
  });

  // @req FR-NODE-241 AC-2
  it("ends the CLI with those codes", async () => {
    const root = await prdWorkspace();
    const cursor = (action: string, ...rest: string[]) => cliJson<{ error: { code: string } }>(root, "cursor", action, PRD_PATH, "--run-id", RUN, ...rest);
    expect((await cursor("next")).code).toBe(2);
    expect((await cursor("next", "--verdict", "deferred")).code).toBe(2);
    expect((await cliJson(root, "cursor", "current", PRD_PATH, "--run-id", "Bad")).code).toBe(2);
    expect((await cliJson(root, "show", PRD_PATH, "PRD-99")).code).toBe(5);
    for (let n = 0; n < 4; n += 1) await cursor("next", "--verdict", "accepted");
    expect((await cursor("next", "--verdict", "accepted")).code).toBe(5);
    await mkdir(path.join(root, "kiwi", "prd"), { recursive: true });
    await writeFile(path.join(root, "kiwi", "prd", "broken.jsonl"), "not json\n", "utf8");
    const corrupt = await cliJson<{ error: { code: string } }>(root, "cursor", "current", PRD_PATH, "--run-id", "broken");
    expect(corrupt.json.error.code).toBe("PRD_LEDGER_CORRUPT");
    expect(corrupt.code).toBe(4);
  });
});
