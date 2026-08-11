import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerSpeckiwiMcp } from "../../../src/core/bootstrap/mcp-registration.js";

// @req FR-NODE-187
//
// The launcher this repository carries was written by the product itself and reads
// `npx -y speckiwi mcp`, which resolves to whatever is installed globally. Measured 2026-08-11: the
// session's MCP server reported 2.7.1 while the checkout was 2.7.2, and its tool list was missing
// exactly the one tool the newer build adds. A repository that dogfoods its own product is the one
// place where the registry copy is guaranteed to be the wrong one.

async function root(label: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `mcp-self-host-${label}-`));
}

async function withPackage(dir: string, name: string): Promise<void> {
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0" }), "utf8");
}

async function withBin(dir: string): Promise<void> {
  await mkdir(path.join(dir, "bin"), { recursive: true });
  await writeFile(path.join(dir, "bin", "speckiwi"), "#!/usr/bin/env node\n", "utf8");
}

async function launcher(dir: string): Promise<{ command: string; args: string[] }> {
  const parsed = JSON.parse(await readFile(path.join(dir, ".mcp.json"), "utf8"));
  return parsed.mcpServers.speckiwi;
}

describe("FR-NODE-187 — MCP registration in a self-hosting checkout", () => {
  it("AC-1: a checkout that is speckiwi and has bin/speckiwi launches its own entrypoint", async () => {
    const dir = await root("self");
    await withPackage(dir, "speckiwi");
    await withBin(dir);

    const result = await registerSpeckiwiMcp(dir);

    expect(result.status).toBe("created");
    expect(await launcher(dir)).toEqual({ command: "node", args: ["bin/speckiwi", "mcp"] });
  });

  it("AC-2: the name alone is not enough — no bin/speckiwi means the ordinary launcher", async () => {
    const dir = await root("no-bin");
    await withPackage(dir, "speckiwi");

    await registerSpeckiwiMcp(dir);

    expect(await launcher(dir)).toEqual({ command: "npx", args: ["-y", "speckiwi", "mcp"] });
  });

  it("AC-3: another package keeps the ordinary launcher even when bin/speckiwi exists", async () => {
    const dir = await root("other");
    await withPackage(dir, "some-consumer");
    await withBin(dir);

    await registerSpeckiwiMcp(dir);

    expect(await launcher(dir)).toEqual({ command: "npx", args: ["-y", "speckiwi", "mcp"] });
  });

  it("AC-4: no readable package.json keeps the ordinary launcher rather than failing", async () => {
    const dir = await root("bare");

    const result = await registerSpeckiwiMcp(dir);

    expect(result.status).toBe("created");
    expect(await launcher(dir)).toEqual({ command: "npx", args: ["-y", "speckiwi", "mcp"] });
  });

  it("AC-5: idempotence is unchanged — an existing speckiwi key is still skipped", async () => {
    const dir = await root("existing");
    await withPackage(dir, "speckiwi");
    await withBin(dir);
    const original = { mcpServers: { speckiwi: { command: "custom", args: [] }, other: { command: "x" } }, extra: 1 };
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify(original), "utf8");

    const result = await registerSpeckiwiMcp(dir);

    expect(result.status).toBe("skipped");
    expect(JSON.parse(await readFile(path.join(dir, ".mcp.json"), "utf8"))).toEqual(original);
  });

  it("AC-5: a file holding other servers gains speckiwi and keeps the rest", async () => {
    const dir = await root("merge");
    await withPackage(dir, "speckiwi");
    await withBin(dir);
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } }, top: 2 }), "utf8");

    const result = await registerSpeckiwiMcp(dir);

    expect(result.status).toBe("updated");
    const parsed = JSON.parse(await readFile(path.join(dir, ".mcp.json"), "utf8"));
    expect(parsed.mcpServers.other).toEqual({ command: "x" });
    expect(parsed.top).toBe(2);
    expect(parsed.mcpServers.speckiwi).toEqual({ command: "node", args: ["bin/speckiwi", "mcp"] });
  });

  it("AC-6: the manual-registration warning names the launcher the detection chose", async () => {
    const dir = await root("warn");
    await withPackage(dir, "speckiwi");
    await withBin(dir);
    await writeFile(path.join(dir, ".mcp.json"), "not json at all", "utf8");

    const result = await registerSpeckiwiMcp(dir);

    expect(result.status).toBe("warning");
    const text = result.warnings.join("\n");
    expect(text).toContain('"command":"node"');
    expect(text).toContain("bin/speckiwi");
  });
});
