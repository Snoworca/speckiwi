import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const childCalls = vi.hoisted(() => ({ calls: [] as Array<{ fn: string; file: string; shell: unknown }> }));

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const wrap = <T extends (...args: never[]) => unknown>(fn: string, real: T): T => {
    const wrapped = ((...args: unknown[]) => {
      const options = args.find((arg) => typeof arg === "object" && arg !== null && !Array.isArray(arg)) as { shell?: unknown } | undefined;
      childCalls.calls.push({ fn, file: String(args[0]), shell: options?.shell });
      return (real as unknown as (...inner: unknown[]) => unknown)(...args);
    }) as unknown as T;
    const custom = (real as unknown as Record<symbol, unknown>)[promisify.custom];
    if (typeof custom === "function") {
      (wrapped as unknown as Record<symbol, unknown>)[promisify.custom] = (...args: unknown[]) => {
        const options = args.find((arg) => typeof arg === "object" && arg !== null && !Array.isArray(arg)) as { shell?: unknown } | undefined;
        childCalls.calls.push({ fn, file: String(args[0]), shell: options?.shell });
        return (custom as (...inner: unknown[]) => unknown)(...args);
      };
    }
    return wrapped;
  };
  return {
    ...actual,
    exec: wrap("exec", actual.exec),
    execSync: wrap("execSync", actual.execSync),
    execFile: wrap("execFile", actual.execFile),
    execFileSync: wrap("execFileSync", actual.execFileSync),
    spawn: wrap("spawn", actual.spawn),
    spawnSync: wrap("spawnSync", actual.spawnSync)
  };
});

/** SEC-MCP-001 — the MCP server keeps file access inside the root and runs no caller-supplied shell command. */

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

describe("SEC-MCP-001 — file access through MCP tools", () => {
  it("SEC-MCP-001 AC-1: a relative path argument is resolved inside the root", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createMcpServer({ root });
    const answer = (await server.callTool("workflow_resolve_artifact", { path: "docs/spec/../spec/00.index.md", includeBody: true })) as {
      ok: boolean;
      value?: { selected?: { relativePath?: string } | null; artifact?: { relativePath?: string } };
    };
    expect(answer.ok).toBe(true);
    expect(answer.value?.selected?.relativePath, "the normalised path is the one inside the root").toBe("docs/spec/00.index.md");
  });

  it("SEC-MCP-001 AC-2: a path argument that traverses out of the root is refused and nothing outside is written", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const parent = path.dirname(root);
    const server = createMcpServer({ root });
    const name = `escape-${path.basename(root)}.md`;
    const answer = await server.callTool("add_completed_work", { date: "2026-10-21", summary: "Traversal.", reportPaths: [`../${name}`] });
    expect(answer).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    expect(await exists(path.join(parent, name))).toBe(false);
    expect(await readdir(root)).not.toContain(name);
  });

  it("SEC-MCP-001 AC-3: local file evidence is checked against the root — a reference outside it does not reach verified", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const spec = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const text = (await readFile(spec, "utf8")).replace(/\r\n/g, "\n");
    const seeded = text
      .replace(/- \[ \] AC-/g, "- [x] AC-")
      .replace(
        "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |",
        "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |\n| VE-1 | inspection | ../outside-the-root/notes.md | all | - |"
      );
    expect(seeded).toContain("../outside-the-root/notes.md");
    await writeFile(spec, seeded, "utf8");
    const server = createMcpServer({ root });
    const answer = await server.callTool("update_status", { id: "FR-ARCH-001", status: "verified" });
    expect(answer).toMatchObject({ ok: false });
    expect(JSON.stringify(answer)).toContain("outside");
    expect(await readFile(spec, "utf8")).toContain("| Status | planned |");
  });

  it("SEC-MCP-001 AC-4: no MCP tool runs a shell, and none runs a command named in its input", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const marker = path.join(root, "pwned.txt");
    const payload = `x & echo pwned > "${marker}" ; echo pwned > "${marker}"`;
    const server = createMcpServer({ root });
    childCalls.calls = [];
    for (const name of Object.keys(server.tools)) {
      await Promise.resolve(
        server.callTool(name, { id: payload, path: payload, target: payload, runId: payload, command: payload, reference: payload, text: payload, workspaceRoot: root })
      ).catch(() => undefined);
    }
    expect(await exists(marker)).toBe(false);
    // The spy is not vacuous: the per-call workspaceRoot gate runs git through execFile.
    expect(childCalls.calls.some((call) => call.fn === "execFile")).toBe(true);
    expect(childCalls.calls.filter((call) => call.fn === "exec" || call.fn === "execSync")).toEqual([]);
    expect(childCalls.calls.filter((call) => call.shell === true || typeof call.shell === "string")).toEqual([]);
    expect(childCalls.calls.filter((call) => call.file.includes("pwned"))).toEqual([]);
  }, 60_000);
});
