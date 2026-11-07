import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer, toolSchemas } from "../../src/mcp/server.js";
import { acFixture, scopeText } from "../core/ac-expiry-fixture.js";

// FR-MCP-072 — `edit_acceptance_criterion` edits one criterion and `append_acceptance_criterion`
// (CLI `append-ac`) appends one, so a caller never restates the criteria it does not change.

const ID = "FR-ARCH-001";
const LIVE = ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: third"];
// The highest number the block ever used belongs to an expired criterion.
const WITH_EXPIRED_TOP = ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: ~~third~~ [EXPIRED 2026-01-01]"];

type Answer = { ok: boolean; value?: { acId?: string; written?: boolean }; error?: { code: string; message: string }; patch?: unknown };

/** The lines of `after` that differ from `before`, by position. */
function changedLines(before: string, after: string): Array<{ before: string | undefined; after: string | undefined }> {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: Array<{ before: string | undefined; after: string | undefined }> = [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) out.push({ before: a[index], after: b[index] });
  }
  return out;
}

async function cli(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...args], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

async function holdLock(root: string): Promise<void> {
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(
    path.join(root, "kiwi", ".srs.lock"),
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      owner: "another-session",
      operation: "add_requirement",
      requestId: "held",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    })}\n`,
    "utf8"
  );
}

describe("FR-MCP-072 AC-1 — edit_acceptance_criterion", () => {
  // @req FR-MCP-072 AC-1
  it("changes only the named criterion's text, keeps its checked state, and leaves every other line", async () => {
    const root = await acFixture({ acLines: LIVE });
    const before = await scopeText(root);
    const answer = (await createMcpServer({ root }).callTool("edit_acceptance_criterion", { id: ID, acId: "AC-3", text: "third, reworded" })) as Answer;
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(changedLines(before, await scopeText(root))).toEqual([{ before: "- [x] AC-3: third", after: "- [x] AC-3: third, reworded" }]);
  });

  // @req FR-MCP-072 AC-1
  it("dryRun returns the patch preview and writes nothing", async () => {
    const root = await acFixture({ acLines: LIVE });
    const before = await scopeText(root);
    const answer = (await createMcpServer({ root }).callTool("edit_acceptance_criterion", { id: ID, acId: "AC-2", text: "second, previewed", dryRun: true })) as Answer;
    expect(answer).toMatchObject({ ok: true, value: { written: false } });
    expect(JSON.stringify(answer)).toContain("- [ ] AC-2: second, previewed");
    expect(await scopeText(root)).toBe(before);
  });
});

describe("FR-MCP-072 AC-2 — append_acceptance_criterion and append-ac", () => {
  // @req FR-MCP-072 AC-2
  it("appends one unchecked criterion numbered one above the highest number used, expired included", async () => {
    const root = await acFixture({ acLines: WITH_EXPIRED_TOP });
    const before = await scopeText(root);
    const answer = (await createMcpServer({ root }).callTool("append_acceptance_criterion", { id: ID, text: "fourth" })) as Answer;
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(answer.value?.acId).toBe("AC-4");
    const after = await scopeText(root);
    expect(after).toContain(`${WITH_EXPIRED_TOP.join("\n")}\n- [ ] AC-4: fourth\n`);
    expect(after.replace("- [ ] AC-4: fourth\n", "")).toBe(before);
  });

  // @req FR-MCP-072 AC-2
  it("numbers past live criteria when no expired one is higher", async () => {
    const root = await acFixture({ acLines: ["- [x] AC-1: first", "- [ ] AC-2: ~~second~~ [EXPIRED 2026-01-01]", "- [x] AC-5: fifth"] });
    const answer = (await createMcpServer({ root }).callTool("append_acceptance_criterion", { id: ID, text: "sixth" })) as Answer;
    expect(answer.value?.acId).toBe("AC-6");
    expect(await scopeText(root)).toContain("- [x] AC-5: fifth\n- [ ] AC-6: sixth\n");
  });

  // @req FR-MCP-072 AC-2
  // Found by 5.3.6 C verification round 1 on a requirement block of the orchestrationgrid SRS: the
  // last criterion's nested detail bullets stay under it, the new criterion goes after them.
  it("appends after the last criterion's nested detail, not between the criterion and its detail", async () => {
    const lines = ["- [x] AC-1: first", "- [ ] AC-2: second", "  - detail one of AC-2", "", "  - detail two of AC-2"];
    const root = await acFixture({ acLines: lines });
    const answer = (await createMcpServer({ root }).callTool("append_acceptance_criterion", { id: ID, text: "third" })) as Answer;
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(await scopeText(root)).toContain(`${lines.join("\n")}\n- [ ] AC-3: third\n`);
  });

  // @req FR-MCP-072 AC-2
  it("the CLI append-ac does the same and --dry-run writes nothing", async () => {
    const root = await acFixture({ acLines: WITH_EXPIRED_TOP });
    const before = await scopeText(root);
    const dry = await cli(root, ["append-ac", ID, "--text", "fourth", "--dry-run", "--json"]);
    expect(dry.code, dry.stdout).toBe(0);
    expect(JSON.parse(dry.stdout)).toMatchObject({ ok: true, value: { acId: "AC-4", written: false } });
    expect(await scopeText(root)).toBe(before);

    const run = await cli(root, ["append-ac", ID, "--text", "fourth", "--json"]);
    expect(run.code, run.stdout).toBe(0);
    expect(await scopeText(root)).toContain(`${WITH_EXPIRED_TOP.join("\n")}\n- [ ] AC-4: fourth\n`);
  });
});

describe("FR-MCP-072 AC-3 — the verified guard, the text rules and the lock", () => {
  // @req FR-MCP-072 AC-3
  it("both refuse a verified block with replace_acceptance_criteria's refusal and write nothing", async () => {
    const root = await acFixture({ acLines: LIVE, status: "verified" });
    const before = await scopeText(root);
    const handle = createMcpServer({ root });
    const replace = (await handle.callTool("replace_acceptance_criteria", { id: ID, items: [{ text: "x" }], dryRun: true })) as Answer;
    const edit = (await handle.callTool("edit_acceptance_criterion", { id: ID, acId: "AC-1", text: "changed" })) as Answer;
    const append = (await handle.callTool("append_acceptance_criterion", { id: ID, text: "added" })) as Answer;
    expect(replace.ok).toBe(false);
    expect(edit.error).toEqual(replace.error);
    expect(append.error).toEqual(replace.error);
    expect(await scopeText(root)).toBe(before);
  });

  // @req FR-MCP-072 AC-3
  it("both apply the FR-NODE-041 text rules: over-long, newline and control characters are refused", async () => {
    const root = await acFixture({ acLines: LIVE });
    const before = await scopeText(root);
    const handle = createMcpServer({ root });
    for (const text of ["x".repeat(16385), "one\ntwo", `nul${String.fromCharCode(0)}`, ""]) {
      const edit = (await handle.callTool("edit_acceptance_criterion", { id: ID, acId: "AC-1", text })) as Answer;
      const append = (await handle.callTool("append_acceptance_criterion", { id: ID, text })) as Answer;
      expect(edit.error?.code, `edit ${text.length}`).toBe("USAGE");
      expect(append.error?.code, `append ${text.length}`).toBe("USAGE");
    }
    expect(await scopeText(root)).toBe(before);
    // The limit admits the longest criterion a real SRS carried (8,642 characters in OG SEC-SEC-045).
    const long = "y".repeat(16384);
    expect(((await handle.callTool("append_acceptance_criterion", { id: ID, text: long })) as Answer).ok).toBe(true);
    expect(await scopeText(root)).toContain(`- [ ] AC-4: ${long}\n`);
  });

  // @req FR-MCP-072 AC-3
  it("both take the SRS mutation lock and pass with ignoreLock", async () => {
    const root = await acFixture({ acLines: LIVE });
    await holdLock(root);
    const before = await scopeText(root);
    const handle = createMcpServer({ root });
    expect(((await handle.callTool("edit_acceptance_criterion", { id: ID, acId: "AC-1", text: "changed" })) as Answer).error?.code).toBe("SRS_LOCKED");
    expect(((await handle.callTool("append_acceptance_criterion", { id: ID, text: "added" })) as Answer).error?.code).toBe("SRS_LOCKED");
    expect((await cli(root, ["append-ac", ID, "--text", "added", "--json"])).code).toBe(5);
    expect(await scopeText(root)).toBe(before);

    expect(((await handle.callTool("edit_acceptance_criterion", { id: ID, acId: "AC-1", text: "changed", ignoreLock: true })) as Answer).ok).toBe(true);
    expect(((await handle.callTool("append_acceptance_criterion", { id: ID, text: "added", ignoreLock: true })) as Answer).ok).toBe(true);
    expect((await cli(root, ["append-ac", ID, "--text", "again", "--ignore-lock", "--json"])).code).toBe(0);
  });
});

describe("FR-MCP-072 AC-4 — replace_acceptance_criteria stays whole-list only", () => {
  // @req FR-MCP-072 AC-4
  it("its input names no criterion and no mode", () => {
    expect(Object.keys(toolSchemas.replace_acceptance_criteria ?? {}).sort()).toEqual(["dryRun", "id", "ignoreLock", "items"]);
    const items = toolSchemas.replace_acceptance_criteria?.items;
    const element = (items as unknown as { element: { shape: Record<string, unknown> } }).element;
    expect(Object.keys(element.shape).sort()).toEqual(["checked", "text"]);
  });
});
