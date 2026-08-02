import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { defaultCatalog, defaultHandoff, defaultLane, defaultRoot } from "../core/orchestrator/handoff-fixtures.js";

// @req FR-NODE-165 — a verb that journals its own option use reports whether the line landed.
//
// `run abort` reads the append helper's outcome and refuses with `run-invariant-drift` when the line
// did not land. `schedule plan` and `handoff validate` awaited the same helper and threw the result
// away, so a refused append was silent and the caller was told the option use was recorded when the
// journal was byte-identical afterwards. Two acceptance criteria state that recording flatly —
// IR-CLI-084 AC-6 and FR-NODE-155 AC-3 — and both were false on this path.

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

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "fr-node-165-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
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

const SIDECAR = JSON.stringify({
  schema_version: "1.1.0",
  plan_contract: "1.2.0",
  tasks: [
    {
      id: "T-PH001-01",
      type: "code",
      action: "implement T-PH001-01",
      req_ids: ["FR-ARCH-001"],
      files: [{ path: "src/a.ts" }],
      test_files: [{ path: "test/a.test.ts" }],
      covers_ac: ["AC-1"],
      depends_on_task: []
    }
  ]
});

/** A root whose sidecar grounds cleanly, so the only thing that can refuse is the journal append. */
async function planRoot(journalText: string): Promise<string> {
  const root = await tempRoot();
  await write(root, "kiwi/waves.jsonl", journalText);
  await write(root, "plan.sidecar.json", SIDECAR);
  await write(root, "existing.json", JSON.stringify(["src/a.ts", "test/a.test.ts"]));
  await write(root, "src/a.ts", "export const a = 1;\n");
  await write(root, "test/a.test.ts", "export const t = 1;\n");
  return root;
}

async function handoffRoot(journalText: string): Promise<string> {
  const root = await tempRoot();
  await write(root, "kiwi/waves.jsonl", journalText);
  await write(root, "lane.json", JSON.stringify(defaultLane()));
  await write(root, "catalog.json", JSON.stringify(defaultCatalog()));
  await write(root, "base.json", JSON.stringify({ ...defaultRoot(), allowUntestedAc: 2 }));
  await write(root, "handoff.md", defaultHandoff());
  return root;
}

function planArgv(root: string, extra: string[] = []): string[] {
  return [
    "--root", root, "orchestrate", "schedule", "plan",
    "--plan", "plan.sidecar.json",
    "--existing-paths", "existing.json",
    "--strict-grounding",
    "--run-id", "run-f",
    ...extra
  ];
}

function handoffArgv(root: string, extra: string[] = []): string[] {
  return [
    "--root", root, "orchestrate", "handoff", "validate",
    "--lane", "lane.json", "--path", "handoff.md", "--catalog", "catalog.json", "--base", "base.json",
    "--run-id", "run-f",
    ...extra
  ];
}

describe("FR-NODE-165 AC-1 — schedule plan refuses when its own journal line cannot land", () => {
  it("raises run-invariant-drift carrying the append's diagnostics instead of returning a plan", async () => {
    const root = await planRoot(POISON);
    const result = await run(planArgv(root));

    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
    expect(JSON.stringify(result.payload.violations)).toContain("complete-without-latest-pass");
    expect(result.payload, "a refused recording must not also report a plan").not.toHaveProperty("plan");
  });

  it("still returns a plan when the journal accepts the line, so the refusal is the poison and not the verb", async () => {
    const root = await planRoot("");
    const result = await run(planArgv(root));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload).toHaveProperty("plan");
  });
});

describe("FR-NODE-165 AC-2 — a dry run is not a failed write", () => {
  it("does not refuse under --dry-run, and leaves the journal untouched", async () => {
    // The baseline is POISON rather than "": over an empty journal the untouched assertion compared
    // "" with "" and also held if the file had been emptied or deleted, so it could not fail.
    const root = await planRoot(POISON);
    const before = await journal(root);
    expect(before, "the baseline must be non-empty for 'untouched' to mean anything").toBe(POISON);

    const result = await run(planArgv(root, ["--dry-run"]));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(await journal(root), "a dry run must write nothing").toBe(before);
  });

  it("reports the dry run as not written rather than claiming a write", async () => {
    // The clause "the dry run is reported as such" had no assertion at all: setting journalWritten
    // unconditionally true left every case in this file green, so the verb could report a write it
    // had not performed.
    const root = await planRoot("");
    const result = await run(planArgv(root, ["--dry-run", "--strict-grounding", "--run-id", "run-a"]));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.journalWritten, "a dry run wrote nothing, and must say so").toBe(false);
  });
});

describe("FR-NODE-165 AC-3 — handoff validate refuses when its own journal line cannot land", () => {
  it("raises run-invariant-drift instead of returning counts", async () => {
    const root = await handoffRoot(POISON);
    const result = await run(handoffArgv(root));

    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
    expect(result.payload, "a refused recording must not also report counts").not.toHaveProperty("counts");
  });
});

describe("FR-NODE-165 AC-4 — the success path says a line landed, and it did", () => {
  it("reports the write and the journal read back from disk holds the line, at both verbs", async () => {
    const planned = await planRoot("");
    const plannedResult = await run(planArgv(planned));
    expect(plannedResult.exit, JSON.stringify(plannedResult.payload)).toBe(0);
    expect(plannedResult.payload.journalWritten, "schedule plan must report the write it performed").toBe(true);
    expect(await journal(planned)).toContain("\"strict_grounding\":true");

    const validated = await handoffRoot("");
    const validatedResult = await run(handoffArgv(validated));
    expect(validatedResult.exit, JSON.stringify(validatedResult.payload)).toBe(0);
    expect(validatedResult.payload.journalWritten, "handoff validate must report the write it performed").toBe(true);
    expect(await journal(validated)).toContain("\"verb\":\"verify-handoff\"");
  });

  it("reports no write when no run is named, so a read stays a read", async () => {
    const root = await handoffRoot("");
    const result = await run([
      "--root", root, "orchestrate", "handoff", "validate",
      "--lane", "lane.json", "--path", "handoff.md", "--catalog", "catalog.json", "--base", "base.json"
    ]);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.journalWritten).toBe(false);
    expect(await journal(root)).toBe("");
  });
});

describe("FR-NODE-165 AC-5 — a refused append leaves the journal byte-identical", () => {
  it("changes nothing at either verb, and leaves no candidate file behind", async () => {
    for (const build of [planRoot, handoffRoot]) {
      const root = await build(POISON);
      const before = await journal(root);
      expect(before, "the poison must actually be present, or this assertion is vacuous").toContain("complete");

      const argv = build === planRoot ? planArgv(root) : handoffArgv(root);
      const result = await run(argv);
      expect(result.exit).toBe(2);
      expect(await journal(root)).toBe(before);
      expect(await readFile(path.join(root, "kiwi", "waves.jsonl.candidate"), "utf8").catch(() => null)).toBeNull();
    }
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
