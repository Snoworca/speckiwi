import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RENDERINGS, skillFiles } from "./kiwi-renderings.js";

// @req FR-FLOW-211 — kiwi-pm reads each requirement named by `--req-filter` by its ID for the
// lifecycle gate and the final `implemented` promotion, whatever target holds it; a named ID that
// does not exist stops the run before kiwi-coder; without a filter the active target's open work is
// proposed as before. The AC numbers are the FR-FLOW-211 block in docs/spec/60.workflow-release.srs.md,
// which is canonical.
//
// Two verification rounds each found one more place that read, filtered or promoted requirements
// outside what this suite looked at (r1: §0.12 and §4.4; r2: MAIN under `--sds` plus `--req-filter`,
// and a target filter added after the by-ID read). So the suite no longer picks places: every line of
// every rendering's kiwi-pm text that names a requirement read, the filter, the active target or the
// promotion is a SITE, the set of sites is frozen in a golden file (a new site fails until it is
// read and recorded), and each site is held by the rule of its kind:
//   - pseudocode is EXECUTED: every branch guard over `--sds` and `--req-filter` is evaluated for all
//     four combinations; under `--req-filter` no reached read is by target, no reached condition sorts
//     requirements by target, every reading function reaches a by-ID read, and MAIN reaches the ID check
//     before kiwi-coder;
//   - prose that names a target-scoped read also names the by-ID read or the no-filter path it is about.
// The record sits at the end of this file, so the suite carries its own denominator wherever it is
// copied. Regenerate it with UPDATE_D1_RULE_BLOCKS=1 and read the diff.

const SELF = fileURLToPath(import.meta.url);
const RECORD_START = "// <recorded-sites>";
const RECORD_END = "// </recorded-sites>";

/** One rendering's kiwi-pm files: codex and etc split the body into references/extended-workflow.md. */
const pmDocs = (root: string) => skillFiles(root, "kiwi-pm");
const pmText = (root: string): string => pmDocs(root).map((doc) => doc.text).join("\n");
const pmSkill = (root: string): string => pmDocs(root)[0]?.text ?? "";
const lineOf = (text: string, start: string): string => text.split("\n").find((line) => line.startsWith(start)) ?? "";

const BY_ID =
  "`--req-filter` 가 있으면 lifecycle gate 와 T-final `implemented` 승급은 집합의 요구를 하나씩 `get_requirement` 로 ID 로 읽는다 — 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다.";
const MISSING =
  "`--req-filter` 의 ID 가운데 `get_requirement` 가 찾지 못하는 것이 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다.";
const NO_FILTER =
  "없으면 활성 target 의 열린 작업 후보(`list_requirements` 의 `planned` · `in_progress` 요구)를 집합으로 출력하고 kiwi-coder 를 띄우기 전에 사용자 게이트에서 확인받는다";
// verify r4: the check read the invocation, so a resume (which need not repeat --req-filter) skipped it.
// It now reads the recorded filter after the state is loaded, once, for a first run and a resume alike.
const ID_CHECK =
  "IF state.req_filter: HALT_ON_MISSING_IDS(state.req_filter)   # §1.1 — 처음 실행과 재개가 같은 확인을 부른다: ID 마다 get_requirement, 찾지 못한 ID 를 적고 kiwi-coder 전에 멈춘다";
const FIND_SESSION = "state = LOAD_STATE(FIND_SESSION(args))";
// verify r6 (lead decision): the run_id of each flag combination, and a resume that finds its session
// by recomputing the same formula from the flags it is given.
const RESUME_FIND =
  "재개할 세션은 `--run-id` 로, 없으면 재개 호출이 준 `--sds` · `--req-filter` 로 §0.14 의 공식을 다시 계산한 `run_id` 로 찾는다(`--sds` 와 `--req-filter` → `<sds-id>-<sha8>`, `--sds` 만 → sds-id, `--req-filter` 만 → `<target>-<sha8>`) — 찾으면 MAIN 은 집합을 다시 정하지 않고(열린 작업 후보 제안과 사용자 게이트 없음) 저장된 값으로 돌며, 찾지 못하면 새 실행을 시작하지 않고 멈춰 `--run-id` 를 묻는다.";
const RUN_ID_TARGET = "`<target>` 은 활성 target 의 이름이고, 활성 target 이 없으면 `none` 이다(`--req-filter` 실행은 활성 target 없이도 돈다).";
const RUN_ID_BOTH = "`--sds` 와 `--req-filter` 를 함께 주면 `run_id` 는 `<sds-id>-<정렬한 REQ ID 의 sha256 앞 8 hex>` 다 — 같은 SDS 에 다른 요구를 준 두 실행은 다른 run 이다.";
const TARGET_EMPTY_HALT = 'HALT("활성 target 없음';
const INTEGRITY_ROWS = [
  "| `--req-filter` 의 ID 를 `get_requirement` 가 찾지 못함 — 처음 실행과 재개 모두 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
  "| `--sds` 와 함께 준 `--req-filter` 의 ID 가 SDS `@req` 집합에 없음 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
];
// Lead decision after verify r2: with --sds and --req-filter the run set (gate, kiwi-coder, promotion)
// is the --req-filter IDs and the SDS only supplies their design; an ID outside the SDS's @req set stops.
const BOTH_SET =
  "`--sds` 와 함께 주면 실행 집합(gate · kiwi-coder 에 넘기는 요구 · 승급)은 `--req-filter` 의 ID 이고 SDS 는 그 요구들의 설계만 준다 — SDS 의 `@req` 에 없는 ID 가 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다.";
const OUTSIDE_SDS_CHECK = "HALT_ON_IDS_OUTSIDE_SDS(args.req_filter, sds.req_ids)   # SDS @req 에 없는 --req-filter ID 를 적고 kiwi-coder 전에 멈춘다";
const STATE_INIT = "state = LOAD_OR_INIT_STATE(sds, req_ids, args)";
const CODER_SET = "--req-filter {state.req_ids 를 쉼표로 이음}";
/** What marks the kiwi-coder spawn among the lines that pass `--req-filter` on (the review hand-offs pass it too). */
const CODER_SPAWN_MARK = "{(' --sds ' + state.sds_path) if state.sds_path else ''}";
// verify r3: the by-ID branch hung on `args.req_filter`, which a `--resume` call need not carry. The run
// set and the filter are state, recorded at boot and read back on resume.
const STATE_FILTER_FIELD = /^ {2}"req_filter": /m;
const RESUME_RULE =
  "재개는 pm-state 의 `req_ids` · `req_filter` · `sds_path` 로 돈다 — 재개 호출이 `--req-filter` 나 `--sds` 를 다시 주지 않아도 gate · kiwi-coder · T-final 은 처음 실행과 같은 집합을 같은 방식으로 읽고, 재개 호출의 인자가 이 값을 덮어쓰지 않는다.";
/** Arguments that fix what the run reads; past boot they are read from state, never from the invocation. */
const RUN_SET_ARGS = /args\.(?:req_filter|sds_path)\b/;
const READ_BY_ID ="reqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)";
const BOTH_FLAGS = "`--req-filter` 가 있으면 `--sds` 실행도 요구 집합 실행처럼 읽는다.";
const RETIRED_SKIP = "# 집합이 가리키지만 활성 target 에 없는 REQ — 무시";

/** What makes a line a site: it names a requirement read, the filter, the active target or the promotion. */
const SITE = /list_requirements|get_requirement|get_active_target|req_filter|--req-filter|target_slug|활성 target|update_status|implemented/;
/** A read of requirements in pseudocode, and the form of it that goes by target. */
const READ = /MCP_CALL\((?:list_requirements|get_requirement)|CLI_FALLBACK\(.*speckiwi (?:list|show)/;
const BY_TARGET_READ = /target=|--target/;
const BY_ID_READ = /MCP_CALL\(get_requirement, id=id\)/;
/** A requirement variable, and a target, in a condition: together they sort requirements by target. */
const REQUIREMENT_VAR = /\b(?:req|reqs|r|p|req_id|req_ids|reqs_by_id|proposals)\b/;
const TARGET = /\btarget\b|target_slug/;
/** Prose that names a target-scoped read is about the by-ID read or the no-filter path. */
const TARGET_SCOPED = /list_requirements|get_active_target|활성 target/;
const SCOPED_TO = /get_requirement|없으면|없는|없을 때|`--sds`|제외|열린 작업 후보/;

/** A run: what it was started with (recorded in state), and whether this call is a resume that repeats neither flag. */
interface Flags {
  sds: boolean;
  reqFilter: boolean;
  resume: boolean;
}
const COMBINATIONS: Flags[] = [false, true].flatMap((resume) =>
  [false, true].flatMap((sds) => [false, true].map((reqFilter) => ({ sds, reqFilter, resume })))
);
const WITH_FILTER = COMBINATIONS.filter((flags) => flags.reqFilter);
const label = (flags: Flags): string =>
  `${flags.resume ? "resume of a run with " : ""}--sds ${flags.sds ? "on" : "off"}, --req-filter ${flags.reqFilter ? "on" : "off"}`;

const code = (line: string): string => line.replace(/\s+#.*$/, "").trim();
const indent = (line: string): number => line.length - line.trimStart().length;

/**
 * A guard evaluated for `flags`: true or false when it reads only `--sds` and `--req-filter`, undefined
 * when it also reads something else — such a branch may be taken either way, so it counts as reached.
 */
function evaluate(condition: string, flags: Flags): boolean | undefined {
  const js = condition
    .replace(/state\.sds_path/g, String(flags.sds))
    .replace(/state\.req_filter/g, String(flags.reqFilter))
    .replace(/args\.sds_path/g, String(flags.sds && !flags.resume))
    .replace(/args\.req_filter/g, String(flags.reqFilter && !flags.resume))
    .replace(/args\.resume/g, String(flags.resume))
    .replace(/\bNOT\b/g, "!")
    .replace(/\bAND\b/g, "&&")
    .replace(/\bOR\b/g, "||");
  if (!/^[\s!()&|]*(?:(?:true|false)[\s!()&|]*)+$/.test(js)) return undefined;
  return Function(`return (${js});`)() as boolean;
}

/** One pseudocode function: from its `FUNCTION <name>(` line to the next function or the closing fence. */
interface Fn {
  name: string;
  lines: string[];
}
function functions(text: string): Fn[] {
  const lines = text.split("\n");
  const found: Fn[] = [];
  lines.forEach((line, at) => {
    const name = /^FUNCTION ([A-Z_]+)\(/.exec(line)?.[1];
    if (name === undefined) return;
    let end = at + 1;
    while (end < lines.length && !/^FUNCTION [A-Z_]+\(/.test(lines[end] as string) && !(lines[end] as string).startsWith("```")) end += 1;
    found.push({ name, lines: lines.slice(at, end) });
  });
  return found;
}

/** Whether a run with `flags` may reach `lines[at]`: no enclosing `IF` (or the line's own inline `IF`) is false, no enclosing `ELSE` follows a true one. */
function reached(lines: readonly string[], at: number, flags: Flags): boolean {
  const inline = /^IF (.*?):\s+\S/.exec(code(lines[at] as string))?.[1];
  if (inline !== undefined && evaluate(inline, flags) === false) return false;
  let depth = indent(lines[at] as string);
  for (let index = at - 1; index >= 0 && depth > 0; index -= 1) {
    const line = lines[index] as string;
    if (line.trim() === "" || indent(line) >= depth) continue;
    depth = indent(line);
    const guard = code(line);
    if (guard === "ELSE:") {
      const opener = lines.slice(0, index).reverse().find((candidate) => indent(candidate) === depth && code(candidate).startsWith("IF "));
      const condition = /^IF (.*):$/.exec(code(opener ?? ""))?.[1];
      if (condition !== undefined && evaluate(condition, flags) === true) return false;
      continue;
    }
    const condition = /^IF (.*):$/.exec(guard)?.[1];
    if (condition !== undefined && evaluate(condition, flags) === false) return false;
  }
  return true;
}

const isCondition = (line: string): boolean => /^(?:IF|ELIF|FOR|WHILE)\b/.test(code(line)) || /\bIF\b|\bCONTINUE\b/.test(code(line));

/** Every site of one rendering, as `<file>\t<kind>\t<text>`, in file order. */
function sites(root: string): string[] {
  return pmDocs(root).flatMap((doc) => {
    const file = path.posix.relative(root, doc.relPath);
    let inFunction = false;
    return doc.text.split("\n").flatMap((line) => {
      if (/^FUNCTION [A-Z_]+\(/.test(line)) inFunction = true;
      else if (line.startsWith("```")) inFunction = false;
      return SITE.test(line) ? [`${file}\t${inFunction ? "code" : "prose"}\t${line.trim()}`] : [];
    });
  });
}

if (process.env.UPDATE_D1_RULE_BLOCKS === "1") {
  const own = readFileSync(SELF, "utf8");
  const record = Object.fromEntries(RENDERINGS.map((root) => [root, sites(root)]));
  const body = `const RECORDED_SITES: Record<string, string[]> = ${JSON.stringify(record, null, 2)};`;
  writeFileSync(SELF, `${own.slice(0, own.lastIndexOf(RECORD_START) + RECORD_START.length)}\n${body}\n${own.slice(own.lastIndexOf(RECORD_END))}`, "utf8");
}

describe("FR-FLOW-211 — kiwi-pm reads --req-filter requirements by ID", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-211 AC-1 — a resumed run keeps the run set and the by-ID branch: pm-state records the filter.
    it(`AC-1: ${root} pm-state records req_filter and §5.4 resumes from the recorded set`, () => {
      const schema = /### 2\.2 pm-state\.json 스키마[\s\S]*?\n```\n/.exec(pmSkill(root))?.[0] ?? "";
      expect(schema, `${root}: the §2.2 schema`).toMatch(STATE_FILTER_FIELD);
      const resume = /### 5\.4 `--resume` 동작[\s\S]*?(?=\n### )/.exec(pmText(root))?.[0] ?? "";
      expect(resume.split("\n"), `${root}: §5.4`).toContain(RESUME_RULE);
    });

    // @req FR-FLOW-211 AC-1 — past MAIN's boot nothing reads the run-set arguments off the invocation (a resume may omit them).
    it(`AC-1: ${root} only MAIN's boot reads --req-filter and --sds off the invocation`, () => {
      const text = pmText(root);
      const main = functions(text).find((f) => f.name === "MAIN")?.lines ?? [];
      const init = main.findIndex((line) => line.trim().startsWith(STATE_INIT));
      expect(init, `${root}: MAIN builds the state`).toBeGreaterThan(0);
      const boot = new Set(main.slice(0, init));
      const offenders = text.split("\n").filter((line) => RUN_SET_ARGS.test(line) && !boot.has(line)).map((line) => line.trim().slice(0, 140));
      expect(offenders).toEqual([]);
    });

    // @req FR-FLOW-211 AC-1 AC-4
    it(`AC-1: ${root} §1.1 reads every --req-filter requirement by ID for the gate and the promotion`, () => {
      expect(lineOf(pmSkill(root), "- **`--req-filter <REQ-ID,...>`**")).toContain(BY_ID);
    });

    // @req FR-FLOW-211 AC-2 AC-4
    it(`AC-2: ${root} §1.1 stops before kiwi-coder on a --req-filter ID that does not exist and names it`, () => {
      expect(lineOf(pmSkill(root), "- **`--req-filter <REQ-ID,...>`**")).toContain(MISSING);
    });

    // @req FR-FLOW-211 AC-3 AC-4
    it(`AC-3: ${root} §1.1 still proposes the active target's open work when --req-filter is absent`, () => {
      expect(lineOf(pmSkill(root), "- **`--req-filter <REQ-ID,...>`**")).toContain(NO_FILTER);
    });

    // @req FR-FLOW-211 AC-1 AC-2 AC-3 AC-4 — the denominator: every site is recorded, nothing new is unread.
    it(`AC-1 AC-2: ${root} carries exactly the recorded requirement sites`, () => {
      const recorded = RECORDED_SITES[root];
      expect(recorded, `the record has no section for ${root}`).toBeDefined();
      const live = sites(root);
      expect(live.filter((site) => !recorded!.includes(site)), `${root}: sites not in the record — read them, then regenerate`).toEqual([]);
      expect(recorded!.filter((site) => !live.includes(site)), `${root}: recorded sites the tree no longer carries`).toEqual([]);
    });

    // @req FR-FLOW-211 AC-1 — prose that names a target-scoped read says which path it is about.
    it(`AC-1: ${root} every prose site naming a target-scoped read names the by-ID read or the no-filter path`, () => {
      const loose = sites(root)
        .filter((site) => site.split("\t")[1] === "prose")
        .map((site) => site.split("\t")[2] as string)
        .filter((text) => TARGET_SCOPED.test(text) && !SCOPED_TO.test(text));
      expect(loose).toEqual([]);
    });

    const fns = (): Fn[] => functions(pmText(root));
    for (const flags of WITH_FILTER) {
      // @req FR-FLOW-211 AC-1 — under --req-filter no pseudocode reads by target or sorts requirements by target.
      it(`AC-1: ${root} with ${label(flags)} no function reads by target or filters requirements by target`, () => {
        const offenders = fns().flatMap((f) =>
          f.lines.flatMap((line, at) => {
            if (!reached(f.lines, at, flags)) return [];
            const body = code(line);
            if (READ.test(body) && BY_TARGET_READ.test(body)) return [`${f.name}: reads by target — ${body}`];
            if (isCondition(line) && REQUIREMENT_VAR.test(body) && TARGET.test(body)) return [`${f.name}: filters by target — ${body}`];
            return [];
          })
        );
        expect(offenders).toEqual([]);
      });

      // @req FR-FLOW-211 AC-2 — MAIN reaches the ID check before the gate (which --skip-lifecycle-gate skips) and before kiwi-coder.
      it(`AC-2: ${root} with ${label(flags)} MAIN checks the --req-filter IDs before the gate and the kiwi-coder run`, () => {
        const main = fns().find((f) => f.name === "MAIN")?.lines ?? [];
        const check = main.findIndex((line) => line.trim() === ID_CHECK);
        expect(check, `${root}: the ID check line`).toBeGreaterThan(0);
        expect(reached(main, check, flags), `${root}: the ID check is not reached`).toBe(true);
        expect(check).toBeLessThan(main.findIndex((line) => line.includes("APPLY_LIFECYCLE_GATE(")));
        expect(check).toBeLessThan(main.findIndex((line) => line.includes("# T-run")));
      });
    }

    // @req FR-FLOW-211 AC-2 — the check is one function, called from one place that a first run and a resume both pass.
    it(`AC-2: ${root} the missing-ID check is one function with one call site`, () => {
      const text = pmText(root);
      const calls = text.split("\n").filter((line) => /HALT_ON_MISSING_IDS\(/.test(line) && !/^FUNCTION /.test(line));
      expect(calls.map((line) => line.trim()), `${root}: call sites`).toEqual([ID_CHECK]);
      const body = functions(text).find((f) => f.name === "HALT_ON_MISSING_IDS")?.lines ?? [];
      expect(body.length, `${root}: FUNCTION HALT_ON_MISSING_IDS`).toBeGreaterThan(1);
      expect(body.some((line) => /MCP_CALL\(get_requirement, id=id\)/.test(line)), `${root}: it reads by ID`).toBe(true);
      expect(body.some((line) => /HALT\(/.test(line)), `${root}: it stops`).toBe(true);
    });

    // @req FR-FLOW-211 AC-1 AC-2 — §5.4 says how a resume finds its session without re-proposing a set, and §7.1 lists both stops.
    it(`AC-1 AC-2: ${root} §5.4 finds the session without re-resolving the set, and §7.1 lists the --req-filter stops`, () => {
      const resume = /### 5\.4 `--resume` 동작[\s\S]*?(?=\n### )/.exec(pmText(root))?.[0] ?? "";
      expect(resume.split("\n"), `${root}: §5.4`).toContain(RESUME_FIND);
      const integrity = /### 7\.1 입력 무결성 게이트 \(T-1\)[\s\S]*?(?=\n### )/.exec(pmText(root))?.[0] ?? "";
      for (const row of INTEGRITY_ROWS) expect(integrity.split("\n"), `${root}: §7.1`).toContain(row);
    });

    // @req FR-FLOW-211 AC-1 AC-2 — the lead's rule for --sds with --req-filter, stated where the input is defined.
    it(`AC-1 AC-2: ${root} §1.1 makes --req-filter the run set beside --sds and stops on an ID outside the SDS`, () => {
      expect(lineOf(pmSkill(root), "- **`--req-filter <REQ-ID,...>`**")).toContain(BOTH_SET);
    });

    for (const flags of COMBINATIONS) {
      // @req FR-FLOW-211 AC-1 — the set MAIN hands to the gate, kiwi-coder and the promotion: --req-filter whenever it is given.
      it(`AC-1: ${root} with ${label(flags)} MAIN runs on ${flags.reqFilter ? (flags.sds ? "the --req-filter IDs, not the SDS @req set" : "the --req-filter IDs") : flags.sds ? "the SDS @req set" : "the confirmed open work"}`, () => {
        const main = fns().find((f) => f.name === "MAIN")?.lines ?? [];
        const init = main.findIndex((line) => line.trim().startsWith(STATE_INIT));
        expect(init, `${root}: MAIN builds the state from req_ids`).toBeGreaterThan(0);
        const load = main.findIndex((line) => code(line) === FIND_SESSION);
        expect(load, `${root}: MAIN's resume load`).toBeGreaterThan(0);
        expect(reached(main, load, flags), `${root}: the resume load`).toBe(flags.resume);
        const resolving = main.filter((line, at) => /RESOLVE_REQ_SET\(|LOAD_OR_INIT_STATE\(|HALT_ON_IDS_OUTSIDE_SDS\(/.test(line) && reached(main, at, flags));
        if (flags.resume) {
          expect(resolving.map((line) => line.trim()), `${root}: a resume re-resolves the set`).toEqual([]);
          return;
        }
        const assigned = main
          .slice(0, init)
          .flatMap((line, at) => (/^\s*req_ids = /.test(line) && reached(main, at, flags) ? [code(line).replace(/^req_ids = /, "")] : []));
        const expected = flags.sds ? (flags.reqFilter ? "args.req_filter" : "sds.req_ids") : "RESOLVE_REQ_SET(args)";
        expect(assigned.at(-1), `${root}: the last req_ids assignment reached`).toBe(expected);
        const spawn = pmSkill(root).split("\n").filter((line) => line.includes(CODER_SPAWN_MARK));
        expect(spawn, `${root}: the kiwi-coder spawn line`).toHaveLength(1);
        expect(spawn[0], `${root}: kiwi-coder gets state.req_ids`).toContain(CODER_SET);
      });

      // @req FR-FLOW-211 AC-2 — with --sds and --req-filter an ID outside the SDS stops the run before the gate and kiwi-coder.
      it(`AC-2: ${root} with ${label(flags)} MAIN ${flags.sds && flags.reqFilter && !flags.resume ? "stops" : "does not check"} on a --req-filter ID outside the SDS`, () => {
        const main = fns().find((f) => f.name === "MAIN")?.lines ?? [];
        const check = main.findIndex((line) => line.trim() === OUTSIDE_SDS_CHECK);
        expect(check, `${root}: the outside-SDS check line`).toBeGreaterThan(0);
        expect(reached(main, check, flags)).toBe(flags.sds && flags.reqFilter && !flags.resume);
        const assign = main.findIndex((line, at) => /^\s*req_ids = args\.req_filter$/.test(code(line)) && reached(main, at, { sds: true, reqFilter: true, resume: false }));
        expect(check, `${root}: the check comes before the set is replaced`).toBeLessThan(assign);
        expect(check).toBeLessThan(main.findIndex((line) => line.includes("APPLY_LIFECYCLE_GATE(")));
        expect(check).toBeLessThan(main.findIndex((line) => line.includes("# T-run")));
      });

      // @req FR-FLOW-211 AC-1 AC-3 — the gate and the promotion each read the set on every run, by ID under --req-filter.
      it(`AC-1: ${root} with ${label(flags)} the gate and the promotion read ${flags.reqFilter ? "by ID" : "the set"}`, () => {
        for (const name of ["APPLY_LIFECYCLE_GATE", "T_FINAL_SRS_MUTATION"]) {
          const lines = fns().find((f) => f.name === name)?.lines ?? [];
          expect(lines.length, `${root}: no ${name}`).toBeGreaterThan(0);
          const reads = lines.flatMap((line, at) => (READ.test(code(line)) && /MCP_CALL/.test(line) && reached(lines, at, flags) ? [line.trim()] : []));
          const byId = reads.filter((line) => BY_ID_READ.test(line));
          expect(byId.filter((line) => line !== READ_BY_ID), `${root}: ${name} by-ID read`).toEqual([]);
          expect((flags.reqFilter ? byId : reads).length, `${root}: ${name} reads nothing`).toBeGreaterThan(0);
        }
      });
    }

    // @req FR-FLOW-211 AC-1 — whenever the gate reads by `target`, the same run bound it.
    // @req FR-FLOW-211 AC-1 AC-3 — verify r6: the empty-active-target stop hit --sds with --req-filter before
    // the by-ID read. It stops exactly the runs without --req-filter, as it did before (AC-3).
    for (const flags of COMBINATIONS) {
      it(`AC-1 AC-3: ${root} with ${label(flags)} an empty active target ${flags.reqFilter ? "does not stop" : "stops"} the gate`, () => {
        const lines = fns().find((f) => f.name === "APPLY_LIFECYCLE_GATE")?.lines ?? [];
        const halt = lines.findIndex((line) => line.includes(TARGET_EMPTY_HALT));
        expect(halt, `${root}: the empty-active-target stop`).toBeGreaterThan(0);
        expect(reached(lines, halt, flags)).toBe(!flags.reqFilter);
      });
    }

    // @req FR-FLOW-211 AC-1 — the run_id of a --req-filter run is defined without an active target, and --sds with --req-filter is its own run.
    it(`AC-1: ${root} §0.14 defines the run_id of every flag combination`, () => {
      const row = lineOf(pmSkill(root), "| §0.14 |");
      expect(row, `${root}: <target> without an active target`).toContain(RUN_ID_TARGET);
      expect(row, `${root}: --sds with --req-filter`).toContain(RUN_ID_BOTH);
    });

    it(`AC-1: ${root} lifecycle gate binds target on every run that reads by it`, () => {
      const lines = fns().find((f) => f.name === "APPLY_LIFECYCLE_GATE")?.lines ?? [];
      const binds = lines.flatMap((line, at) => (/^\s*target = .*get_active_target/.test(line) ? [at] : []));
      expect(binds.length, `${root}: the target binding`).toBeGreaterThan(0);
      for (const flags of COMBINATIONS) {
        const usesTarget = lines.some((line, at) => /target=target|--target \{target\}/.test(line) && reached(lines, at, flags));
        if (usesTarget) expect(binds.some((at) => reached(lines, at, flags)), `${root}: ${label(flags)} reads by an unbound target`).toBe(true);
      }
    });

    // @req FR-FLOW-211 AC-1 — the silent skip of another target's requirement is gone.
    it(`AC-1: ${root} no longer skips a requirement outside the active target without a word`, () => {
      expect(pmText(root)).not.toContain(RETIRED_SKIP);
    });

    // @req FR-FLOW-211 AC-1 AC-4 — the statements of the read path name the by-ID read.
    const text = (): string => pmText(root);
    const STATEMENTS: ReadonlyArray<readonly [string, () => string, string]> = [
      ["§0.12 PM read list (the call SSOT)", () => /read \d+종: ([^.]+)\./.exec(lineOf(pmSkill(root), "| §0.12 |"))?.[1] ?? "", "`get_requirement`"],
      ["the intro's lifecycle-gate clause", () => /PM 은 부팅 시[^,]*,/.exec(pmSkill(root))?.[0] ?? "", "`get_requirement`"],
      ["§4 opening sentence", () => lineOf(text(), "부팅 T0 단계 — "), "`get_requirement`"],
      ["§4 opening: a --sds run given --req-filter reads by ID", () => lineOf(text(), "부팅 T0 단계 — "), BOTH_FLAGS],
      ["§4.4 MCP read", () => lineOf(text(), "1. `mcp__speckiwi__list_requirements(target"), "`mcp__speckiwi__get_requirement(id)`"],
      ["the call table's get_requirement row", () => lineOf(text(), "| `get_requirement` (read) | **kiwi-pm** |"), "T0 / T-final"],
      // verify r3: §6.2 named the SDS @req set as the promotion's set even when --req-filter was given beside --sds.
      ["§6.2 the promotion's set", () => lineOf(text(), "**문제**: kiwi-coder 는 `update_status(in_progress)`"), "요구 집합(`--sds` 면 SDS `@req` 집합, `--req-filter` 도 주면 그 ID)을 일괄 마무리한다"],
      ["§4.1 the empty-target row", () => lineOf(text(), "| target 비어있음 "), "(`--req-filter` 실행은 제외)"],
      ["§9 responsibility 1",() => lineOf(text(), "1. **부팅 입력 확정 + lifecycle gate**"), "`get_requirement`"],
      ...(root === "skills/claude"
        ? ([["§4.4 CLI fallback", () => lineOf(text(), "2. 실패 시 `speckiwi list --target"), "`speckiwi show <ID> --json`"]] as const)
        : []),
    ];
    for (const [statement, extract, needle] of STATEMENTS) {
      it(`AC-1: ${root} ${statement} names the by-ID read`, () => {
        expect(extract(), `${root}: ${statement}`).toContain(needle);
      });
    }
  }
});

// The recorded sites: the FR-FLOW-211 denominator. Generated; read the diff whenever it changes.
// <recorded-sites>
const RECORDED_SITES: Record<string, string[]> = {
  "skills/claude": [
    "kiwi-pm/SKILL.md\tprose\tdescription: \"요구 ID 집합(--req-filter, 없으면 활성 target 의 열린 작업 후보를 확인받는다)을 입력으로 받아 — SDS 는 사용자가 --sds <path>(별칭 SDS_PATH=)로 줄 때만 쓴다 — 그 작업을 격리된 Agent 서브에이전트(kiwi-coder) 실행 하나로 구현시키는 runner v0.1 — 호출 하나 = kiwi-coder 실행 하나. 3상태 프로토콜(TASK_DONE / NEEDS_USER / FAILED) 로 메인 세션과 대화하며, 부팅 시 Stability lifecycle gate(evolving/stable 만 진행 — --sds 면 speckiwi sds check 도), 종료 시 요구 집합 중 테스트 충분성 gap 이 없는 요구의 implemented 승급 + add_completed_work(req-summary — --sds 면 sds-summary), doculight MCP 가용 시 보고서 표시, 단독 실행이면 끝에서 항상 kiwi-review-fix-loop 로 넘긴다. --auto 시 severity 가드레일(clarification 자동 / business-decision 서브에이전트 자동 결정 — confidence ≥ 0.7 미만 시 critical 격상 / rollback-confirmation 자동승인, SSOT `_shared/kiwi/auto-option.md` §4). `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 지정 전파. --resume 재개 가능. 트리거 — SDS 구현, SDS 돌려, kiwi pm, kiwi 코더 실행, 자동 코딩 실행, sds 실행, coder runner. 범위 외 — SRS/feasibility/SDS 작성 스킬 호출 안 함(`--sds` 실행의 §6.4.1 `kiwi-sds --close` 마감 호출만 예외), /snoworca-* 호출 절대 금지.\"",
    "kiwi-pm/SKILL.md\tprose\t요구 ID 집합(`--req-filter`)을 입력으로 받아 — 사용자가 `--sds <path>` 로 SDS 를 주면 그 SDS 를 — 격리된 `Agent` 서브에이전트(`kiwi-coder`) 실행 하나로 구현시키는 runner. 호출 하나가 실행 단위다 — PM 은 요구 집합이나 SDS 를 나누거나 합치지 않는다.",
    "kiwi-pm/SKILL.md\tprose\tPM 자체는 read-only orchestrator 에 가깝다 — 구현/TDD/회귀/MCP mutation 4종 중 3종은 자식 `kiwi-coder` 전권. PM 은 부팅 시 요구 집합을 확정하고(`--sds` 면 `check_sds` 로 SDS 를 검사하고) speckiwi read(요구 집합 실행은 요구마다 `get_requirement`)로 Stability lifecycle gate 적용하고, 실행이 끝나면 T-final 단계에서 `update_status(\"implemented\")` + `add_completed_work(req-summary)`(`--sds` 면 `add_completed_work(sds-summary)`) 2종 mutation 으로 마무리한다. 보고서는 `Agent` 가용 시 doculight MCP `open_markdown` 으로 표시.",
    "kiwi-pm/SKILL.md\tprose\t- **요구는 ID 로 읽는다** — `--req-filter` 의 요구는 하나씩 `get_requirement` 로 읽는다. 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다 (§1.1).",
    "kiwi-pm/SKILL.md\tprose\t| §0.2 | **작업 입력 SSOT**. 기본 입력은 요구 ID 집합이다(`--req-filter <REQ-ID,...>`, 없으면 활성 target 의 열린 작업 후보 — §1.1). SDS 는 사용자가 `--sds <path>`(별칭 `SDS_PATH=<path>`)로 주거나 말로 요청할 때만 쓴다 — opt-in 이 없으면 SDS 를 쓰지 않고 SDS 로 구현하지도 않는다. `docs/sds/` 에 SDS 가 있다는 것만으로는 요청이 아니다(§1.1). SDS 를 받으면 그것은 `/kiwi-sds` 가 합의한 lite SDS 한 파일이다 — `docs/sds/<sds-id>.sds.md`, `Profile = lite`, Status `agreed`, `speckiwi sds check` error 0. 문법과 진단 코드는 `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 가 정본이며 본 스킬에 다시 적지 않는다. 위반 시 §7.1 입력 무결성 게이트 차단. PM 도 자식도 SDS 를 고치지 않는다 — 설계가 틀렸으면 NEEDS_USER 로 올린다 |",
    "kiwi-pm/SKILL.md\tprose\t| §0.12 | **MCP 호출 분담 + 시그니처 SSOT** — speckiwi MCP 실제 schema 기준. PM 호출 2종: (a) `update_status(id, status)` — T-final 조건부 implemented 승급, dryRun 옵션 없음. (b) `add_completed_work(date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun])` — T-final sds-summary, sds_id 같은 임의 필드는 summary 텍스트에 인코딩. read 4종: `get_active_target` / `get_requirement` / `list_requirements` / `check_sds`. 자식 kiwi-coder 4종 mutation: `add_trace_link(id, type, reference, relation)` / `add_verification_evidence(id, type, reference, [covers, notes])` / `update_status(id, status=\"in_progress\")` / `add_completed_work(date, summary, ...)`. doculight MCP: `open_markdown` / `update_markdown` (§6.3) |",
    "kiwi-pm/SKILL.md\tprose\t| §0.14 | **세션 id SSOT**. SDS 없는 실행의 `run_id` 는 `--run-id <id>`, 없으면 `<target>-<정렬한 REQ ID 의 sha256 앞 8 hex>`. `<target>` 은 활성 target 의 이름이고, 활성 target 이 없으면 `none` 이다(`--req-filter` 실행은 활성 target 없이도 돈다). 그 `run_id` 의 세션이 있고 끝나지 않았으면 이어서 돌고, 끝났으면 다음 빈 접미사 `<run_id>-2`, `-3`, … 를 쓴다. `--sds` 면 `run_id` = sds-id(SDS 파일 이름에서 `.sds.md` 를 뺀 값) — work-order 와 세션 해석기가 sds-id 로 세션을 찾는다. `--sds` 와 `--req-filter` 를 함께 주면 `run_id` 는 `<sds-id>-<정렬한 REQ ID 의 sha256 앞 8 hex>` 다 — 같은 SDS 에 다른 요구를 준 두 실행은 다른 run 이다. SDS 없는 실행에는 SDS sha pin 도 `sha-mismatch-on-resume` 의 SDS 경우도 없다. `run_id` = `[a-z0-9.-]{4,128}` — 벗어나면 §7.1 차단. 이 정규식은 **세션 식별자** 전용이며 **이벤트 emit 키**에는 **적용하지 않는다** — 재진입 emit 키 `{run_id}#r{n}` 는 다른 id 공간이다(`pipeline-event.md` §5.4) |",
    "kiwi-pm/SKILL.md\tprose\t| 요구 집합이 비었음 — `--req-filter` 의 ID 가 없거나 Stability gate 뒤 남은 요구가 없음 (§4) | HALT |",
    "kiwi-pm/SKILL.md\tprose\t`update_status` 가 REQ status 를 역방향 (예: `implemented → in_progress`) 으로 전이시키는 호출은 PM 측에서 차단 + 경고. forward only (planned/in_progress → implemented) 만 허용.",
    "kiwi-pm/SKILL.md\tprose\t| `t-final-backward-transition` | `update_status` REQ status 역방향 전이 (§0.G5) | §0.G5 |",
    "kiwi-pm/SKILL.md\tprose\t- **`--req-filter <REQ-ID,...>`** — 구현할 요구 ID 집합. 없으면 활성 target 의 열린 작업 후보(`list_requirements` 의 `planned` · `in_progress` 요구)를 집합으로 출력하고 kiwi-coder 를 띄우기 전에 사용자 게이트에서 확인받는다(`--auto` 면 결정 위원회가 정한다, `_shared/kiwi/auto-option.md`). 확인된 집합은 `pm-state.json` 의 `req_ids` 로 기록한다. `--req-filter` 가 있으면 lifecycle gate 와 T-final `implemented` 승급은 집합의 요구를 하나씩 `get_requirement` 로 ID 로 읽는다 — 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다. `--req-filter` 의 ID 가운데 `get_requirement` 가 찾지 못하는 것이 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다. `--sds` 와 함께 주면 실행 집합(gate · kiwi-coder 에 넘기는 요구 · 승급)은 `--req-filter` 의 ID 이고 SDS 는 그 요구들의 설계만 준다 — SDS 의 `@req` 에 없는 ID 가 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다. SDS 가 없다는 이유로 멈추지 않는다.",
    "kiwi-pm/SKILL.md\tprose\t| \"이 요구들 구현\", \"X 구현\", \"REQ 구현\" | `--req-filter <REQ-ID,...>` | 활성 target 의 열린 작업 후보 — 사용자 게이트에서 확인 (§1.1) |",
    "kiwi-pm/SKILL.md\tprose\t/kiwi-pm [--req-filter <REQ-ID,...>]      # 기본 입력 — 없으면 열린 작업 후보를 확인받는다 (§1.1)",
    "kiwi-pm/SKILL.md\tprose\t| speckiwi REQ status `implemented` 승급 | T-final mutation | PM (조건부) |",
    "kiwi-pm/SKILL.md\tprose\t`.kiwi/sessions/{run_id}/` — kiwi-coder 의 `.kiwi/` 영역을 공유. `run_id` 는 §0.14 가 정한다(`--sds` 면 sds-id, `--sds` 와 `--req-filter` 면 `<sds-id>-<sha8>`).",
    "kiwi-pm/SKILL.md\tprose\t\"target_slug\": \"4.0.0\",",
    "kiwi-pm/SKILL.md\tprose\t\"req_filter\": null,",
    "kiwi-pm/SKILL.md\tprose\t- `req_ids` — 확인된 요구 집합(§1.1, `--sds` 면 부팅 시 `check_sds` 요약에서 옮긴 SDS `@req` 집합, `--req-filter` 도 주면 그 ID), `req_filter` — `--req-filter` 로 받은 ID 목록(없으면 `null`) — gate · T-final 의 ID 분기와 재개가 이 값으로 갈린다, `write_set` — `--sds` 면 SDS 쓰기 집합(Files 경로 ∪ Test Plan 테스트 파일), SDS 없는 실행은 kiwi-coder 가 보고한 변경 경로(실행 뒤 채운다)",
    "kiwi-pm/SKILL.md\tcode\tstate = LOAD_STATE(FIND_SESSION(args))   # --run-id, 없으면 재개 호출의 --sds · --req-filter 로 다시 계산한 run_id (§0.14). 못 찾으면 HALT 하고 --run-id 를 묻는다",
    "kiwi-pm/SKILL.md\tcode\tIF args.req_filter:                      # §1.1 — 두 플래그면 실행 집합은 --req-filter 의 ID, SDS 는 그 요구들의 설계만 준다",
    "kiwi-pm/SKILL.md\tcode\tHALT_ON_IDS_OUTSIDE_SDS(args.req_filter, sds.req_ids)   # SDS @req 에 없는 --req-filter ID 를 적고 kiwi-coder 전에 멈춘다",
    "kiwi-pm/SKILL.md\tcode\treq_ids = args.req_filter",
    "kiwi-pm/SKILL.md\tcode\treq_ids = RESOLVE_REQ_SET(args)          # §1.1 — --req-filter 또는 열린 작업 후보 + 사용자 게이트",
    "kiwi-pm/SKILL.md\tcode\tstate = LOAD_OR_INIT_STATE(sds, req_ids, args)   # §0.14 run_id · base_sha · req_filter 기록",
    "kiwi-pm/SKILL.md\tcode\tIF state.req_filter: HALT_ON_MISSING_IDS(state.req_filter)   # §1.1 — 처음 실행과 재개가 같은 확인을 부른다: ID 마다 get_requirement, 찾지 못한 ID 를 적고 kiwi-coder 전에 멈춘다",
    "kiwi-pm/SKILL.md\tcode\tT_FINAL_SRS_MUTATION(state, args)            # update_status implemented + add_completed_work(req-summary | sds-summary)",
    "kiwi-pm/SKILL.md\tcode\tmissing = [id FOR id IN ids IF MCP_CALL(get_requirement, id=id) IS NOT_FOUND]",
    "kiwi-pm/SKILL.md\tcode\tIF missing: HALT(f\"--req-filter 의 요구를 찾지 못함: {missing}\")   # kiwi-coder 를 띄우기 전",
    "kiwi-pm/SKILL.md\tprose\t- TARGET={state.target_slug}           # lifecycle gate 일관성 확인용",
    "kiwi-pm/SKILL.md\tprose\targs=\"--req-filter {state.req_ids 를 쉼표로 이음}{(' --sds ' + state.sds_path) if state.sds_path else ''} RUN_ID={state.run_id} SPAWN_CONTEXT=pm-child\\",
    "kiwi-pm/SKILL.md\tprose\t부팅 T0 단계 — `--req-filter` 가 있으면 `--sds` 실행도 요구 집합 실행처럼 읽는다. 요구 집합(§2.2 `req_ids`)을 평가한다 — 요구 집합 실행은 요구마다 `get_requirement` 로 ID 로 읽고(§1.1), `--sds` 실행은 1회 `list_requirements` read 로 일괄 평가한다. `--skip-lifecycle-gate` 명시 시 SKIP (사용자 책임, worklog `lifecycle_override` 기록).",
    "kiwi-pm/SKILL.md\tprose\t| target 비어있음 (`--req-filter` 실행은 제외) | — | **차단** + \"speckiwi `set_active_target` 으로 활성 target 지정 후 재실행\" |",
    "kiwi-pm/SKILL.md\tprose\t- target 비어있음 → HALT (`--req-filter` 실행은 제외)",
    "kiwi-pm/SKILL.md\tprose\t1. `mcp__speckiwi__list_requirements(target, projection: \"compact\")` 호출 시도 — 요구 집합 실행은 요구마다 `mcp__speckiwi__get_requirement(id)`",
    "kiwi-pm/SKILL.md\tcode\tIF state.sds_path OR NOT state.req_filter:    # 1. 활성 target 확인 — --sds 없는 --req-filter 실행은 요구를 ID 로 읽으므로 활성 target 에 매이지 않는다 (§1.1)",
    "kiwi-pm/SKILL.md\tcode\ttarget = MCP_CALL_OR_CLI(\"get_active_target\", fallback_cli=\"speckiwi active-target --json\")",
    "kiwi-pm/SKILL.md\tcode\tIF NOT state.req_filter:                  # 활성 target 이 없어 멈추는 것은 --req-filter 없는 실행뿐 (§1.1)",
    "kiwi-pm/SKILL.md\tcode\tHALT(\"활성 target 없음. speckiwi set_active_target 으로 지정 후 재실행\")",
    "kiwi-pm/SKILL.md\tcode\tIF target != state.target_slug AND state.target_slug:",
    "kiwi-pm/SKILL.md\tcode\tAskUserQuestion(f\"SDS target={state.target_slug} vs 활성 target={target} 불일치 — 진행?\")",
    "kiwi-pm/SKILL.md\tcode\t# 2. read — 대상은 요구 집합(req_ids). --req-filter 실행과 요구 집합 실행은 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/SKILL.md\tcode\tIF state.sds_path AND NOT state.req_filter:",
    "kiwi-pm/SKILL.md\tcode\treqs = MCP_CALL(list_requirements, target=target, projection=\"compact\")",
    "kiwi-pm/SKILL.md\tcode\treqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/SKILL.md\tprose\t재개는 pm-state 의 `req_ids` · `req_filter` · `sds_path` 로 돈다 — 재개 호출이 `--req-filter` 나 `--sds` 를 다시 주지 않아도 gate · kiwi-coder · T-final 은 처음 실행과 같은 집합을 같은 방식으로 읽고, 재개 호출의 인자가 이 값을 덮어쓰지 않는다.",
    "kiwi-pm/SKILL.md\tprose\t재개할 세션은 `--run-id` 로, 없으면 재개 호출이 준 `--sds` · `--req-filter` 로 §0.14 의 공식을 다시 계산한 `run_id` 로 찾는다(`--sds` 와 `--req-filter` → `<sds-id>-<sha8>`, `--sds` 만 → sds-id, `--req-filter` 만 → `<target>-<sha8>`) — 찾으면 MAIN 은 집합을 다시 정하지 않고(열린 작업 후보 제안과 사용자 게이트 없음) 저장된 값으로 돌며, 찾지 못하면 새 실행을 시작하지 않고 멈춰 `--run-id` 를 묻는다.",
    "kiwi-pm/SKILL.md\tprose\t**SDS 없는 실행**: `req_ids` 의 요구마다 `speckiwi coverage --tests --ids <그 요구>` (MCP `check_test_sufficiency`) 가 gap 을 보고하지 않고 그것을 인용한 테스트가 통과한 요구만 `implemented` 로 올리고, 나머지는 gap 과 함께 보고한다. `add_completed_work` 는 그 집합으로 기록하며 요약 종류는 `req-summary` 다. `--no-final` 이면 종전처럼 건너뛴다. 아래 의사코드가 두 경우를 함께 적는다 — `covered` 가 SDS 없는 실행의 coverage 조건이다.",
    "kiwi-pm/SKILL.md\tprose\t**문제**: kiwi-coder 는 `update_status(in_progress)` 만 호출한다. 한 SDS 가 여러 요구를 구현하고 한 요구가 여러 SDS 에 걸칠 수 있어 자식 시야에서는 `implemented` 승급을 판단할 수 없다. PM 이 실행이 끝난 뒤 요구 집합(`--sds` 면 SDS `@req` 집합, `--req-filter` 도 주면 그 ID)을 일괄 마무리한다.",
    "kiwi-pm/SKILL.md\tcode\t# 1. read REQ 현재 status — --req-filter 실행과 요구 집합 실행은 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/SKILL.md\tcode\tIF state.sds_path AND NOT state.req_filter:",
    "kiwi-pm/SKILL.md\tcode\treqs = MCP_CALL(list_requirements, target=state.target_slug, projection=\"compact\")",
    "kiwi-pm/SKILL.md\tcode\treqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/SKILL.md\tcode\tSTATUS_ORDER = [\"planned\", \"in_progress\", \"implemented\", \"verified\"]",
    "kiwi-pm/SKILL.md\tcode\tIF NOT req: CONTINUE   # --req-filter 없는 --sds 실행: SDS 가 가리키지만 활성 target 에 없는 REQ — 무시 (--req-filter 실행은 부팅에서 없는 ID 로 멈춘다)",
    "kiwi-pm/SKILL.md\tcode\ttarget_idx = STATUS_ORDER.index(\"implemented\")",
    "kiwi-pm/SKILL.md\tcode\tproposals.append({ req_id: req_id, from: req.status, to: \"implemented\" })",
    "kiwi-pm/SKILL.md\tcode\tf\"T-final 제안: {len(proposals)} 개 REQ 를 implemented 로 승급?\",",
    "kiwi-pm/SKILL.md\tcode\t# speckiwi `update_status` MCP schema (SSOT): { id: string, status: string } — 그 외 인자 없음 (dryRun 미지원)",
    "kiwi-pm/SKILL.md\tcode\tworklog.append({event: \"t_final_dryrun_only\", req_id: p.req_id, kind: \"update_status\"})",
    "kiwi-pm/SKILL.md\tcode\tMCP_CALL(update_status, id=p.req_id, status=\"implemented\")",
    "kiwi-pm/SKILL.md\tcode\tts: NOW(), kind: \"update_status\", req_id: p.req_id,",
    "kiwi-pm/SKILL.md\tcode\tfrom: p.from, to: \"implemented\", dry_run: is_pm_dry_run",
    "kiwi-pm/SKILL.md\tcode\ttarget=state.target_slug,",
    "kiwi-pm/SKILL.md\tprose\t| `update_status` | `id, status` | — | 본 호출에 `dryRun` 옵션 없음. PM 의 --dry-run flag 시 호출 자체를 skip |",
    "kiwi-pm/SKILL.md\tprose\t**실행이 성공으로 끝나지 않았을 때** (실패·차단) 해당 REQ 의 `all_done == False` → `update_status` 호출 안 함 (REQ 는 in_progress 또는 blocked 그대로 유지). `add_completed_work(req-summary)` · `add_completed_work(sds-summary)` 도 skip. 보고서 §6.3 에서 미완료 REQ 목록을 명시.",
    "kiwi-pm/SKILL.md\tprose\targs=\"--req-filter {state.req_ids 를 쉼표로 이음}\\",
    "kiwi-pm/SKILL.md\tprose\t- `--req-filter` 는 이 실행의 요구 범위를 넘긴다(`--sds` 실행은 `--sds` 도) — review-fix-loop 의 마지막 단계인 테스트 충분성 확인(`_shared/kiwi/test-sufficiency.md`)이 이 실행의 범위를 본다.",
    "kiwi-pm/SKILL.md\tprose\t- `--close-reqs` 는 실행이 `done` 으로 끝나 T-final 이 요구를 `implemented` 로 올렸을 때(`CLOSE_SAFE`) — `--sds` 실행은 옮기기도 끝났을 때(`MOVED`) — 만 붙인다. 실행이 `failed` 이거나 critical 로 격상된 NEEDS_USER 가 남은 채로 `--close-reqs` 를 붙이는 것은 §0.G7 `followup-review-fix-loop-close-unsafe` 가 막는다 — 되감을 수 없는 `verified` 를 향하기 때문이며 `--auto` 도 이 멈춤을 덮지 못한다. 그 경우에도 hand-off 는 `--close-reqs` 없이 돈다.",
    "kiwi-pm/SKILL.md\tprose\t- PM 자체는 `update_status(\"verified\")` 를 호출하지 않는다 — verified 전이는 review-fix-loop §6.6 의 몫이다 (§0.12 mutation 분담 SSOT 불변).",
    "kiwi-pm/SKILL.md\tprose\targs=\"--req-filter {state.req_ids 를 쉼표로 이음} --sds {state.sds_path}\\",
    "kiwi-pm/SKILL.md\tprose\t| `--req-filter` 의 ID 를 `get_requirement` 가 찾지 못함 — 처음 실행과 재개 모두 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
    "kiwi-pm/SKILL.md\tprose\t| `--sds` 와 함께 준 `--req-filter` 의 ID 가 SDS `@req` 집합에 없음 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
    "kiwi-pm/SKILL.md\tprose\t| MCP 미가용 (T-final update_status) | `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내 |",
    "kiwi-pm/SKILL.md\tprose\t| `update_status` transition guard 거부 (MCP 응답 reject) | catch → `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내. 강제 우회 없음. (`update_status` MCP 에 dryRun 옵션 없음 — 사전 시뮬레이션 불가, 호출 시점에 거부 가능성 catch) |",
    "kiwi-pm/SKILL.md\tprose\t| 자식이 `update_status` backward 시도 | kiwi-coder §0.G5 자체 차단. PM 무대응 |",
    "kiwi-pm/SKILL.md\tprose\t/kiwi-pm --req-filter FR-TODO-001,FR-TODO-002",
    "kiwi-pm/SKILL.md\tprose\t1. **부팅 입력 확정 + lifecycle gate** — 요구 집합을 확정하고(`--sds` 면 `check_sds` 로 lite SDS 를 검사하고), speckiwi `get_requirement`(요구 집합 실행) 또는 `list_requirements` read 로 그 집합의 Stability ∈ {evolving, stable} 만 진행 허용 (§4)",
    "kiwi-pm/SKILL.md\tprose\t4. **T-final REQ status 마무리** — 실행이 성공으로 끝났으면 요구 집합(`--sds` 면 SDS `@req` 집합)에 `update_status(id, \"implemented\")` + `add_completed_work(date, summary, requirementIds, target, reportPaths)` (§6.2) — `--sds` 와 `--req-filter` 를 함께 주면 대상은 `--req-filter` 의 ID 다",
    "kiwi-pm/SKILL.md\tprose\t| `get_active_target` (read) | **kiwi-pm** | T0 lifecycle gate (`--sds` 없는 `--req-filter` 실행은 제외) | `{}` |",
    "kiwi-pm/SKILL.md\tprose\t| `get_requirement` (read) | **kiwi-pm** | T-1 `--req-filter` 확인 · T0 / T-final (`--req-filter` · 요구 집합 실행) | `{id}` |",
    "kiwi-pm/SKILL.md\tprose\t| `list_requirements` (read) | **kiwi-pm** | T-1 열린 작업 후보 · T0 / T-final (필터 없는 `--sds` 실행) | `{target?, status?, stability?, scope?, tag?, type?}` |",
    "kiwi-pm/SKILL.md\tprose\t| `update_status(in_progress)` | kiwi-coder (자식) | 실행 시작 시 | `{id, status: \"in_progress\"}` |",
    "kiwi-pm/SKILL.md\tprose\t| `update_status(\"implemented\")` | **kiwi-pm** | T-final, 실행이 성공으로 끝났을 때 (조건부, forward-only) | `{id, status: \"implemented\"}` (dryRun 인자 없음) |",
    "kiwi-pm/SKILL.md\tprose\t- `req_ids`: T-final 에서 `update_status(\"implemented\")` 호출한 REQ-ID 배열"
  ],
  "skills/codex": [
    "kiwi-pm/SKILL.md\tprose\tdescription: \"요구 ID 집합(--req-filter, 없으면 활성 target 의 열린 작업 후보를 확인받는다)을 입력으로 받아 — SDS 는 사용자가 --sds <path>(별칭 SDS_PATH=)로 줄 때만 쓴다 — 그 작업을 격리된 sub-agent(kiwi-coder) 실행 하나로 구현시키는 runner v0.1 — 호출 하나 = kiwi-coder 실행 하나. 3상태 프로토콜(TASK_DONE / NEEDS_USER / FAILED) 로 메인 세션과 대화하며, 부팅 시 Stability lifecycle gate(evolving/stable 만 진행 — --sds 면 speckiwi sds check 도), 종료 시 요구 집합 중 테스트 충분성 gap 이 없는 요구의 implemented 승급 + add_completed_work(req-summary — --sds 면 sds-summary), doculight MCP 가용 시 보고서 표시, 단독 실행이면 끝에서 항상 kiwi-review-fix-loop 로 넘긴다. --auto 는 공용 auto-option 정책으로 clarification/business-decision/rollback-confirmation 게이트를 자동 결정하되 critical_gates[] 는 항상 중단한다. `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 지정 전파. --resume 재개 가능. 트리거 — SDS 구현, SDS 돌려, kiwi pm, kiwi 코더 실행, 자동 코딩 실행, sds 실행, coder runner. 범위 외 — SRS/feasibility/SDS 작성 스킬 호출 안 함(`--sds` 실행의 §6.4.1 `kiwi-sds --close` 마감 호출만 예외), /snoworca-* 호출 절대 금지.\"",
    "kiwi-pm/SKILL.md\tprose\t요구 ID 집합(`--req-filter`)을 입력으로 받아 — 사용자가 `--sds <path>` 로 SDS 를 주면 그 SDS 를 — 격리된 sub-agent(`kiwi-coder`) 실행 하나로 구현시키는 runner. 호출 하나가 실행 단위다 — PM 은 요구 집합이나 SDS 를 나누거나 합치지 않는다.",
    "kiwi-pm/SKILL.md\tprose\tPM 자체는 read-only orchestrator 에 가깝다 — 구현/TDD/회귀/MCP mutation 4종 중 3종은 자식 `kiwi-coder` 전권. PM 은 부팅 시 요구 집합을 확정하고(`--sds` 면 `check_sds` 로 SDS 를 검사하고) speckiwi read(요구 집합 실행은 요구마다 `get_requirement`)로 Stability lifecycle gate 적용하고, 실행이 끝나면 T-final 단계에서 `update_status(\"implemented\")` + `add_completed_work(req-summary)`(`--sds` 면 `add_completed_work(sds-summary)`) 2종 mutation 으로 마무리한다. 보고서는 doculight MCP 가용 시 doculight MCP `open_markdown` 으로 표시.",
    "kiwi-pm/SKILL.md\tprose\t- **요구는 ID 로 읽는다** — `--req-filter` 의 요구는 하나씩 `get_requirement` 로 읽는다. 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다 (§1.1).",
    "kiwi-pm/SKILL.md\tprose\t| §0.2 | **작업 입력 SSOT**. 기본 입력은 요구 ID 집합이다(`--req-filter <REQ-ID,...>`, 없으면 활성 target 의 열린 작업 후보 — §1.1). SDS 는 사용자가 `--sds <path>`(별칭 `SDS_PATH=<path>`)로 주거나 말로 요청할 때만 쓴다 — opt-in 이 없으면 SDS 를 쓰지 않고 SDS 로 구현하지도 않는다. `docs/sds/` 에 SDS 가 있다는 것만으로는 요청이 아니다(§1.1). SDS 를 받으면 그것은 `$kiwi-sds` 가 합의한 lite SDS 한 파일이다 — `docs/sds/<sds-id>.sds.md`, `Profile = lite`, Status `agreed`, `speckiwi sds check` error 0. 문법과 진단 코드는 `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 가 정본이며 본 스킬에 다시 적지 않는다. 위반 시 `references/extended-workflow.md` §7.1 입력 무결성 게이트 차단. PM 도 자식도 SDS 를 고치지 않는다 — 설계가 틀렸으면 NEEDS_USER 로 올린다 |",
    "kiwi-pm/SKILL.md\tprose\t| §0.12 | **MCP 호출 분담 + 시그니처 SSOT** — speckiwi MCP 실제 schema 기준. PM 호출 2종: (a) `update_status(id, status)` — T-final 조건부 implemented 승급, dryRun 옵션 없음. (b) `add_completed_work(date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun])` — T-final sds-summary, sds_id 같은 임의 필드는 summary 텍스트에 인코딩. read 4종: `get_active_target` / `get_requirement` / `list_requirements` / `check_sds`. 자식 kiwi-coder 4종 mutation: `add_trace_link(id, type, reference, relation)` / `add_verification_evidence(id, type, reference, [covers, notes])` / `update_status(id, status=\"in_progress\")` / `add_completed_work(date, summary, ...)`. doculight MCP: `open_markdown` / `update_markdown` (§6.3) |",
    "kiwi-pm/SKILL.md\tprose\t| §0.14 | **세션 id SSOT**. SDS 없는 실행의 `run_id` 는 `--run-id <id>`, 없으면 `<target>-<정렬한 REQ ID 의 sha256 앞 8 hex>`. `<target>` 은 활성 target 의 이름이고, 활성 target 이 없으면 `none` 이다(`--req-filter` 실행은 활성 target 없이도 돈다). 그 `run_id` 의 세션이 있고 끝나지 않았으면 이어서 돌고, 끝났으면 다음 빈 접미사 `<run_id>-2`, `-3`, … 를 쓴다. `--sds` 면 `run_id` = sds-id(SDS 파일 이름에서 `.sds.md` 를 뺀 값) — work-order 와 세션 해석기가 sds-id 로 세션을 찾는다. `--sds` 와 `--req-filter` 를 함께 주면 `run_id` 는 `<sds-id>-<정렬한 REQ ID 의 sha256 앞 8 hex>` 다 — 같은 SDS 에 다른 요구를 준 두 실행은 다른 run 이다. SDS 없는 실행에는 SDS sha pin 도 `sha-mismatch-on-resume` 의 SDS 경우도 없다. `run_id` = `[a-z0-9.-]{4,128}` — 벗어나면 §7.1 차단. 이 정규식은 **세션 식별자** 전용이며 **이벤트 emit 키**에는 **적용하지 않는다** — 재진입 emit 키 `{run_id}#r{n}` 는 다른 id 공간이다(`pipeline-event.md` §5.4) |",
    "kiwi-pm/SKILL.md\tprose\t| 요구 집합이 비었음 — `--req-filter` 의 ID 가 없거나 Stability gate 뒤 남은 요구가 없음 (§4) | HALT |",
    "kiwi-pm/SKILL.md\tprose\t`update_status` 가 REQ status 를 역방향 (예: `implemented → in_progress`) 으로 전이시키는 호출은 PM 측에서 차단 + 경고. forward only (planned/in_progress → implemented) 만 허용.",
    "kiwi-pm/SKILL.md\tprose\t- **`--req-filter <REQ-ID,...>`** — 구현할 요구 ID 집합. 없으면 활성 target 의 열린 작업 후보(`list_requirements` 의 `planned` · `in_progress` 요구)를 집합으로 출력하고 kiwi-coder 를 띄우기 전에 사용자 게이트에서 확인받는다(`--auto` 면 결정 위원회가 정한다, `../_shared/kiwi/auto-option.md`). 확인된 집합은 `pm-state.json` 의 `req_ids` 로 기록한다. `--req-filter` 가 있으면 lifecycle gate 와 T-final `implemented` 승급은 집합의 요구를 하나씩 `get_requirement` 로 ID 로 읽는다 — 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다. `--req-filter` 의 ID 가운데 `get_requirement` 가 찾지 못하는 것이 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다. `--sds` 와 함께 주면 실행 집합(gate · kiwi-coder 에 넘기는 요구 · 승급)은 `--req-filter` 의 ID 이고 SDS 는 그 요구들의 설계만 준다 — SDS 의 `@req` 에 없는 ID 가 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다. SDS 가 없다는 이유로 멈추지 않는다.",
    "kiwi-pm/SKILL.md\tprose\t| \"이 요구들 구현\", \"X 구현\", \"REQ 구현\" | `--req-filter <REQ-ID,...>` | 활성 target 의 열린 작업 후보 — 사용자 게이트에서 확인 (§1.1) |",
    "kiwi-pm/SKILL.md\tprose\t$kiwi-pm [--req-filter <REQ-ID,...>]      # 기본 입력 — 없으면 열린 작업 후보를 확인받는다 (§1.1)",
    "kiwi-pm/SKILL.md\tprose\t| speckiwi REQ status `implemented` 승급 | T-final mutation | PM (조건부) |",
    "kiwi-pm/SKILL.md\tprose\t`.kiwi/sessions/{run_id}/` — kiwi-coder 의 `.kiwi/` 영역을 공유. `run_id` 는 §0.14 가 정한다(`--sds` 면 sds-id, `--sds` 와 `--req-filter` 면 `<sds-id>-<sha8>`).",
    "kiwi-pm/SKILL.md\tprose\t\"target_slug\": \"4.0.0\",",
    "kiwi-pm/SKILL.md\tprose\t\"req_filter\": null,",
    "kiwi-pm/SKILL.md\tprose\t- `req_ids` — 확인된 요구 집합(§1.1, `--sds` 면 부팅 시 `check_sds` 요약에서 옮긴 SDS `@req` 집합, `--req-filter` 도 주면 그 ID), `req_filter` — `--req-filter` 로 받은 ID 목록(없으면 `null`) — gate · T-final 의 ID 분기와 재개가 이 값으로 갈린다, `write_set` — `--sds` 면 SDS 쓰기 집합(Files 경로 ∪ Test Plan 테스트 파일), SDS 없는 실행은 kiwi-coder 가 보고한 변경 경로(실행 뒤 채운다)",
    "kiwi-pm/SKILL.md\tcode\tstate = LOAD_STATE(FIND_SESSION(args))   # --run-id, 없으면 재개 호출의 --sds · --req-filter 로 다시 계산한 run_id (§0.14). 못 찾으면 HALT 하고 --run-id 를 묻는다",
    "kiwi-pm/SKILL.md\tcode\tIF args.req_filter:                      # §1.1 — 두 플래그면 실행 집합은 --req-filter 의 ID, SDS 는 그 요구들의 설계만 준다",
    "kiwi-pm/SKILL.md\tcode\tHALT_ON_IDS_OUTSIDE_SDS(args.req_filter, sds.req_ids)   # SDS @req 에 없는 --req-filter ID 를 적고 kiwi-coder 전에 멈춘다",
    "kiwi-pm/SKILL.md\tcode\treq_ids = args.req_filter",
    "kiwi-pm/SKILL.md\tcode\treq_ids = RESOLVE_REQ_SET(args)          # §1.1 — --req-filter 또는 열린 작업 후보 + 사용자 게이트",
    "kiwi-pm/SKILL.md\tcode\tstate = LOAD_OR_INIT_STATE(sds, req_ids, args)   # §0.14 run_id · base_sha · req_filter 기록",
    "kiwi-pm/SKILL.md\tcode\tIF state.req_filter: HALT_ON_MISSING_IDS(state.req_filter)   # §1.1 — 처음 실행과 재개가 같은 확인을 부른다: ID 마다 get_requirement, 찾지 못한 ID 를 적고 kiwi-coder 전에 멈춘다",
    "kiwi-pm/SKILL.md\tcode\tT_FINAL_SRS_MUTATION(state, args)            # update_status implemented + add_completed_work(req-summary | sds-summary)",
    "kiwi-pm/SKILL.md\tcode\tmissing = [id FOR id IN ids IF MCP_CALL(get_requirement, id=id) IS NOT_FOUND]",
    "kiwi-pm/SKILL.md\tcode\tIF missing: HALT(f\"--req-filter 의 요구를 찾지 못함: {missing}\")   # kiwi-coder 를 띄우기 전",
    "kiwi-pm/SKILL.md\tprose\t- TARGET={state.target_slug}           # lifecycle gate 일관성 확인용",
    "kiwi-pm/SKILL.md\tprose\tUse $kiwi-coder with --req-filter {state.req_ids 를 쉼표로 이음}{(' --sds ' + state.sds_path) if state.sds_path else ''} RUN_ID={state.run_id} SPAWN_CONTEXT=pm-child{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{PASS_THROUGH_FLAGS}",
    "kiwi-pm/SKILL.md\tprose\t- target 비어있음 → HALT (`--req-filter` 실행은 제외)",
    "kiwi-pm/references/extended-workflow.md\tprose\t부팅 T0 단계 — `--req-filter` 가 있으면 `--sds` 실행도 요구 집합 실행처럼 읽는다. 요구 집합(`SKILL.md` §2.2 `req_ids`)을 평가한다 — 요구 집합 실행은 요구마다 `get_requirement` 로 ID 로 읽고(`SKILL.md` §1.1), `--sds` 실행은 1회 `list_requirements` read 로 일괄 평가한다. `--skip-lifecycle-gate` 명시 시 SKIP (사용자 책임, worklog `lifecycle_override` 기록).",
    "kiwi-pm/references/extended-workflow.md\tprose\t| target 비어있음 (`--req-filter` 실행은 제외) | — | **차단** + \"speckiwi `set_active_target` 으로 활성 target 지정 후 재실행\" |",
    "kiwi-pm/references/extended-workflow.md\tprose\t1. `mcp__speckiwi__list_requirements(target, projection: \"compact\")` 호출 시도 — 요구 집합 실행은 요구마다 `mcp__speckiwi__get_requirement(id)`",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path OR NOT state.req_filter:    # 1. 활성 target 확인 — --sds 없는 --req-filter 실행은 요구를 ID 로 읽으므로 활성 target 에 매이지 않는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget = MCP_CALL(\"get_active_target\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF NOT state.req_filter:                  # 활성 target 이 없어 멈추는 것은 --req-filter 없는 실행뿐 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tHALT(\"활성 target 없음. speckiwi set_active_target 으로 지정 후 재실행\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF target != state.target_slug AND state.target_slug:",
    "kiwi-pm/references/extended-workflow.md\tcode\tCodex clarification gate(f\"SDS target={state.target_slug} vs 활성 target={target} 불일치 — 진행?\")",
    "kiwi-pm/references/extended-workflow.md\tcode\t# 2. read — 대상은 요구 집합(req_ids). --req-filter 실행과 요구 집합 실행은 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path AND NOT state.req_filter:",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = MCP_CALL(list_requirements, target=target, projection=\"compact\")",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tprose\t재개는 pm-state 의 `req_ids` · `req_filter` · `sds_path` 로 돈다 — 재개 호출이 `--req-filter` 나 `--sds` 를 다시 주지 않아도 gate · kiwi-coder · T-final 은 처음 실행과 같은 집합을 같은 방식으로 읽고, 재개 호출의 인자가 이 값을 덮어쓰지 않는다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t재개할 세션은 `--run-id` 로, 없으면 재개 호출이 준 `--sds` · `--req-filter` 로 §0.14 의 공식을 다시 계산한 `run_id` 로 찾는다(`--sds` 와 `--req-filter` → `<sds-id>-<sha8>`, `--sds` 만 → sds-id, `--req-filter` 만 → `<target>-<sha8>`) — 찾으면 MAIN 은 집합을 다시 정하지 않고(열린 작업 후보 제안과 사용자 게이트 없음) 저장된 값으로 돌며, 찾지 못하면 새 실행을 시작하지 않고 멈춰 `--run-id` 를 묻는다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t**SDS 없는 실행**: `req_ids` 의 요구마다 `speckiwi coverage --tests --ids <그 요구>` (MCP `check_test_sufficiency`) 가 gap 을 보고하지 않고 그것을 인용한 테스트가 통과한 요구만 `implemented` 로 올리고, 나머지는 gap 과 함께 보고한다. `add_completed_work` 는 그 집합으로 기록하며 요약 종류는 `req-summary` 다. `--no-final` 이면 종전처럼 건너뛴다. 아래 의사코드가 두 경우를 함께 적는다 — `covered` 가 SDS 없는 실행의 coverage 조건이다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t**문제**: kiwi-coder 는 `update_status(in_progress)` 만 호출한다. 한 SDS 가 여러 요구를 구현하고 한 요구가 여러 SDS 에 걸칠 수 있어 자식 시야에서는 `implemented` 승급을 판단할 수 없다. PM 이 실행이 끝난 뒤 요구 집합(`--sds` 면 SDS `@req` 집합, `--req-filter` 도 주면 그 ID)을 일괄 마무리한다.",
    "kiwi-pm/references/extended-workflow.md\tcode\t# 1. read REQ 현재 status — --req-filter 실행과 요구 집합 실행은 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path AND NOT state.req_filter:",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = MCP_CALL(list_requirements, target=state.target_slug, projection=\"compact\")",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tSTATUS_ORDER = [\"planned\", \"in_progress\", \"implemented\", \"verified\"]",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF NOT req: CONTINUE   # --req-filter 없는 --sds 실행: SDS 가 가리키지만 활성 target 에 없는 REQ — 무시 (--req-filter 실행은 부팅에서 없는 ID 로 멈춘다)",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget_idx = STATUS_ORDER.index(\"implemented\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tproposals.append({ req_id: req_id, from: req.status, to: \"implemented\" })",
    "kiwi-pm/references/extended-workflow.md\tcode\tf\"T-final 제안: {len(proposals)} 개 REQ 를 implemented 로 승급?\",",
    "kiwi-pm/references/extended-workflow.md\tcode\t# speckiwi `update_status` MCP schema (SSOT): { id: string, status: string } — 그 외 인자 없음 (dryRun 미지원)",
    "kiwi-pm/references/extended-workflow.md\tcode\tworklog.append({event: \"t_final_dryrun_only\", req_id: p.req_id, kind: \"update_status\"})",
    "kiwi-pm/references/extended-workflow.md\tcode\tMCP_CALL(update_status, id=p.req_id, status=\"implemented\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tts: NOW(), kind: \"update_status\", req_id: p.req_id,",
    "kiwi-pm/references/extended-workflow.md\tcode\tfrom: p.from, to: \"implemented\", dry_run: is_pm_dry_run",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget=state.target_slug,",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status` | `id, status` | — | 본 호출에 `dryRun` 옵션 없음. PM 의 --dry-run flag 시 호출 자체를 skip |",
    "kiwi-pm/references/extended-workflow.md\tprose\t**실행이 성공으로 끝나지 않았을 때** (실패·차단) 해당 REQ 의 `all_done == False` → `update_status` 호출 안 함 (REQ 는 in_progress 또는 blocked 그대로 유지). `add_completed_work(req-summary)` · `add_completed_work(sds-summary)` 도 skip. 보고서 §6.3 에서 미완료 REQ 목록을 명시.",
    "kiwi-pm/references/extended-workflow.md\tprose\tUse $kiwi-review-fix-loop with --req-filter {state.req_ids 를 쉼표로 이음}{' --close-reqs' if CLOSE_SAFE(state) else ''}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{' --skip-clean-code' if state.clean_code_skip is True else ' --keep-clean-code' if state.clean_code_skip is False else ''}",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `--req-filter` 는 이 실행의 요구 범위를 넘긴다(`--sds` 실행은 `--sds` 도) — review-fix-loop 의 마지막 단계인 테스트 충분성 확인(`../../_shared/kiwi/test-sufficiency.md`)이 이 실행의 범위를 본다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `--close-reqs` 는 실행이 `done` 으로 끝나 T-final 이 요구를 `implemented` 로 올렸을 때(`CLOSE_SAFE`) — `--sds` 실행은 옮기기도 끝났을 때(`MOVED`) — 만 붙인다. 실행이 `failed` 이거나 critical 로 격상된 NEEDS_USER 가 남은 채로 `--close-reqs` 를 붙이는 것은 §0.G7 `followup-review-fix-loop-close-unsafe` 가 막는다 — 되감을 수 없는 `verified` 를 향하기 때문이며 `--auto` 도 이 멈춤을 덮지 못한다. 그 경우에도 hand-off 는 `--close-reqs` 없이 돈다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t- PM 자체는 `update_status(\"verified\")` 를 호출하지 않는다 — verified 전이는 review-fix-loop 의 몫이다 (`SKILL.md` §0.12 mutation 분담 SSOT 불변).",
    "kiwi-pm/references/extended-workflow.md\tprose\tUse $kiwi-review-fix-loop with --req-filter {state.req_ids 를 쉼표로 이음} --sds {state.sds_path}{' --close-reqs' if MOVED else ''}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{' --skip-clean-code' if state.clean_code_skip is True else ' --keep-clean-code' if state.clean_code_skip is False else ''}",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `--req-filter` 의 ID 를 `get_requirement` 가 찾지 못함 — 처음 실행과 재개 모두 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `--sds` 와 함께 준 `--req-filter` 의 ID 가 SDS `@req` 집합에 없음 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| MCP 미가용 (T-final update_status) | `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status` transition guard 거부 (MCP 응답 reject) | catch → `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내. 강제 우회 없음. (`update_status` MCP 에 dryRun 옵션 없음 — 사전 시뮬레이션 불가, 호출 시점에 거부 가능성 catch) |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| 자식이 `update_status` backward 시도 | kiwi-coder §0.G5 자체 차단. PM 무대응 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t$kiwi-pm --req-filter FR-TODO-001,FR-TODO-002",
    "kiwi-pm/references/extended-workflow.md\tprose\t1. **부팅 입력 확정 + lifecycle gate** — 요구 집합을 확정하고(`--sds` 면 `check_sds` 로 lite SDS 를 검사하고), speckiwi `get_requirement`(요구 집합 실행) 또는 `list_requirements` read 로 그 집합의 Stability ∈ {evolving, stable} 만 진행 허용 (§4)",
    "kiwi-pm/references/extended-workflow.md\tprose\t4. **T-final REQ status 마무리** — 실행이 성공으로 끝났으면 요구 집합(`--sds` 면 SDS `@req` 집합)에 `update_status(id, \"implemented\")` + `add_completed_work(date, summary, requirementIds, target, reportPaths)` (§6.2) — `--sds` 와 `--req-filter` 를 함께 주면 대상은 `--req-filter` 의 ID 다",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `get_active_target` (read) | **kiwi-pm** | T0 lifecycle gate (`--sds` 없는 `--req-filter` 실행은 제외) | `{}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `get_requirement` (read) | **kiwi-pm** | T-1 `--req-filter` 확인 · T0 / T-final (`--req-filter` · 요구 집합 실행) | `{id}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `list_requirements` (read) | **kiwi-pm** | T-1 열린 작업 후보 · T0 / T-final (필터 없는 `--sds` 실행) | `{target?, status?, stability?, scope?, tag?, type?}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status(in_progress)` | kiwi-coder (자식) | 실행 시작 시 | `{id, status: \"in_progress\"}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status(\"implemented\")` | **kiwi-pm** | T-final, 실행이 성공으로 끝났을 때 (조건부, forward-only) | `{id, status: \"implemented\"}` (dryRun 인자 없음) |",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `req_ids`: T-final 에서 `update_status(\"implemented\")` 호출한 REQ-ID 배열"
  ],
  "skills/etc": [
    "kiwi-pm/SKILL.md\tprose\tdescription: \"OpenCode/Hermes local-LLM variant for running one requirement-ID set (--req-filter, or the open work candidates confirmed at a gate) through one kiwi-coder run — one invocation is one kiwi-coder run; an agreed kiwi-sds SDS (docs/sds/<sds-id>.sds.md) is used only when the user gives it with --sds <path> (alias SDS_PATH=). Requires speckiwi mcp for the lifecycle gate and completion updates (--sds adds the SDS check). Defaults to --max, uses one delegated worker at a time, does not use multi-worker fanout, and a standalone run always hands off to kiwi-review-fix-loop. Triggers: kiwi pm, SDS execution, coder runner.\"",
    "kiwi-pm/SKILL.md\tprose\t요구 ID 집합(`--req-filter`)을 입력으로 받아 — 사용자가 `--sds <path>` 로 SDS 를 주면 그 SDS 를 — 격리된 delegated worker(`kiwi-coder`) 실행 하나로 구현시키는 runner. 호출 하나가 실행 단위다 — PM 은 요구 집합이나 SDS 를 나누거나 합치지 않는다.",
    "kiwi-pm/SKILL.md\tprose\tPM 자체는 read-only orchestrator 에 가깝다 — 구현/TDD/회귀/MCP mutation 4종 중 3종은 자식 `kiwi-coder` 전권. PM 은 부팅 시 요구 집합을 확정하고(`--sds` 면 `check_sds` 로 SDS 를 검사하고) speckiwi read(요구 집합 실행은 요구마다 `get_requirement`)로 Stability lifecycle gate 적용하고, 실행이 끝나면 T-final 단계에서 `update_status(\"implemented\")` + `add_completed_work(req-summary)`(`--sds` 면 `add_completed_work(sds-summary)`) 2종 mutation 으로 마무리한다. 보고서는 doculight MCP 가용 시 doculight MCP `open_markdown` 으로 표시.",
    "kiwi-pm/SKILL.md\tprose\t- **요구는 ID 로 읽는다** — `--req-filter` 의 요구는 하나씩 `get_requirement` 로 읽는다. 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다 (§1.1).",
    "kiwi-pm/SKILL.md\tprose\t| §0.2 | **작업 입력 SSOT**. 기본 입력은 요구 ID 집합이다(`--req-filter <REQ-ID,...>`, 없으면 활성 target 의 열린 작업 후보 — §1.1). SDS 는 사용자가 `--sds <path>`(별칭 `SDS_PATH=<path>`)로 주거나 말로 요청할 때만 쓴다 — opt-in 이 없으면 SDS 를 쓰지 않고 SDS 로 구현하지도 않는다. `docs/sds/` 에 SDS 가 있다는 것만으로는 요청이 아니다(§1.1). SDS 를 받으면 그것은 `$kiwi-sds` 가 합의한 lite SDS 한 파일이다 — `docs/sds/<sds-id>.sds.md`, `Profile = lite`, Status `agreed`, `speckiwi sds check` error 0. 문법과 진단 코드는 `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 가 정본이며 본 스킬에 다시 적지 않는다. 위반 시 `references/extended-workflow.md` §7.1 입력 무결성 게이트 차단. PM 도 자식도 SDS 를 고치지 않는다 — 설계가 틀렸으면 NEEDS_USER 로 올린다 |",
    "kiwi-pm/SKILL.md\tprose\t| §0.12 | **MCP 호출 분담 + 시그니처 SSOT** — speckiwi MCP 실제 schema 기준. PM 호출 2종: (a) `update_status(id, status)` — T-final 조건부 implemented 승급, dryRun 옵션 없음. (b) `add_completed_work(date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun])` — T-final sds-summary, sds_id 같은 임의 필드는 summary 텍스트에 인코딩. read 4종: `get_active_target` / `get_requirement` / `list_requirements` / `check_sds`. 자식 kiwi-coder 4종 mutation: `add_trace_link(id, type, reference, relation)` / `add_verification_evidence(id, type, reference, [covers, notes])` / `update_status(id, status=\"in_progress\")` / `add_completed_work(date, summary, ...)`. doculight MCP: `open_markdown` / `update_markdown` (§6.3) |",
    "kiwi-pm/SKILL.md\tprose\t| §0.14 | **세션 id SSOT**. SDS 없는 실행의 `run_id` 는 `--run-id <id>`, 없으면 `<target>-<정렬한 REQ ID 의 sha256 앞 8 hex>`. `<target>` 은 활성 target 의 이름이고, 활성 target 이 없으면 `none` 이다(`--req-filter` 실행은 활성 target 없이도 돈다). 그 `run_id` 의 세션이 있고 끝나지 않았으면 이어서 돌고, 끝났으면 다음 빈 접미사 `<run_id>-2`, `-3`, … 를 쓴다. `--sds` 면 `run_id` = sds-id(SDS 파일 이름에서 `.sds.md` 를 뺀 값) — work-order 와 세션 해석기가 sds-id 로 세션을 찾는다. `--sds` 와 `--req-filter` 를 함께 주면 `run_id` 는 `<sds-id>-<정렬한 REQ ID 의 sha256 앞 8 hex>` 다 — 같은 SDS 에 다른 요구를 준 두 실행은 다른 run 이다. SDS 없는 실행에는 SDS sha pin 도 `sha-mismatch-on-resume` 의 SDS 경우도 없다. `run_id` = `[a-z0-9.-]{4,128}` — 벗어나면 §7.1 차단. 이 정규식은 **세션 식별자** 전용이며 **이벤트 emit 키**에는 **적용하지 않는다** — 재진입 emit 키 `{run_id}#r{n}` 는 다른 id 공간이다(`pipeline-event.md` §5.4) |",
    "kiwi-pm/SKILL.md\tprose\t| 요구 집합이 비었음 — `--req-filter` 의 ID 가 없거나 Stability gate 뒤 남은 요구가 없음 (§4) | HALT |",
    "kiwi-pm/SKILL.md\tprose\t`update_status` 가 REQ status 를 역방향 (예: `implemented → in_progress`) 으로 전이시키는 호출은 PM 측에서 차단 + 경고. forward only (planned/in_progress → implemented) 만 허용.",
    "kiwi-pm/SKILL.md\tprose\t- **`--req-filter <REQ-ID,...>`** — 구현할 요구 ID 집합. 없으면 활성 target 의 열린 작업 후보(`list_requirements` 의 `planned` · `in_progress` 요구)를 집합으로 출력하고 kiwi-coder 를 띄우기 전에 사용자 게이트에서 확인받는다(`--auto` 면 결정 위원회가 정한다, `../_shared/kiwi/auto-option.md`). 확인된 집합은 `pm-state.json` 의 `req_ids` 로 기록한다. `--req-filter` 가 있으면 lifecycle gate 와 T-final `implemented` 승급은 집합의 요구를 하나씩 `get_requirement` 로 ID 로 읽는다 — 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다. `--req-filter` 의 ID 가운데 `get_requirement` 가 찾지 못하는 것이 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다. `--sds` 와 함께 주면 실행 집합(gate · kiwi-coder 에 넘기는 요구 · 승급)은 `--req-filter` 의 ID 이고 SDS 는 그 요구들의 설계만 준다 — SDS 의 `@req` 에 없는 ID 가 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다. SDS 가 없다는 이유로 멈추지 않는다.",
    "kiwi-pm/SKILL.md\tprose\t| \"이 요구들 구현\", \"X 구현\", \"REQ 구현\" | `--req-filter <REQ-ID,...>` | 활성 target 의 열린 작업 후보 — 사용자 게이트에서 확인 (§1.1) |",
    "kiwi-pm/SKILL.md\tprose\t$kiwi-pm [--req-filter <REQ-ID,...>]      # 기본 입력 — 없으면 열린 작업 후보를 확인받는다 (§1.1)",
    "kiwi-pm/SKILL.md\tprose\t| speckiwi REQ status `implemented` 승급 | T-final mutation | PM (조건부) |",
    "kiwi-pm/SKILL.md\tprose\t`.kiwi/sessions/{run_id}/` — kiwi-coder 의 `.kiwi/` 영역을 공유. `run_id` 는 §0.14 가 정한다(`--sds` 면 sds-id, `--sds` 와 `--req-filter` 면 `<sds-id>-<sha8>`).",
    "kiwi-pm/SKILL.md\tprose\t\"target_slug\": \"4.0.0\",",
    "kiwi-pm/SKILL.md\tprose\t\"req_filter\": null,",
    "kiwi-pm/SKILL.md\tprose\t- `req_ids` — 확인된 요구 집합(§1.1, `--sds` 면 부팅 시 `check_sds` 요약에서 옮긴 SDS `@req` 집합, `--req-filter` 도 주면 그 ID), `req_filter` — `--req-filter` 로 받은 ID 목록(없으면 `null`) — gate · T-final 의 ID 분기와 재개가 이 값으로 갈린다, `write_set` — `--sds` 면 SDS 쓰기 집합(Files 경로 ∪ Test Plan 테스트 파일), SDS 없는 실행은 kiwi-coder 가 보고한 변경 경로(실행 뒤 채운다)",
    "kiwi-pm/SKILL.md\tcode\tstate = LOAD_STATE(FIND_SESSION(args))   # --run-id, 없으면 재개 호출의 --sds · --req-filter 로 다시 계산한 run_id (§0.14). 못 찾으면 HALT 하고 --run-id 를 묻는다",
    "kiwi-pm/SKILL.md\tcode\tIF args.req_filter:                      # §1.1 — 두 플래그면 실행 집합은 --req-filter 의 ID, SDS 는 그 요구들의 설계만 준다",
    "kiwi-pm/SKILL.md\tcode\tHALT_ON_IDS_OUTSIDE_SDS(args.req_filter, sds.req_ids)   # SDS @req 에 없는 --req-filter ID 를 적고 kiwi-coder 전에 멈춘다",
    "kiwi-pm/SKILL.md\tcode\treq_ids = args.req_filter",
    "kiwi-pm/SKILL.md\tcode\treq_ids = RESOLVE_REQ_SET(args)          # §1.1 — --req-filter 또는 열린 작업 후보 + 사용자 게이트",
    "kiwi-pm/SKILL.md\tcode\tstate = LOAD_OR_INIT_STATE(sds, req_ids, args)   # §0.14 run_id · base_sha · req_filter 기록",
    "kiwi-pm/SKILL.md\tcode\tIF state.req_filter: HALT_ON_MISSING_IDS(state.req_filter)   # §1.1 — 처음 실행과 재개가 같은 확인을 부른다: ID 마다 get_requirement, 찾지 못한 ID 를 적고 kiwi-coder 전에 멈춘다",
    "kiwi-pm/SKILL.md\tcode\tT_FINAL_SRS_MUTATION(state, args)            # update_status implemented + add_completed_work(req-summary | sds-summary)",
    "kiwi-pm/SKILL.md\tcode\tmissing = [id FOR id IN ids IF MCP_CALL(get_requirement, id=id) IS NOT_FOUND]",
    "kiwi-pm/SKILL.md\tcode\tIF missing: HALT(f\"--req-filter 의 요구를 찾지 못함: {missing}\")   # kiwi-coder 를 띄우기 전",
    "kiwi-pm/SKILL.md\tprose\t- TARGET={state.target_slug}           # lifecycle gate 일관성 확인용",
    "kiwi-pm/SKILL.md\tprose\tUse $kiwi-coder with --req-filter {state.req_ids 를 쉼표로 이음}{(' --sds ' + state.sds_path) if state.sds_path else ''} RUN_ID={state.run_id} SPAWN_CONTEXT=pm-child --max{LOOP_FLAGS}{PASS_THROUGH_FLAGS}",
    "kiwi-pm/SKILL.md\tprose\t- target 비어있음 → HALT (`--req-filter` 실행은 제외)",
    "kiwi-pm/references/extended-workflow.md\tprose\t부팅 T0 단계 — `--req-filter` 가 있으면 `--sds` 실행도 요구 집합 실행처럼 읽는다. 요구 집합(`SKILL.md` §2.2 `req_ids`)을 평가한다 — 요구 집합 실행은 요구마다 `get_requirement` 로 ID 로 읽고(`SKILL.md` §1.1), `--sds` 실행은 1회 `list_requirements` read 로 일괄 평가한다. `--skip-lifecycle-gate` 명시 시 SKIP (사용자 책임, worklog `lifecycle_override` 기록).",
    "kiwi-pm/references/extended-workflow.md\tprose\t| target 비어있음 (`--req-filter` 실행은 제외) | — | **차단** + \"speckiwi `set_active_target` 으로 활성 target 지정 후 재실행\" |",
    "kiwi-pm/references/extended-workflow.md\tprose\t1. `mcp__speckiwi__list_requirements(target, projection: \"compact\")` 호출 시도 — 요구 집합 실행은 요구마다 `mcp__speckiwi__get_requirement(id)`",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path OR NOT state.req_filter:    # 1. 활성 target 확인 — --sds 없는 --req-filter 실행은 요구를 ID 로 읽으므로 활성 target 에 매이지 않는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget = MCP_CALL(\"get_active_target\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF NOT state.req_filter:                  # 활성 target 이 없어 멈추는 것은 --req-filter 없는 실행뿐 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tHALT(\"활성 target 없음. speckiwi set_active_target 으로 지정 후 재실행\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF target != state.target_slug AND state.target_slug:",
    "kiwi-pm/references/extended-workflow.md\tcode\tUser clarification gate(f\"SDS target={state.target_slug} vs 활성 target={target} 불일치 — 진행?\")",
    "kiwi-pm/references/extended-workflow.md\tcode\t# 2. read — 대상은 요구 집합(req_ids). --req-filter 실행과 요구 집합 실행은 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path AND NOT state.req_filter:",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = MCP_CALL(list_requirements, target=target, projection=\"compact\")",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tprose\t재개는 pm-state 의 `req_ids` · `req_filter` · `sds_path` 로 돈다 — 재개 호출이 `--req-filter` 나 `--sds` 를 다시 주지 않아도 gate · kiwi-coder · T-final 은 처음 실행과 같은 집합을 같은 방식으로 읽고, 재개 호출의 인자가 이 값을 덮어쓰지 않는다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t재개할 세션은 `--run-id` 로, 없으면 재개 호출이 준 `--sds` · `--req-filter` 로 §0.14 의 공식을 다시 계산한 `run_id` 로 찾는다(`--sds` 와 `--req-filter` → `<sds-id>-<sha8>`, `--sds` 만 → sds-id, `--req-filter` 만 → `<target>-<sha8>`) — 찾으면 MAIN 은 집합을 다시 정하지 않고(열린 작업 후보 제안과 사용자 게이트 없음) 저장된 값으로 돌며, 찾지 못하면 새 실행을 시작하지 않고 멈춰 `--run-id` 를 묻는다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t**SDS 없는 실행**: `req_ids` 의 요구마다 `speckiwi coverage --tests --ids <그 요구>` (MCP `check_test_sufficiency`) 가 gap 을 보고하지 않고 그것을 인용한 테스트가 통과한 요구만 `implemented` 로 올리고, 나머지는 gap 과 함께 보고한다. `add_completed_work` 는 그 집합으로 기록하며 요약 종류는 `req-summary` 다. `--no-final` 이면 종전처럼 건너뛴다. 아래 의사코드가 두 경우를 함께 적는다 — `covered` 가 SDS 없는 실행의 coverage 조건이다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t**문제**: kiwi-coder 는 `update_status(in_progress)` 만 호출한다. 한 SDS 가 여러 요구를 구현하고 한 요구가 여러 SDS 에 걸칠 수 있어 자식 시야에서는 `implemented` 승급을 판단할 수 없다. PM 이 실행이 끝난 뒤 요구 집합(`--sds` 면 SDS `@req` 집합, `--req-filter` 도 주면 그 ID)을 일괄 마무리한다.",
    "kiwi-pm/references/extended-workflow.md\tcode\t# 1. read REQ 현재 status — --req-filter 실행과 요구 집합 실행은 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path AND NOT state.req_filter:",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = MCP_CALL(list_requirements, target=state.target_slug, projection=\"compact\")",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tSTATUS_ORDER = [\"planned\", \"in_progress\", \"implemented\", \"verified\"]",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF NOT req: CONTINUE   # --req-filter 없는 --sds 실행: SDS 가 가리키지만 활성 target 에 없는 REQ — 무시 (--req-filter 실행은 부팅에서 없는 ID 로 멈춘다)",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget_idx = STATUS_ORDER.index(\"implemented\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tproposals.append({ req_id: req_id, from: req.status, to: \"implemented\" })",
    "kiwi-pm/references/extended-workflow.md\tcode\tf\"T-final 제안: {len(proposals)} 개 REQ 를 implemented 로 승급?\",",
    "kiwi-pm/references/extended-workflow.md\tcode\t# speckiwi `update_status` MCP schema (SSOT): { id: string, status: string } — 그 외 인자 없음 (dryRun 미지원)",
    "kiwi-pm/references/extended-workflow.md\tcode\tworklog.append({event: \"t_final_dryrun_only\", req_id: p.req_id, kind: \"update_status\"})",
    "kiwi-pm/references/extended-workflow.md\tcode\tMCP_CALL(update_status, id=p.req_id, status=\"implemented\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tts: NOW(), kind: \"update_status\", req_id: p.req_id,",
    "kiwi-pm/references/extended-workflow.md\tcode\tfrom: p.from, to: \"implemented\", dry_run: is_pm_dry_run",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget=state.target_slug,",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status` | `id, status` | — | 본 호출에 `dryRun` 옵션 없음. PM 의 --dry-run flag 시 호출 자체를 skip |",
    "kiwi-pm/references/extended-workflow.md\tprose\t**실행이 성공으로 끝나지 않았을 때** (실패·차단) 해당 REQ 의 `all_done == False` → `update_status` 호출 안 함 (REQ 는 in_progress 또는 blocked 그대로 유지). `add_completed_work(req-summary)` · `add_completed_work(sds-summary)` 도 skip. 보고서 §6.3 에서 미완료 REQ 목록을 명시.",
    "kiwi-pm/references/extended-workflow.md\tprose\tUse $kiwi-review-fix-loop with --req-filter {state.req_ids 를 쉼표로 이음}{' --close-reqs' if CLOSE_SAFE(state) else ''}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{' --skip-clean-code' if state.clean_code_skip is True else ' --keep-clean-code' if state.clean_code_skip is False else ''}",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `--req-filter` 는 이 실행의 요구 범위를 넘긴다(`--sds` 실행은 `--sds` 도) — review-fix-loop 의 마지막 단계인 테스트 충분성 확인(`../../_shared/kiwi/test-sufficiency.md`)이 이 실행의 범위를 본다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `--close-reqs` 는 실행이 `done` 으로 끝나 T-final 이 요구를 `implemented` 로 올렸을 때(`CLOSE_SAFE`) — `--sds` 실행은 옮기기도 끝났을 때(`MOVED`) — 만 붙인다. 실행이 `failed` 이거나 critical 로 격상된 NEEDS_USER 가 남은 채로 `--close-reqs` 를 붙이는 것은 §0.G7 `followup-review-fix-loop-close-unsafe` 가 막는다 — 되감을 수 없는 `verified` 를 향하기 때문이며 `--auto` 도 이 멈춤을 덮지 못한다. 그 경우에도 hand-off 는 `--close-reqs` 없이 돈다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t- PM 자체는 `update_status(\"verified\")` 를 호출하지 않는다 — verified 전이는 review-fix-loop 의 몫이다 (`SKILL.md` §0.12 mutation 분담 SSOT 불변).",
    "kiwi-pm/references/extended-workflow.md\tprose\tUse $kiwi-review-fix-loop with --req-filter {state.req_ids 를 쉼표로 이음} --sds {state.sds_path}{' --close-reqs' if MOVED else ''}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{' --skip-clean-code' if state.clean_code_skip is True else ' --keep-clean-code' if state.clean_code_skip is False else ''}",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `--req-filter` 의 ID 를 `get_requirement` 가 찾지 못함 — 처음 실행과 재개 모두 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `--sds` 와 함께 준 `--req-filter` 의 ID 가 SDS `@req` 집합에 없음 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| MCP 미가용 (T-final update_status) | HALT + `state.pending_mutations[]` 기록. MCP 복구 후 재개 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status` transition guard 거부 (MCP 응답 reject) | catch → `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내. 강제 우회 없음. (`update_status` MCP 에 dryRun 옵션 없음 — 사전 시뮬레이션 불가, 호출 시점에 거부 가능성 catch) |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| 자식이 `update_status` backward 시도 | kiwi-coder §0.G5 자체 차단. PM 무대응 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t$kiwi-pm --req-filter FR-TODO-001,FR-TODO-002",
    "kiwi-pm/references/extended-workflow.md\tprose\t1. **부팅 입력 확정 + lifecycle gate** — 요구 집합을 확정하고(`--sds` 면 `check_sds` 로 lite SDS 를 검사하고), speckiwi `get_requirement`(요구 집합 실행) 또는 `list_requirements` read 로 그 집합의 Stability ∈ {evolving, stable} 만 진행 허용 (§4)",
    "kiwi-pm/references/extended-workflow.md\tprose\t4. **T-final REQ status 마무리** — 실행이 성공으로 끝났으면 요구 집합(`--sds` 면 SDS `@req` 집합)에 `update_status(id, \"implemented\")` + `add_completed_work(date, summary, requirementIds, target, reportPaths)` (§6.2) — `--sds` 와 `--req-filter` 를 함께 주면 대상은 `--req-filter` 의 ID 다",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `get_active_target` (read) | **kiwi-pm** | T0 lifecycle gate (`--sds` 없는 `--req-filter` 실행은 제외) | `{}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `get_requirement` (read) | **kiwi-pm** | T-1 `--req-filter` 확인 · T0 / T-final (`--req-filter` · 요구 집합 실행) | `{id}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `list_requirements` (read) | **kiwi-pm** | T-1 열린 작업 후보 · T0 / T-final (필터 없는 `--sds` 실행) | `{target?, status?, stability?, scope?, tag?, type?}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status(in_progress)` | kiwi-coder (자식) | 실행 시작 시 | `{id, status: \"in_progress\"}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status(\"implemented\")` | **kiwi-pm** | T-final, 실행이 성공으로 끝났을 때 (조건부, forward-only) | `{id, status: \"implemented\"}` (dryRun 인자 없음) |",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `req_ids`: T-final 에서 `update_status(\"implemented\")` 호출한 REQ-ID 배열"
  ],
  ".agents/skills": [
    "kiwi-pm/SKILL.md\tprose\tdescription: \"요구 ID 집합(--req-filter, 없으면 활성 target 의 열린 작업 후보를 확인받는다)을 입력으로 받아 — SDS 는 사용자가 --sds <path>(별칭 SDS_PATH=)로 줄 때만 쓴다 — 그 작업을 격리된 sub-agent(kiwi-coder) 실행 하나로 구현시키는 runner v0.1 — 호출 하나 = kiwi-coder 실행 하나. 3상태 프로토콜(TASK_DONE / NEEDS_USER / FAILED) 로 메인 세션과 대화하며, 부팅 시 Stability lifecycle gate(evolving/stable 만 진행 — --sds 면 speckiwi sds check 도), 종료 시 요구 집합 중 테스트 충분성 gap 이 없는 요구의 implemented 승급 + add_completed_work(req-summary — --sds 면 sds-summary), doculight MCP 가용 시 보고서 표시, 단독 실행이면 끝에서 항상 kiwi-review-fix-loop 로 넘긴다. --auto 는 공용 auto-option 정책으로 clarification/business-decision/rollback-confirmation 게이트를 자동 결정하되 critical_gates[] 는 항상 중단한다. `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 지정 전파. --resume 재개 가능. 트리거 — SDS 구현, SDS 돌려, kiwi pm, kiwi 코더 실행, 자동 코딩 실행, sds 실행, coder runner. 범위 외 — SRS/feasibility/SDS 작성 스킬 호출 안 함(`--sds` 실행의 §6.4.1 `kiwi-sds --close` 마감 호출만 예외), /snoworca-* 호출 절대 금지.\"",
    "kiwi-pm/SKILL.md\tprose\t요구 ID 집합(`--req-filter`)을 입력으로 받아 — 사용자가 `--sds <path>` 로 SDS 를 주면 그 SDS 를 — 격리된 sub-agent(`kiwi-coder`) 실행 하나로 구현시키는 runner. 호출 하나가 실행 단위다 — PM 은 요구 집합이나 SDS 를 나누거나 합치지 않는다.",
    "kiwi-pm/SKILL.md\tprose\tPM 자체는 read-only orchestrator 에 가깝다 — 구현/TDD/회귀/MCP mutation 4종 중 3종은 자식 `kiwi-coder` 전권. PM 은 부팅 시 요구 집합을 확정하고(`--sds` 면 `check_sds` 로 SDS 를 검사하고) speckiwi read(요구 집합 실행은 요구마다 `get_requirement`)로 Stability lifecycle gate 적용하고, 실행이 끝나면 T-final 단계에서 `update_status(\"implemented\")` + `add_completed_work(req-summary)`(`--sds` 면 `add_completed_work(sds-summary)`) 2종 mutation 으로 마무리한다. 보고서는 doculight MCP 가용 시 doculight MCP `open_markdown` 으로 표시.",
    "kiwi-pm/SKILL.md\tprose\t- **요구는 ID 로 읽는다** — `--req-filter` 의 요구는 하나씩 `get_requirement` 로 읽는다. 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다 (§1.1).",
    "kiwi-pm/SKILL.md\tprose\t| §0.2 | **작업 입력 SSOT**. 기본 입력은 요구 ID 집합이다(`--req-filter <REQ-ID,...>`, 없으면 활성 target 의 열린 작업 후보 — §1.1). SDS 는 사용자가 `--sds <path>`(별칭 `SDS_PATH=<path>`)로 주거나 말로 요청할 때만 쓴다 — opt-in 이 없으면 SDS 를 쓰지 않고 SDS 로 구현하지도 않는다. `docs/sds/` 에 SDS 가 있다는 것만으로는 요청이 아니다(§1.1). SDS 를 받으면 그것은 `$kiwi-sds` 가 합의한 lite SDS 한 파일이다 — `docs/sds/<sds-id>.sds.md`, `Profile = lite`, Status `agreed`, `speckiwi sds check` error 0. 문법과 진단 코드는 `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 가 정본이며 본 스킬에 다시 적지 않는다. 위반 시 `references/extended-workflow.md` §7.1 입력 무결성 게이트 차단. PM 도 자식도 SDS 를 고치지 않는다 — 설계가 틀렸으면 NEEDS_USER 로 올린다 |",
    "kiwi-pm/SKILL.md\tprose\t| §0.12 | **MCP 호출 분담 + 시그니처 SSOT** — speckiwi MCP 실제 schema 기준. PM 호출 2종: (a) `update_status(id, status)` — T-final 조건부 implemented 승급, dryRun 옵션 없음. (b) `add_completed_work(date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun])` — T-final sds-summary, sds_id 같은 임의 필드는 summary 텍스트에 인코딩. read 4종: `get_active_target` / `get_requirement` / `list_requirements` / `check_sds`. 자식 kiwi-coder 4종 mutation: `add_trace_link(id, type, reference, relation)` / `add_verification_evidence(id, type, reference, [covers, notes])` / `update_status(id, status=\"in_progress\")` / `add_completed_work(date, summary, ...)`. doculight MCP: `open_markdown` / `update_markdown` (§6.3) |",
    "kiwi-pm/SKILL.md\tprose\t| §0.14 | **세션 id SSOT**. SDS 없는 실행의 `run_id` 는 `--run-id <id>`, 없으면 `<target>-<정렬한 REQ ID 의 sha256 앞 8 hex>`. `<target>` 은 활성 target 의 이름이고, 활성 target 이 없으면 `none` 이다(`--req-filter` 실행은 활성 target 없이도 돈다). 그 `run_id` 의 세션이 있고 끝나지 않았으면 이어서 돌고, 끝났으면 다음 빈 접미사 `<run_id>-2`, `-3`, … 를 쓴다. `--sds` 면 `run_id` = sds-id(SDS 파일 이름에서 `.sds.md` 를 뺀 값) — work-order 와 세션 해석기가 sds-id 로 세션을 찾는다. `--sds` 와 `--req-filter` 를 함께 주면 `run_id` 는 `<sds-id>-<정렬한 REQ ID 의 sha256 앞 8 hex>` 다 — 같은 SDS 에 다른 요구를 준 두 실행은 다른 run 이다. SDS 없는 실행에는 SDS sha pin 도 `sha-mismatch-on-resume` 의 SDS 경우도 없다. `run_id` = `[a-z0-9.-]{4,128}` — 벗어나면 §7.1 차단. 이 정규식은 **세션 식별자** 전용이며 **이벤트 emit 키**에는 **적용하지 않는다** — 재진입 emit 키 `{run_id}#r{n}` 는 다른 id 공간이다(`pipeline-event.md` §5.4) |",
    "kiwi-pm/SKILL.md\tprose\t| 요구 집합이 비었음 — `--req-filter` 의 ID 가 없거나 Stability gate 뒤 남은 요구가 없음 (§4) | HALT |",
    "kiwi-pm/SKILL.md\tprose\t`update_status` 가 REQ status 를 역방향 (예: `implemented → in_progress`) 으로 전이시키는 호출은 PM 측에서 차단 + 경고. forward only (planned/in_progress → implemented) 만 허용.",
    "kiwi-pm/SKILL.md\tprose\t- **`--req-filter <REQ-ID,...>`** — 구현할 요구 ID 집합. 없으면 활성 target 의 열린 작업 후보(`list_requirements` 의 `planned` · `in_progress` 요구)를 집합으로 출력하고 kiwi-coder 를 띄우기 전에 사용자 게이트에서 확인받는다(`--auto` 면 결정 위원회가 정한다, `../_shared/kiwi/auto-option.md`). 확인된 집합은 `pm-state.json` 의 `req_ids` 로 기록한다. `--req-filter` 가 있으면 lifecycle gate 와 T-final `implemented` 승급은 집합의 요구를 하나씩 `get_requirement` 로 ID 로 읽는다 — 그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다. `--req-filter` 의 ID 가운데 `get_requirement` 가 찾지 못하는 것이 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다. `--sds` 와 함께 주면 실행 집합(gate · kiwi-coder 에 넘기는 요구 · 승급)은 `--req-filter` 의 ID 이고 SDS 는 그 요구들의 설계만 준다 — SDS 의 `@req` 에 없는 ID 가 있으면 kiwi-coder 를 띄우기 전에 멈추고 그 ID 를 적는다. SDS 가 없다는 이유로 멈추지 않는다.",
    "kiwi-pm/SKILL.md\tprose\t| \"이 요구들 구현\", \"X 구현\", \"REQ 구현\" | `--req-filter <REQ-ID,...>` | 활성 target 의 열린 작업 후보 — 사용자 게이트에서 확인 (§1.1) |",
    "kiwi-pm/SKILL.md\tprose\t$kiwi-pm [--req-filter <REQ-ID,...>]      # 기본 입력 — 없으면 열린 작업 후보를 확인받는다 (§1.1)",
    "kiwi-pm/SKILL.md\tprose\t| speckiwi REQ status `implemented` 승급 | T-final mutation | PM (조건부) |",
    "kiwi-pm/SKILL.md\tprose\t`.kiwi/sessions/{run_id}/` — kiwi-coder 의 `.kiwi/` 영역을 공유. `run_id` 는 §0.14 가 정한다(`--sds` 면 sds-id, `--sds` 와 `--req-filter` 면 `<sds-id>-<sha8>`).",
    "kiwi-pm/SKILL.md\tprose\t\"target_slug\": \"4.0.0\",",
    "kiwi-pm/SKILL.md\tprose\t\"req_filter\": null,",
    "kiwi-pm/SKILL.md\tprose\t- `req_ids` — 확인된 요구 집합(§1.1, `--sds` 면 부팅 시 `check_sds` 요약에서 옮긴 SDS `@req` 집합, `--req-filter` 도 주면 그 ID), `req_filter` — `--req-filter` 로 받은 ID 목록(없으면 `null`) — gate · T-final 의 ID 분기와 재개가 이 값으로 갈린다, `write_set` — `--sds` 면 SDS 쓰기 집합(Files 경로 ∪ Test Plan 테스트 파일), SDS 없는 실행은 kiwi-coder 가 보고한 변경 경로(실행 뒤 채운다)",
    "kiwi-pm/SKILL.md\tcode\tstate = LOAD_STATE(FIND_SESSION(args))   # --run-id, 없으면 재개 호출의 --sds · --req-filter 로 다시 계산한 run_id (§0.14). 못 찾으면 HALT 하고 --run-id 를 묻는다",
    "kiwi-pm/SKILL.md\tcode\tIF args.req_filter:                      # §1.1 — 두 플래그면 실행 집합은 --req-filter 의 ID, SDS 는 그 요구들의 설계만 준다",
    "kiwi-pm/SKILL.md\tcode\tHALT_ON_IDS_OUTSIDE_SDS(args.req_filter, sds.req_ids)   # SDS @req 에 없는 --req-filter ID 를 적고 kiwi-coder 전에 멈춘다",
    "kiwi-pm/SKILL.md\tcode\treq_ids = args.req_filter",
    "kiwi-pm/SKILL.md\tcode\treq_ids = RESOLVE_REQ_SET(args)          # §1.1 — --req-filter 또는 열린 작업 후보 + 사용자 게이트",
    "kiwi-pm/SKILL.md\tcode\tstate = LOAD_OR_INIT_STATE(sds, req_ids, args)   # §0.14 run_id · base_sha · req_filter 기록",
    "kiwi-pm/SKILL.md\tcode\tIF state.req_filter: HALT_ON_MISSING_IDS(state.req_filter)   # §1.1 — 처음 실행과 재개가 같은 확인을 부른다: ID 마다 get_requirement, 찾지 못한 ID 를 적고 kiwi-coder 전에 멈춘다",
    "kiwi-pm/SKILL.md\tcode\tT_FINAL_SRS_MUTATION(state, args)            # update_status implemented + add_completed_work(req-summary | sds-summary)",
    "kiwi-pm/SKILL.md\tcode\tmissing = [id FOR id IN ids IF MCP_CALL(get_requirement, id=id) IS NOT_FOUND]",
    "kiwi-pm/SKILL.md\tcode\tIF missing: HALT(f\"--req-filter 의 요구를 찾지 못함: {missing}\")   # kiwi-coder 를 띄우기 전",
    "kiwi-pm/SKILL.md\tprose\t- TARGET={state.target_slug}           # lifecycle gate 일관성 확인용",
    "kiwi-pm/SKILL.md\tprose\tUse $kiwi-coder with --req-filter {state.req_ids 를 쉼표로 이음}{(' --sds ' + state.sds_path) if state.sds_path else ''} RUN_ID={state.run_id} SPAWN_CONTEXT=pm-child{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{PASS_THROUGH_FLAGS}",
    "kiwi-pm/SKILL.md\tprose\t- target 비어있음 → HALT (`--req-filter` 실행은 제외)",
    "kiwi-pm/references/extended-workflow.md\tprose\t부팅 T0 단계 — `--req-filter` 가 있으면 `--sds` 실행도 요구 집합 실행처럼 읽는다. 요구 집합(`SKILL.md` §2.2 `req_ids`)을 평가한다 — 요구 집합 실행은 요구마다 `get_requirement` 로 ID 로 읽고(`SKILL.md` §1.1), `--sds` 실행은 1회 `list_requirements` read 로 일괄 평가한다. `--skip-lifecycle-gate` 명시 시 SKIP (사용자 책임, worklog `lifecycle_override` 기록).",
    "kiwi-pm/references/extended-workflow.md\tprose\t| target 비어있음 (`--req-filter` 실행은 제외) | — | **차단** + \"speckiwi `set_active_target` 으로 활성 target 지정 후 재실행\" |",
    "kiwi-pm/references/extended-workflow.md\tprose\t1. `mcp__speckiwi__list_requirements(target, projection: \"compact\")` 호출 시도 — 요구 집합 실행은 요구마다 `mcp__speckiwi__get_requirement(id)`",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path OR NOT state.req_filter:    # 1. 활성 target 확인 — --sds 없는 --req-filter 실행은 요구를 ID 로 읽으므로 활성 target 에 매이지 않는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget = MCP_CALL(\"get_active_target\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF NOT state.req_filter:                  # 활성 target 이 없어 멈추는 것은 --req-filter 없는 실행뿐 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tHALT(\"활성 target 없음. speckiwi set_active_target 으로 지정 후 재실행\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF target != state.target_slug AND state.target_slug:",
    "kiwi-pm/references/extended-workflow.md\tcode\tCodex clarification gate(f\"SDS target={state.target_slug} vs 활성 target={target} 불일치 — 진행?\")",
    "kiwi-pm/references/extended-workflow.md\tcode\t# 2. read — 대상은 요구 집합(req_ids). --req-filter 실행과 요구 집합 실행은 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path AND NOT state.req_filter:",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = MCP_CALL(list_requirements, target=target, projection=\"compact\")",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tprose\t재개는 pm-state 의 `req_ids` · `req_filter` · `sds_path` 로 돈다 — 재개 호출이 `--req-filter` 나 `--sds` 를 다시 주지 않아도 gate · kiwi-coder · T-final 은 처음 실행과 같은 집합을 같은 방식으로 읽고, 재개 호출의 인자가 이 값을 덮어쓰지 않는다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t재개할 세션은 `--run-id` 로, 없으면 재개 호출이 준 `--sds` · `--req-filter` 로 §0.14 의 공식을 다시 계산한 `run_id` 로 찾는다(`--sds` 와 `--req-filter` → `<sds-id>-<sha8>`, `--sds` 만 → sds-id, `--req-filter` 만 → `<target>-<sha8>`) — 찾으면 MAIN 은 집합을 다시 정하지 않고(열린 작업 후보 제안과 사용자 게이트 없음) 저장된 값으로 돌며, 찾지 못하면 새 실행을 시작하지 않고 멈춰 `--run-id` 를 묻는다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t**SDS 없는 실행**: `req_ids` 의 요구마다 `speckiwi coverage --tests --ids <그 요구>` (MCP `check_test_sufficiency`) 가 gap 을 보고하지 않고 그것을 인용한 테스트가 통과한 요구만 `implemented` 로 올리고, 나머지는 gap 과 함께 보고한다. `add_completed_work` 는 그 집합으로 기록하며 요약 종류는 `req-summary` 다. `--no-final` 이면 종전처럼 건너뛴다. 아래 의사코드가 두 경우를 함께 적는다 — `covered` 가 SDS 없는 실행의 coverage 조건이다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t**문제**: kiwi-coder 는 `update_status(in_progress)` 만 호출한다. 한 SDS 가 여러 요구를 구현하고 한 요구가 여러 SDS 에 걸칠 수 있어 자식 시야에서는 `implemented` 승급을 판단할 수 없다. PM 이 실행이 끝난 뒤 요구 집합(`--sds` 면 SDS `@req` 집합, `--req-filter` 도 주면 그 ID)을 일괄 마무리한다.",
    "kiwi-pm/references/extended-workflow.md\tcode\t# 1. read REQ 현재 status — --req-filter 실행과 요구 집합 실행은 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF state.sds_path AND NOT state.req_filter:",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = MCP_CALL(list_requirements, target=state.target_slug, projection=\"compact\")",
    "kiwi-pm/references/extended-workflow.md\tcode\treqs = [MCP_CALL(get_requirement, id=id) FOR id IN state.req_ids]   # --req-filter 실행과 요구 집합 실행 — 요구마다 ID 로 읽는다 (§1.1)",
    "kiwi-pm/references/extended-workflow.md\tcode\tSTATUS_ORDER = [\"planned\", \"in_progress\", \"implemented\", \"verified\"]",
    "kiwi-pm/references/extended-workflow.md\tcode\tIF NOT req: CONTINUE   # --req-filter 없는 --sds 실행: SDS 가 가리키지만 활성 target 에 없는 REQ — 무시 (--req-filter 실행은 부팅에서 없는 ID 로 멈춘다)",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget_idx = STATUS_ORDER.index(\"implemented\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tproposals.append({ req_id: req_id, from: req.status, to: \"implemented\" })",
    "kiwi-pm/references/extended-workflow.md\tcode\tf\"T-final 제안: {len(proposals)} 개 REQ 를 implemented 로 승급?\",",
    "kiwi-pm/references/extended-workflow.md\tcode\t# speckiwi `update_status` MCP schema (SSOT): { id: string, status: string } — 그 외 인자 없음 (dryRun 미지원)",
    "kiwi-pm/references/extended-workflow.md\tcode\tworklog.append({event: \"t_final_dryrun_only\", req_id: p.req_id, kind: \"update_status\"})",
    "kiwi-pm/references/extended-workflow.md\tcode\tMCP_CALL(update_status, id=p.req_id, status=\"implemented\")",
    "kiwi-pm/references/extended-workflow.md\tcode\tts: NOW(), kind: \"update_status\", req_id: p.req_id,",
    "kiwi-pm/references/extended-workflow.md\tcode\tfrom: p.from, to: \"implemented\", dry_run: is_pm_dry_run",
    "kiwi-pm/references/extended-workflow.md\tcode\ttarget=state.target_slug,",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status` | `id, status` | — | 본 호출에 `dryRun` 옵션 없음. PM 의 --dry-run flag 시 호출 자체를 skip |",
    "kiwi-pm/references/extended-workflow.md\tprose\t**실행이 성공으로 끝나지 않았을 때** (실패·차단) 해당 REQ 의 `all_done == False` → `update_status` 호출 안 함 (REQ 는 in_progress 또는 blocked 그대로 유지). `add_completed_work(req-summary)` · `add_completed_work(sds-summary)` 도 skip. 보고서 §6.3 에서 미완료 REQ 목록을 명시.",
    "kiwi-pm/references/extended-workflow.md\tprose\tUse $kiwi-review-fix-loop with --req-filter {state.req_ids 를 쉼표로 이음}{' --close-reqs' if CLOSE_SAFE(state) else ''}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{' --skip-clean-code' if state.clean_code_skip is True else ' --keep-clean-code' if state.clean_code_skip is False else ''}",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `--req-filter` 는 이 실행의 요구 범위를 넘긴다(`--sds` 실행은 `--sds` 도) — review-fix-loop 의 마지막 단계인 테스트 충분성 확인(`../../_shared/kiwi/test-sufficiency.md`)이 이 실행의 범위를 본다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `--close-reqs` 는 실행이 `done` 으로 끝나 T-final 이 요구를 `implemented` 로 올렸을 때(`CLOSE_SAFE`) — `--sds` 실행은 옮기기도 끝났을 때(`MOVED`) — 만 붙인다. 실행이 `failed` 이거나 critical 로 격상된 NEEDS_USER 가 남은 채로 `--close-reqs` 를 붙이는 것은 §0.G7 `followup-review-fix-loop-close-unsafe` 가 막는다 — 되감을 수 없는 `verified` 를 향하기 때문이며 `--auto` 도 이 멈춤을 덮지 못한다. 그 경우에도 hand-off 는 `--close-reqs` 없이 돈다.",
    "kiwi-pm/references/extended-workflow.md\tprose\t- PM 자체는 `update_status(\"verified\")` 를 호출하지 않는다 — verified 전이는 review-fix-loop 의 몫이다 (`SKILL.md` §0.12 mutation 분담 SSOT 불변).",
    "kiwi-pm/references/extended-workflow.md\tprose\tUse $kiwi-review-fix-loop with --req-filter {state.req_ids 를 쉼표로 이음} --sds {state.sds_path}{' --close-reqs' if MOVED else ''}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{' --skip-clean-code' if state.clean_code_skip is True else ' --keep-clean-code' if state.clean_code_skip is False else ''}",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `--req-filter` 의 ID 를 `get_requirement` 가 찾지 못함 — 처음 실행과 재개 모두 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `--sds` 와 함께 준 `--req-filter` 의 ID 가 SDS `@req` 집합에 없음 (§1.1) | HALT — kiwi-coder 전에 그 ID 를 적는다 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| MCP 미가용 (T-final update_status) | `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status` transition guard 거부 (MCP 응답 reject) | catch → `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내. 강제 우회 없음. (`update_status` MCP 에 dryRun 옵션 없음 — 사전 시뮬레이션 불가, 호출 시점에 거부 가능성 catch) |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| 자식이 `update_status` backward 시도 | kiwi-coder §0.G5 자체 차단. PM 무대응 |",
    "kiwi-pm/references/extended-workflow.md\tprose\t$kiwi-pm --req-filter FR-TODO-001,FR-TODO-002",
    "kiwi-pm/references/extended-workflow.md\tprose\t1. **부팅 입력 확정 + lifecycle gate** — 요구 집합을 확정하고(`--sds` 면 `check_sds` 로 lite SDS 를 검사하고), speckiwi `get_requirement`(요구 집합 실행) 또는 `list_requirements` read 로 그 집합의 Stability ∈ {evolving, stable} 만 진행 허용 (§4)",
    "kiwi-pm/references/extended-workflow.md\tprose\t4. **T-final REQ status 마무리** — 실행이 성공으로 끝났으면 요구 집합(`--sds` 면 SDS `@req` 집합)에 `update_status(id, \"implemented\")` + `add_completed_work(date, summary, requirementIds, target, reportPaths)` (§6.2) — `--sds` 와 `--req-filter` 를 함께 주면 대상은 `--req-filter` 의 ID 다",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `get_active_target` (read) | **kiwi-pm** | T0 lifecycle gate (`--sds` 없는 `--req-filter` 실행은 제외) | `{}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `get_requirement` (read) | **kiwi-pm** | T-1 `--req-filter` 확인 · T0 / T-final (`--req-filter` · 요구 집합 실행) | `{id}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `list_requirements` (read) | **kiwi-pm** | T-1 열린 작업 후보 · T0 / T-final (필터 없는 `--sds` 실행) | `{target?, status?, stability?, scope?, tag?, type?}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status(in_progress)` | kiwi-coder (자식) | 실행 시작 시 | `{id, status: \"in_progress\"}` |",
    "kiwi-pm/references/extended-workflow.md\tprose\t| `update_status(\"implemented\")` | **kiwi-pm** | T-final, 실행이 성공으로 끝났을 때 (조건부, forward-only) | `{id, status: \"implemented\"}` (dryRun 인자 없음) |",
    "kiwi-pm/references/extended-workflow.md\tprose\t- `req_ids`: T-final 에서 `update_status(\"implemented\")` 호출한 REQ-ID 배열"
  ]
};
// </recorded-sites>
