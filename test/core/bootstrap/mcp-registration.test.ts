import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerSpeckiwiMcp } from "../../../src/core/bootstrap/mcp-registration.js";

// @req FR-NODE-067 — speckiwi init MCP server project registration (.mcp.json idempotent merge).
// Direct config-file registration with idempotent detect->skip; non-destructive merge; refuse on
// unparseable JSON; Codex remediation warning (no global ~/.codex/config.toml edit); dry-run preview.

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-mcp-reg-"));
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

async function exists(file: string): Promise<boolean> {
  return readFile(file, "utf8").then(() => true).catch(() => false);
}

describe("registerSpeckiwiMcp (.mcp.json project registration)", () => {
  it("AC-1: creates .mcp.json with an mcpServers.speckiwi launcher when none exists", async () => {
    const root = await tempRoot();
    const result = await registerSpeckiwiMcp(root);
    expect(result.status).toBe("created");
    expect(result.filePath).toBe(path.join(root, ".mcp.json"));
    const json = await readJson(path.join(root, ".mcp.json"));
    const servers = json.mcpServers as Record<string, { command?: unknown; args?: unknown }>;
    expect(servers.speckiwi).toBeDefined();
    expect(typeof servers.speckiwi.command).toBe("string");
    expect((servers.speckiwi.command as string).length).toBeGreaterThan(0);
    expect(servers.speckiwi.args).toContain("mcp");
    expect(JSON.stringify(servers.speckiwi.args)).toContain("speckiwi");
  });

  it("AC-2: leaves an existing speckiwi registration unchanged and reports skipped", async () => {
    const root = await tempRoot();
    const original = `${JSON.stringify({ mcpServers: { speckiwi: { command: "custom", args: ["x"] } } }, null, 2)}\n`;
    await writeFile(path.join(root, ".mcp.json"), original, "utf8");
    const result = await registerSpeckiwiMcp(root);
    expect(result.status).toBe("skipped");
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe(original);
  });

  it("AC-3: merges speckiwi while preserving other mcpServers and top-level keys", async () => {
    const root = await tempRoot();
    await writeFile(
      path.join(root, ".mcp.json"),
      `${JSON.stringify({ mcpServers: { other: { command: "o", args: [] } }, someTopLevel: 7 }, null, 2)}\n`,
      "utf8"
    );
    const result = await registerSpeckiwiMcp(root);
    expect(result.status).toBe("updated");
    const json = await readJson(path.join(root, ".mcp.json"));
    const servers = json.mcpServers as Record<string, unknown>;
    expect(servers.other).toEqual({ command: "o", args: [] });
    expect(json.someTopLevel).toBe(7);
    expect(servers.speckiwi).toBeDefined();
  });

  it("AC-4: refuses to overwrite an unparseable .mcp.json and warns", async () => {
    const root = await tempRoot();
    const broken = "{ this is not json";
    await writeFile(path.join(root, ".mcp.json"), broken, "utf8");
    const result = await registerSpeckiwiMcp(root);
    expect(result.status).toBe("warning");
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe(broken);
    expect(result.warnings.some((w) => /\.mcp\.json/.test(w))).toBe(true);
  });

  it("AC-5: always emits a Codex remediation warning and never edits ~/.codex/config.toml", async () => {
    const root = await tempRoot();
    const result = await registerSpeckiwiMcp(root);
    expect(result.warnings.some((w) => /codex/i.test(w))).toBe(true);
  });

  it("AC-6: dry-run reports the action but writes nothing", async () => {
    const root = await tempRoot();
    const result = await registerSpeckiwiMcp(root, { dryRun: true });
    expect(result.status).toBe("created");
    expect(await exists(path.join(root, ".mcp.json"))).toBe(false);
  });

  it("AC-6: dry-run merge into an existing file reports updated without writing", async () => {
    const root = await tempRoot();
    const original = `${JSON.stringify({ mcpServers: { other: { command: "o", args: [] } } }, null, 2)}\n`;
    await writeFile(path.join(root, ".mcp.json"), original, "utf8");
    const result = await registerSpeckiwiMcp(root, { dryRun: true });
    expect(result.status).toBe("updated");
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe(original);
  });

  // AC-4 robustness — malformed-but-parseable roots must be treated like unparseable ones:
  // warn and leave the file untouched, never abort and never clobber.
  it("AC-4: refuses a .mcp.json whose JSON root is null and leaves it unchanged", async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, ".mcp.json"), "null\n", "utf8");
    const result = await registerSpeckiwiMcp(root);
    expect(result.status).toBe("warning");
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe("null\n");
  });

  it("AC-4: refuses a .mcp.json whose JSON root is an array and leaves it unchanged", async () => {
    const root = await tempRoot();
    const original = "[1, 2, 3]\n";
    await writeFile(path.join(root, ".mcp.json"), original, "utf8");
    const result = await registerSpeckiwiMcp(root);
    expect(result.status).toBe("warning");
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe(original);
  });

  it("AC-3/AC-4: refuses when mcpServers is not an object and leaves the file unchanged", async () => {
    const root = await tempRoot();
    const original = `${JSON.stringify({ mcpServers: ["x"] }, null, 2)}\n`;
    await writeFile(path.join(root, ".mcp.json"), original, "utf8");
    const result = await registerSpeckiwiMcp(root);
    expect(result.status).toBe("warning");
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe(original);
  });

  it("AC-4: refuses (does not throw) when .mcp.json is a directory", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, ".mcp.json"), { recursive: true });
    const result = await registerSpeckiwiMcp(root);
    expect(result.status).toBe("warning");
  });
});
