import { describe, expect, it } from "vitest";
import { expireAcceptanceCriterion } from "../../src/core/mutation/expire-ac.js";
import { updateField } from "../../src/core/mutation/update-field.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { acFixture } from "./ac-expiry-fixture.js";

const THREE_LIVE = ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: third"];

describe("r2 probes", () => {
  it("scope migration of the successor keeps the expired marker pointing at it (no dangling SRS-E012)", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE });
    const root = await resolveProjectRoot(rootPath);
    const before = validateWorkspace(await parseWorkspace(root)).diagnostics.filter((d) => d.code === "SRS-E012").length;
    const expired = await expireAcceptanceCriterion(root, { id: "FR-ARCH-001", acId: "AC-2", reason: "moved", successor: "FR-ARCH-002" });
    expect(expired.ok).toBe(true);
    const moved = await updateField(root, { id: "FR-ARCH-002", field: "scope", value: "NODE", dryRun: false, signOff: true });
    expect(moved.ok, JSON.stringify(moved.error)).toBe(true);
    const newId = moved.value!.newId!;
    const workspace = await parseWorkspace(root);
    const record = workspace.records.find((r) => r.id === "FR-ARCH-001")!;
    expect(record.expiredAcceptanceCriteria?.[0]?.successor).toBe(newId);
    const after = validateWorkspace(workspace).diagnostics.filter((d) => d.code === "SRS-E012");
    expect(after.length, after.map((d) => d.message).join("; ")).toBe(before);
  });
});
