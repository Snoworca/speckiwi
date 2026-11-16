import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { todayStamp } from "../../../src/core/date-stamp.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { appendAcceptanceCriterion, editAcceptanceCriteria } from "../../../src/core/mutation/check-ac.js";
import { replaceAcceptanceCriteria } from "../../../src/core/mutation/edit-requirement.js";
import { markAcceptanceCriterionNonTest, unmarkAcceptanceCriterionNonTest } from "../../../src/core/mutation/non-test-ac.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { acFixture, scopeText } from "../ac-expiry-fixture.js";

// @req FR-NODE-315 — the non-test marker is written and removed only by a tool that records why, and
// no other acceptance-criterion writer writes it or drops it silently.

const LINES = ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: ~~third~~ [EXPIRED 2026-01-02]"];
const MARKED = ["- [x] AC-1: first", "- [x] AC-2: second [NON-TEST]", "- [x] AC-3: ~~third~~ [EXPIRED 2026-01-02]"];

const root = (rootPath: string) => resolveProjectRoot(rootPath);

describe("FR-NODE-315 AC-1 — marking appends the marker and a Change Notes row in one patch", () => {
  // @req FR-NODE-315 AC-1
  it("appends ` [NON-TEST]`, keeps the number, text and box, and records the reason", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const result = await markAcceptanceCriterionNonTest(await root(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "needs a real authorization server" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const text = await scopeText(rootPath);
    expect(text).toContain("- [ ] AC-2: second [NON-TEST]\n");
    expect(text).toContain("- [x] AC-1: first\n");
    expect(text).toContain(`| ${todayStamp()} | Marked AC-2 non-test | needs a real authorization server |`);
    expect(result.value).toMatchObject({ id: "FR-ARCH-001", acId: "AC-2", written: true });
  });

  // @req FR-NODE-315 AC-1
  it("writes nothing on dryRun", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const before = await scopeText(rootPath);
    const result = await markAcceptanceCriterionNonTest(await root(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "manual", dryRun: true });
    expect(result.ok).toBe(true);
    expect(await scopeText(rootPath)).toBe(before);
  });
});

describe("FR-NODE-315 AC-2 — a mark that cannot stand is refused without writing", () => {
  // @req FR-NODE-315 AC-2
  it.each([
    ["an empty reason", { acId: "AC-2", reason: "  " }, /reason/],
    ["a control character in the reason", { acId: "AC-2", reason: "a\u0007b" }, /control/],
    ["an expired criterion", { acId: "AC-3", reason: "manual" }, /expired/],
    ["an absent criterion", { acId: "AC-9", reason: "manual" }, /AC-9/]
  ])("refuses %s", async (_label, call, message) => {
    const rootPath = await acFixture({ acLines: LINES });
    const before = await scopeText(rootPath);
    const result = await markAcceptanceCriterionNonTest(await root(rootPath), { id: "FR-ARCH-001", ...call });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(message);
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-315 AC-2
  it("refuses a criterion that is already marked", async () => {
    const rootPath = await acFixture({ acLines: MARKED });
    const before = await scopeText(rootPath);
    const result = await markAcceptanceCriterionNonTest(await root(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "again" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/already marked/);
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-315 AC-2
  it("refuses an absent requirement", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const result = await markAcceptanceCriterionNonTest(await root(rootPath), { id: "FR-ARCH-404", acId: "AC-2", reason: "manual" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("FR-ARCH-404");
  });

  // @req FR-NODE-315 AC-2
  it("refuses a verified requirement", async () => {
    const rootPath = await acFixture({ acLines: LINES, status: "verified" });
    const before = await scopeText(rootPath);
    const result = await markAcceptanceCriterionNonTest(await root(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "manual" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/verified/);
    expect(await scopeText(rootPath)).toBe(before);
  });
});

describe("FR-NODE-315 AC-3 — unmarking removes the marker and records why", () => {
  // @req FR-NODE-315 AC-3
  it("removes the marker and appends a Change Notes row", async () => {
    const rootPath = await acFixture({ acLines: MARKED });
    const result = await unmarkAcceptanceCriterionNonTest(await root(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "an automated test reaches it now" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const text = await scopeText(rootPath);
    expect(text).toContain("- [x] AC-2: second\n");
    expect(text).not.toContain("[NON-TEST]");
    expect(text).toContain(`| ${todayStamp()} | Unmarked AC-2 non-test | an automated test reaches it now |`);
  });

  // @req FR-NODE-315 AC-3
  it.each([
    ["an unmarked criterion", MARKED, "AC-1", "x", undefined],
    ["an expired criterion", MARKED, "AC-3", "x", undefined],
    ["an empty reason", MARKED, "AC-2", "", undefined],
    ["a verified requirement", MARKED, "AC-2", "x", "verified"]
  ])("refuses %s without writing", async (_label, lines, acId, reason, status) => {
    const rootPath = await acFixture({ acLines: lines, ...(status ? { status } : {}) });
    const before = await scopeText(rootPath);
    const result = await unmarkAcceptanceCriterionNonTest(await root(rootPath), { id: "FR-ARCH-001", acId, reason });
    expect(result.ok).toBe(false);
    expect(await scopeText(rootPath)).toBe(before);
  });
});

describe("FR-NODE-315 AC-4 — the other writers neither write the marker nor drop it", () => {
  // @req FR-NODE-315 AC-4
  it("add_requirement refuses a criterion written in the marker grammar and names the mark tool", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const before = await scopeText(rootPath);
    const result = await addRequirement(await root(rootPath), {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Forged",
      statement: "SpecKiwi SHALL keep it.",
      acceptanceCriteria: ["checked by hand [NON-TEST]"]
    } as Parameters<typeof addRequirement>[1]);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("mark_acceptance_criterion_non_test");
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-315 AC-4
  it("append_acceptance_criterion and edit_acceptance_criterion refuse the marker grammar", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const before = await scopeText(rootPath);
    const appended = await appendAcceptanceCriterion(await root(rootPath), { id: "FR-ARCH-001", text: "new one [NON-TEST]" });
    const edited = await editAcceptanceCriteria(await root(rootPath), { id: "FR-ARCH-001", acId: "AC-1", text: "reworded [NON-TEST]" });
    expect(appended.ok).toBe(false);
    expect(edited.ok).toBe(false);
    expect(appended.error?.message).toContain("mark_acceptance_criterion_non_test");
    expect(edited.error?.message).toContain("mark_acceptance_criterion_non_test");
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-315 AC-4
  it("edit_acceptance_criterion keeps the marker when it rewords a marked criterion", async () => {
    const rootPath = await acFixture({ acLines: MARKED });
    const result = await editAcceptanceCriteria(await root(rootPath), { id: "FR-ARCH-001", acId: "AC-2", text: "second, reworded" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await scopeText(rootPath)).toContain("- [x] AC-2: second, reworded [NON-TEST]\n");
  });

  // @req FR-NODE-315 AC-4
  it("replace_acceptance_criteria refuses while a criterion is marked, naming it", async () => {
    const rootPath = await acFixture({ acLines: MARKED });
    const before = await scopeText(rootPath);
    const result = await replaceAcceptanceCriteria(await root(rootPath), { id: "FR-ARCH-001", items: [{ text: "only one" }] });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("AC-2");
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-315 AC-4
  it("replace_acceptance_criteria refuses an item written in the marker grammar", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const before = await scopeText(rootPath);
    const result = await replaceAcceptanceCriteria(await root(rootPath), { id: "FR-ARCH-001", items: [{ text: "x [NON-TEST]" }] });
    expect(result.ok).toBe(false);
    expect(await scopeText(rootPath)).toBe(before);
  });
});

describe("FR-NODE-315 AC-5 — MCP and CLI agree, and unmarked requirements are written as before", () => {
  async function cli(rootPath: string, args: string[]): Promise<{ ok: boolean; error?: { message: string } }> {
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", rootPath, ...args, "--json"], streams);
    return JSON.parse(streams.stdout.read()?.toString() ?? "{}");
  }

  // @req FR-NODE-315 AC-5
  it("marks and unmarks the same way through MCP and the CLI", async () => {
    const viaMcp = await acFixture({ acLines: LINES });
    const viaCli = await acFixture({ acLines: LINES });
    const server = createMcpServer({ root: viaMcp });
    expect(((await server.callTool("mark_acceptance_criterion_non_test", { id: "FR-ARCH-001", acId: "AC-2", reason: "manual" })) as { ok: boolean }).ok).toBe(true);
    expect((await cli(viaCli, ["mark-ac-non-test", "FR-ARCH-001", "AC-2", "--reason", "manual"])).ok).toBe(true);
    expect(await scopeText(viaCli)).toBe(await scopeText(viaMcp));
    expect(((await server.callTool("unmark_acceptance_criterion_non_test", { id: "FR-ARCH-001", acId: "AC-2", reason: "back" })) as { ok: boolean }).ok).toBe(true);
    expect((await cli(viaCli, ["unmark-ac-non-test", "FR-ARCH-001", "AC-2", "--reason", "back"])).ok).toBe(true);
    expect(await scopeText(viaCli)).toBe(await scopeText(viaMcp));
    const refusedMcp = (await server.callTool("mark_acceptance_criterion_non_test", { id: "FR-ARCH-001", acId: "AC-3", reason: "x" })) as { ok: boolean; error?: { message: string } };
    const refusedCli = await cli(viaCli, ["mark-ac-non-test", "FR-ARCH-001", "AC-3", "--reason", "x"]);
    expect(refusedMcp.ok).toBe(false);
    expect(refusedCli.error?.message).toBe(refusedMcp.error?.message);
  });

  // @req FR-NODE-315 AC-5
  it("writes an unmarked criterion edit exactly as before", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const result = await editAcceptanceCriteria(await root(rootPath), { id: "FR-ARCH-001", acId: "AC-1", text: "first, reworded" });
    expect(result.ok).toBe(true);
    expect(await scopeText(rootPath)).toContain("- [x] AC-1: first, reworded\n- [ ] AC-2: second\n");
  });
});
