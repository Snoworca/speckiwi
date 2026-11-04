import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { projectRequirementRecords } from "../../src/core/query/discovery.js";
import { acFixture } from "./ac-expiry-fixture.js";

// FR-PARSE-044 AC-1 returns expired criteria beside the live ones; the `fields` projection of
// list/search (CLI --fields, MCP fields) rejects the new field, so a caller asking for
// `acceptanceCriteria` sees the expired ones vanish with no way to request them.
describe("verify r1 — fields projection and expired criteria", () => {
  it("accepts expiredAcceptanceCriteria as a requestable field", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03]"] });
    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
    const records = workspace.records.filter((r) => r.id === "FR-ARCH-001");
    const out = projectRequirementRecords(records, { fields: ["acceptanceCriteria", "expiredAcceptanceCriteria"] }) as { records: Record<string, unknown>[] };
    expect(out.records[0]!.expiredAcceptanceCriteria).toEqual([expect.objectContaining({ id: "AC-2", expiredOn: "2026-11-03" })]);
  });
});
