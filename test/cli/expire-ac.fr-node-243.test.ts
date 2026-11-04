import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { findSpecByCliName } from "../../src/mcp/schemas.js";
import { acFixture, scopeText } from "../core/ac-expiry-fixture.js";

// FR-NODE-243 AC-6 — the expire mutation on both surfaces: the `expire-ac` CLI command and the
// `expire_acceptance_criterion` MCP tool, classified req-scoped. The fixture gives FR-ARCH-001 three
// live criteria and adds FR-ARCH-002 as a successor to name.

const THREE_LIVE = ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: third"];

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function cli(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = io();
  const code = await main(["--root", root, ...args], streams);
  return { code, stdout: drain(streams.stdout), stderr: drain(streams.stderr) };
}

/** Writes an unexpired lock owned by another session (same shape as the IR-CLI-078 suite). */
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
    })}
`,
    "utf8"
  );
}

describe("FR-NODE-243 AC-6 — the CLI exposes the expire mutation", () => {
  // @req FR-NODE-243 AC-6
  it("expire-ac <id> <acId> --reason --successor rewrites the line and records the reason", async () => {
    const root = await acFixture({ acLines: THREE_LIVE });
    const run = await cli(root, ["expire-ac", "FR-ARCH-001", "AC-3", "--reason", "moved", "--successor", "FR-ARCH-002", "--json"]);

    expect(run.code, run.stdout + run.stderr).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; value: { id: string; acId: string; successor?: string; written: boolean; expiredOn: string } };
    expect(parsed.value).toMatchObject({ id: "FR-ARCH-001", acId: "AC-3", successor: "FR-ARCH-002", written: true });
    const text = await scopeText(root);
    expect(text).toContain(`- [x] AC-3: ~~third~~ [EXPIRED ${parsed.value.expiredOn} → FR-ARCH-002]`);
    expect(text).toContain(`| ${parsed.value.expiredOn} | Expired AC-3 | moved |`);
  });

  // @req FR-NODE-243 AC-6
  it("--dry-run reports the result and writes nothing", async () => {
    const root = await acFixture({ acLines: THREE_LIVE });
    const before = await scopeText(root);
    const run = await cli(root, ["expire-ac", "FR-ARCH-001", "AC-1", "--reason", "gone", "--dry-run", "--json"]);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect((JSON.parse(run.stdout) as { value: { written: boolean } }).value.written).toBe(false);
    expect(await scopeText(root)).toBe(before);
  });

  // @req FR-NODE-243 AC-6
  it("a refusal exits 5 with the reason and writes nothing", async () => {
    for (const args of [
      ["FR-ARCH-001", "AC-1", "--reason", "x", "--successor", "FR-ARCH-404"],
      ["FR-ARCH-001", "AC-9", "--reason", "x"],
      ["FR-ARCH-001", "AC-1", "--reason", "   "]
    ]) {
      const root = await acFixture({ acLines: THREE_LIVE });
      const before = await scopeText(root);
      const run = await cli(root, ["expire-ac", ...args, "--json"]);
      expect(run.code, args.join(" ")).toBe(5);
      const parsed = JSON.parse(run.stdout) as { ok: boolean; error: { code: string; message: string } };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.message.length).toBeGreaterThan(0);
      expect(await scopeText(root)).toBe(before);
    }
  });

  // @req FR-NODE-243 AC-6
  it("a held lock refuses the write on both surfaces, and --ignore-lock / ignoreLock get it through", async () => {
    const root = await acFixture({ acLines: THREE_LIVE });
    await holdLock(root);
    const before = await scopeText(root);
    const blocked = await cli(root, ["expire-ac", "FR-ARCH-001", "AC-1", "--reason", "gone", "--json"]);
    expect(blocked.code, blocked.stdout).toBe(5);
    const handle = createMcpServer({ root });
    expect(((await handle.callTool("expire_acceptance_criterion", { id: "FR-ARCH-001", acId: "AC-1", reason: "gone" })) as { ok: boolean }).ok).toBe(false);
    expect(await scopeText(root)).toBe(before);

    const bypassed = await cli(root, ["expire-ac", "FR-ARCH-001", "AC-1", "--reason", "gone", "--ignore-lock", "--json"]);
    expect(bypassed.code, bypassed.stdout + bypassed.stderr).toBe(0);
    expect(await scopeText(root)).toContain("AC-1: ~~first~~ [EXPIRED");
    expect(((await handle.callTool("expire_acceptance_criterion", { id: "FR-ARCH-001", acId: "AC-2", reason: "gone", ignoreLock: true })) as { ok: boolean }).ok).toBe(true);
  });

  // @req FR-NODE-243 AC-6
  it("--reason is required by the command itself", async () => {
    const root = await acFixture({ acLines: THREE_LIVE });
    const before = await scopeText(root);
    const run = await cli(root, ["expire-ac", "FR-ARCH-001", "AC-1"]);
    expect(run.code).toBe(2);
    expect(await scopeText(root)).toBe(before);
  });

  // @req FR-NODE-243 AC-6
  it("the registry lists the CLI command beside the MCP tool, as one req-scoped entry", () => {
    const spec = findSpecByCliName("expire-ac");
    expect(spec?.mcpName).toBe("expire_acceptance_criterion");
    expect(spec?.kind).toBe("req-scoped");
  });
});

describe("FR-NODE-243 AC-6 — the MCP tool is req-scoped and matches the CLI", () => {
  // @req FR-NODE-243 AC-6
  it("expire_acceptance_criterion is registered with kind req-scoped", async () => {
    const handle = createMcpServer({ root: await acFixture({ acLines: THREE_LIVE }) });
    expect(Object.keys(handle.tools)).toContain("expire_acceptance_criterion");
    expect(handle.toolKinds.expire_acceptance_criterion).toBe("req-scoped");
  });

  // @req FR-NODE-243 AC-6
  it("the tool writes the same bytes and returns the same value as the CLI for the same input", async () => {
    const cliRoot = await acFixture({ acLines: THREE_LIVE });
    const mcpRoot = await acFixture({ acLines: THREE_LIVE });
    const run = await cli(cliRoot, ["expire-ac", "FR-ARCH-001", "AC-2", "--reason", "superseded", "--successor", "FR-ARCH-002", "--json"]);
    const viaMcp = (await createMcpServer({ root: mcpRoot }).callTool("expire_acceptance_criterion", {
      id: "FR-ARCH-001",
      acId: "AC-2",
      reason: "superseded",
      successor: "FR-ARCH-002"
    })) as { ok: boolean; value: unknown };

    expect(viaMcp.ok, JSON.stringify(viaMcp)).toBe(true);
    expect(viaMcp.value).toEqual((JSON.parse(run.stdout) as { value: unknown }).value);
    expect(await scopeText(mcpRoot)).toBe(await scopeText(cliRoot));
  });

  // @req FR-NODE-243 AC-6
  it("a refusal returns a failure envelope and writes nothing; dryRun writes nothing", async () => {
    const root = await acFixture({ acLines: THREE_LIVE });
    const before = await scopeText(root);
    const handle = createMcpServer({ root });
    const refused = (await handle.callTool("expire_acceptance_criterion", { id: "FR-ARCH-001", acId: "AC-1", reason: "x", successor: "FR-ARCH-404" })) as {
      ok: boolean;
      error: { message: string };
    };
    expect(refused.ok).toBe(false);
    expect(refused.error.message).toContain("FR-ARCH-404");
    const preview = (await handle.callTool("expire_acceptance_criterion", { id: "FR-ARCH-001", acId: "AC-1", reason: "x", dryRun: true })) as {
      ok: boolean;
      value: { written: boolean };
    };
    expect(preview.ok).toBe(true);
    expect(preview.value.written).toBe(false);
    expect(await scopeText(root)).toBe(before);
  });
});
