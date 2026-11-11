import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-NODE-301 — the completion gate reads only wave-verify lines that carry a verification, and
// its refusal names the line it read.
//
// SSO-run-close-4908 (2026-11-11): loop P recorded a pass, then the wave-issue-triage and
// promote-requirements intent/result lines were journalled with `phase: "wave-verify"`, and the
// `complete` that followed the skill's own order was refused as complete-without-latest-pass.

const created: string[] = [];

afterAll(async () => {
  for (const directory of created) await rm(directory, { recursive: true, force: true });
});

const RUN = "run-g";
const BASE = { schema_version: "2.0.0", run_id: RUN, engine: "kiwi-orchestrator" } as const;

function round(verdict: string, index: number): Record<string, unknown> {
  return {
    ...BASE,
    wave: "wave-1",
    order: 1,
    target: "wave-1",
    status: "in_progress",
    phase: "wave-verify",
    round: index,
    summary: `P round ${index}: ${verdict}`,
    verification: { verdict, rounds: index, cap: 3, residual: [], findings: { kept: 0, dropped: 0 } }
  };
}

function ledger(verb: string, event: "intent" | "result"): Record<string, unknown> {
  return {
    ...BASE,
    wave: "wave-1",
    phase: "wave-verify",
    verb,
    event,
    ...(event === "intent" ? { inputs_digest: `sha256:${verb}-in` } : { proof: { kind: "digest", ref: `sha256:${verb}-out` } })
  };
}

const COMPLETE = { ...BASE, wave: "wave-1", order: 1, target: "wave-1", status: "complete", summary: "wave 1 done" };

async function gitRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-301-"));
  created.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root }).toString().trim();
  expect(path.resolve(top).toLowerCase()).toBe(path.resolve(await realpath(root)).toLowerCase());
  return root;
}

async function append(root: string, line: Record<string, unknown>): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", "journal", "append", "--run-id", RUN, "--payload", JSON.stringify(line), "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? JSON.parse(text) : {} };
}

/** Appends every line but the last through the tool, each accepted, and returns the last line's answer. */
async function journal(lines: Array<Record<string, unknown>>): Promise<{ exit: number; payload: Record<string, unknown>; root: string }> {
  const root = await gitRoot();
  for (const line of lines.slice(0, -1)) {
    const accepted = await append(root, line);
    expect(accepted.exit, JSON.stringify(accepted.payload)).toBe(0);
  }
  return { ...(await append(root, lines[lines.length - 1] as Record<string, unknown>)), root };
}

function refusalMessage(payload: Record<string, unknown>): string {
  const violations = (payload.violations ?? []) as Array<{ code: string; message: string }>;
  return violations.find((entry) => entry.code === "complete-without-latest-pass")?.message ?? "";
}

describe("FR-NODE-301 AC-1 — ledger lines after the passing round do not stand in for it", () => {
  it("accepts complete after wave-issue-triage and promote-requirements intent/result lines marked wave-verify", async () => {
    const result = await journal([
      round("pass", 1),
      ledger("wave-issue-triage", "intent"),
      ledger("wave-issue-triage", "result"),
      ledger("promote-requirements", "intent"),
      ledger("promote-requirements", "result"),
      COMPLETE
    ]);
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect((await readFile(path.join(result.root, "kiwi/waves.jsonl"), "utf8")).trim().split("\n")).toHaveLength(6);
  });
});

describe("FR-NODE-301 AC-2 — the gate still refuses what FR-NODE-142 refuses", () => {
  it.each(["in-progress", "fail-cap", "fail-residual"])("refuses complete after a later %s round", async (verdict) => {
    const result = await journal([round("pass", 1), ledger("wave-issue-triage", "intent"), round(verdict, 2), COMPLETE]);
    expect(result.exit).toBe(2);
    expect(refusalMessage(result.payload)).not.toBe("");
  });

  it("keeps the round line round record writes — a result line carrying a verification — as the record", async () => {
    const roundRecordLine = { ...round("pass", 1), verb: "post-merge-verify", event: "result", proof: { kind: "digest", ref: "sha256:round-1" } };
    const result = await journal([roundRecordLine, ledger("wave-issue-triage", "intent"), ledger("wave-issue-triage", "result"), COMPLETE]);
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
  });

  it("refuses complete when the wave's only wave-verify lines are ledger lines", async () => {
    const result = await journal([ledger("wave-issue-triage", "intent"), ledger("wave-issue-triage", "result"), COMPLETE]);
    expect(result.exit).toBe(2);
    expect(refusalMessage(result.payload)).not.toBe("");
  });

  it("refuses complete when the wave's only wave-verify line carries no verification", async () => {
    const bare = { ...BASE, wave: "wave-1", order: 1, target: "wave-1", status: "in_progress", phase: "wave-verify", summary: "verifying" };
    const result = await journal([bare, COMPLETE]);
    expect(result.exit).toBe(2);
    expect(refusalMessage(result.payload)).not.toBe("");
  });
});

describe("FR-NODE-301 AC-3 — the refusal names the line and verdict it judged by", () => {
  it("names the journal line and verdict of the latest record", async () => {
    const result = await journal([round("pass", 1), ledger("wave-issue-triage", "intent"), round("fail-cap", 2), COMPLETE]);
    const message = refusalMessage(result.payload);
    expect(message).toContain("journal line 3");
    expect(message).toContain("fail-cap");
  });

  it("says when the wave has no wave-verify record carrying a verification", async () => {
    const result = await journal([ledger("wave-issue-triage", "intent"), COMPLETE]);
    expect(refusalMessage(result.payload)).toContain("no wave-verify record carrying a verification");
  });
});

describe("FR-NODE-301 AC-4 — the contract documents say which lines the gate reads", () => {
  /** The rule as each document states it: a line without a verification is not the record; the gate reads the latest one with it. */
  const GATE_RULE =
    "`verification` 을 싣지 않은 줄 — verb 의 `intent`·`result` 원장 줄 등 — 은 `phase` 를 `wave-verify` 로 달아도 wave-verify 기록이 아니며, 게이트는 `verification` 을 실은 wave-verify 줄(`orchestrate round record` 가 쓰는 라운드 줄) 가운데 최신 1줄만 본다";
  const PW_RULE_KO =
    "`journal append` 는 그 `complete` 를 `verification` 을 실은 그 wave 의 wave-verify 줄 가운데 최신 1줄이 `pass` 일 때만 받는다 — `verification` 을 싣지 않은 줄(verb 의 `intent`·`result` 원장 줄 등)은 `phase` 를 `wave-verify` 로 달아도 그 기록이 아니다.";
  const PW_RULE_EN =
    "`journal append` accepts that `complete` only when the latest of the wave's wave-verify lines carrying a `verification` is `pass` — a line without a `verification` (a verb's `intent` or `result` ledger line, for one) is not that record, whatever `phase` it carries.";
  const cases: Array<[string, string]> = [
    ...["claude", "codex", "etc"].flatMap((tree): Array<[string, string]> => [
      [`skills/${tree}/_shared/kiwi/waves-event.md`, GATE_RULE],
      [`skills/${tree}/kiwi-wave-master/SKILL.md`, GATE_RULE],
      [`skills/${tree}/kiwi-orchestrator/SKILL.md`, GATE_RULE],
      [`skills/${tree}/_shared/kiwi/parallel-waves.md`, tree === "claude" ? PW_RULE_KO : PW_RULE_EN]
    ]),
    [".agents/skills/_shared/kiwi/waves-event.md", GATE_RULE],
    [".agents/skills/kiwi-orchestrator/SKILL.md", GATE_RULE],
    [".agents/skills/_shared/kiwi/parallel-waves.md", PW_RULE_EN]
  ];

  it.each(cases)("%s states the rule", async (relative, rule) => {
    const text = (await readFile(path.join(process.cwd(), relative), "utf8")).replace(/\r\n/g, "\n");
    expect(text, relative).toContain(rule);
  });
});
