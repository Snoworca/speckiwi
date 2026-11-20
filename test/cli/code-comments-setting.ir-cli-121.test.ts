import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { CODE_COMMENT_MODES } from "../../src/core/types.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-121 — user request 2026-11-20 for 5.7.1: a CLI setting that turns the agents' code
// comments off and on, keeping @req ("@req 를 남기고 코멘트만 꺼야합니다").

type Answer = { ok: boolean; value?: { codeComments?: string; mode?: string; written?: boolean }; error?: { code: string; message: string } };

const STATE = path.join("docs", "spec", "steps", "state.md");
const BASE = ["# Step State", "", "Mode: sdd", "", "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |", "| --- | --- | --- | --- | --- | --- | --- |", "| step-a | active | - | ARCH | - | 2026-07-16 | 2026-07-16 |", ""];

async function workspace(lines: string[] | null = BASE): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await rm(path.join(root, STATE), { force: true });
  if (lines !== null) {
    await mkdir(path.dirname(path.join(root, STATE)), { recursive: true });
    await writeFile(path.join(root, STATE), lines.join("\n"), "utf8");
  }
  return root;
}

async function cli(root: string, argv: string[], json = true): Promise<{ code: number; stdout: string; answer: Answer }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...argv, ...(json ? ["--json"] : [])], streams);
  const stdout = streams.stdout.read()?.toString() ?? "";
  return { code, stdout, answer: json ? (JSON.parse(stdout || "{}") as Answer) : { ok: code === 0 } };
}

async function mcp(root: string, tool: string, args: Record<string, unknown> = {}): Promise<Answer> {
  return (await createMcpServer({ root }).callTool(tool, args)) as Answer;
}

const state = (root: string) => readFile(path.join(root, STATE), "utf8");

describe("IR-CLI-121 AC-1 — reading the setting, on unless state.md says off", () => {
  // @req IR-CLI-121 AC-1
  it("reads on without the line, with an invalid value and without state.md", async () => {
    for (const lines of [BASE, ["Mode: sdd", "Code Comments: maybe", "", ...BASE.slice(4)], null]) {
      const root = await workspace(lines);
      const read = await cli(root, ["comments"]);
      expect(read.code).toBe(0);
      expect(read.answer.value?.codeComments).toBe("on");
    }
  });

  // @req IR-CLI-121 AC-1
  it("reads off when state.md says off, in human output too", async () => {
    const root = await workspace(["# Step State", "", "Mode: sdd", "Code Comments: off", "", ...BASE.slice(4)]);
    expect((await cli(root, ["comments"])).answer.value?.codeComments).toBe("off");
    expect((await cli(root, ["comments"], false)).stdout).toMatch(/\boff\b/);
  });
});

describe("IR-CLI-121 AC-2 — writing on or off", () => {
  // @req IR-CLI-121 AC-2
  it("off adds one Code Comments line and leaves every other line byte-identical; on replaces it", async () => {
    const root = await workspace();
    const before = await state(root);
    const off = await cli(root, ["comments", "off"]);
    expect(off.code, off.stdout).toBe(0);
    expect(off.answer.value?.codeComments).toBe("off");
    const after = (await state(root)).split("\n");
    expect(after.filter((line) => line.startsWith("Code Comments:"))).toEqual(["Code Comments: off"]);
    expect(after.filter((line) => !line.startsWith("Code Comments:")).join("\n")).toBe(before);
    await cli(root, ["comments", "on"]);
    const again = (await state(root)).split("\n");
    expect(again.filter((line) => line.startsWith("Code Comments:"))).toEqual(["Code Comments: on"]);
    expect(again.filter((line) => !line.startsWith("Code Comments:")).join("\n")).toBe(before);
    expect((await cli(root, ["mode"])).answer.value?.mode).toBe("sdd");
  });

  // @req IR-CLI-121 AC-2
  it("a dry run writes nothing", async () => {
    const root = await workspace();
    const before = await state(root);
    const dry = await cli(root, ["comments", "off", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(await state(root)).toBe(before);
  });
});

describe("IR-CLI-121 AC-3 — values outside the set, and no state.md", () => {
  // @req IR-CLI-121 AC-3
  it("refuses another value with USAGE, naming it and the accepted values, and writes nothing", async () => {
    expect([...CODE_COMMENT_MODES]).toEqual(["on", "off"]);
    const root = await workspace();
    const before = await state(root);
    const refused = await cli(root, ["comments", "Off"]);
    expect(refused.code).toBe(2);
    expect(refused.answer.error?.code).toBe("USAGE");
    expect(refused.answer.error?.message).toContain("Off");
    for (const value of CODE_COMMENT_MODES) expect(refused.answer.error?.message.split(/[\s,;:()]+/)).toContain(value);
    expect(await state(root)).toBe(before);
  });

  // @req IR-CLI-121 AC-3
  it("refuses a write with NOT_FOUND when state.md does not exist, as speckiwi mode does", async () => {
    const root = await workspace(null);
    const comments = await cli(root, ["comments", "off"]);
    const mode = await cli(root, ["mode", "tdd"]);
    expect(comments.answer.error?.code).toBe("NOT_FOUND");
    expect(mode.answer.error?.code).toBe("NOT_FOUND");
    expect(comments.code).toBe(mode.code);
  });
});

describe("IR-CLI-121 AC-4 — get_work_mode and speckiwi mode report it, and a mode switch keeps it", () => {
  // @req IR-CLI-121 AC-4
  it("returns codeComments beside mode from MCP and CLI, and set_work_mode and speckiwi mode keep the line", async () => {
    const root = await workspace();
    expect((await mcp(root, "get_work_mode")).value).toEqual({ mode: "sdd", codeComments: "on" });
    await cli(root, ["comments", "off"]);
    expect((await mcp(root, "get_work_mode")).value).toEqual({ mode: "sdd", codeComments: "off" });
    expect((await cli(root, ["mode"])).answer.value).toEqual({ mode: "sdd", codeComments: "off" });
    expect((await mcp(root, "set_work_mode", { mode: "tdd", activeTask: "t-1" })).ok).toBe(true);
    expect((await mcp(root, "get_work_mode")).value).toEqual({ mode: "tdd", activeTask: "t-1", codeComments: "off" });
    expect((await cli(root, ["mode", "wait"])).code).toBe(0);
    expect((await state(root)).split("\n")).toContain("Code Comments: off");
    expect((await cli(root, ["comments"])).answer.value?.codeComments).toBe("off");
  });
});

describe("IR-CLI-121 AC-5 — no MCP write, and reading changes nothing", () => {
  // @req IR-CLI-121 AC-5
  it("lists no MCP tool that writes the setting, and reads leave state.md byte-identical", async () => {
    const sdk = createSdkServer(createMcpServer({ root: process.cwd(), rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "ir-cli-121", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();
    expect(tools.tools.map((tool) => tool.name).filter((name) => /comment/i.test(name))).toEqual([]);
    const setWorkMode = tools.tools.find((tool) => tool.name === "set_work_mode")?.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(setWorkMode.properties ?? {}).filter((key) => /comment/i.test(key))).toEqual([]);

    // Both with the line and without it: a read that wrote the default would change only the second.
    for (const lines of [["# Step State", "", "Mode: sdd", "Code Comments: off", "", ...BASE.slice(4)], BASE]) {
      const root = await workspace(lines);
      const before = await state(root);
      await cli(root, ["comments"]);
      await cli(root, ["mode"]);
      await mcp(root, "get_work_mode");
      expect(await state(root)).toBe(before);
    }
  });
});
