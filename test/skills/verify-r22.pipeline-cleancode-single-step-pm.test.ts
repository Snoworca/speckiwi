// Round-22 verification. kiwi-pipeline §2.5.3 names "자식 `--resume` 뒤 T1 추천을 따르는 호출" as a way to continue a
// cycle that stopped before its review hop, and says that call forwards the recorded clean-code answer to the review
// hop. But a pipeline call without work input spawns one T1 step (§7.1 "작업 입력 없는 단일 단계 `--run`"): after
// kiwi-srs-feasibility the T1 step is `kiwi-pm`, spawned without `--review-hop-owned-by-parent` (that flag exists only
// on the §2.5 chain lines). kiwi-pm then hands off to kiwi-review-fix-loop itself ("인자가 없으면 진입 경로를
// 추론하지 않고 언제나 넘긴다"), and that hand-off carries a clean-code flag only from kiwi-pm's own speed-signal
// question — kiwi-pm takes no `--skip-clean-code` / `--keep-clean-code` from a parent, and the pipeline gives kiwi-pm
// neither the flag nor the speed words. So the review hop runs up to three clean-code rounds the user already chose
// to skip (request B "최초에 한 번 물어보고 클린 코드 검사를 진행하지 않도록", FR-FLOW-206 AC-5 "pass
// `--skip-clean-code` to every review hop").
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

function skillText(root: string, skill: string): string {
  const dir = join(root, skill);
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".md")) out.push(readFileSync(p, "utf8").replace(/\r\n/g, "\n"));
    }
  };
  walk(dir);
  return out.join("\n");
}

describe("verify-r22 — the recorded clean-code answer reaches kiwi-pm's own review hand-off on the T1 single-step path", () => {
  for (const root of ROOTS) {
    // @req FR-FLOW-206 AC-5 — precondition: the T1 path is a named continuation route, and kiwi-pm without the parent-owned flag hands off itself.
    it(`${root}: precondition — T1 continuation is named, and kiwi-pm hands off unless told the parent owns the review hop`, () => {
      const pipeline = skillText(root, "kiwi-pipeline");
      const pm = skillText(root, "kiwi-pm");
      expect(pipeline).toContain("자식 `--resume` 뒤 T1 추천을 따르는 호출");
      expect(pipeline).toContain("작업 입력 없는 단일 단계 `--run`");
      expect(pm).toContain("인자가 없으면 진입 경로를 추론하지 않고 언제나 넘긴다");
      const ownedLines = pipeline.split("\n").filter((l) => l.includes("--review-hop-owned-by-parent"));
      // every pipeline line that passes the parent-owned flag is a §2.5 chain line, not the single-step spawn
      for (const line of ownedLines) expect(/사이클|체인|kiwi-srs →/.test(line)).toBe(true);
    });

    // @req FR-FLOW-206 AC-5 — the confirmed skip must reach the review hop that kiwi-pm runs on that path.
    it(`${root}: the pipeline passes the recorded answer to a single-step kiwi-pm, or kiwi-pm forwards a parent's clean-code flag`, () => {
      const pipeline = skillText(root, "kiwi-pipeline");
      const pm = skillText(root, "kiwi-pm");
      const pipelineGivesPm = pipeline
        .split("\n")
        .some((l) => l.includes("kiwi-pm") && /--skip-clean-code|clean_code_skip/.test(l) && /단일 단계|T1/.test(l));
      const pmTakesParentFlag = /(부모|호출자)[^\n]{0,60}`--skip-clean-code`[^\n]{0,80}(넘겼으면|받으면|넘기면)|`--skip-clean-code`[^\n]{0,40}(를|을) (받으면|넘겨받으면)/.test(pm);
      expect(
        pipelineGivesPm || pmTakesParentFlag,
        "a single-step kiwi-pm spawned on the T1 continuation hands off to kiwi-review-fix-loop with no clean-code flag",
      ).toBe(true);
    });
  }
});
