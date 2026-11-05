import { PassThrough, Readable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { appendSectionNote } from "../../src/core/mutation/append-section-note.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-NODE-270 — the CLI surface of the replace loss report and its confirmation flag.

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

const originalStdin = process.stdin;

afterEach(() => {
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
});

async function withStdin<T>(text: string, body: () => Promise<T>): Promise<T> {
  const fake = Readable.from([text]) as unknown as NodeJS.ReadStream;
  (fake as unknown as { isTTY: boolean }).isTTY = false;
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  try {
    return await body();
  } finally {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  }
}

interface Envelope {
  ok?: boolean;
  value?: { written?: boolean; removedItems?: number; removedLines?: string[] };
  error?: { code?: string; message?: string };
}

/**
 * A copy of the fixture whose FR-ARCH-001 Implementation Notes holds the template placeholder and
 * three dated notes appended by the tool itself — the shape AC-3 names.
 */
async function placeholderAndThreeNotes(): Promise<{ rootPath: string; notes: string[] }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, ARCH_FILE);
  const original = await readFile(file, "utf8");
  await writeFile(file, original.replace("#### Implementation Notes\n\n- src/core/mutation\n", "#### Implementation Notes\n\n- -\n"), "utf8");
  const root = await resolveProjectRoot(rootPath);
  for (const text of ["first note", "second note", "third note"]) {
    const appended = await appendSectionNote(root, { id: "FR-ARCH-001", section: "implementation_notes", text });
    expect(appended.ok).toBe(true);
  }
  const lines = (await readFile(file, "utf8")).split("\n");
  const notes = lines.filter((line) => /^- \[\d{4}-\d{2}-\d{2}\] (first|second|third) note$/.test(line));
  expect(notes).toHaveLength(3);
  return { rootPath, notes };
}

async function run(args: string[], stdin?: string): Promise<{ code: number; out: Envelope }> {
  const streams = io();
  const call = () => main(args, streams);
  const code = stdin === undefined ? await call() : await withStdin(stdin, call);
  const raw = drain(streams.stdout).trim();
  return { code, out: raw ? (JSON.parse(raw) as Envelope) : {} };
}

const REPLACE = ["append-note", "FR-ARCH-001", "--section", "implementation_notes", "--mode", "replace", "--text", "Only one"];

describe("FR-NODE-270 AC-3 — the dry run shows the removal without the flag", () => {
  // @req FR-NODE-270 AC-3
  it("reports removedItems 3 and the three notes in order, writes nothing, needs no flag", async () => {
    const { rootPath, notes } = await placeholderAndThreeNotes();
    const before = await readFile(path.join(rootPath, ARCH_FILE), "utf8");

    const { code, out } = await run(["--root", rootPath, ...REPLACE, "--dry-run", "--json"]);

    expect(code).toBe(0);
    expect(out.ok).toBe(true);
    expect(out.value?.written).toBe(false);
    expect(out.value?.removedItems).toBe(3);
    expect(out.value?.removedLines).toEqual(notes);
    expect(await readFile(path.join(rootPath, ARCH_FILE), "utf8")).toBe(before);
  });
});

describe("FR-NODE-270 AC-4 — the write without the flag is refused", () => {
  // @req FR-NODE-270 AC-4
  it("exits non-zero with USAGE, names --confirm-replace and the count, and leaves the file byte-identical", async () => {
    const { rootPath } = await placeholderAndThreeNotes();
    const before = await readFile(path.join(rootPath, ARCH_FILE), "utf8");

    const { code, out } = await run(["--root", rootPath, ...REPLACE, "--json"]);

    expect(code).not.toBe(0);
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe("USAGE");
    expect(out.error?.message).toContain("--confirm-replace");
    expect(out.error?.message).toMatch(/\b3 items\b/);
    expect(await readFile(path.join(rootPath, ARCH_FILE), "utf8")).toBe(before);
  });
});

describe("FR-NODE-270 AC-5 — the confirmed write reports what the dry run did", () => {
  // @req FR-NODE-270 AC-5
  it("--confirm-replace writes the replacement and carries the dry run's removedItems and removedLines", async () => {
    const { rootPath, notes } = await placeholderAndThreeNotes();

    const dry = await run(["--root", rootPath, ...REPLACE, "--dry-run", "--json"]);
    const { code, out } = await run(["--root", rootPath, ...REPLACE, "--confirm-replace", "--json"]);

    expect(code).toBe(0);
    expect(out.ok).toBe(true);
    expect(out.value?.written).toBe(true);
    expect(out.value?.removedItems).toBe(dry.out.value?.removedItems);
    expect(out.value?.removedLines).toEqual(dry.out.value?.removedLines);
    expect(out.value?.removedLines).toEqual(notes);
    expect(await readFile(path.join(rootPath, ARCH_FILE), "utf8")).toContain("#### Implementation Notes\n\nOnly one\n\n#### Change Notes");
  });

  // @req FR-NODE-270 AC-5
  it("\"confirmReplace\": true through --input-json - confirms the same write", async () => {
    const { rootPath, notes } = await placeholderAndThreeNotes();
    const payload = JSON.stringify({ id: "FR-ARCH-001", section: "implementation_notes", mode: "replace", text: "Only one", confirmReplace: true });

    const { code, out } = await run(["--root", rootPath, "append-note", "--input-json", "-", "--json"], payload);

    expect(code).toBe(0);
    expect(out.ok).toBe(true);
    expect(out.value?.written).toBe(true);
    expect(out.value?.removedItems).toBe(3);
    expect(out.value?.removedLines).toEqual(notes);
  });
});

describe("FR-NODE-270 AC-8 — the flag is declared where callers look for it", () => {
  // @req FR-NODE-270 AC-8
  it("`speckiwi commands --json` lists --confirm-replace on append-note with payload key confirmReplace", async () => {
    const streams = io();
    const code = await main(["commands", "--json"], streams);
    expect(code).toBe(0);
    const parsed = JSON.parse(drain(streams.stdout)) as { commands: Array<{ name: string; options: Array<{ flag: string; dest: string; encoding: string }> }> };
    const appendNote = parsed.commands.find((command) => command.name === "append-note");
    const option = appendNote?.options.find((entry) => entry.flag === "--confirm-replace");
    expect(option?.dest).toBe("confirmReplace");
    expect(option?.encoding).toBe("boolean");
  });

  // @req FR-NODE-270 AC-8
  it("the help of --mode says that a replace removing an item needs --confirm-replace", async () => {
    const streams = io();
    await main(["append-note", "--help"], streams);
    const help = drain(streams.stdout);
    const modeLine = help.split("\n").findIndex((line) => line.includes("--mode <mode>"));
    expect(modeLine).toBeGreaterThan(-1);
    // Commander wraps long descriptions, so the mode option's text is read up to the next option.
    const lines = help.split("\n");
    const nextOption = lines.findIndex((line, index) => index > modeLine && /^\s+-/.test(line));
    const modeHelp = lines.slice(modeLine, nextOption === -1 ? undefined : nextOption).join(" ");
    expect(modeHelp).toContain("--confirm-replace");
  });
});
