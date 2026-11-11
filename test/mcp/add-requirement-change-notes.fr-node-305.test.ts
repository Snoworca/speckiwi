import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildProgram, main } from "../../src/cli/index.js";
import { todayStamp } from "../../src/core/date-stamp.js";
import * as dateStamp from "../../src/core/date-stamp.js";
import { addChangeNote } from "../../src/core/mutation/add-change-note.js";
import * as seedRows from "../../src/core/mutation/seed-rows.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { snapshotTree } from "../support/discarded-target-fixture.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "./support/workspace-root-fixture.js";

// @req FR-NODE-305 — add_requirement's changeNotes takes rows shaped like add_change_note's, read by
// the seed-row normalizer under one date rule.
//
// 2026-11-12: `changeNotes: "Added for #4920."` refused the whole requirement as MUTATION_DENIED with no
// word of the expected form, and `yesterday | Added | #4920` was written unchecked.

// Each case seeds and commits a real repository, which takes seconds on Windows.
vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const SPEC_FILE = "docs/spec/10.product-architecture.srs.md";
const EXAMPLE_ROWS = '[{"change": "Added", "reason": "#4920", "date": "2026-11-12"}]';
const EXAMPLE_STRING = '"2026-11-12 | Added | #4920"';

const BASE = {
  type: "functional",
  scope: "ARCH",
  target: "v1.0.0",
  title: "Change note rows",
  requirement: "The system SHALL keep change notes.",
  acceptanceCriteria: ["THE SYSTEM SHALL keep change notes."]
};

interface Envelope {
  ok?: boolean;
  error?: { code: string; message: string };
  value?: { requirementId?: string; written?: boolean };
}

/** A committed repository holding valid-basic, checked to be the root in use. */
async function workspace(): Promise<string> {
  const directory = await gitWorkspaceRepo("fr-node-305-");
  expect(path.resolve((await resolveProjectRoot(directory)).root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  return directory;
}

/** A real MCP client over the SDK server, so the declared schema is what admits the argument. */
async function mcp(rootPath: string, name: string, args: Record<string, unknown>): Promise<Envelope> {
  const sdk = createSdkServer(createMcpServer({ root: rootPath, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-node-305", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
  await client.close();
  return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Envelope;
}

async function cli(rootPath: string, args: string[]): Promise<{ code: number; envelope: Envelope }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", rootPath, ...args, "--json"], streams);
  const text = streams.stdout.read()?.toString() ?? "";
  return { code, envelope: (text ? JSON.parse(text) : {}) as Envelope };
}

/** The Change Notes rows of the requirement block `id`, as written. */
async function changeNoteRows(rootPath: string, id: string): Promise<string[]> {
  const text = (await readFile(path.join(rootPath, SPEC_FILE), "utf8")).replace(/\r\n/g, "\n");
  const start = text.indexOf(`### ${id} `);
  expect(start, `${id} was written`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n### ", start + 1);
  const block = text.slice(start, end < 0 ? text.length : end);
  const section = block.slice(block.indexOf("#### Change Notes"));
  return section.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Date ") && !line.startsWith("| ---"));
}

describe("FR-NODE-305 AC-1 — changeNotes rows in add_change_note's shape", () => {
  it("writes a row without a date with today's local date, and no default Created row", async () => {
    const root = await workspace();
    const answer = await mcp(root, "add_requirement", { ...BASE, changeNotes: [{ change: "Added for #4920", reason: "issue #4920" }] });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(await changeNoteRows(root, answer.value?.requirementId ?? "")).toEqual([`| ${todayStamp()} | Added for #4920 | issue #4920 |`]);
  });

  it("writes every row in the given order, with the dates given", async () => {
    const root = await workspace();
    const answer = await mcp(root, "add_requirement", {
      ...BASE,
      changeNotes: [
        { date: "2026-11-01", change: "Drafted", reason: "issue #4920" },
        { change: "Added", reason: "review", date: "2026-11-02" }
      ]
    });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(await changeNoteRows(root, answer.value?.requirementId ?? "")).toEqual(["| 2026-11-01 | Drafted | issue #4920 |", "| 2026-11-02 | Added | review |"]);
  });

  it("keeps the default row when changeNotes is absent", async () => {
    const root = await workspace();
    const answer = await mcp(root, "add_requirement", BASE);
    expect(answer.ok).toBe(true);
    expect(await changeNoteRows(root, answer.value?.requirementId ?? "")).toEqual([`| ${todayStamp()} | Created | add-requirement |`]);
  });
});

describe("FR-NODE-305 AC-2 — the three-cell string is still taken", () => {
  it("writes the same row through MCP", async () => {
    const root = await workspace();
    const answer = await mcp(root, "add_requirement", { ...BASE, changeNotes: "2026-11-12 | Added | #4920" });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(await changeNoteRows(root, answer.value?.requirementId ?? "")).toEqual(["| 2026-11-12 | Added | #4920 |"]);
  });

  it("writes the same row through the CLI --change-notes", async () => {
    const root = await workspace();
    const { code, envelope } = await cli(root, [
      "add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", "Change note rows",
      "--requirement", "The system SHALL keep change notes.", "--ac", "THE SYSTEM SHALL keep change notes.",
      "--change-notes", "2026-11-12 | Added | #4920"
    ]);
    expect(code, JSON.stringify(envelope)).toBe(0);
    expect(await changeNoteRows(root, envelope.value?.requirementId ?? "")).toEqual(["| 2026-11-12 | Added | #4920 |"]);
  });
});

describe("FR-NODE-305 AC-3 — a malformed row is refused as USAGE, naming changeNotes and both forms", () => {
  it.each([
    { label: "a plain sentence", changeNotes: "Added for #4920.", row: "row 1" },
    { label: "a string date that is not YYYY-MM-DD", changeNotes: "yesterday | Added | #4920", row: "row 1" },
    { label: "a whole table row with outer pipes", changeNotes: "| 2026-11-12 | Added | #4920 |", row: "row 1" },
    { label: "a row date that is not YYYY-MM-DD", changeNotes: [{ change: "Added", reason: "#4920", date: "yesterday" }], row: "row 1" },
    { label: "an unknown key", changeNotes: [{ change: "Added", reason: "#4920", who: "me" }], row: "row 1" },
    { label: "an empty change", changeNotes: [{ change: " ", reason: "#4920" }], row: "row 1" },
    { label: "a missing reason", changeNotes: [{ change: "Added" }], row: "row 1" },
    { label: "a cell that is not text", changeNotes: [{ change: { text: "Added" }, reason: "#4920" }], row: "row 1" },
    { label: "a row that is not an object", changeNotes: ["2026-11-12 | Added | #4920"], row: "row 1" },
    { label: "a bad second row", changeNotes: [{ change: "Added", reason: "#4920" }, { change: "Again", reason: "r", date: "11/12/2026" }], row: "row 2" }
  ])("MCP refuses $label and writes nothing", async ({ changeNotes, row }) => {
    const root = await workspace();
    const before = await snapshotTree(root);
    const answer = await mcp(root, "add_requirement", { ...BASE, changeNotes });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("USAGE");
    expect(answer.error?.message).toContain(`changeNotes ${row}`);
    expect(answer.error?.message).toContain(EXAMPLE_ROWS);
    expect(answer.error?.message).toContain(EXAMPLE_STRING);
    expect(await snapshotTree(root)).toEqual(before);
  });

  it("MCP refuses one row object given without its array, as USAGE with both forms", async () => {
    const root = await workspace();
    const before = await snapshotTree(root);
    const answer = await mcp(root, "add_requirement", { ...BASE, changeNotes: { change: "Added", reason: "#4920" } });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("USAGE");
    expect(answer.error?.message).toContain("changeNotes");
    expect(answer.error?.message).toContain(EXAMPLE_ROWS);
    expect(answer.error?.message).toContain(EXAMPLE_STRING);
    expect(await snapshotTree(root)).toEqual(before);
  });

  it("the CLI refusal shows only the form the CLI takes", async () => {
    const root = await workspace();
    const { envelope } = await cli(root, [
      "add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", "Change note rows",
      "--requirement", "The system SHALL keep change notes.", "--ac", "THE SYSTEM SHALL keep change notes.",
      "--change-notes", "Added for #4920."
    ]);
    expect(envelope.error?.code).toBe("USAGE");
    expect(envelope.error?.message).toContain("changeNotes row 1");
    expect(envelope.error?.message).toContain(EXAMPLE_STRING);
    expect(envelope.error?.message).not.toContain(EXAMPLE_ROWS);
  });

  it("the CLI refuses a string date that is not YYYY-MM-DD and writes nothing", async () => {
    const root = await workspace();
    const before = await snapshotTree(root);
    const { code, envelope } = await cli(root, [
      "add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", "Change note rows",
      "--requirement", "The system SHALL keep change notes.", "--ac", "THE SYSTEM SHALL keep change notes.",
      "--change-notes", "yesterday | Added | #4920"
    ]);
    expect(code).not.toBe(0);
    expect(envelope.error?.code).toBe("USAGE");
    expect(envelope.error?.message).toContain("changeNotes row 1");
    expect(await snapshotTree(root)).toEqual(before);
  });
});

describe("FR-NODE-305 AC-4 — one normalizer, one date rule shared with add_change_note", () => {
  it("the seed-row normalizer reads changeNotes beside evidence and trace", () => {
    const normalized = seedRows.normalizeSeedRows({ changeNotes: "2026-11-12 | Added | #4920" } as never) as unknown as {
      ok: boolean;
      changeNotes?: Array<{ date: string; change: string; reason: string }>;
    };
    expect(normalized.ok).toBe(true);
    expect(normalized.changeNotes).toEqual([{ date: "2026-11-12", change: "Added", reason: "#4920" }]);
  });

  it("date-stamp exports the date rule, which accepts YYYY-MM-DD and nothing else", () => {
    const rule = (dateStamp as unknown as { isDateStamp?: (value: string) => boolean }).isDateStamp;
    expect(typeof rule).toBe("function");
    if (!rule) return;
    expect(rule("2026-11-12")).toBe(true);
    for (const value of ["yesterday", "2026-1-12", "11/12/2026", " 2026-11-12", "2026-11-12T00:00"]) expect(rule(value), value).toBe(false);
  });

  it("the core add_change_note refuses the dates add_requirement refuses, writing nothing", async () => {
    const root = await workspace();
    const before = await snapshotTree(root);
    const answer = await addChangeNote(await resolveProjectRoot(root), { id: "FR-ARCH-001", date: "yesterday", change: "c", reason: "r" });
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.code).toBe("USAGE");
    expect(await snapshotTree(root)).toEqual(before);
  });
});

describe("FR-NODE-305 AC-5 — the MCP schema and the CLI help state the forms", () => {
  it("the add_requirement schema describes both forms with an example", async () => {
    const sdk = createSdkServer(createMcpServer({ root: process.cwd(), rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "fr-node-305", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();
    const schema = tools.tools.find((tool) => tool.name === "add_requirement")?.inputSchema as { properties?: Record<string, { description?: string }> };
    const description = schema.properties?.changeNotes?.description ?? "";
    expect(description).toContain(EXAMPLE_ROWS);
    expect(description).toContain(EXAMPLE_STRING);
  });

  it("the CLI --change-notes help gives the string form with an example", () => {
    const command = buildProgram().commands.find((entry) => entry.name() === "add-requirement");
    const option = command?.options.find((entry) => entry.long === "--change-notes");
    expect(option?.description ?? "").toContain("date | change | reason");
    expect(option?.description ?? "").toContain(EXAMPLE_STRING);
  });
});
