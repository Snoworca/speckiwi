import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import { appendSectionNote } from "../../../src/core/mutation/append-section-note.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { renderToolDescriptions } from "../../../src/mcp/schemas.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-291 — an appended note that opens with the date the tool stamps carries that date once;
// every other date in the text is the caller's and is kept.

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");
const D = "2026-11-10";

beforeEach(() => {
  // Local noon, so the stamp is D in every zone the suite runs in. Only Date is faked: the file and
  // git work below keeps its real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await cleanupFixtures();
});

/** A committed git repository holding the fixture, checked to be the root a write lands in. */
async function workspace(): Promise<string> {
  const rootPath = await gitWorkspaceRepo("fr-node-291-", "mutation-target");
  const root = await resolveProjectRoot(rootPath);
  expect(path.resolve(root.root)).toBe(path.resolve(rootPath));
  return rootPath;
}

async function appendedRow(rootPath: string, text: string): Promise<string> {
  const root = await resolveProjectRoot(rootPath);
  const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
  const rows = file.split(/\r?\n/).filter((line) => line.startsWith(`- [${D}] `));
  return rows[rows.length - 1] ?? "";
}

describe("FR-NODE-291 AC-1 — the stamp date at the start of the text is written once", () => {
  it.each([
    [`${D} bare form`, "bare form"],
    [`${D}: colon form`, "colon form"],
    [`${D}:colon without space`, "colon without space"],
    [`[${D}] bracket form`, "bracket form"],
    [`(${D}) paren form`, "paren form"],
    [`${D} - hyphen form`, "hyphen form"],
    [`${D} — dash form`, "dash form"],
    [`[${D}]: bracket and colon`, "bracket and colon"],
    [`[${D}]- bracket hyphen`, "bracket hyphen"],
    [`(${D})-paren hyphen`, "paren hyphen"],
    [`[${D}] — bracket dash`, "bracket dash"],
    [`(${D}): paren and colon`, "paren and colon"],
    [`(${D}) — paren dash`, "paren dash"],
    [`${D} : spaced colon`, "spaced colon"],
    // Text that itself starts with `-` or `:` keeps every character: only the separator goes.
    [`[${D}] -1 regression`, "-1 regression"],
    [`[${D}] -v flag now refused`, "-v flag now refused"],
    [`[${D}] :tada: shipped`, ":tada: shipped"],
    [`[${D}] --root flag removed`, "--root flag removed"],
    [`${D}: -3 failing tests`, "-3 failing tests"],
    [`${D} --root flag removed`, "--root flag removed"],
    [`${D} -x`, "-x"],
    [`(${D}) -1 regression`, "-1 regression"],
    [`${D}: x`, "x"],
    [`[${D}]: x`, "x"],
    [`${D}: first line\nsecond line`, "first line"]
  ])("%j becomes `- [D] %s`", async (text, rest) => {
    const rootPath = await workspace();
    expect(await appendedRow(rootPath, text)).toBe(`- [${D}] ${rest}`);
  });
});

describe("FR-NODE-291 AC-2 — every other date, and a text with nothing after the date, is kept", () => {
  it.each([
    ["2026-11-05 older event date"],
    ["[2026-11-09] measured yesterday"],
    [`measured on ${D} mid-body`],
    [`${D}-01 build number`],
    [`${D}x no separator`],
    [`[${D}]text no separator`],
    [D],
    [`[${D}]`],
    [`${D}:`],
    // Nothing but separators after the date: the line holds no text the date could stand before.
    [`[${D}] -`],
    [`[${D}] :`],
    [`(${D}) —`],
    [`${D} -`],
    [`${D} —`],
    [`${D} - -`],
    [`[${D}]: -`],
    [`${D}—note`],
    [`2026-11-05: -3 failing tests on an earlier day`],
    [`(2026-11-09) -1 regression`],
    [`see [${D}] -1 regression`]
  ])("%j is written unchanged", async (text) => {
    const rootPath = await workspace();
    expect(await appendedRow(rootPath, text)).toBe(`- [${D}] ${text}`);
  });

  it.each([[`${D}\nsecond line`], [`[${D}]:\nsecond line`], [`${D}:\nsecond line`], [`(${D}) -\nsecond line`]])(
    "keeps a first line %j that holds no text after the date, so the next line is not pulled up",
    async (text) => {
      const rootPath = await workspace();
      const root = await resolveProjectRoot(rootPath);
      const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const file = (await readFile(path.join(rootPath, ARCH_FILE), "utf8")).replace(/\r\n/g, "\n");
      expect(file).toContain(`- [${D}] ${text}\n`);
    }
  );
});

describe("FR-NODE-291 AC-3 — replace mode writes its text as given", () => {
  it("keeps a leading stamp date in a replaced section", async () => {
    const rootPath = await workspace();
    const root = await resolveProjectRoot(rootPath);
    const text = `[${D}] replaced body`;
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text, mode: "replace", confirmReplace: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(file).toContain(`\n${text}\n`);
    expect(file).not.toContain(`- [${D}] replaced body`);
  });
});

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

describe("FR-NODE-291 AC-4 — the CLI and MCP write the same row", () => {
  it("CLI append-note drops the same leading date", async () => {
    const rootPath = await workspace();
    const streams = io();
    const code = await main(["--root", rootPath, "append-note", "FR-ARCH-001", "--section", "rationale", "--text", `[${D}] via cli`, "--json"], streams);
    expect(code, streams.stderr.read()?.toString()).toBe(0);
    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(file).toContain(`- [${D}] via cli\n`);
  });

  it("MCP append_section_note drops the same leading date", async () => {
    const rootPath = await workspace();
    const server = createMcpServer({ root: rootPath, rootSource: "server-cwd-discovery" });
    const answer = (await server.callTool("append_section_note", { id: "FR-ARCH-001", section: "rationale", text: `${D}: via mcp` })) as {
      ok: boolean;
      mcpWorkspace: { workspaceRoot: string };
    };
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(path.resolve(answer.mcpWorkspace.workspaceRoot)).toBe(path.resolve(rootPath));
    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(file).toContain(`- [${D}] via mcp\n`);
  });
});

const flat = (text: string) => text.replace(/\s+/g, " ");
// Only a leading copy followed by a separator, with text on the rest of that line, goes; the wording
// must not claim more.
const RULE_ONCE = /when the text starts with that same date and a separator and the rest of that line holds text, the date is written once/;

describe("FR-NODE-291 AC-5 — the help, the README and the MCP description say the note is dated", () => {
  it("append-note --help says so for --text", async () => {
    const streams = io();
    await main(["append-note", "--help"], streams);
    const help = flat(streams.stdout.read()?.toString() ?? "");
    expect(help).toMatch(/stamped with the day's date/);
    expect(help).toMatch(RULE_ONCE);
    expect(help).toMatch(/any other date in the text is kept/);
  });

  it("the README says so in both languages", async () => {
    const readme = flat(await readFile(path.resolve(import.meta.dirname, "../../../README.md"), "utf8"));
    expect(readme).toMatch(/An appended note is stamped with the day's date: when the text starts with that same date and a separator and the rest of that line holds text, the date is written once, and any other date in the text is kept\./);
    expect(readme).toMatch(/덧붙인 노트에는 그날 날짜가 찍힙니다\. 본문이 같은 날짜와 구분자로 시작하고 그 줄의 나머지에 내용이 있으면 날짜를 한 번만 쓰고, 다른 날짜는 그대로 둡니다\./);
  });

  it("the append_section_note description says so and no longer says a carried date doubles", () => {
    const description = renderToolDescriptions().append_section_note ?? "";
    expect(description).toMatch(/stamped with the day's date/);
    expect(description).toMatch(RULE_ONCE);
    expect(description).toMatch(/any other date in the text is kept/);
    expect(description).not.toMatch(/doubles it/);
  });
});
