import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readUtf8File } from "../../../src/core/fs/read-text.js";
import { applyPatchPlan } from "../../../src/core/patch/apply-patch.js";
import { createPatchPlan } from "../../../src/core/patch/patch-plan.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// The patch engine writes a temporary file beside the target and renames it over the target. When the
// rename fails, the temporary file must not be left in docs/spec (FR-NODE-232 AC-6 relies on a failed
// rename leaving docs/spec as it was; every mutation shares this writer).

describe("applyPatchPlan when the final rename fails", () => {
  // @req FR-NODE-232 AC-6
  it("rejects and leaves no temporary file beside the target", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const spec = path.join(root, "docs", "spec");
    const file = await readUtf8File(path.join(spec, "10.product-architecture.srs.md"), root);
    // A directory in the target's place: the rename over it fails on every platform.
    const target = path.join(spec, "blocked.srs.md");
    await mkdir(target);
    await mkdir(path.join(target, "inner"));
    const before = (await readdir(spec)).sort();

    const plan = createPatchPlan({ ...file, path: target }, [{ type: "appendLines", lines: ["x"] }]);
    await expect(applyPatchPlan(plan, { dryRun: false, staleCheck: false })).rejects.toThrow();

    expect((await readdir(spec)).sort()).toEqual(before);
  });
});
