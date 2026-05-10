import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatchPlan } from "../../../src/core/patch/apply-patch.js";
import { createPatchPlan } from "../../../src/core/patch/patch-plan.js";
import { readUtf8File } from "../../../src/core/fs/read-text.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("line patch engine", () => {
  it("supports dry-run, replacement, insertion, append, and CRLF preservation", async () => {
    const root = await copyFixtureWorkspace("crlf-basic");
    const filePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const file = await readUtf8File(filePath);
    const plan = createPatchPlan(file, [
      { type: "replaceLine", line: 1, original: "# Product Architecture", replacement: "# Product Architecture Updated" },
      { type: "appendLines", lines: ["", "<!-- patch -->"] }
    ]);

    const dryRun = await applyPatchPlan(plan, { dryRun: true });
    expect(dryRun.written).toBe(false);
    expect(await readFile(filePath, "utf8")).toContain("# Product Architecture\r\n");

    const applied = await applyPatchPlan(plan, { dryRun: false });
    expect(applied.written).toBe(true);
    expect(await readFile(filePath, "utf8")).toContain("# Product Architecture Updated\r\n");
  });

  it("leaves bytes unchanged on stale original line mismatch", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const filePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    await writeFile(filePath, "# changed\n", "utf8");
    const file = await readUtf8File(filePath);
    const plan = createPatchPlan(file, [{ type: "replaceLine", line: 1, original: "# old", replacement: "# new" }]);
    await expect(applyPatchPlan(plan, { dryRun: false })).rejects.toThrow(/stale/i);
    expect(await readFile(filePath, "utf8")).toBe("# changed\n");
  });

  it("rejects writes when the file snapshot changed after planning", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const filePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const file = await readUtf8File(filePath);
    const before = await readFile(filePath, "utf8");
    const plan = createPatchPlan(file, [{ type: "replaceLine", line: 1, original: file.lines[0], replacement: "# planned" }]);

    await writeFile(filePath, before.replace("# Product Architecture", "# concurrent"), "utf8");

    await expect(applyPatchPlan(plan, { dryRun: false })).rejects.toMatchObject({ code: "STALE_PATCH" });
    expect(await readFile(filePath, "utf8")).toContain("# concurrent");
  });

  it("validates insert neighbors before rendering a patch", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const filePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const file = await readUtf8File(filePath);
    const before = await readFile(filePath, "utf8");
    const plan = createPatchPlan(file, [{ type: "insertLines", line: 2, lines: ["inserted"], expectedBefore: "# wrong" }]);

    await expect(applyPatchPlan(plan, { dryRun: true })).rejects.toThrow(/stale/i);
    expect(await readFile(filePath, "utf8")).toBe(before);
  });
});
