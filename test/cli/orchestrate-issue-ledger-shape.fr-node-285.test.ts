import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-NODE-285 — the issue ledger checks a row's shape when it is opened, and `wave close`
// fails closed on a wave value it cannot read and on a missing ledger.
//
// SB15 (5.3.7): a row opened with `wave: "wave-1"` was never judged by `wave close --wave 1`,
// `--wave wave-1` judged nothing, and a missing `--ledger` was read as an empty ledger; all three
// answered ok while a local-defect issue with no proof stayed open.

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function run(argv: string[]): Promise<Run> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exit = await main([...argv, "--json"], { stdout, stderr });
  const text = stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-285-"));
  await writeFile(path.join(root, "resolution.json"), JSON.stringify({ existingPaths: [], lineCounts: {}, testIds: [], commitShas: [] }), "utf8");
  return root;
}

async function writeLedger(root: string, rows: unknown[]): Promise<void> {
  await mkdir(path.join(root, "kiwi", "orchestrator"), { recursive: true });
  await writeFile(path.join(root, "kiwi", "orchestrator", "issues.json"), JSON.stringify(rows), "utf8");
}

async function readLedger(root: string): Promise<Array<Record<string, unknown>>> {
  return JSON.parse(await readFile(path.join(root, "kiwi", "orchestrator", "issues.json"), "utf8")) as Array<Record<string, unknown>>;
}

function open(root: string, payload: Record<string, unknown>): Promise<Run> {
  return run(["--root", root, "orchestrate", "issue", "open", "--payload", JSON.stringify(payload)]);
}

function close(root: string, wave: string): Promise<Run> {
  return run(["--root", root, "orchestrate", "wave", "close", "--wave", wave, "--resolution", "resolution.json"]);
}

const LOCAL_DEFECT = { issueId: "I-1", wave: 1, class: "local-defect", source: "verify" };

describe("FR-NODE-285 AC-1 — issue open refuses a row whose shape is wrong and writes nothing", () => {
  it.each([
    [{ ...LOCAL_DEFECT, issueId: undefined, issue_id: "I-1" }, "issueId"],
    [{ ...LOCAL_DEFECT, issueId: "" }, "issueId"],
    [{ ...LOCAL_DEFECT, issueId: 7 }, "issueId"],
    [{ ...LOCAL_DEFECT, wave: "wave-0" }, "wave"],
    [{ ...LOCAL_DEFECT, wave: "intake" }, "wave"],
    [{ ...LOCAL_DEFECT, wave: 0 }, "wave"],
    [{ ...LOCAL_DEFECT, wave: 1.5 }, "wave"],
    [{ ...LOCAL_DEFECT, wave: "1" }, "wave"],
    [{ ...LOCAL_DEFECT, wave: undefined }, "wave"],
    [{ ...LOCAL_DEFECT, resolutionRef: 42 }, "resolutionRef"],
    [{ ...LOCAL_DEFECT, source: ["verify"] }, "source"],
    [{ ...LOCAL_DEFECT, class: { name: "local-defect" } }, "class"]
  ])("refuses %j naming %s", async (payload, field) => {
    const root = await tempRoot();
    const answer = await open(root, payload as Record<string, unknown>);
    expect(answer.exit).toBe(1);
    expect(answer.payload.ok).toBe(false);
    expect(String(answer.payload.error)).toContain(field);
    await expect(readFile(path.join(root, "kiwi", "orchestrator", "issues.json"), "utf8")).rejects.toThrow();
  });

  it("names every wrong field of one row", async () => {
    const root = await tempRoot();
    const answer = await open(root, { issueId: "", wave: "intake", source: 3 });
    expect(answer.exit).toBe(1);
    for (const field of ["issueId", "wave", "source"]) expect(String(answer.payload.error)).toContain(field);
  });
});

describe("FR-NODE-285 AC-2 — issue open stores wave-<n> as n and an omitted field as null", () => {
  it("normalises the wave and fills the optional fields", async () => {
    const root = await tempRoot();
    expect((await open(root, { issueId: "I-1", wave: "wave-12", class: "local-defect" })).exit).toBe(0);
    expect(await readLedger(root)).toEqual([
      {
        issueId: "I-1",
        wave: 12,
        class: "local-defect",
        source: null,
        resolutionKind: null,
        resolutionRef: null,
        userDecisionRef: null,
        designLockDigest: null,
        deferralReason: null
      }
    ]);
  });
});

describe("FR-NODE-285 AC-3 — wave close reads 1 and wave-1 alike, also for a row stored as \"wave-1\"", () => {
  it.each(["1", "wave-1"])("refuses an open local defect of wave 1 under --wave %s", async (wave) => {
    const root = await tempRoot();
    expect((await open(root, { issueId: "I-1", wave: "wave-1", class: "local-defect" })).exit).toBe(0);
    const answer = await close(root, wave);
    expect(answer.exit).toBe(2);
    expect(answer.payload.gate).toBe("wave-issues-open");
    expect(answer.payload.violations).toEqual([expect.objectContaining({ code: "P-WAVE-ISSUES-CLOSED", issueId: "I-1" })]);
  });

  it.each(["1", "wave-1"])("judges a row an earlier version stored with wave \"wave-1\" under --wave %s", async (wave) => {
    const root = await tempRoot();
    await writeLedger(root, [{ ...LOCAL_DEFECT, wave: "wave-1", resolutionKind: null, resolutionRef: null, userDecisionRef: null, designLockDigest: null, deferralReason: null }]);
    const answer = await close(root, wave);
    expect(answer.exit).toBe(2);
    expect(answer.payload.violations).toEqual([expect.objectContaining({ code: "P-WAVE-ISSUES-CLOSED", issueId: "I-1" })]);
  });

  it("still closes a wave whose rows are all discharged, and reports the wave as a number", async () => {
    const root = await tempRoot();
    await writeLedger(root, [{ ...LOCAL_DEFECT, wave: 2 }]);
    const answer = await close(root, "wave-1");
    expect(answer).toMatchObject({ exit: 0, payload: { ok: true, wave: 1 } });
  });
});

describe("FR-NODE-285 AC-4 — wave close refuses a --wave it cannot read", () => {
  it.each(["wave-0", "0", "intake", "1x", "wave-01", ""])("fails on --wave %j", async (wave) => {
    const root = await tempRoot();
    await writeLedger(root, []);
    const answer = await close(root, wave);
    expect(answer.exit).toBe(1);
    expect(answer.payload.ok).toBe(false);
    expect(String(answer.payload.error)).toContain("--wave");
  });
});

describe("FR-NODE-285 AC-5 — a ledger row whose wave reads as no positive integer refuses every close", () => {
  it.each([["wave-0"], ["intake"], [null], [0]])("refuses wave close when a row holds wave %j", async (bad) => {
    const root = await tempRoot();
    await writeLedger(root, [{ ...LOCAL_DEFECT, issueId: "I-9", wave: bad, resolutionKind: "path", resolutionRef: "x" }]);
    const answer = await close(root, "3");
    expect(answer.exit).toBe(2);
    expect(answer.payload.violations).toEqual([expect.objectContaining({ code: "P-WAVE-ISSUES-CLOSED", issueId: "I-9" })]);
  });
});

describe("FR-NODE-285 AC-6 — wave close fails on a ledger file that does not exist", () => {
  it("names the missing path instead of judging an empty ledger", async () => {
    const root = await tempRoot();
    const answer = await run(["--root", root, "orchestrate", "wave", "close", "--wave", "1", "--ledger", "nope.json", "--resolution", "resolution.json"]);
    expect(answer.exit).toBe(1);
    expect(answer.payload.ok).toBe(false);
    expect(String(answer.payload.error)).toContain("nope.json");
  });

  it("still lets issue open create the ledger it finds missing", async () => {
    const root = await tempRoot();
    expect((await open(root, LOCAL_DEFECT)).exit).toBe(0);
    expect(await readLedger(root)).toHaveLength(1);
  });
});
