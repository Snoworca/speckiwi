import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req IR-CLI-083 — `orchestrate validate --strict`, the writer stamp, and the run-scoped
// version-downgrade guard.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-strict-"));
}

interface Line {
  readonly schemaVersion: string;
  readonly runId?: string;
  readonly writer?: string;
}

/** A benign `author-design` intent, the smallest line that trips no other journal rule. */
function line(options: Line): Record<string, unknown> {
  return {
    schema_version: options.schemaVersion,
    run_id: options.runId ?? "run-a",
    engine: "kiwi-orchestrator",
    verb: "author-design",
    kind: "intent",
    wave: "wave-1",
    ...(options.writer ? { writer: options.writer } : {})
  };
}

async function validateRun(lines: Record<string, unknown>[], argv: string[] = ["--strict"]): Promise<{
  exit: number;
  payload: Record<string, unknown>;
}> {
  const root = await tempRoot();
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, "kiwi", "waves.jsonl"), `${lines.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  const pipes = io();
  const exit = await main(["--root", root, "orchestrate", "validate", "--run-id", "run-a", ...argv, "--json"], pipes);
  const text = drain(pipes.stdout);
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function codes(payload: Record<string, unknown>, key: "violations" | "diagnostics"): string[] {
  const rows = (payload[key] ?? []) as Array<{ code: string }>;
  return rows.map((row) => row.code);
}

describe("IR-CLI-083 AC-1 / AC-2 — the writer stamp is required at 1.4.0 and above", () => {
  it("fails a run whose 1.4.0 line carries no writer, naming the offending line", async () => {
    const result = await validateRun([line({ schemaVersion: "1.4.0" })]);

    expect(result.exit).not.toBe(0);
    expect(codes(result.payload, "violations")).toContain("unstamped-writer");
    const offending = (result.payload.violations as Array<{ code: string; line: number | null }>)
      .find((row) => row.code === "unstamped-writer");
    expect(offending?.line, "the diagnostic must name the journal line").toBe(1);
  });

  it("passes a run whose 1.4.0 lines all carry a writer stamp", async () => {
    const result = await validateRun([
      line({ schemaVersion: "1.4.0", writer: "speckiwi-orchestrate/2.6.0" }),
      line({ schemaVersion: "1.4.0", writer: "speckiwi-orchestrate/2.6.0" })
    ]);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(codes(result.payload, "diagnostics")).not.toContain("unstamped-writer");
  });
});

describe("IR-CLI-083 AC-3 — the downgrade guard is ordered within a run", () => {
  it("reports a 1.3.0 line that follows a 1.4.0 line of the same run", async () => {
    const result = await validateRun([
      line({ schemaVersion: "1.4.0", writer: "speckiwi-orchestrate/2.6.0" }),
      line({ schemaVersion: "1.3.0" })
    ]);

    expect(result.exit).not.toBe(0);
    expect(codes(result.payload, "violations")).toContain("journal-version-downgrade");
  });

  it("reports nothing for the same 1.3.0 line placed before every 1.4.0 line of that run", async () => {
    const result = await validateRun([
      line({ schemaVersion: "1.3.0" }),
      line({ schemaVersion: "1.4.0", writer: "speckiwi-orchestrate/2.6.0" })
    ]);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(codes(result.payload, "diagnostics")).not.toContain("journal-version-downgrade");
  });
});

describe("IR-CLI-083 AC-4 — a pre-1.4.0 run reports unstamped and passes", () => {
  it("exits 0 under --strict and names the lines unstamped", async () => {
    const result = await validateRun([line({ schemaVersion: "1.2.0" }), line({ schemaVersion: "1.3.0" })]);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    const unstamped = result.payload.unstamped as Array<{ line: number | null; state: string }>;
    expect(unstamped).toHaveLength(2);
    expect(unstamped.every((row) => row.state === "unstamped")).toBe(true);
    expect(codes(result.payload, "diagnostics")).not.toContain("unstamped-writer");
  });
});

describe("IR-CLI-083 AC-5 — the downgrade rule is run-scoped, not file-scoped", () => {
  it("does not report a lower-version line belonging to a different run", async () => {
    const result = await validateRun([
      line({ schemaVersion: "1.4.0", writer: "speckiwi-orchestrate/2.6.0" }),
      line({ schemaVersion: "1.3.0", runId: "run-b" })
    ]);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(codes(result.payload, "diagnostics")).not.toContain("journal-version-downgrade");
  });
});
