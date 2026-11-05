import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// verify-v532-r2 (independent verification, round 2). No red test was found in this round; the
// cases below are the green checks that were kept, run against a copy of the repository's own SRS.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const made: string[] = [];

async function copyRealSpec(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "verify-v532-r2-"));
  made.push(dir);
  await cp(path.join(REPO_ROOT, "docs"), path.join(dir, "docs"), { recursive: true });
  return dir;
}

async function cli(rootPath: string, args: string[]): Promise<{ exitCode: number; json: Record<string, unknown> }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exitCode = await main(["--root", rootPath, ...args, "--json"], streams);
  const chunks: Buffer[] = [];
  let chunk: Buffer | null;
  while ((chunk = streams.stdout.read() as Buffer | null) !== null) chunks.push(chunk);
  return { exitCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown> };
}

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("verify-v532-r2 — FR-PARSE-049 on the repository's own SRS", () => {
  // @req FR-PARSE-049 AC-2
  // Input: docs/spec (the repository SRS, which holds Requirement rows to discarded requirements).
  it("links check and validate report the same discarded-target rows", async () => {
    const root = await copyRealSpec();
    const links = await cli(root, ["links", "check"]);
    const validate = await cli(root, ["validate"]);
    const broken = (links.json.broken as Array<{ requirementId: string; reference: string; code: string }>).filter((entry) => entry.code === "SRS-W081");
    const warnings = (validate.json.warnings as Array<{ code: string; requirementId?: string; details?: { discardedId?: string } }>).filter((entry) => entry.code === "SRS-W081");
    const fromLinks = broken.map((entry) => `${entry.requirementId}>${entry.reference}`).sort();
    const fromValidate = warnings.map((entry) => `${entry.requirementId}>${entry.details?.discardedId}`).sort();
    expect(fromLinks.length).toBeGreaterThan(0);
    expect(fromValidate).toEqual(fromLinks);
    expect(validate.exitCode).toBe(0);
  });
});

describe("verify-v532-r2 — FR-NODE-270 on the repository's own SRS", () => {
  // @req FR-NODE-270 AC-3 AC-4
  // Input: docs/spec/20.parser-validation.srs.md, FR-PARSE-049 Implementation Notes (two bullet notes).
  it("a replace dry run reports both notes, and the unconfirmed write is refused naming the flag and the count", async () => {
    const root = await copyRealSpec();
    const args = ["append-note", "FR-PARSE-049", "--section", "implementation_notes", "--mode", "replace", "--text", "one line"];
    const dry = await cli(root, [...args, "--dry-run"]);
    const value = dry.json.value as { removedItems: number; removedLines: string[]; written: boolean };
    expect(value.written).toBe(false);
    expect(value.removedItems).toBe(2);
    expect(value.removedLines.every((line) => line.startsWith("- "))).toBe(true);
    const refused = await cli(root, args);
    const error = refused.json.error as { code: string; message: string };
    expect(error.code).toBe("USAGE");
    expect(error.message).toContain("--confirm-replace");
    expect(error.message).toContain("2 items");
  });
});
