import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("status and AC mutations", () => {
  it("updates status and checks all AC through shared guards", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["all"], checked: true });
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "implemented" });
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).toContain("| Status | implemented |");
  });

  it("denies verified when evidence is missing", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["all"], checked: true });
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "verified" });
    expect(result.ok).toBe(false);
  });
});
