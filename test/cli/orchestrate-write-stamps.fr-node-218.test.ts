import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { WAVES_EVENT_REQUIRED_BY_SCOPE } from "../../src/core/orchestrator/journal-schema.js";
import { computeInvariantDigest, resumeCardPath, stampCard, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";
import { minimalCard } from "../core/orchestrator/resume-fixtures.js";

// FR-NODE-218 — the write verbs compute the stamps they record: `card write` its invariant digest and
// `written_at`, `journal append` its `ts`; and `journal append` refuses a line missing a field its
// event scope requires.

const RUN = "run-a";
const JOURNAL = "kiwi/waves.jsonl";
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function orchestrate(root: string, argv: readonly string[]): Promise<Run> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-218-"));
}

async function put(root: string, relativePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await writeFile(path.join(root, relativePath), text, "utf8");
}

function cardWithout(...keys: Array<keyof ResumeCard>): Record<string, unknown> {
  const card: Record<string, unknown> = { ...minimalCard() };
  for (const key of keys) delete card[key];
  return card;
}

async function writtenCard(root: string): Promise<ResumeCard> {
  return JSON.parse(await readFile(path.join(root, resumeCardPath(RUN)), "utf8")) as ResumeCard;
}

describe("FR-NODE-218 AC-1 card write computes invariant_digest", () => {
  it("FR-NODE-218 AC-1 computes and writes the digest when the payload carries none", async () => {
    const root = await tempRoot();
    const run = await orchestrate(root, ["card", "write", "--run-id", RUN, "--payload", JSON.stringify(cardWithout("invariant_digest"))]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const card = await writtenCard(root);
    expect(card.invariant_digest).toBe(computeInvariantDigest(card.frozen));
  });

  it("FR-NODE-218 AC-1 still refuses a supplied digest that differs, and accepts an equal one", async () => {
    const root = await tempRoot();
    const wrong = await orchestrate(root, ["card", "write", "--run-id", RUN, "--payload", JSON.stringify({ ...minimalCard(), invariant_digest: "sha256:0" })]);
    expect(wrong.exit).toBe(2);
    expect(wrong.payload.violations).toContain("invariant-digest-mismatch");
    expect(existsSync(path.join(root, resumeCardPath(RUN)))).toBe(false);
    const equal = await orchestrate(root, ["card", "write", "--run-id", RUN, "--payload", JSON.stringify(minimalCard())]);
    expect(equal.exit, JSON.stringify(equal.payload)).toBe(0);
  });

  it("FR-NODE-218 AC-1 stampCard fills only an absent digest", () => {
    const absent = stampCard(cardWithout("invariant_digest") as unknown as ResumeCard, "2026-10-20T00:00:00.000Z");
    expect(absent.invariant_digest).toBe(computeInvariantDigest(absent.frozen));
    expect(stampCard({ ...minimalCard(), invariant_digest: "sha256:0" }, "2026-10-20T00:00:00.000Z").invariant_digest).toBe("sha256:0");
  });
});

describe("FR-NODE-218 AC-2 card write stamps written_at from its own clock", () => {
  it("FR-NODE-218 AC-2 replaces a payload written_at and returns the value it wrote", async () => {
    const root = await tempRoot();
    const before = Date.now();
    const run = await orchestrate(root, ["card", "write", "--run-id", RUN, "--payload", JSON.stringify({ ...minimalCard(), written_at: "1999-01-01T00:00:00.000Z" })]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const card = await writtenCard(root);
    expect(card.written_at).toMatch(ISO_UTC);
    expect(card.written_at).not.toBe("1999-01-01T00:00:00.000Z");
    expect(Date.parse(card.written_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(run.payload.writtenAt).toBe(card.written_at);
  });

  it("FR-NODE-218 AC-2 writes written_at when the payload carries none", async () => {
    const root = await tempRoot();
    const run = await orchestrate(root, ["card", "write", "--run-id", RUN, "--payload", JSON.stringify(cardWithout("written_at", "invariant_digest"))]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((await writtenCard(root)).written_at).toMatch(ISO_UTC);
  });
});

const INTENT = { event: "intent", schema_version: "2.0.0", run_id: RUN, engine: "kiwi-orchestrator", verb: "author-design", inputs_digest: "sha256:in", wave: "all" };
const RESULT = { event: "result", schema_version: "2.0.0", run_id: RUN, engine: "kiwi-orchestrator", verb: "author-design", wave: "all", proof: { kind: "digest", ref: "sha256:out" } };
const WAVE_STATE = { schema_version: "2.0.0", run_id: RUN, engine: "kiwi-orchestrator", wave: "wave-1", order: 1, target: "4.1.0", status: "in_progress", summary: "started" };

async function append(root: string, line: Record<string, unknown>): Promise<Run> {
  return orchestrate(root, ["journal", "append", "--run-id", RUN, "--payload", JSON.stringify(line)]);
}

async function journalLines(root: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(path.join(root, JOURNAL), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("FR-NODE-218 AC-3 journal append fills ts", () => {
  it("FR-NODE-218 AC-3 fills a missing ts with its own ISO-8601 UTC time", async () => {
    const root = await tempRoot();
    const run = await append(root, INTENT);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((await journalLines(root))[0]?.ts).toMatch(ISO_UTC);
  });

  it("FR-NODE-218 AC-3 keeps a supplied ts", async () => {
    const root = await tempRoot();
    expect((await append(root, { ...INTENT, ts: "2026-10-20T01:02:03.000Z" })).exit).toBe(0);
    expect((await journalLines(root))[0]?.ts).toBe("2026-10-20T01:02:03.000Z");
  });
});

describe("FR-NODE-218 AC-4 journal append takes the line from a file", () => {
  it("FR-NODE-218 AC-4 accepts --payload-file as an alternative to --payload", async () => {
    const root = await tempRoot();
    await put(root, "line.json", JSON.stringify(INTENT));
    const run = await orchestrate(root, ["journal", "append", "--run-id", RUN, "--payload-file", "line.json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((await journalLines(root))[0]).toMatchObject(INTENT);
  });

  it("FR-NODE-218 AC-4 exits 1 when both or neither are given", async () => {
    const root = await tempRoot();
    await put(root, "line.json", JSON.stringify(INTENT));
    const both = await orchestrate(root, ["journal", "append", "--run-id", RUN, "--payload-file", "line.json", "--payload", JSON.stringify(INTENT)]);
    expect(both.exit).toBe(1);
    const neither = await orchestrate(root, ["journal", "append", "--run-id", RUN]);
    expect(neither.exit).toBe(1);
    expect(existsSync(path.join(root, JOURNAL))).toBe(false);
  });
});

describe("FR-NODE-218 AC-5 journal append refuses a line missing a field its scope requires", () => {
  it("FR-NODE-218 AC-5 declares exactly the three per-scope sets", () => {
    expect(WAVES_EVENT_REQUIRED_BY_SCOPE).toEqual({
      intent: ["event", "schema_version", "run_id", "engine", "verb", "inputs_digest"],
      result: ["event", "schema_version", "run_id", "engine", "verb", "proof"],
      "wave-state": ["schema_version", "run_id", "wave", "order", "target", "status", "summary"]
    });
    for (const fields of Object.values(WAVES_EVENT_REQUIRED_BY_SCOPE)) expect(fields).not.toContain("ts");
  });

  for (const [scope, complete] of [
    ["intent", INTENT],
    ["result", RESULT],
    ["wave-state", WAVE_STATE]
  ] as const) {
    it(`FR-NODE-218 AC-5 refuses a ${scope} line missing a required field before writing any byte, naming the fields`, async () => {
      const root = await tempRoot();
      await put(root, JOURNAL, "");
      for (const field of WAVES_EVENT_REQUIRED_BY_SCOPE[scope]) {
        if (field === "event") continue;
        const line: Record<string, unknown> = { ...complete };
        delete line[field];
        const run = await append(root, line);
        expect(run.exit, `${scope} without ${field}`).toBe(2);
        expect(JSON.stringify(run.payload.violations), `${scope} without ${field}`).toContain(field);
        expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe("");
      }
    });

    it(`FR-NODE-218 AC-5 accepts a complete ${scope} line`, async () => {
      const root = await tempRoot();
      const run = await append(root, complete);
      expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    });
  }

  it("FR-NODE-218 AC-5 treats a null field as missing", async () => {
    const root = await tempRoot();
    await put(root, JOURNAL, "");
    const run = await append(root, { ...WAVE_STATE, summary: null });
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(JSON.stringify(run.payload.violations)).toContain("summary");
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe("");
  });

  it("FR-NODE-218 AC-5 names the scope in a grammatical message", async () => {
    const root = await tempRoot();
    const { inputs_digest: _omitted, ...line } = INTENT;
    const run = await append(root, line);
    expect(JSON.stringify(run.payload.violations)).toContain("an intent line needs inputs_digest");
  });

  it("FR-NODE-218 AC-5 does not check a round record or a run-abort line, which their own verbs stamp", async () => {
    const root = await tempRoot();
    const abort = { schema_version: "2.0.0", run_id: RUN, engine: "kiwi-orchestrator", verb: "abort-run", event: "result", wave: "all", abort_gate: "run-invariant-drift" };
    const abortRun = await append(root, abort);
    expect(JSON.stringify(abortRun.payload)).not.toContain("journal-required-field-missing");
  });
});
