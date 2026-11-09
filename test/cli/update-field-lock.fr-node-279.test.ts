import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { updateField } from "../../src/core/mutation/update-field.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-279 AC-3 — update-field's type and scope migration rewrites the requirement id in several
// documents, so it runs under the SRS mutation lock and refuses, writing nothing, while another writer
// holds it.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

/** A lock owned by another session that has not expired, so recovery does not take it over. */
async function holdLock(rootPath: string): Promise<void> {
  await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
  await writeFile(
    path.join(rootPath, "kiwi", ".srs.lock"),
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

async function snapshotSpec(rootPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const dir = path.join(rootPath, "docs", "spec");
  for (const name of await readdir(dir)) {
    if (name.endsWith(".md")) out[name] = await readFile(path.join(dir, name), "utf8");
  }
  return out;
}

describe("FR-NODE-279 AC-3 — update-field migration under the SRS mutation lock", () => {
  // @req FR-NODE-279 AC-3
  it("refuses a confirmed type migration with SRS_LOCKED and writes nothing while another writer holds the lock", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await holdLock(rootPath);
    const before = await snapshotSpec(rootPath);
    const streams = io();
    const code = await main(["--root", rootPath, "update-field", "FR-ARCH-001", "--field", "type", "--value", "interface", "--apply", "--confirm", "--json"], streams);
    const out = drain(streams.stdout);
    expect(code, out).toBe(5);
    expect(JSON.parse(out).error.code).toBe("SRS_LOCKED");
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req FR-NODE-279 AC-3
  it("refuses a confirmed scope migration through the core mutation the same way", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await holdLock(rootPath);
    const before = await snapshotSpec(rootPath);
    const result = await updateField(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", field: "scope", value: "PARSE", signOff: true, dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SRS_LOCKED");
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req FR-NODE-279 AC-3 — the lock is released afterwards, so the next migration goes through.
  it("migrates once the lock is free and leaves no lock behind", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const code = await main(["--root", rootPath, "update-field", "FR-ARCH-001", "--field", "type", "--value", "interface", "--apply", "--confirm", "--json"], streams);
    expect(code, drain(streams.stdout)).toBe(0);
    expect(await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).toContain("IR-ARCH-001");
    const kiwi = await readdir(path.join(rootPath, "kiwi")).catch(() => [] as string[]);
    expect(kiwi.filter((name) => name.startsWith(".srs.lock"))).toEqual([]);
  });

  // @req FR-NODE-279 AC-3 — the SRS-only override every comparable mutation offers.
  it("gets a confirmed migration past a held lock with --ignore-lock", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await holdLock(rootPath);
    const streams = io();
    const code = await main(["--root", rootPath, "update-field", "FR-ARCH-001", "--field", "type", "--value", "interface", "--apply", "--confirm", "--ignore-lock", "--json"], streams);
    expect(code, drain(streams.stdout)).toBe(0);
    expect(await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).toContain("IR-ARCH-001");
  });
});
