import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendWorkflowJsonl, parseWorkflowJsonl } from "../../../src/core/workflow/jsonl.js";
import { WAVES_SCHEMA_VERSIONS } from "../../../src/core/orchestrator/journal-schema.js";

// FR-NODE-125 — the workflow JSONL reader's `eventKeying` option, whose "none" value suppresses
// duplicate-key diagnostics and correction resolution for append-only journals.

async function rootWith(relativePath: string, lines: object[]): Promise<{ root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-jsonl-"));
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return { root };
}

const DUPLICATE_KEY_LINES = [
  { schema_version: "1.0.0", skill: "kiwi-srs", run_id: "r1", status: "OK", ts: "2026-08-02T00:00:00Z" },
  { schema_version: "1.0.0", skill: "kiwi-srs", run_id: "r1", status: "OK", ts: "2026-08-02T00:01:00Z" }
];

const CORRECTION_LINES = [
  { schema_version: "1.0.0", skill: "kiwi-srs", run_id: "r1", status: "OK", ts: "2026-08-02T00:00:00Z" },
  { schema_version: "1.0.0", skill: "kiwi-srs", run_id: "r2", status: "CORRECTION", corrects_run_id: "r1", ts: "2026-08-02T00:01:00Z" }
];

describe("FR-NODE-125 workflow JSONL eventKeying", () => {
  it("AC-1 defaults to skill-run when the option is omitted", async () => {
    const root = await rootWith("kiwi/pipeline.jsonl", DUPLICATE_KEY_LINES);

    const defaulted = await parseWorkflowJsonl(root, "kiwi/pipeline.jsonl");
    const explicit = await parseWorkflowJsonl(root, "kiwi/pipeline.jsonl", { eventKeying: "skill-run" });

    expect(defaulted.diagnostics).toEqual(explicit.diagnostics);
    expect(defaulted.entries.map((entry) => entry.eventKey)).toEqual(["kiwi-srs|r1", "kiwi-srs|r1"]);
  });

  it("AC-2 diagnoses a duplicate key by default and suppresses it under eventKeying none", async () => {
    const root = await rootWith("kiwi/pipeline.jsonl", DUPLICATE_KEY_LINES);

    const defaulted = await parseWorkflowJsonl(root, "kiwi/pipeline.jsonl");
    expect(defaulted.diagnostics.filter((item) => item.code === "SRS-W053")).toHaveLength(1);

    const suppressed = await parseWorkflowJsonl(root, "kiwi/pipeline.jsonl", { eventKeying: "none" });
    expect(suppressed.diagnostics.filter((item) => item.code === "SRS-W053")).toEqual([]);
  });

  it("AC-3 resolves a correction chain by default and leaves it unresolved under eventKeying none", async () => {
    const root = await rootWith("kiwi/pipeline.jsonl", CORRECTION_LINES);

    const defaulted = await parseWorkflowJsonl(root, "kiwi/pipeline.jsonl");
    expect(defaulted.latestEntries.map((entry) => entry.event.run_id)).toEqual([]);
    expect(defaulted.entries[0]?.correctedBy).toEqual(["r2"]);

    const unresolved = await parseWorkflowJsonl(root, "kiwi/pipeline.jsonl", { eventKeying: "none" });
    // The superseded line is present in the parsed output, and nothing is marked corrected.
    expect(unresolved.latestEntries.map((entry) => entry.event.run_id)).toEqual(["r1", "r2"]);
    expect(unresolved.entries[0]?.correctedBy).toBeUndefined();
  });

  it("AC-4 leaves every pre-existing caller passing no eventKeying option", async () => {
    // The trees that consumed the reader before this change; the option belongs to the orchestrator's
    // append-only journal alone, so a hit here means an existing caller's behaviour moved.
    const { stdout } = await import("node:child_process").then(async ({ execFile }) => {
      const { promisify } = await import("node:util");
      return promisify(execFile)(
        "git",
        // `jsonl.ts` is excluded because it is where the option is declared, not a caller of it.
        ["grep", "-l", "eventKeying", "--", "src/core/workflow", "src/core/mutation", "src/mcp", ":!src/core/workflow/jsonl.ts"],
        { cwd: process.cwd() }
      ).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
    });

    expect(stdout.trim()).toBe("");
  });

  it("AC-5 parses a many-line waves journal with no duplicate-key diagnostic and permits an append", async () => {
    const wavesLines = Array.from({ length: 30 }, (_unused, index) => ({
      ts: `2026-08-02T00:${String(index).padStart(2, "0")}:00Z`,
      schema_version: "1.3.0",
      run_id: "run-a",
      wave: "wave-1",
      order: 1,
      target: "wave-1",
      status: "in_progress",
      summary: `round ${index + 1}`
    }));
    const root = await rootWith("kiwi/waves.jsonl", wavesLines);
    const options = { eventKeying: "none" as const, supportedSchemaVersions: [...WAVES_SCHEMA_VERSIONS] };

    const parsed = await parseWorkflowJsonl(root, "kiwi/waves.jsonl", options);
    expect(parsed.diagnostics).toEqual([]);

    // The default halt policy refuses an append when the pre-existing file carries any diagnostic,
    // so a suppressed duplicate is what makes the 31st line writable at all.
    const appended = await appendWorkflowJsonl(
      root,
      "kiwi/waves.jsonl",
      { ...wavesLines[0], summary: "round 31" },
      options
    );
    expect(appended.ok).toBe(true);

    const text = await readFile(path.join(root.root, "kiwi/waves.jsonl"), "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(31);
  });

  it("AC-5 refuses the same append under the default keying, which is why the option exists", async () => {
    const wavesLines = Array.from({ length: 3 }, (_unused, index) => ({
      ts: `2026-08-02T00:0${index}:00Z`,
      schema_version: "1.3.0",
      run_id: "run-a",
      wave: "wave-1",
      status: "in_progress"
    }));
    const root = await rootWith("kiwi/waves.jsonl", wavesLines);

    const refused = await appendWorkflowJsonl(root, "kiwi/waves.jsonl", wavesLines[0] as object, {
      supportedSchemaVersions: [...WAVES_SCHEMA_VERSIONS]
    });

    expect(refused.ok).toBe(false);
  });
});
