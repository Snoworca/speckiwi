import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// FR-NODE-254 — CLI round record: a verifier list that names no verifier
// ---------------------------------------------------------------------------------------------

const PROOF = { kind: "digest", ref: "sha256:0123456789abcdef" };

function roundPayload(overrides: Json = {}): Json {
  return {
    loop: "P",
    scope: "wave-1-post",
    roundIndex: 1,
    mode: "normal",
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 1,
    verifiers: ["verifier-1"],
    rows: [{ id: "R-1", verdict: "pass", kept: false, verifier: "verifier-1" }],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: [],
    ...overrides
  };
}

async function recordRound(body: Json): Promise<{ exit: number; journal: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-r5b-"));
  try {
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi/waves.jsonl"), "", "utf8");
    const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
    const exit = await main(
      ["--root", root, "orchestrate", "round", "record", "--run-id", "run-a", "--payload", JSON.stringify(body), "--proof", JSON.stringify(PROOF), "--json"],
      pipes
    );
    const journal = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");
    return { exit, journal };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("FR-NODE-254 — verify r5.b", () => {
  // @req FR-NODE-254 AC-1
  it("FR-NODE-254 AC-1: round record refuses a round whose only verifier name is the empty string, as a round without verifiers", async () => {
    const result = await recordRound(roundPayload({ verifiers: [""], rows: [{ id: "R-1", verdict: "pass", kept: false, verifier: "" }] }));
    expect(result).toEqual({ exit: 1, journal: "" });
  });

  // @req FR-NODE-254 AC-1
  it("FR-NODE-254 AC-1: round record refuses a round whose only verifier name is blank, as a round without verifiers", async () => {
    const result = await recordRound(roundPayload({ verifiers: [" "], rows: [{ id: "R-1", verdict: "pass", kept: false, verifier: " " }] }));
    expect(result).toEqual({ exit: 1, journal: "" });
  });
});
