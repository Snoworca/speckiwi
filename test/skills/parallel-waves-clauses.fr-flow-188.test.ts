import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, section, tableRows } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-188  the shared parallel-waves contract: merge order, the conformance fix path, the host review window
// @req FR-FLOW-187  unallocated-req-id checks a non-empty union equal to the allocation
// @req FR-FLOW-035  kiwi-wave-master forwards --mini / --loops N to every per-wave call
// @req FR-FLOW-123  the worktree procedure cites the join, the verdict and the merge instead of restating them
// @req FR-FLOW-134  the --auto safety gate names the directly-spawned review child beside the per-wave children
// @req FR-FLOW-029  a wave's target is registered with a scope bounded to that wave
//
// The contract ships in Korean (claude) and English (codex, etc and the .agents mirror), so every
// contract assertion carries both spellings of the one clause — and is held to the `**PW-n` step or
// the table row the clause belongs to, not to the file.

const CONTRACTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/_shared/kiwi/parallel-waves.md`);
const BUNDLES = ["claude", "codex", "etc"] as const;

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const body = (rel: string): string => read(rel).replace(/^---[\s\S]*?\n---\s*\n?/, "");
const orchestrator = (bundle: string): string => body(`skills/${bundle}/kiwi-orchestrator/SKILL.md`);
const waveMaster = (bundle: string): string => body(`skills/${bundle}/kiwi-wave-master/SKILL.md`);

/** The `**PW-k` step block of the contract's §5 — it ends where the next `**PW-` marker starts. */
function step(text: string, k: number): string {
  const numbered = section(text, /^## 5\./);
  const marks = [...numbered.matchAll(/^\*\*PW-(\d+)\b/gm)];
  const index = marks.findIndex((mark) => Number(mark[1]) === k);
  if (index === -1) return "";
  const start = marks[index]?.index as number;
  const end = index + 1 < marks.length ? (marks[index + 1]?.index as number) : numbered.length;
  return numbered.slice(start, end);
}

/** Code-fence contents. */
function fences(text: string): string[] {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1] as string);
}

/** The first line of `text` matching `re`. */
function lineOf(text: string, re: RegExp): string {
  return text.split("\n").find((line) => re.test(line)) ?? "";
}

/** A gate table row's predicate cell. */
function gatePredicate(text: string, gate: string): string {
  return tableRows(text).find((r) => (r.cells[0] ?? "").replace(/`/g, "").trim() === gate)?.cells[1] ?? "";
}

describe("FR-FLOW-188 AC-1 — the contract merges in wave order", () => {
  it.each(CONTRACTS)("FR-FLOW-188 AC-1 %s: PW-9 merges the passed branches in wave order with --no-ff", (copy) => {
    const merge = step(read(copy), 9);
    expect(merge, `${copy}: PW-9`).not.toBe("");
    const heading = merge.split("\n")[0] as string;
    expect(heading, `${copy}: the merge step must be ordered by wave`).toMatch(/^\*\*PW-9 · (병합 — 호스트, wave 순서로\.|Merge — host, in wave order\.)\*\*/);
    expect(merge).toContain("`--no-ff`");
    expect(merge).toContain("`integrate-lane`");
  });
});

describe("FR-FLOW-188 AC-4 — a mismatch with the SRS, the SDS or the recorded decisions goes to an independent fixer", () => {
  it.each(CONTRACTS)("FR-FLOW-188 AC-4 %s: PW-13's rule names all three references in its condition", (copy) => {
    const rule = lineOf(step(read(copy), 13), /원래 워커가 아닌|not the original worker/);
    expect(rule, `${copy}: PW-13 rule`).toMatch(
      /\*\*(결과가 SRS · SDS · 결정과 다르면 원래 워커가 아닌 독립 서브에이전트가 고치고, 호스트는 다시 검증한다\.|When the result differs from the SRS · the SDS · a decision, an independent subagent that is not the original worker fixes it, and the host re-verifies\.)\*\*/
    );
  });

  it.each(BUNDLES)("FR-FLOW-188 AC-4 %s: both skills' verification steps state the same three references and the re-verification", (bundle) => {
    const loopP = section(orchestrator(bundle), /^###\s*12\.1\b/m);
    expect(lineOf(loopP, /원래 워커가 아닌/), `${bundle}: orchestrator §12.1`).toMatch(
      /\*\*loop P 가 병합된 결과를 SRS · SDS · 기록된 결정과 다르다고 판정하면, 원래 워커가 아닌 독립 서브에이전트가 고치고 loop P 가 다시 검증한다\*\*/
    );
    const waveVerify = section(waveMaster(bundle), /^## 5\.5 /m).split(/^### /m)[0] as string;
    expect(lineOf(waveVerify, /원래 워커가 아닌/), `${bundle}: kiwi-wave-master §5.5`).toMatch(
      /병합된 결과가 SRS · SDS · 기록된 결정과 다르다고 판정하면 원래 워커가 아닌 독립 서브에이전트가 고치고 두 검증자가 다시 검증한다/
    );
  });
});

describe("FR-FLOW-188 AC-8 — the host reviews only its own post-merge commits, and a window with no code file records no-host-code-commits", () => {
  it.each(CONTRACTS)("FR-FLOW-188 AC-8 %s: the no-code branch names the diff, skips the hop, and leaves the rest to the worker and the run-window review", (copy) => {
    const rule = lineOf(step(read(copy), 12), /`no-host-code-commits`/);
    expect(rule, `${copy}: PW-12 no-code branch`).not.toBe("");
    expect(rule, `${copy}: the window's diff`).toMatch(/`git diff --name-only <(마지막 병합 커밋|last merge commit)>\.\.<(호스트 tip|host tip)>`/);
    expect(rule, `${copy}: the file classes`).toMatch(/`kiwi-review-fix-loop` §11/);
    expect(rule, `${copy}: instead of calling the hop`).toMatch(/hop 을 부르지 않고 `no-host-code-commits`|the hop is not called and `no-host-code-commits`/);
    expect(rule, `${copy}: the run-window final review`).toMatch(/run 창 종료 리뷰가 run 전체를 본다|the run-window final review sees the whole run/);
    expect(rule, `${copy}: the worker's window`).toMatch(/워커의 창은 그 워커가 리뷰했고|Each worker reviewed its own window/);
  });

  it.each(BUNDLES)("FR-FLOW-188 AC-8 %s: the orchestrator's §11.2 carries the same window, branch and division of review", (bundle) => {
    const review = section(orchestrator(bundle), /^###\s*11\.2\s/m);
    const rule = lineOf(review, /`no-host-code-commits`/);
    expect(rule).toMatch(/\*\*호스트가 만든 커밋만\*\* 리뷰한다/);
    expect(rule).toMatch(/`--base` 는 그 stage 의 마지막 병합 커밋, `--head` 는 호스트의 tip 이다/);
    expect(rule).toMatch(/`kiwi-review-fix-loop` §11 의 부류 표로 걸렀을 때 코드 파일이 하나도 없으면/);
    expect(rule).toMatch(/hop 을 부르지 않고 `no-host-code-commits`/);
    expect(rule).toMatch(/워커 창은 워커가, run 전체는 run 창 종료 리뷰가 본다/);
  });
});

describe("FR-FLOW-187 AC-3 — the allocation check is a non-empty union equal to the allocated set", () => {
  it.each(CONTRACTS)("FR-FLOW-187 AC-3 %s: PW-2 checks the union is non-empty and equal, and the gate row names all three failures", (copy) => {
    const text = read(copy);
    expect(step(text, 2), `${copy}: PW-2`).toMatch(/그 합집합이 비어 있지 않고 배정 집합과 같은지 확인한다|checks that the union is not empty and equals the allocated set/);
    const predicate = gatePredicate(text, "unallocated-req-id");
    expect(predicate, `${copy}: gate row`).toMatch(/합집합이 비었거나|union of the wave SDS files' `@req` sets is empty/);
    expect(predicate).toMatch(/배정 집합 밖의 요구|outside the allocated set/);
    expect(predicate).toMatch(/배정 집합의 요구를 빠뜨림|misses one of the allocated set/);
  });

  it.each(BUNDLES)("FR-FLOW-187 AC-3 %s: the orchestrator's 3.c′ check spans every part and requires a non-empty union", (bundle) => {
    const check = lineOf(orchestrator(bundle), /^\*\*3\.c′ 배정 검사\*\*/);
    expect(check).toMatch(/wave 의 SDS 파일마다\(조각으로 나뉘었으면 조각 전부\)/);
    expect(check).toMatch(/합집합이 비어 있지 않고 그 wave 의 3\.b 배정 집합과 같아야 한다/);
    expect(gatePredicate(orchestrator(bundle), "unallocated-req-id")).toMatch(/비어 있음/);
    expect(gatePredicate(waveMaster(bundle), "unallocated-req-id")).toMatch(/합집합이 비었거나/);
    expect(gatePredicate(orchestrator(bundle), "files-not-grounded")).toMatch(/wave SDS 의 Files · Test Plan 경로/);
  });
});

describe("FR-FLOW-035 AC-3 — kiwi-wave-master forwards the loop flags to every per-wave call", () => {
  const LOOP = /\[--mini ?\| ?--loops N\]/;

  it.each(BUNDLES)("FR-FLOW-035 AC-3 %s: the per-wave /kiwi-srs and /kiwi-srs-feasibility calls carry the loop flags", (bundle) => {
    const register = section(waveMaster(bundle), /^## 4\. /m);
    const calls = fences(register).join("\n").split(/\n(?=Skill\()/);
    for (const skill of ["kiwi-srs", "kiwi-srs-feasibility"]) {
      const call = calls.find((c) => c.includes(`skill: "${skill}"`)) ?? "";
      expect(call, `${bundle}: §4 ${skill} call`).not.toBe("");
      expect(LOOP.test(call), `${bundle}: §4 ${skill} call must carry the loop flags`).toBe(true);
    }
    const propagate = section(waveMaster(bundle), /^### 7\.3 /m);
    expect(propagate).toMatch(/per-wave `kiwi-srs` 와 `parallel-waves\.md` 가 wave 마다 부르는 호출에 해당 플래그를 그대로 \*\*전파\(propagate\)\*\* 한다/);
  });

  // PW-15 / PW-17 (`kiwi-sds --close`) are left out: close-out runs no loop, so it has no round cap.
  it.each(CONTRACTS)("FR-FLOW-035 AC-3 %s: every looping per-wave call the contract makes carries the loop flags", (copy) => {
    const text = read(copy);
    const calls: Array<[string, string]> = [
      ["PW-2 kiwi-sds", fences(step(text, 2)).find((f) => f.includes('skill: "kiwi-sds"')) ?? ""],
      ["PW-6 kiwi-pm", fences(step(text, 6)).find((f) => f.includes("/kiwi-pm SDS_PATH=")) ?? ""],
      ["PW-6 worker review", fences(step(text, 6)).find((f) => f.includes('skill: "kiwi-review-fix-loop"')) ?? ""],
      ["PW-12 host review", fences(step(text, 12)).find((f) => f.includes('skill: "kiwi-review-fix-loop"')) ?? ""]
    ];
    for (const [name, call] of calls) {
      expect(call, `${copy}: ${name} call`).not.toBe("");
      expect(LOOP.test(call), `${copy}: ${name} must carry the loop flags`).toBe(true);
    }
  });
});

describe("FR-FLOW-188 AC-3 — the longest sds-id suffix follows the part and re-entry naming", () => {
  // A part is `<sds-id>-<k>` and a re-entry's sds-id is `{run_id}-wave-{n}-r{m}`, so a part of a
  // re-entry SDS ends `-wave-{n}-r{m}-{k}`; the cap argument is only sound for a suffix that can exist.
  it.each(CONTRACTS)("FR-FLOW-188 AC-3 %s: the §0 example suffix is a part of a re-entry SDS", (copy) => {
    const zero = section(read(copy), /^## 0\./);
    const match = /(?:가장 긴 접미사|the longest suffix) ?\(`([^`]+)`\)/.exec(zero);
    expect(match, `${copy}: §0 names the longest suffix`).not.toBeNull();
    expect(match?.[1], `${copy}: re-entry marker before the part index`).toMatch(/^-wave-\d+-r\d+-\d+$/);
  });
});

describe("FR-FLOW-123 AC-8 — the worktree procedure cites the join, the verdict and the merge and does not restate them", () => {
  const CITE_OPENING = /수확과 재생 사이의 join · 판정 · 병합은 `parallel-waves\.md` PW-7 ~ PW-9 가 소유한다/;
  const CITE_HARVEST = /그 뒤 join · 판정 · 병합은 `parallel-waves\.md` PW-7 ~ PW-9 를 따른다/;
  // The contract's own spellings of the three steps. None may appear in the procedure.
  const RESTATED = /--no-ff|git merge|`integrate-lane`|`verify-lane`|돌아오기를 기다|변경 경로 ⊆|base 가 head 의 조상|병합한다/;

  for (const bundle of BUNDLES) {
    for (const [skill, text, heading] of [
      ["kiwi-orchestrator", () => orchestrator(bundle), /^## 18 워크트리 절차/m],
      ["kiwi-wave-master", () => waveMaster(bundle), /^## 11 워크트리 절차/m]
    ] as const) {
      it(`FR-FLOW-123 AC-8 ${bundle}/${skill}: cited in the opening lines and the harvest step, restated nowhere in the section`, () => {
        const procedure = section(text(), heading);
        expect(procedure, `${bundle}/${skill}: worktree procedure`).not.toBe("");
        const opening = procedure.split(/^1\. /m)[0] as string;
        expect(opening, `${bundle}/${skill}: the opening lines cite the contract`).toMatch(CITE_OPENING);
        const harvest = lineOf(procedure, /^5\. \*\*수확\(harvest\)\*\*/);
        expect(harvest, `${bundle}/${skill}: the harvest step cites the contract`).toMatch(CITE_HARVEST);
        const offending = procedure.split("\n").filter((line) => RESTATED.test(line));
        expect(offending, `${bundle}/${skill}: the procedure restates a step the contract owns`).toEqual([]);
      });
    }
  }
});

describe("FR-FLOW-134 AC-8 — the --auto safety gate enumerates the review child with the per-wave children", () => {
  it.each(BUNDLES)("FR-FLOW-134 AC-8 %s: the §0.4 row names the four contract children and the directly-spawned review loop", (bundle) => {
    const row = lineOf(waveMaster(bundle), /^\| §0\.4 \|/);
    expect(row, `${bundle}: §0.4 row`).toMatch(
      /wave 마다 부르는 자식 — `[/$]kiwi-srs` · `[/$]kiwi-srs-feasibility` · `[/$]kiwi-sds` · 워커의 `[/$]kiwi-pm` — 과 §5\.55 · 개선 위임이 \*\*직접\*\* 호출한 `[/$]kiwi-review-fix-loop`/
    );
    expect(row).toMatch(/`NEEDS_USER` \/ `FAILED` 를 반환하거나 critical 게이트에 도달하면, `--auto` 라도 자동 진행을 중단/);
  });
});

describe("FR-FLOW-029 AC-2 — each wave's target is registered with a scope bounded to that wave", () => {
  it.each(BUNDLES)("FR-FLOW-029 AC-2 %s: §4 registers wave-{n} with an explicit scope and bounds every later stage to it", (bundle) => {
    const register = section(waveMaster(bundle), /^## 4\. /m);
    expect(lineOf(register, /^각 wave 마다/)).toMatch(
      /^각 wave 마다 `[/$]kiwi-srs` 를 호출하여 전용 `wave-\{n\}` \*\*target\(타깃\)\*\* 을 등록하되, 그 wave 의 \*\*작업 범위\(work scope\)\*\* 를 명시적으로 지정한다/
    );
    expect(lineOf(register, /^이때 지정한/)).toMatch(
      /\*\*범위\(scope\)\*\* 는 \*\*해당 wave 로 한정\(bounded\)\*\* 되어야 한다 — 뒤따르는 feasibility·SDS 작성·review 단계가 그 wave 의 범위를 \*\*넘어서지\(beyond\)\*\* 않고/
    );
    const call = fences(register).join("\n");
    expect(call).toMatch(/skill: "kiwi-srs", args: "REQ_PATH=<그 wave 의 excerpt_path>[^"]*TARGET=wave-\{n\}/);
    expect(call).toMatch(/skill: "kiwi-srs-feasibility", args: "TARGET=wave-\{n\}/);
  });
});
