import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-FLOW-155 AC-1 — a contract-violating terminal line is refused on EVERY engine the journal
// carries, not only on `kiwi-orchestrator`, at the write and at the preview an agent sees first.
// @req FR-FLOW-155 AC-2 — the engine handed to the prospective-journal parse is derived from the
// payload by `engineOf`, the resolver the parser itself uses, and not restated beside it.
//
// What this file measures and what it does not:
//   - It DOES exercise the real append path (`orchestrate journal append` → `appendWavesLine` →
//     `validateProspectiveJournal`), so a refusal here is the shipped refusal and not a predicate.
//   - It does NOT assert that any skill or agent calls the validator. That is a separate claim and
//     it is asserted, as a text contract only, in `test/skills/orchestrate-validate-wiring.*`.
//   - The last block reads the SOURCE of `appendWavesLine`. A source scan proves nothing about what
//     runs, and this repository has been burned by treating one as if it did; it is here only
//     because AC-2's second half is a rule ABOUT THE SOURCE TEXT — "not restated beside it" — which
//     no behavioural assertion can observe, since a correct restatement behaves identically by
//     construction. The wiring is proved by the four cases above, not by that block.
//
// The subject and the control carry the SAME payload and differ only in `engine`. That is what fixes
// the red on the engine rather than on the shape of the line: before the fix the control is refused
// and the subject lands, and the only difference between them is the field the parse pinned.

const RUN_ID = "run-engine-155";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const REVIEW_HEAD = "3333333333333333333333333333333333333333";

/**
 * A line that opens the run. Written at 1.3.0 so it needs no writer stamp and sits below the
 * terminal-review rule's 1.5.0 gate — it exists only so "byte-identical after a refusal" has a
 * non-empty baseline to be true of.
 */
const SEED =
  JSON.stringify({
    ts: "2026-08-27T00:00:00Z",
    schema_version: "1.3.0",
    run_id: RUN_ID,
    engine: "kiwi-wave-master",
    verb: "run-start",
    event: "intent",
    phase: "intake",
    wave: "all",
    status: "in_progress"
  }) + "\n";

type TerminalReview = { skill: string; base: string; head: string; verdict: string };

/** The run-closing record. `terminal_review` is the only thing the two shapes below differ by. */
function closeLine(engine: string, terminalReview?: TerminalReview): Record<string, unknown> {
  return {
    ts: "2026-08-27T01:00:00Z",
    schema_version: "1.5.0",
    run_id: RUN_ID,
    engine,
    verb: "final-verify",
    event: "result",
    phase: "final-verify",
    wave: "all",
    status: "complete",
    verification: { verdict: "pass" },
    run_diff_window: { base_sha: BASE_SHA, head_sha: HEAD_SHA },
    ...(terminalReview ? { terminal_review: terminalReview } : {})
  };
}

const DISCHARGING: TerminalReview = {
  skill: "kiwi-review-fix-loop",
  base: BASE_SHA,
  head: REVIEW_HEAD,
  verdict: "pass"
};

async function seededRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "fr-flow-155-"));
  const absolute = path.join(root, "kiwi", "waves.jsonl");
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, SEED, "utf8");
  return root;
}

async function journal(root: string): Promise<string> {
  return readFile(path.join(root, "kiwi", "waves.jsonl"), "utf8").catch(() => "");
}

/**
 * `dryRun` runs the same command with `--dry-run`. It is a parameter rather than a second helper
 * because the two branches must be asked the SAME question: `appendWavesLine` resolves the engine
 * once and hands it to two calls, and only one of them was ever exercised.
 */
async function append(
  root: string,
  payload: Record<string, unknown>,
  options: { dryRun?: boolean } = {}
): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(
    [
      "--root",
      root,
      "orchestrate",
      "journal",
      "append",
      "--run-id",
      RUN_ID,
      "--payload",
      JSON.stringify(payload),
      "--json",
      ...(options.dryRun === true ? ["--dry-run"] : [])
    ],
    pipes
  );
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("FR-FLOW-155 AC-1 — the refusal reaches the engine the line was written under", () => {
  it("refuses a kiwi-wave-master close that omits terminal_review, with the journal byte-identical", async () => {
    const root = await seededRoot();
    const before = await journal(root);
    expect(before, "the baseline must be non-empty for 'byte-identical' to mean anything").toBe(SEED);

    const result = await append(root, closeLine("kiwi-wave-master"));

    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
    expect(JSON.stringify(result.payload.violations)).toContain("terminal-review-loop-missing");
    expect(await journal(root), "a refused append must not reach the journal").toBe(before);
    expect(
      (await readdir(path.join(root, "kiwi"))).filter((entry) => entry.startsWith("waves.jsonl.candidate")),
      "the refused append left a candidate behind"
    ).toEqual([]);
  });

  it("refuses the SAME payload under kiwi-orchestrator — the control that pins the red on the engine", async () => {
    // This half is green before the fix and after it. Without it, the first assertion's red is
    // consistent with the payload simply being malformed in some engine-independent way.
    const root = await seededRoot();
    const before = await journal(root);

    const result = await append(root, closeLine("kiwi-orchestrator"));

    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
    expect(JSON.stringify(result.payload.violations)).toContain("terminal-review-loop-missing");
    expect(await journal(root)).toBe(before);
  });

  it("refuses the same kiwi-wave-master close in --dry-run, which is the only judgement an agent sees before writing", async () => {
    // `appendWavesLine` resolves the engine once and passes it to two calls: the dry-run preview and
    // the real write. Both were changed by this requirement and only the write was asked about, so
    // reverting the preview's argument to the literal left every assertion green while the preview
    // reported a clean run over zero lines — the same empty-candidate-set answer, one step earlier
    // and one step more persuasive, because an agent that previews a clean result goes on to write.
    const root = await seededRoot();
    const before = await journal(root);

    const result = await append(root, closeLine("kiwi-wave-master"), { dryRun: true });

    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
    expect(JSON.stringify(result.payload.violations)).toContain("terminal-review-loop-missing");
    expect(await journal(root), "a dry run must not touch the journal either").toBe(before);
  });

  it("refuses the SAME payload under kiwi-orchestrator in --dry-run — the preview's control", async () => {
    const root = await seededRoot();

    const result = await append(root, closeLine("kiwi-orchestrator"), { dryRun: true });

    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(JSON.stringify(result.payload.violations)).toContain("terminal-review-loop-missing");
  });

  it("previews a discharging kiwi-wave-master close as acceptable, so the preview is not refusing everything", async () => {
    // Without this, a preview hard-wired to refuse would satisfy both assertions above.
    const root = await seededRoot();
    const before = await journal(root);

    const result = await append(root, closeLine("kiwi-wave-master", DISCHARGING), { dryRun: true });

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.written, "a dry run reports no write").toBe(false);
    expect(await journal(root)).toBe(before);
  });
});

describe("FR-FLOW-155 AC-2 — the resolution is `engineOf`, so both engines keep writing", () => {
  it("accepts a kiwi-wave-master close that carries a discharging terminal_review", async () => {
    // A fix that refused every non-orchestrator append, or that resolved the engine by any rule of
    // its own, would pass the two refusal assertions above and fail here.
    const root = await seededRoot();

    const result = await append(root, closeLine("kiwi-wave-master", DISCHARGING));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.written).toBe(true);
    expect(await journal(root)).toContain("\"verdict\":\"pass\"");
  });

  it("accepts a kiwi-orchestrator close that carries a discharging terminal_review", async () => {
    const root = await seededRoot();

    const result = await append(root, closeLine("kiwi-orchestrator", DISCHARGING));

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.written).toBe(true);
  });

  it("reads an absent `engine` as kiwi-wave-master, which is what `engineOf` defines", async () => {
    // `engineOf`'s stated rule is "anything that is not kiwi-orchestrator is kiwi-wave-master",
    // absence included. A resolver that read `payload.engine` directly and fell back to the literal
    // would let an unstamped close through — and kiwi-wave-master writes no `engine` field on some
    // shapes, so this is the field's ordinary state rather than a hypothetical.
    const root = await seededRoot();
    const withoutEngine = closeLine("kiwi-wave-master");
    delete withoutEngine.engine;
    const before = await journal(root);

    const result = await append(root, withoutEngine);

    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(JSON.stringify(result.payload.violations)).toContain("terminal-review-loop-missing");
    expect(await journal(root)).toBe(before);
  });
});

describe("FR-FLOW-155 AC-2 — the rule has one spelling: `engineOf`, and no second one beside it", () => {
  // AC-2's second half — "not restated beside it. A second spelling of that rule is a second place to
  // drift" — is a claim about the source text, and no behavioural assertion can reach it: a
  // restatement that is correct today is by definition indistinguishable at runtime from the
  // resolver it copies, and every case above stays green while the literal returns. So this block
  // reads the source. It is NOT evidence that the resolved engine reaches the parse — that is what
  // the four cases above exercise — and it must never be cited as such.

  const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/cli/commands/orchestrate.ts");

  /** `appendWavesLine`'s body: from its signature to the first `}` in column 0 after it. */
  async function appendWavesLineBody(): Promise<string> {
    const text = await readFile(SOURCE, "utf8");
    const start = text.indexOf("async function appendWavesLine(");
    if (start === -1) return "";
    const end = text.indexOf("\n}\n", start);
    return end === -1 ? "" : text.slice(start, end + 3);
  }

  it("reads a non-empty function body, or every assertion below is about an empty string", async () => {
    const body = await appendWavesLineBody();
    expect(body, "appendWavesLine was renamed or moved; this block is measuring nothing").not.toBe("");
    expect(body).toContain("validateProspectiveJournal");
  });

  it("resolves the engine with `engineOf` and spells no engine literal of its own", async () => {
    const body = await appendWavesLineBody();
    expect(/const engine = engineOf\(/.test(body), "the resolver the parser filters with must be the one called here").toBe(true);
    expect(
      /"kiwi-orchestrator"|"kiwi-wave-master"/.exec(body)?.[0] ?? null,
      "an engine literal inside this function is a second spelling of the resolver's rule, and the two drift apart the day the resolver changes"
    ).toBe(null);
  });

  it("hands that one resolution to both parses — the preview and the write", async () => {
    const body = await appendWavesLineBody();
    const calls = [...body.matchAll(/validateProspectiveJournal\([^)]*\bengine\)/g)];
    expect(calls.length, "both branches must pass the resolved engine; a literal in either reopens the empty candidate set").toBe(2);
  });
});
