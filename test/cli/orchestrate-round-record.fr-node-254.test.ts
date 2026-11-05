import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { waveVerify } from "../core/orchestrator/waves-fixtures.js";

// @req FR-NODE-254 — `orchestrate round record` takes keep/drop rows under a declared verifier list
// and writes `verification.findings` and `red_tests[]`; `orchestrate validate` still reads `axis_b`.

const PROOF = { kind: "digest", ref: "sha256:0123456789abcdef" };

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    loop: "P",
    scope: "wave-1-post",
    roundIndex: 1,
    mode: "normal",
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 3,
    verifiers: ["verifier-1"],
    rows: [
      { id: "R-1", verdict: "mismatch", kept: true, evidence: "test/x.test.ts > red", verifier: "verifier-1" },
      { id: "R-2", verdict: "mismatch", kept: false, verifier: "verifier-1" },
      { id: "R-3", verdict: "pass", kept: false, verifier: "verifier-1" }
    ],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: [],
    ...overrides
  };
}

async function tempRoot(seed = ""): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-round-keep-drop-"));
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, "kiwi/waves.jsonl"), seed, "utf8");
  return root;
}

async function run(root: string, argv: string[]): Promise<{ exit: number; out: Record<string, unknown> }> {
  const pipes = io();
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = drain(pipes.stdout);
  return { exit, out: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function record(root: string, body: Record<string, unknown>) {
  return run(root, ["round", "record", "--run-id", "run-a", "--payload", JSON.stringify(body), "--proof", JSON.stringify(PROOF)]);
}

async function journal(root: string): Promise<string> {
  return readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");
}

function rows(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return body.rows as Array<Record<string, unknown>>;
}

describe("FR-NODE-254 AC-1 — round record refuses a payload outside the keep/drop shape", () => {
  const withoutVerifiers = payload();
  delete withoutVerifiers.verifiers;

  const refusals: Array<{ label: string; body: Record<string, unknown>; names: string }> = [
    {
      label: "a row carrying severity",
      body: payload({ rows: [{ ...rows(payload())[0], severity: "HIGH" }, ...rows(payload()).slice(1)] }),
      names: "severity"
    },
    {
      label: "a kept row without evidence",
      body: payload({ rows: [{ id: "R-1", verdict: "mismatch", kept: true, verifier: "verifier-1" }, ...rows(payload()).slice(1)] }),
      names: "evidence"
    },
    {
      label: "a row without verifier",
      body: payload({ rows: [{ id: "R-1", verdict: "mismatch", kept: false }, ...rows(payload()).slice(1)] }),
      names: "verifier"
    },
    {
      label: "a row whose verifier is not in verifiers",
      body: payload({ rows: [{ id: "R-1", verdict: "mismatch", kept: false, verifier: "stranger" }, ...rows(payload()).slice(1)] }),
      names: "stranger"
    },
    { label: "a round without verifiers", body: withoutVerifiers, names: "verifiers" },
    // An empty list names no verifier, so it is a round without verifiers too.
    { label: "a round whose verifiers list is empty", body: payload({ verifiers: [], rows: [], frozenDenominator: 0 }), names: "verifiers" }
  ];

  // @req FR-NODE-254 AC-1
  it.each(refusals)("refuses $label with a usage error and no journal line", async ({ body, names }) => {
    const root = await tempRoot();
    const before = await journal(root);

    const refused = await record(root, body);

    expect(refused.exit, JSON.stringify(refused.out)).toBe(1);
    expect(refused.out.ok).toBe(false);
    expect(refused.out.gate, "a usage error is not a gate refusal").toBeUndefined();
    expect(String(refused.out.error)).toContain(names);
    expect(await journal(root), "nothing is written").toBe(before);
  });

  // @req FR-NODE-254 AC-1
  it("records the legal keep/drop round", async () => {
    const root = await tempRoot();
    const accepted = await record(root, payload());
    expect(accepted.exit, JSON.stringify(accepted.out)).toBe(0);
    expect((await journal(root)).trim().split("\n")).toHaveLength(1);
  });
});

describe("FR-NODE-254 AC-3 — the wave-verify line carries findings and red_tests", () => {
  // @req FR-NODE-254 AC-3
  it("writes verification.findings {kept, dropped} and red_tests[] and no axis_a or axis_b", async () => {
    const root = await tempRoot();
    const result = await record(root, payload());
    expect(result.exit, JSON.stringify(result.out)).toBe(0);

    const line = JSON.parse((await journal(root)).trim()) as Record<string, unknown>;
    const verification = line.verification as Record<string, unknown>;
    expect(line.phase).toBe("wave-verify");
    expect(verification.findings).toEqual({ kept: 1, dropped: 1 });
    expect(verification.red_tests).toEqual(["test/x.test.ts > red"]);
    expect(Object.keys(verification)).not.toContain("axis_a");
    expect(Object.keys(verification)).not.toContain("axis_b");

    // The line it wrote validates clean.
    const validated = await run(root, ["validate", "--run-id", "run-a"]);
    expect(validated.exit, JSON.stringify(validated.out)).toBe(0);
  });

  // @req FR-NODE-254 AC-3
  it("still accepts, under orchestrate validate, a line already written with axis_b", async () => {
    const old = waveVerify({ run_id: "run-a", engine: "kiwi-orchestrator" });
    expect(Object.keys(old.verification as Record<string, unknown>)).toContain("axis_b");
    const root = await tempRoot(`${JSON.stringify(old)}\n`);

    const validated = await run(root, ["validate", "--run-id", "run-a"]);

    expect(validated.exit, JSON.stringify(validated.out)).toBe(0);
    expect(validated.out.ok).toBe(true);
  });
});

describe("FR-NODE-254 AC-3 — the residual of a fail-cap round is complete on the new line", () => {
  const exhausted = (residual: unknown[]): Record<string, unknown> =>
    payload({ cap: 1, roundIndex: 1, residual });

  // @req FR-NODE-254 AC-3
  it("round record refuses a fail-cap round whose kept finding is missing from residual, and writes nothing", async () => {
    const root = await tempRoot();
    const refused = await record(root, exhausted([]));

    expect(refused.exit, JSON.stringify(refused.out)).toBe(1);
    expect(String(refused.out.error)).toContain("fail-cap");
    expect(String(refused.out.error)).toContain("R-1");
    expect(await journal(root)).toBe("");
  });

  // @req FR-NODE-254 AC-3
  it("round record writes the fail-cap round whose residual lists its kept finding", async () => {
    const root = await tempRoot();
    const accepted = await record(root, exhausted([{ id: "R-1", reasonClass: "design-gap" }]));
    expect(accepted.exit, JSON.stringify(accepted.out)).toBe(0);
    const line = JSON.parse((await journal(root)).trim()) as Record<string, unknown>;
    expect((line.verification as Record<string, unknown>).verdict).toBe("fail-cap");
  });

  /** A hand-written new-format line: `findings` in place of `axis_a`/`axis_b`. */
  const newLine = (verification: Record<string, unknown>): string =>
    `${JSON.stringify(
      waveVerify({
        run_id: "run-a",
        engine: "kiwi-orchestrator",
        verification: { axis_a: undefined, axis_b: undefined, red_tests: [], ...verification }
      })
    )}\n`;

  // @req FR-NODE-254 AC-3
  it("orchestrate validate refuses a fail-cap line whose residual count differs from findings.kept as truncated-residual", async () => {
    const root = await tempRoot(newLine({ verdict: "fail-cap", findings: { kept: 1, dropped: 0 }, residual: [] }));
    const validated = await run(root, ["validate", "--run-id", "run-a"]);

    expect(validated.exit, JSON.stringify(validated.out)).toBe(2);
    expect(JSON.stringify(validated.out.violations)).toContain("truncated-residual");
  });

  // @req FR-NODE-254 AC-3
  it("orchestrate validate accepts the complete fail-cap line, and a pass line carrying a residual", async () => {
    const residual = [{ id: "R-1", reason_class: "design-gap" }];
    const complete = await tempRoot(newLine({ verdict: "fail-cap", findings: { kept: 1, dropped: 0 }, residual }));
    expect((await run(complete, ["validate", "--run-id", "run-a"])).exit).toBe(0);

    // A pass holds no kept finding, and its residual is the carried list: no count is implied.
    const passing = await tempRoot(newLine({ verdict: "pass", findings: { kept: 0, dropped: 1 }, residual }));
    expect((await run(passing, ["validate", "--run-id", "run-a"])).exit).toBe(0);
  });
});
