import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { findSpecByCliName } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-078 — scaffold-scope can get past a held SRS mutation lock.
//
// The mutation took no lock before v2.5.0 (two concurrent calls provably produced two documents on one
// number). It now takes one and reads input.ignoreLock, but no caller ever supplies it, so a held lock
// leaves this one mutation with no way through where it previously always succeeded.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/** Writes a lock owned by another session that has not expired, so recovery does not kick in. */
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

async function scopeDocuments(root: string): Promise<string[]> {
  return (await readdir(path.join(root, "docs", "spec"))).filter((name) => name.endsWith(".srs.md")).sort();
}

describe("IR-CLI-078 AC-1 — --ignore-lock gets the scaffold through a held lock", () => {
  it("creates the scope document while another session holds the lock", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await scopeDocuments(root);
    await holdLock(root);

    const streams = io();
    const code = await main(["--root", root, "scaffold-scope", "Billing:BILL", "--apply", "--ignore-lock", "--json"], streams);

    expect(code, drain(streams.stdout)).toBe(0);
    const after = await scopeDocuments(root);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((name) => name.endsWith(".billing.srs.md"))).toBe(true);
  });
});

describe("IR-CLI-078 AC-2 — without the flag a held lock still refuses", () => {
  it("fails, reports the lock, and adds no scope document", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await scopeDocuments(root);
    await holdLock(root);

    const streams = io();
    const code = await main(["--root", root, "scaffold-scope", "Billing:BILL", "--apply", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(5);
    expect(out).toContain("SRS_LOCKED");
    expect(await scopeDocuments(root)).toEqual(before);
  });
});

describe("IR-CLI-078 AC-3 — the registry advertises the flag", () => {
  it("declares --ignore-lock on the scaffold-scope spec, so the catalog lists it", async () => {
    const spec = findSpecByCliName("scaffold-scope");
    expect(spec).toBeDefined();
    expect(spec!.options.map((option) => option.flag)).toContain("--ignore-lock");

    const root = await copyFixtureWorkspace("valid-basic");
    const streams = io();
    expect(await main(["--root", root, "commands", "--json"], streams)).toBe(0);
    const catalog = JSON.parse(drain(streams.stdout)) as unknown;
    const entry = JSON.stringify(catalog)
      .split('{"name":"')
      .find((chunk) => chunk.startsWith("scaffold-scope"));
    expect(entry, "the catalog must carry a scaffold-scope entry").toBeDefined();
    expect(entry).toContain("--ignore-lock");
  });
});
