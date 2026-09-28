import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// FR-NODE-127 AC-5 — `orchestrate validate` reports, on demand and for a journal already on disk, the
// diagnostics `journal append` reports for the same line; and the pre-commit hook `speckiwi init`
// installs is no host for the check — neither the hook script nor the runner it delegates to runs it.

interface Diagnostic {
  code: string;
  message: string;
  severity: string;
}

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

const JOURNAL = "kiwi/waves.jsonl";
const WRITER = "speckiwi-orchestrate/test";

const PRIOR = { schema_version: "2.0.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "author-design", event: "intent", wave: "wave-1", writer: WRITER };

/** Two independent errors on one line: a retired verb at 2.0.0 and a `complete` with no passing verify. */
const INVALID = { schema_version: "2.0.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "execute-unit", event: "result", wave: "wave-1", status: "complete", writer: WRITER };

/** A line that passes with a warning only: `complete-without-verification` rides on a passing verify. */
const VERIFY = { schema_version: "2.0.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "author-design", event: "result", wave: "wave-1", phase: "wave-verify", status: "in_progress", verification: { verdict: "pass" }, writer: WRITER };
const WARNED = { schema_version: "2.0.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "emit-and-finish", event: "result", wave: "wave-1", status: "complete", writer: WRITER };

const shape = (entries: unknown): Diagnostic[] =>
  (entries as Diagnostic[]).map(({ code, message, severity }) => ({ code, message, severity })).sort((a, b) => a.code.localeCompare(b.code));

function runNode(script: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CODEX_PROJECT_DIR: cwd }, timeout: 15_000 }, (error, stdout, stderr) => {
      if (error && typeof (error as { code?: unknown }).code !== "number") return reject(error);
      resolve({ exitCode: error ? (error as { code: number }).code : 0, output: `${String(stdout)}${String(stderr)}` });
    });
  });
}

describe("FR-NODE-127 AC-5 — validate answers what append answers; the installed hook hosts no journal check", { timeout: 60_000 }, () => {
  it("FR-NODE-127 AC-5: orchestrate validate reports, for a historical journal, the error diagnostics journal append reports for the same line", async () => {
    const appendRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-127-ac5-append-"));
    await write(appendRoot, JOURNAL, `${JSON.stringify(PRIOR)}\n`);
    const appended = await run(["--root", appendRoot, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", JSON.stringify(INVALID)]);
    expect(appended.exit).toBe(2);
    const appendErrors = shape(appended.payload.violations).filter((entry) => entry.severity === "error");
    expect(appendErrors.map((entry) => entry.code), "the probe carries two independent errors").toEqual(["complete-without-latest-pass", "vocabulary-retired-in-4-0-0"]);

    // The same line, already in the file — written before the gate existed, or around it.
    const historicalRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-127-ac5-history-"));
    await write(historicalRoot, JOURNAL, `${JSON.stringify(PRIOR)}\n${JSON.stringify(INVALID)}\n`);
    const validated = await run(["--root", historicalRoot, "orchestrate", "validate", "--run-id", "run-a"]);
    expect(validated.exit).toBe(2);
    expect(shape(validated.payload.violations)).toEqual(appendErrors);
  });

  it("FR-NODE-127 AC-5: for a journal append accepts with a warning, orchestrate validate reports the same diagnostic set", async () => {
    const appendRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-127-ac5-warn-append-"));
    await write(appendRoot, JOURNAL, `${JSON.stringify(PRIOR)}\n${JSON.stringify(VERIFY)}\n`);
    const appended = await run(["--root", appendRoot, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", JSON.stringify(WARNED)]);
    expect(appended.exit, JSON.stringify(appended.payload)).toBe(0);
    const appendDiagnostics = shape(appended.payload.diagnostics);
    expect(appendDiagnostics.length, "the probe must raise something to compare").toBeGreaterThan(0);

    const historicalRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-127-ac5-warn-history-"));
    await write(historicalRoot, JOURNAL, `${JSON.stringify(PRIOR)}\n${JSON.stringify(VERIFY)}\n${JSON.stringify(WARNED)}\n`);
    const validated = await run(["--root", historicalRoot, "orchestrate", "validate", "--run-id", "run-a"]);
    expect(validated.exit).toBe(0);
    expect(shape(validated.payload.diagnostics)).toEqual(appendDiagnostics);
  });

  it("FR-NODE-127 AC-5: the pre-commit hook speckiwi init installs neither names nor runs the journal validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-127-ac5-hook-"));
    await mkdir(path.join(root, ".git"));
    const init = await run(["--root", root, "init"]);
    expect(init.exit, JSON.stringify(init.payload)).toBe(0);

    const hook = await readFile(path.join(root, ".git", "hooks", "pre-commit"), "utf8");
    const runnerLine = hook.split("\n").find((line) => line.startsWith("node "));
    expect(runnerLine, "the installed hook delegates to one node runner").toBeDefined();
    const runnerPath = /docs\/\.kiwi\/hooks\/[\w.-]+\.mjs/.exec(runnerLine ?? "")?.[0];
    expect(runnerPath).toBe("docs/.kiwi/hooks/pre-commit.mjs");
    const runner = await readFile(path.join(root, ...(runnerPath as string).split("/")), "utf8");

    for (const [name, text] of [["hook", hook], ["runner", runner]] as const) {
      expect(text, `${name} must not call the validator`).not.toMatch(/validateWavesJournal|waves\.jsonl|orchestrate\s+validate|journal/i);
      const imports = [...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      expect(imports.filter((spec) => !spec?.startsWith("node:")), `${name} imports only node builtins`).toEqual([]);
    }

    // Behaviourally too: an invalid run journal in the tree does not make the installed runner refuse
    // or report a journal diagnostic.
    await write(root, JOURNAL, `${JSON.stringify(INVALID)}\n`);
    const hooked = await runNode(path.join(root, "docs", ".kiwi", "hooks", "pre-commit.mjs"), root);
    expect(hooked.exitCode).toBe(0);
    expect(hooked.output).not.toMatch(/complete-without-latest-pass|vocabulary-retired|run-invariant-drift/);
  }, 60_000);
});
