import { describe, expect, it } from "vitest";
import { cli, prdWorkspace, PRD_PATH } from "../../cli/prd-surface-fixture.js";

// Round 3 of the 5.2.0 PRD tool verification: CLI exit codes of refused PRD reads and cursor calls.
// IR-CLI-018 gives 1 to a validation error and 2 to a usage or argument error; `speckiwi show` of an
// unknown ID exits 2 (IR-CLI-007 AC-2) and the read family maps NOT_FOUND to 5.

const RUN = "r3";

describe("verify 5.2.0 round 3 — PRD CLI exit codes", () => {
  // @req FR-NODE-240 AC-3
  it("prd show of an item the file does not hold exits with a usage or not-found code, not the validation code 1", async () => {
    const root = await prdWorkspace();
    const shown = await cli(root, "show", PRD_PATH, "PRD-99", "--json");
    expect(JSON.parse(shown.stdout).error.code).toBe("PRD_ITEM_NOT_FOUND");
    expect([2, 5]).toContain(shown.code);
  });

  // @req FR-NODE-241 AC-1
  it("prd cursor seek beyond total exits 2 like a seek below 1", async () => {
    const root = await prdWorkspace();
    const low = await cli(root, "cursor", "seek", PRD_PATH, "--run-id", RUN, "--index", "0", "--json");
    const high = await cli(root, "cursor", "seek", PRD_PATH, "--run-id", RUN, "--index", "99", "--json");
    expect(JSON.parse(high.stdout).error.code).toBe("PRD_CURSOR_INDEX_OUT_OF_RANGE");
    expect(high.code).toBe(low.code);
    expect(high.code).toBe(2);
  });

  // @req FR-NODE-241 AC-2
  it("prd cursor next with a verdict outside the list exits 2 as an argument error", async () => {
    const root = await prdWorkspace();
    const bad = await cli(root, "cursor", "next", PRD_PATH, "--run-id", RUN, "--verdict", "bogus", "--json");
    expect(JSON.parse(bad.stdout).error.code).toBe("PRD_CURSOR_VERDICT_INVALID");
    expect(bad.code).toBe(2);
  });
});
