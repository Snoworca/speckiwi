import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendWorkflowJsonl } from "../../../src/core/workflow/jsonl.js";
import { applyWorkflowMutation } from "../../../src/core/workflow/mutation.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-193 — the append gate reads diagnostic severity instead of counting diagnostics.
// @req FR-NODE-194 — an append to a journal that does not exist yet creates it.
//
// Both defects were measured before these tests existed. Every diagnostic the parser produces is a
// warning, so counting them made "this journal was once written by a version that spelled an event
// differently" a permanent denial — this repository's own journal has two such lines. And the first
// append in a fresh project died on `realpath` of the file it was about to create, so the tool path
// could never bootstrap; only the unvalidated shell append the skills use could.

const REL = "kiwi/pipeline.jsonl";

async function project(): Promise<Awaited<ReturnType<typeof resolveProjectRoot>>> {
  const root = await mkdtemp(path.join(tmpdir(), "journal-resilience-"));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await writeFile(path.join(root, "docs", "spec", "00.index.md"), "# Index\n", "utf8");
  return resolveProjectRoot(root);
}

/** A project whose journal already holds `body`, written verbatim so a case can shape it exactly. */
async function seeded(body: string) {
  const root = await project();
  const abs = path.join(root.root, REL);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
  return { root, abs };
}

function event(runId: string, extra: Record<string, unknown> = {}) {
  return { ts: "2026-08-19T00:00:00.000Z", schema_version: "1.0.0", skill: "kiwi-srs", run_id: runId, status: "TASK_DONE", ...extra };
}

const VALID = `${JSON.stringify(event("r-0"))}\n`;

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

function nonEmptyLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/** Every line parses, which is the only property that keeps the journal readable at all. */
function allLinesParse(text: string): boolean {
  return nonEmptyLines(text).every((line) => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  });
}

describe("FR-NODE-193 AC-1/AC-2 — a legacy line does not deny the write", () => {
  it("appends past a line whose schema version is unsupported, and reports the warning", async () => {
    // The exact shape of this repository's lines 35-36: written before `schema_version` existed.
    const legacy = `${JSON.stringify({ ts: "2026-07-10T00:00:00.000Z", run_id: "old", skill: "kiwi-pm", status: "TASK_DONE" })}\n`;
    const { root, abs } = await seeded(legacy);

    const result = await appendWorkflowJsonl(root, REL, event("r-1"));

    expect(result.ok, `append was denied: ${result.ok ? "" : result.error.message}`).toBe(true);
    const after = await readFile(abs, "utf8");
    expect(after.startsWith(legacy), "the legacy line was rewritten or removed").toBe(true);
    expect(nonEmptyLines(after)).toHaveLength(2);
    // Proceeding is not the same as pretending the file is clean.
    expect(result.diagnostics?.some((entry) => entry.code === "SRS-W055"), "the warning was dropped").toBe(true);
  });

  it("appends past an unsupported version string too", async () => {
    const { root, abs } = await seeded(`${JSON.stringify(event("r-0", { schema_version: "9.9.9" }))}\n`);

    const result = await appendWorkflowJsonl(root, REL, event("r-1"));

    expect(result.ok).toBe(true);
    expect(nonEmptyLines(await readFile(abs, "utf8"))).toHaveLength(2);
  });
});

describe("FR-NODE-193 AC-3 — an unreadable line is stepped over, not repaired", () => {
  it("appends after it and leaves it byte-identical", async () => {
    const broken = '{"ts":"2026-08-19T00:00:00.000Z","schema_ver\n';
    const { root, abs } = await seeded(`${VALID}${broken}`);

    const result = await appendWorkflowJsonl(root, REL, event("r-1"));

    expect(result.ok, `append was denied: ${result.ok ? "" : result.error.message}`).toBe(true);
    const after = await readFile(abs, "utf8");
    // The tool cannot read this line, so it has no business rewriting it — only adding after it.
    expect(after.startsWith(`${VALID}${broken}`), "the unreadable line was altered").toBe(true);
    expect(result.diagnostics?.some((entry) => entry.code === "SRS-W052"), "the parse warning was dropped").toBe(true);
  });
});

describe("FR-NODE-193 AC-4 — a missing trailing newline is resolved by the append itself", () => {
  it("writes the separator it needs so the two events do not merge", async () => {
    // The recovery for this already existed in the code and was unreachable: the same condition
    // raised a warning, and the warning denied the write before the recovery could run.
    const { root, abs } = await seeded(JSON.stringify(event("r-0"))); // no trailing "\n"

    const result = await appendWorkflowJsonl(root, REL, event("r-1"));

    expect(result.ok, `append was denied: ${result.ok ? "" : result.error.message}`).toBe(true);
    const after = await readFile(abs, "utf8");
    expect(nonEmptyLines(after), "the events were welded into one line").toHaveLength(2);
    expect(allLinesParse(after)).toBe(true);
  });
});

describe("FR-NODE-193 AC-5/AC-6 — an error still refuses, and severity is what decides", () => {
  it("refuses when a diagnostic carries error severity, writing nothing", async () => {
    const { root, abs } = await seeded(VALID);
    const before = await readFile(abs, "utf8");

    // A stale snapshot is the error the gate must still honour.
    const result = await appendWorkflowJsonl(root, REL, event("r-1"), { expectedSha256: "0".repeat(64) });

    expect(result.ok, "an error-severity condition was allowed through").toBe(false);
    expect(await readFile(abs, "utf8"), "the refused append still wrote").toBe(before);
  });

  it("every diagnostic the parser produces is a warning, which is why the gate now blocks nothing", async () => {
    // Mutation testing found this: emptying the blocking filter entirely left the suite green,
    // because no diagnostic reaching that gate has ever carried error severity. So the severity
    // selection is vacuous today, and claiming a test "proves errors still block" would be false.
    //
    // What is worth fixing is the premise. If someone later introduces an error-severity diagnostic,
    // this assertion fails and they have to decide on purpose whether appends should stop for it,
    // instead of silently changing when the journal locks.
    const messy = [
      JSON.stringify({ ts: "2026-07-10T00:00:00.000Z", run_id: "old", skill: "kiwi-pm", status: "TASK_DONE" }), // no schema_version
      '{"broken":',                                                                                             // unreadable
      JSON.stringify(event("dup")),
      JSON.stringify(event("dup")),                                                                             // duplicate key
      JSON.stringify(event("gone", { status: "DELETED" }))                                                      // tombstone
    ].join("\n"); // and no trailing newline, for SRS-W056
    const { root } = await seeded(messy);

    const result = await appendWorkflowJsonl(root, REL, event("r-1"));

    const codes = (result.diagnostics ?? []).map((entry) => entry.code);
    expect(new Set(codes).size, "the fixture did not exercise several diagnostics at once").toBeGreaterThan(2);
    const severities = new Set((result.diagnostics ?? []).map((entry) => entry.severity));
    expect([...severities], "the parser now emits a non-warning diagnostic; decide whether it should block appends").toEqual(["warning"]);
    expect(result.ok, "warnings denied the write").toBe(true);
  });
});

/**
 * The append as a consumer reaches it: through the locked mutation layer.
 *
 * Calling `appendWorkflowJsonl` directly skips the lock, and the lock is where the bootstrap failed —
 * an earlier version of these cases did exactly that and passed before the fix, proving nothing.
 */
async function emit(root: Awaited<ReturnType<typeof project>>, runId: string, options: { dryRun?: boolean } = {}) {
  return applyWorkflowMutation(root, {
    kind: "pipeline_event_append",
    owner: "kiwi-pm",
    runId,
    jsonlPath: REL,
    event: event(runId),
    ...(options.dryRun ? { dryRun: true } : {})
  });
}

describe("FR-NODE-194 AC-1/AC-2 — a journal that does not exist is created", () => {
  it("creates the directory and the file, and writes the event", async () => {
    const root = await project();
    const abs = path.join(root.root, REL);
    expect(await exists(path.dirname(abs)), "the fixture already had a kiwi directory").toBe(false);

    const result = await emit(root, "r-1");

    expect(result.ok, `first append failed: ${result.ok ? "" : result.error.message}`).toBe(true);
    expect(await exists(abs)).toBe(true);
    const after = await readFile(abs, "utf8");
    expect(nonEmptyLines(after)).toHaveLength(1);
    expect(JSON.parse(nonEmptyLines(after)[0]!).run_id).toBe("r-1");
  });

  it("creates nothing on a dry run", async () => {
    const root = await project();
    const abs = path.join(root.root, REL);

    const result = await emit(root, "r-1", { dryRun: true });

    expect(result.ok).toBe(true);
    expect(await exists(abs), "a dry run created the file").toBe(false);
    expect(await exists(path.dirname(abs)), "a dry run created the directory").toBe(false);
  });
});

describe("FR-NODE-194 AC-4 — creating the file does not bypass the lock", () => {
  it("keeps every written line parseable when two first appends race", async () => {
    const root = await project();

    const [a, b] = await Promise.all([emit(root, "race-a"), emit(root, "race-b")]);

    // One may lose the lock and say so; what must not happen is a truncated or merged line.
    const after = await readFile(path.join(root.root, REL), "utf8").catch(() => "");
    expect(allLinesParse(after), "a racing first append left an unparseable line").toBe(true);
    expect([a, b].filter((result) => result.ok).length, "neither racing append succeeded").toBeGreaterThan(0);
    expect(nonEmptyLines(after).length, "more lines than appends").toBeLessThanOrEqual(2);
  });
});

describe("FR-NODE-194 AC-3 — the containment guard does not weaken for an absent file", () => {
  it("rejects a path that resolves outside the project root, and creates nothing", async () => {
    // The guard rejects by throwing rather than by returning a failed result. What the criterion
    // fixes is that no write happens; asserting the shape of the rejection would pin an incidental
    // detail, and asserting only that it rejected would pass over a guard that rejected AFTER
    // creating the directory.
    const root = await project();
    const escapee = path.resolve(root.root, "..", "escaped");

    await expect(appendWorkflowJsonl(root, "../escaped/pipeline.jsonl", event("r-1"))).rejects.toThrow(/outside project root/i);

    expect(await exists(escapee), "the rejected path was created anyway").toBe(false);
  });
});

describe("FR-NODE-194 AC-5 — a created journal behaves like a pre-existing one", () => {
  it("takes a second append the same way, with both events on their own lines", async () => {
    // Duplicate suppression lives in the calling mutation layer, not here — an earlier version of
    // this case asserted it at this level and failed for that reason, not because anything was
    // wrong. What belongs here is that creating the file leaves the append semantics unchanged.
    const root = await project();

    const first = await emit(root, "r-1");
    const second = await emit(root, "r-2");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const after = await readFile(path.join(root.root, REL), "utf8");
    expect(nonEmptyLines(after)).toHaveLength(2);
    expect(allLinesParse(after)).toBe(true);
  });
});
