import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "../core/orchestrator/resume-fixtures.js";
import { pinResumeRunRoot } from "./support/resume-run-root.js";

// FR-NODE-107 AC-2 — below 2.0.0 the reader accepts `demoted` and `coupling-reset` (the four-value enum
// that line was written under), but `orchestrate resume` refuses such a run as written before 4.0.0
// (FR-NODE-213 AC-6); the same run with a live kind resumes.

const V15 = { schema_version: "1.5.0", run_id: "run-a", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/3.0.1" } as const;

const VERIFY = { ...V15, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } };

function disposed(kind: string): Record<string, unknown> {
  return { ...V15, wave: "wave-1", stage: 1, lane: "lane-1", verb: "collect-lane", event: "result", status: "complete", lane_disposition: { kind, reason: "left the run" } };
}

async function resume(journal: Array<Record<string, unknown>>): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-107-ac2-"));
  const put = async (relative: string, text: string) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text, "utf8");
  };
  await put("kiwi/waves.jsonl", `${journal.map((line) => JSON.stringify(line)).join("\n")}\n`);
  await put("card.json", JSON.stringify(await pinResumeRunRoot(minimalCard(), root)));
  await put("facts.json", JSON.stringify({ gitFacts: emptyGitFacts(), driftInputs: emptyDriftInputs() }));
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", "resume", "--run-id", "run-a", "--card", "card.json", "--facts", "facts.json", "--json"], pipes);
  return { exit, payload: JSON.parse(pipes.stdout.read()?.toString() ?? "{}") as Record<string, unknown> };
}

describe("FR-NODE-107 AC-2 — resume refuses a run whose pre-2.0.0 line carries a retired disposition kind", { timeout: 60_000 }, () => {
  it("FR-NODE-107 AC-2: orchestrate resume refuses a 1.5.0 demoted or coupling-reset run as run-predates-4.0.0, and resumes the same run disposed quarantined", async () => {
    for (const kind of ["demoted", "coupling-reset"]) {
      const refused = await resume([VERIFY, disposed(kind)]);
      expect(refused.exit, `${kind}: ${JSON.stringify(refused.payload)}`).toBe(2);
      expect(refused.payload.gate, kind).toBe("resume-card-missing-or-invalid");
      const predates = (refused.payload.violations as Array<{ code?: string; markers?: string[] }>).find((entry) => entry.code === "run-predates-4.0.0");
      expect(predates, kind).toBeDefined();
      expect((predates?.markers ?? []).join("\n"), kind).toContain(kind);
      expect(refused.payload, kind).not.toHaveProperty("resume");
    }

    const resumed = await resume([VERIFY, disposed("quarantined")]);
    expect(resumed.exit, JSON.stringify(resumed.payload)).toBe(0);
  });
});
