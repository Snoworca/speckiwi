import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, section } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-183 AC-1, AC-3 — kiwi-wave-master closes a wave's SDS out through `parallel-waves.md`:
// PW-15 runs `kiwi-sds --close` BEFORE the PW-16 promotion to move the interpretation decisions into
// the SRS, and PW-17 runs the same entry point again AFTER it, which deletes the SDS once every `@req`
// requirement is verified or discarded. The wave-master step that walks PW-14 to PW-17 is held as an
// ordered chain, so dropping either call or moving it across the promotion turns this red.

const CONTRACTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/_shared/kiwi/parallel-waves.md`);
const BUNDLES = ["claude", "codex", "etc"] as const;

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** The paragraph of step PW-k inside `## 5.`, from its bold marker to the next one. */
function pwStep(text: string, k: number): string {
  const numbered = section(text, /^## 5\./);
  const marks = [...numbered.matchAll(/^\*\*PW-(\d+)\b/gm)];
  const index = marks.findIndex((mark) => Number(mark[1]) === k);
  if (index < 0) return "";
  const start = marks[index]?.index as number;
  const end = index + 1 < marks.length ? (marks[index + 1]?.index as number) : numbered.length;
  return numbered.slice(start, end).trim();
}

const CLOSE_CALL = '`Skill({ skill: "kiwi-sds", args: "--close {run_id}-wave-{n} --no-pipeline-emit [--auto]" })`';

describe("FR-FLOW-183 AC-1 / AC-3 — parallel-waves.md closes out around the promotion", () => {
  it.each(CONTRACTS)("FR-FLOW-183 AC-1 %s: PW-15 runs kiwi-sds --close before the PW-16 promotion and moves the decisions into the SRS", (contract) => {
    const text = read(contract);
    const move = pwStep(text, 15);
    expect(move, `${contract}: PW-15 is not the moving close-out`).toMatch(/^\*\*PW-15 · SDS close-out, (?:옮김|moving) — (?:호스트|host)\.\*\*/);
    expect(move, `${contract}: PW-15 does not call kiwi-sds --close`).toContain(CLOSE_CALL);
    expect(move, `${contract}: PW-15 does not move the interpretation decisions into the SRS`).toMatch(
      /SDS-AC 의 해석 결정을 SRS AC 의 명확화로 옮기고|moves each SDS-AC interpretation decision into the SRS as a clarification of that AC/
    );
    expect(pwStep(text, 16), `${contract}: the step after PW-15 is not the promotion`).toMatch(/^\*\*PW-16 · (?:승급|Promotion) — /);
  });

  it.each(CONTRACTS)("FR-FLOW-183 AC-3 %s: PW-17 runs the same kiwi-sds --close after the promotion, which deletes the SDS once every @req requirement is promoted", (contract) => {
    const remove = pwStep(read(contract), 17);
    expect(remove, `${contract}: PW-17 is not the deleting close-out`).toMatch(/^\*\*PW-17 · SDS close-out, (?:삭제|deletion) — (?:호스트|host)\.\*\*/);
    expect(remove, `${contract}: PW-17 does not call kiwi-sds --close again`).toMatch(
      /같은 `kiwi-sds --close` 를 한 번 더 부른다\.|The same `kiwi-sds --close` runs once more\./
    );
    expect(remove, `${contract}: PW-17 does not delete the SDS once every @req requirement is verified or discarded`).toMatch(
      /`@req` 요구가 모두 `verified` 또는 `discarded` 이면 SDS 파일이 지워지고|When every `@req` requirement is `verified` or `discarded`, the SDS file is deleted/
    );
  });
});

describe("FR-FLOW-183 AC-1 / AC-3 — kiwi-wave-master walks PW-14 to PW-17 in order", () => {
  it.each(BUNDLES)("FR-FLOW-183 AC-1 AC-3 %s: kiwi-wave-master moves through kiwi-sds --close, promotes, then deletes through the same kiwi-sds --close", (bundle) => {
    const rel = `skills/${bundle}/kiwi-wave-master/SKILL.md`;
    const lines = read(rel).split("\n").filter((line) => /`parallel-waves\.md` PW-14 ~ PW-17 을 돈다 — /.test(line));
    expect(lines, `${rel}: no single step walks parallel-waves.md PW-14 to PW-17`).toHaveLength(1);
    const line = lines[0] as string;

    const chain = /PW-14 ~ PW-17 을 돈다 — (.*?)\. 두 `kiwi-sds --close` 는/.exec(line)?.[1] ?? "";
    const links = chain.split(" → ");
    expect(links, `${rel}: the chain is not test sufficiency → move → promote → delete`).toHaveLength(4);
    expect(links[0]).toMatch(/^테스트 충분성 확인/);
    expect(links[1]).toBe("`kiwi-sds --close` 로 해석 결정을 SRS 로 옮김");
    expect(links[2]).toMatch(/^승급\(/);
    expect(links[3]).toBe("같은 `kiwi-sds --close` 로 SDS 삭제");
    expect(line, `${rel}: the two calls are not tied to PW-15 and PW-17`).toMatch(/두 `kiwi-sds --close` 는 그 wave 의 sds-id 마다 — [^.]*부른다\(PW-15 · PW-17\)\./);
  });
});
