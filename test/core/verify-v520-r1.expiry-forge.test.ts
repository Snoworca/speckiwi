import { describe, expect, it } from "vitest";
import { editAcceptanceCriteria } from "../../src/core/mutation/check-ac.js";
import { replaceAcceptanceCriteria } from "../../src/core/mutation/edit-requirement.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { acFixture, scopeText } from "./ac-expiry-fixture.js";

// Rules §21.7.1: the expired marker is written only by expire_acceptance_criterion (with the writer's
// date and a Change Notes reason); FR-NODE-243 AC-3: the last live criterion cannot be expired.
// The AC text editors accept the marker grammar verbatim, so they expire a criterion with any date,
// no reason row, and can expire the last live one.

async function liveOf(rootPath: string) {
  const ws = await parseWorkspace(await resolveProjectRoot(rootPath));
  return ws.records.find((r) => r.id === "FR-ARCH-001")!;
}

describe("verify r1 — AC text editors forge the expired marker", () => {
  it("edit_acceptance_criteria refuses text in the expired grammar (it would expire the last live AC with no reason)", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: only live", "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03]"] });
    const original = await scopeText(rootPath);
    const result = await editAcceptanceCriteria(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-1", text: "~~only live~~ [EXPIRED 1999-01-01]" });
    expect(result.ok).toBe(false);
    expect(await scopeText(rootPath)).toBe(original);
    expect((await liveOf(rootPath)).acceptanceCriteria.length).toBe(1);
  });

  it("replace_acceptance_criteria refuses items in the expired grammar (no live criterion left)", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: a", "- [x] AC-2: b"] });
    const original = await scopeText(rootPath);
    const result = await replaceAcceptanceCriteria(await resolveProjectRoot(rootPath), {
      id: "FR-ARCH-001",
      items: [{ text: "~~a~~ [EXPIRED 1999-01-01]", checked: false }]
    } as never);
    expect(result.ok).toBe(false);
    expect(await scopeText(rootPath)).toBe(original);
  });
});
