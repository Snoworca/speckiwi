import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { sdsPath, sdsWorkspace, writeUnder } from "../core/orchestrator/sds-fixtures.js";

// @req FR-NODE-165 — a verb that journals its own option use reports whether the line landed.
//
// `run abort` reads the append helper's outcome and refuses with `run-invariant-drift` when the line
// did not land. The scheduler once awaited the same helper and threw the result away, so a refused
// append was silent and the caller was told the option use was recorded when the journal was
// byte-identical afterwards. `orchestrate schedule waves` keeps the journalled grounding
// (IR-CLI-084 AC-6), so it keeps this obligation.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A journal that refuses every append. The `complete` line has no preceding passing `wave-verify`
 * for its run and wave, so `complete-without-latest-pass` fires at error severity over the RESULTING
 * journal — which is what the helper validates — and the candidate is unlinked before the rename.
 */
const POISON =
  JSON.stringify({
    ts: "2026-08-02T00:00:00Z",
    schema_version: "1.4.0",
    run_id: "run-f",
    wave: "wave-1",
    order: 1,
    target: "wave-1",
    status: "complete",
    summary: "done",
    engine: "kiwi-orchestrator",
    writer: "speckiwi-orchestrate/test"
  }) + "\n";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = io();
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function journal(root: string): Promise<string> {
  return readFile(path.join(root, "kiwi", "waves.jsonl"), "utf8").catch(() => "");
}

/** A root whose one SDS grounds cleanly, so the only thing that can refuse is the journal append. */
async function scheduleRoot(journalText: string): Promise<string> {
  const root = await sdsWorkspace([{ id: "run-f-wave-1", files: ["src/a.ts"], testFiles: ["test/a.test.ts"] }]);
  await writeUnder(root, "kiwi/waves.jsonl", journalText);
  await writeUnder(root, "existing.json", JSON.stringify(["src/a.ts", "test/a.test.ts"]));
  return root;
}

function scheduleArgv(root: string, extra: string[] = []): string[] {
  return [
    "--root", root, "orchestrate", "schedule", "waves",
    "--sds", sdsPath("run-f-wave-1"),
    "--depends", "{}",
    "--existing-paths", "existing.json",
    "--strict-grounding",
    "--run-id", "run-f",
    ...extra
  ];
}

describe("FR-NODE-165 AC-1 — schedule waves refuses when its own journal line cannot land", () => {
  it("FR-NODE-165 AC-1 raises run-invariant-drift carrying the append's diagnostics instead of returning a lanes lock", async () => {
    const root = await scheduleRoot(POISON);
    const result = await run(scheduleArgv(root));

    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
    expect(JSON.stringify(result.payload.violations)).toContain("complete-without-latest-pass");
    expect(result.payload, "a refused recording must not also report a lanes lock").not.toHaveProperty("lock");
  });

  it("FR-NODE-165 AC-1 still returns a lanes lock when the journal accepts the line, so the refusal is the poison and not the verb", async () => {
    const root = await scheduleRoot("");
    const result = await run(scheduleArgv(root));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload).toHaveProperty("lock");
  });
});

describe("FR-NODE-165 AC-2 — a dry run is not a failed write", () => {
  it("FR-NODE-165 AC-2 does not refuse under --dry-run, and leaves the journal untouched", async () => {
    // The baseline is POISON rather than "": over an empty journal the untouched assertion compared
    // "" with "" and also held if the file had been emptied or deleted, so it could not fail.
    const root = await scheduleRoot(POISON);
    const before = await journal(root);
    expect(before, "the baseline must be non-empty for 'untouched' to mean anything").toBe(POISON);

    const result = await run(scheduleArgv(root, ["--dry-run"]));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(await journal(root), "a dry run must write nothing").toBe(before);
  });

  it("FR-NODE-165 AC-2 reports the dry run as not written rather than claiming a write", async () => {
    const root = await scheduleRoot("");
    const result = await run(scheduleArgv(root, ["--dry-run"]));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.journalWritten, "a dry run wrote nothing, and must say so").toBe(false);
  });
});

describe("FR-NODE-165 AC-4 — the success path says a line landed, and it did", () => {
  it("FR-NODE-165 AC-4 reports the write and the journal read back from disk holds exactly that line", async () => {
    const root = await scheduleRoot("");
    const result = await run(scheduleArgv(root));
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.journalWritten, "schedule waves must report the write it performed").toBe(true);
    const lines = (await journal(root)).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ run_id: "run-f", verb: "freeze-lane-plan", strict_grounding: true });
  });

  it("FR-NODE-165 AC-4 reports no write when no run is named", async () => {
    const root = await scheduleRoot("");
    const result = await run(scheduleArgv(root).filter((arg, index, all) => arg !== "--run-id" && all[index - 1] !== "--run-id"));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.journalWritten).toBe(false);
    expect(await journal(root)).toBe("");
  });
});

describe("FR-NODE-165 AC-5 — a refused append leaves the journal byte-identical", () => {
  it("FR-NODE-165 AC-5 changes nothing, and leaves no candidate file behind", async () => {
    const root = await scheduleRoot(POISON);
    const before = await journal(root);
    expect(before, "the poison must actually be present, or this assertion is vacuous").toContain("complete");

    const result = await run(scheduleArgv(root));
    expect(result.exit).toBe(2);
    expect(await journal(root)).toBe(before);
    // Scanned by prefix, not by the one literal name: @req FR-NODE-196 AC-3 gave the candidate a
    // per-attempt suffix, so reading the bare `waves.jsonl.candidate` became a read of a path that
    // can never exist, and this assertion silently became a tautology.
    expect(
      (await readdir(path.join(root, "kiwi"))).filter((entry) => entry.startsWith("waves.jsonl.candidate")),
      "the refused append left a candidate behind"
    ).toEqual([]);
  });
});

describe("FR-NODE-165 AC-6 — no call site discards the append outcome", () => {
  it("binds the result of every appendWavesLine call in the orchestrate command module", () => {
    const CALL = /^(?<prefix>.*?)\bappendWavesLine\s*\(/;
    const source = readFileSync(path.join(REPO_ROOT, "src/cli/commands/orchestrate.ts"), "utf8");
    const sites = source
      .split(/\r?\n/)
      .map((line, index) => ({ line, number: index + 1 }))
      // The declaration is not a call site.
      .filter((entry) => CALL.test(entry.line) && !/\bfunction\b/.test(entry.line));

    expect(sites.length, "the census found no call sites, so it proves nothing").toBeGreaterThan(0);

    // The criterion's own parity clause, which was stated and never written. The line-scoped census
    // above drops any line carrying the word `function`, so a call split across lines — or one on a
    // line that also mentions `function` — is skipped in silence, which is precisely the omission
    // the clause exists to catch. Count the identifier independently and reconcile.
    const mentions = (source.match(/\bappendWavesLine\s*\(/g) ?? []).length;
    const declarations = (source.match(/\bfunction\s+appendWavesLine\s*\(/g) ?? []).length;
    expect(declarations, "appendWavesLine is declared exactly once in this module").toBe(1);
    expect(
      sites.length,
      `the census saw ${sites.length} call sites but the identifier occurs ${mentions} times, ${declarations} of them a declaration`
    ).toBe(mentions - declarations);

    const discarded = sites.filter((entry) => {
      const prefix = (CALL.exec(entry.line)?.groups?.prefix ?? "").replace(/\bawait\s*$/, "").trimEnd();
      return !/[=(,]$/.test(prefix) && !/\breturn$/.test(prefix);
    });
    expect(
      discarded.map((entry) => `${entry.number}: ${entry.line.trim()}`),
      `every call must bind its outcome; ${sites.length} call sites seen`
    ).toEqual([]);
  });
});
