import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { buildCommand } from "../../src/cli/command.js";
import { registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";
import { workflowDoctor } from "../../src/core/workflow/read.js";
import { minimalCard, emptyDriftInputs, emptyGitFacts } from "../core/orchestrator/resume-fixtures.js";

// @req FR-NODE-127 — validation runs on every `journal append` and every `resume`, unconditionally.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = io();
  const exit = await main([...argv, "--json"], pipes);
  const text = drain(pipes.stdout);
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-journal-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

const JOURNAL = "kiwi/waves.jsonl";

/** A `complete` with no passing wave-verify record: `waves-event.md:135`'s completion gate. */
const INVALIDATING_LINE = {
  schema_version: "1.4.0",
  run_id: "run-a",
  engine: "kiwi-orchestrator",
  verb: "emit-and-finish",
  kind: "result",
  wave: "wave-1",
  status: "complete"
};

const VALID_LINE = {
  schema_version: "1.4.0",
  run_id: "run-a",
  engine: "kiwi-orchestrator",
  verb: "author-design",
  kind: "intent",
  wave: "wave-1"
};

function leaf(...segments: string[]): Command {
  const pipes = io();
  const command = buildCommand({ io: pipes });
  registerOrchestrateCommands(command, { io: pipes });
  let cursor = command.commands.find((sub) => sub.name() === "orchestrate") as Command;
  for (const segment of segments) {
    const next = cursor.commands.find((sub) => sub.name() === segment);
    expect(next, `orchestrate ${segments.join(" ")} must be registered`).toBeDefined();
    cursor = next as Command;
  }
  return cursor;
}

describe("FR-NODE-127 AC-1 — an invalidating append is refused and nothing is written", () => {
  it("reports the diagnostic and leaves the journal byte-identical", async () => {
    const root = await tempRoot();
    await write(root, JOURNAL, `${JSON.stringify(VALID_LINE)}\n`);
    const before = await readFile(path.join(root, JOURNAL), "utf8");

    const refused = await run(["--root", root, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", JSON.stringify(INVALIDATING_LINE)]);

    expect(refused.exit).toBe(2);
    expect(refused.payload.applied).toBe(false);
    const violations = refused.payload.violations as Array<{ code: string }>;
    expect(violations.map((entry) => entry.code)).toContain("complete-without-latest-pass");
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(before);
  });
});

describe("FR-NODE-127 AC-2 — a valid append is written and the validation ran", () => {
  it("writes the line and reports an empty diagnostic set rather than skipping the check", async () => {
    const root = await tempRoot();
    await write(root, JOURNAL, "");

    const accepted = await run(["--root", root, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", JSON.stringify(VALID_LINE)]);

    expect(accepted.exit, JSON.stringify(accepted.payload)).toBe(0);
    expect(accepted.payload.applied).toBe(true);
    expect(accepted.payload.written).toBe(true);
    // The check ran: the field is present and empty. A skipped check would omit it entirely.
    expect(accepted.payload).toHaveProperty("diagnostics");
    expect(accepted.payload.diagnostics).toEqual([]);

    const text = await readFile(path.join(root, JOURNAL), "utf8");
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(text.trim()).writer).toMatch(/^speckiwi-orchestrate\//);
  });
});

describe("FR-NODE-127 AC-3 — resume over an invalid journal refuses and computes no resume state", () => {
  it("returns the refusal without a resume payload", async () => {
    const root = await tempRoot();
    await write(root, JOURNAL, `${JSON.stringify({ ...INVALIDATING_LINE, writer: "bash" })}\n`);
    await write(root, "card.json", JSON.stringify(minimalCard()));
    await write(root, "facts.json", JSON.stringify({ gitFacts: emptyGitFacts(), driftInputs: emptyDriftInputs() }));

    const refused = await run(["--root", root, "orchestrate", "resume", "--run-id", "run-a", "--card", "card.json", "--facts", "facts.json"]);

    expect(refused.exit).toBe(2);
    expect(refused.payload).not.toHaveProperty("resume");
    expect(refused.payload.ok).toBe(false);
  });
});

describe("FR-NODE-127 AC-4 — no invocation form skips validation", () => {
  it("registers no flag, option or mode on `journal append` or `resume` that disables the check", () => {
    const skipVocabulary = /(skip|no-validate|novalidate|force|unsafe|unchecked|ignore|bypass)/i;

    const appendOptions = leaf("journal", "append").options.map((option) => option.long ?? "");
    const resumeOptions = leaf("resume").options.map((option) => option.long ?? "");

    expect(appendOptions.filter((flag) => skipVocabulary.test(flag))).toEqual([]);
    expect(resumeOptions.filter((flag) => skipVocabulary.test(flag))).toEqual([]);

    // The whole declared option set, so a later addition is a conscious change rather than a silent
    // one. Both leaves carry exactly these and nothing else.
    expect([...appendOptions].sort()).toEqual(["--dry-run", "--journal", "--json", "--payload", "--run-id"]);
    expect([...resumeOptions].sort()).toEqual(["--card", "--facts", "--journal", "--json", "--run-id"]);
  });
});

describe("FR-NODE-127 AC-5 — the doctor keeps the check, the pre-commit hook never hosts it", () => {
  it("reports the same journal diagnostics on demand for a historical journal", async () => {
    const root = await tempRoot();
    await write(root, JOURNAL, `${JSON.stringify({ ...INVALIDATING_LINE, writer: "bash" })}\n`);

    const doctor = await workflowDoctor({ root }, { runId: "run-a" });

    expect(doctor.diagnostics.map((item) => item.code)).toContain("complete-without-latest-pass");
  });

  it("leaves the doctor untouched when no run is named", async () => {
    const root = await tempRoot();
    await write(root, JOURNAL, `${JSON.stringify({ ...INVALIDATING_LINE, writer: "bash" })}\n`);

    const doctor = await workflowDoctor({ root });

    expect(doctor.diagnostics.map((item) => item.code)).not.toContain("complete-without-latest-pass");
  });

  it("invokes validateWavesJournal from no pre-commit hook code path", async () => {
    for (const source of ["src/core/bootstrap/init-project.ts", "src/core/bootstrap/upgrade-project.ts"]) {
      const text = await readFile(source, "utf8");
      expect(text, `${source} installs the hook and must not host the journal check`).not.toContain("validateWavesJournal");
    }
  });
});
