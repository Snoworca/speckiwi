import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-121 — kiwi-coder --defer-srs-mutation and its kiwi-pm pass-through.
//
// Charter C1 forbids SRS mutation inside a parallel task, but kiwi-coder §0.12 makes four MCP
// mutations mandatory per Task and a lane's MCP writes land at the HOST root, not in its worktree.
// The flag is the only path between "skip them" (traceability breaks) and "call them" (C1 breaks):
// record to the queue, and let the orchestrator replay at the host root.
//
// Both halves are asserted by one requirement because either alone is inert — kiwi-pm owns the
// spawn, so a flag only kiwi-coder documents can never be reached, and a flag only kiwi-pm forwards
// is discarded by a kiwi-coder that does not read it.
//
// Runtime lag: these read the BUNDLED copies. The running agent reads `~/.claude/skills/…`, which
// `00.charter.md:303-304` forbids reinstalling from this repository; the lag is recorded as
// verification evidence rather than accommodated here.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every shipped rendering of a skill's SKILL.md. `.agents/skills/` mirrors the codex variant;
 * only kiwi-step and kiwi-wave-master are excluded (`.agents/skills/.speckiwi-mirror-exclusions.json`). */
function copies(skill: string): string[] {
  return [
    `skills/claude/${skill}/SKILL.md`,
    `skills/codex/${skill}/SKILL.md`,
    `skills/etc/${skill}/SKILL.md`,
    `.agents/skills/${skill}/SKILL.md`
  ];
}

const CODER_COPIES = copies("kiwi-coder");
const PM_COPIES = copies("kiwi-pm");

function read(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** A heading and everything under it, down to the next same-or-higher-level heading. "" when absent. */
function section(text: string, headingRe: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && headingRe.test(l));
  if (start === -1) return "";
  const level = (lines[start].match(/^#+/) as RegExpMatchArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^#+/);
    if (m && m[0].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** A section with its own heading line removed. Every rule assertion runs against this rather than
 * against `section()`, because a sub-block heading repeats the rule's words — so an unscoped search
 * matches the heading and leaves the rule sentence below it entirely unchecked. The sibling suite
 * names the same trap at `orchestrator-delegated-flags.fr-flow-113.test.ts:71-73`. */
function body(sectionText: string): string {
  return sectionText.split("\n").slice(1).join("\n");
}

/** The single line containing the first match of `re`. "" when absent. */
function line(text: string, re: RegExp): string {
  return text.split("\n").find((l) => re.test(l)) ?? "";
}

/** Hedges that turn a MUST into a SHOULD. */
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|지양/;

/**
 * Where a kiwi-coder rendering makes §6.2 its SSOT. The claude variant keeps the section inline; the
 * others delegate §6.2~§6.4 to `references/extended-workflow.md` and say so at their §6 boundary.
 * Resolved per variant rather than hard-coded, so a variant that RELOCATES the section is followed
 * rather than silently passing on an empty section.
 */
function mutationSsot(copy: string): string {
  const extended = `${copy.slice(0, copy.lastIndexOf("/"))}/references/extended-workflow.md`;
  return existsSync(path.join(REPO_ROOT, extended)) ? extended : copy;
}

const FLAG = "--defer-srs-mutation";

/** The flag's own sub-block inside a resolved §6.2, heading stripped. "" when either is absent. */
function coderFlagBody(copy: string): string {
  const six2 = section(read(mutationSsot(copy)), /^###\s+6\.2\s/);
  return body(section(six2, new RegExp(`^####\\s.*\`${FLAG}[^\`]*\``)));
}

/** The `| … | … | 기본값 |` row whose middle cell names `flag`. "" when absent. */
function optionRow(text: string, flag: string): string {
  return text.split("\n").find((l) => l.startsWith("|") && l.includes(`\`${flag}`)) ?? "";
}

/** The last column of a markdown row. Outer pipes are dropped rather than every empty cell, so a row
 * whose default column is genuinely blank reads as blank instead of falling back to the cell before. */
function defaultCell(row: string): string {
  const cells = row.split("|").slice(1, -1).map((c) => c.trim());
  return cells[cells.length - 1] ?? "";
}

describe("FR-FLOW-121 — kiwi-coder --defer-srs-mutation and its kiwi-pm pass-through", () => {
  it("covers exactly the four shipped copies of each skill", () => {
    expect(CODER_COPIES).toHaveLength(4);
    expect(PM_COPIES).toHaveLength(4);
    for (const copy of [...CODER_COPIES, ...PM_COPIES]) {
      expect(() => read(copy), `${copy} must exist`).not.toThrow();
    }
  });

  // AC-1
  it.each(CODER_COPIES)("%s documents the flag in its optional-input table", (copy) => {
    const table = section(read(copy), /^###\s+1\.2\s/);
    expect(table, `${copy} must have a §1.2 optional-input section`).not.toBe("");
    expect(optionRow(table, FLAG), `${copy} §1.2 must carry a ${FLAG} row`).not.toBe("");
  });

  // AC-2 — asserted against the file THAT variant makes SSOT for §6.2, heading excluded.
  it.each(CODER_COPIES)("%s defines the flag as record-instead-of-call in its §6.2 SSOT", (copy) => {
    const ssot = mutationSsot(copy);
    expect(
      section(read(ssot), /^###\s+6\.2\s/),
      `${ssot} must carry §6.2; ${copy} resolves its mutation SSOT there`
    ).not.toBe("");

    const rule = coderFlagBody(copy);
    expect(rule, `${ssot} §6.2 must define ${FLAG} in its own sub-block`).not.toBe("");

    const sentence = line(rule, /호출하지 않고|호출 대신/);
    expect(sentence, `${ssot} the rule sentence must live in the body, not only in the heading`).not.toBe("");
    expect(HEDGE.test(sentence), `${ssot} record-instead-of-call must be absolute, not hedged`).toBe(false);

    expect(/기록/.test(rule), `${ssot} the mutations must be recorded to the queue`).toBe(true);
    expect(
      rule.includes("mcp_call_log"),
      `${ssot} the queue must be the existing mcp_call_log[] entry shape, not a new format`
    ).toBe(true);
    expect(rule.includes("args_hash"), `${ssot} the existing args_hash dedupe must be kept`).toBe(true);
  });

  // AC-3 — three separate claims, each asserted as its own sentence rather than as a bare mention.
  it.each(CODER_COPIES)("%s states recording is not skipping, and names the only caller", (copy) => {
    const ssot = mutationSsot(copy);
    const rule = coderFlagBody(copy);
    expect(rule, `${ssot} must define ${FLAG} before this can be asserted`).not.toBe("");

    const accounted = line(rule, /회계|그대로 남는다|보존/);
    expect(accounted, `${ssot} must say the four mutations remain accounted for`).not.toBe("");
    expect(
      /skip 이 아니다|건너뛰는 것이 아니다|생략이 아니다/.test(rule),
      `${ssot} must say recording is NOT skipping; a reader who skips loses traceability`
    ).toBe(true);

    const replay = line(rule, /재생|replay/);
    expect(replay, `${ssot} must name the orchestrator's replay as what makes deferral safe`).not.toBe("");
    expect(
      /host root|호스트 root|호스트 루트/.test(replay),
      `${ssot} the replay must be stated to happen at the HOST root, which is the point of deferring`
    ).toBe(true);

    const reach = line(rule, /직접 호출/);
    expect(reach, `${ssot} must say a direct invocation is not a supported path`).not.toBe("");
    expect(
      rule.includes("kiwi-pm"),
      `${ssot} must name kiwi-pm's spawn as the only path that reaches this flag`
    ).toBe(true);
  });

  // AC-4 — all three sibling places, plus the count the heading and the prose must agree on.
  it.each(PM_COPIES)("%s carries the pass-through in all three sibling places", (copy) => {
    const text = read(copy);

    const table = section(text, /^###\s+1\.2\s/);
    expect(table, `${copy} must have a §1.2 optional-input section`).not.toBe("");
    expect(optionRow(table, FLAG), `${copy} §1.2 must carry a ${FLAG} row`).not.toBe("");

    const summary = section(text, /^###\s.*CLI 인자 요약/);
    expect(summary, `${copy} must have a CLI argument summary`).not.toBe("");
    expect(
      summary.includes(FLAG),
      `${copy} the CLI summary lists the sibling flags; the newest must not be the odd one out`
    ).toBe(true);

    const delegation = section(text, /^###\s.*오케스트레이션 위임 플래그/);
    expect(delegation, `${copy} must define the orchestration delegation flags in their own section`).not.toBe("");
    const block = body(section(delegation, new RegExp(`^####\\s.*\`${FLAG}[^\`]*\``)));
    expect(block, `${copy} §1.5 must define ${FLAG} in its own sub-block`).not.toBe("");
    expect(
      /그대로 전달|pass-through|패스스루/.test(block),
      `${copy} pm must forward the flag unchanged rather than interpret it`
    ).toBe(true);
    expect(
      block.includes("kiwi-coder"),
      `${copy} the forwarding target must be named: it is the kiwi-coder spawn prompt`
    ).toBe(true);
  });

  // AC-4, second half: the heading's list and the prose's count must agree. Adding a member to one
  // and not the other is invisible to every other assertion here.
  it.each(PM_COPIES)("%s states a flag count that matches its heading's list", (copy) => {
    const delegation = section(read(copy), /^###\s.*오케스트레이션 위임 플래그/);
    const heading = delegation.split("\n")[0] ?? "";
    const listed = (heading.match(/`--[a-z-]+`/g) ?? []).length;
    expect(listed, `${copy} the §1.5 heading must list the delegation flags`).toBeGreaterThan(0);

    const counted = line(body(delegation), /\d+\s*개\s*플래그/);
    expect(counted, `${copy} §1.5 must state how many flags it covers`).not.toBe("");
    const stated = Number((counted.match(/(\d+)\s*개\s*플래그/) as RegExpMatchArray)[1]);
    expect(
      stated,
      `${copy} the prose says ${stated} flags while the heading lists ${listed}`
    ).toBe(listed);
  });

  // AC-5 — a required argument, and no default. `--commit-lane-work` takes none; this one must not
  // be documented into a shared queue.
  it.each([...CODER_COPIES, ...PM_COPIES])("%s requires a path argument and names no default", (copy) => {
    const table = section(read(copy), /^###\s+1\.2\s/);
    const row = optionRow(table, FLAG);
    expect(row, `${copy} §1.2 must carry a ${FLAG} row`).not.toBe("");

    expect(
      new RegExp(`\`${FLAG}\\s+<[^>]+>`).test(row),
      `${copy} the flag must carry a path placeholder; a bare flag has nowhere to write`
    ).toBe(true);

    const fallback = defaultCell(row);
    expect(fallback, `${copy} the ${FLAG} row must state a default column`).not.toBe("");
    expect(
      /\.jsonl|\.json\b|kiwi\/|\.kiwi\//.test(fallback),
      `${copy} the default must not name a queue path; two lanes sharing one queue is the failure`
    ).toBe(false);
  });

  // AC-6 — the producer shipped before its consumer. Said in the text a reader reaches, not only in
  // the requirement: today the flag is one hop from permanently losing four mutations per Task.
  it.each(CODER_COPIES)("%s warns that the replay consumer does not exist yet", (copy) => {
    const ssot = mutationSsot(copy);
    const rule = coderFlagBody(copy);
    expect(rule, `${ssot} must define ${FLAG} before this can be asserted`).not.toBe("");

    const caveat = line(rule, /소비자[는가]? 아직 없다|재생하는 쪽이 아직 없다/);
    expect(
      caveat,
      `${ssot} must say the replay consumer does not exist yet; without it the text reads as if replay happens`
    ).not.toBe("");
    expect(
      /소실|잃는다|사라진다/.test(rule),
      `${ssot} must say what is lost when the queue is never harvested`
    ).toBe(true);
    expect(HEDGE.test(caveat), `${ssot} the caveat must be absolute, not hedged`).toBe(false);
  });

  // AC-7 — the interaction the sibling family handles by refusing (`--from-task` × `--handoff`).
  it.each(CODER_COPIES)("%s makes the flag mutually exclusive with --dry-run", (copy) => {
    const ssot = mutationSsot(copy);
    const rule = coderFlagBody(copy);
    expect(rule, `${ssot} must define ${FLAG} before this can be asserted`).not.toBe("");

    const exclusive = line(rule, /상호 배타|함께 (줄|주면|쓸)/);
    expect(exclusive, `${ssot} must state the --dry-run interaction rather than leave it undefined`).not.toBe("");
    expect(exclusive.includes("--dry-run"), `${ssot} the excluded flag must be named`).toBe(true);
    expect(
      /거부|거절|refuse/.test(rule),
      `${ssot} the combination must be refused, not silently resolved one way`
    ).toBe(true);
    expect(
      /사유|reason/.test(rule),
      `${ssot} the refusal must record a reason, as the sibling conflict rule does`
    ).toBe(true);
  });
});
