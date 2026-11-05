import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-220 — wave-end and final verification run the machine checks first, then one fresh verifier
// per round (two under --max) whose only kept findings are the tests it writes that run red.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const LOOP = RENDERINGS.map((root) => `${root}/_shared/kiwi/verify-loop.md`);
const WAVE_MASTER = ["skills/claude", "skills/codex", "skills/etc"].map((root) => `${root}/kiwi-wave-master/SKILL.md`);
const ORCHESTRATOR = RENDERINGS.map((root) => `${root}/kiwi-orchestrator/SKILL.md`);

/** `## n.` of a document, up to the next `## `. */
function chapter(text: string, n: number): string {
  const start = text.search(new RegExp(`\\n## ${n}\\. `));
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start + 4);
  return text.slice(start, next < 0 ? undefined : next);
}

describe("FR-FLOW-220 AC-1 — the machine checks run first, each failure to its own fix path", () => {
  it.each(LOOP)("%s: §2 lists the six checks and runs them before any verifier round", (rel) => {
    // @req FR-FLOW-220 AC-1
    const text = read(rel);
    const checks = chapter(text, 2);
    expect(checks, `${rel}: §2 not found`).toContain("## 2. 기계 검사가 먼저다");
    expect(checks).toContain("병합 뒤 `complete` 줄 앞에서, 검증자를 띄우기 전에 호스트가 아래 검사를 차례로 돈다");
    expect(checks).toContain("실패는 그 행의 경로로 먼저 고치고, 모두 통과한 뒤에야 §4 의 라운드에 들어간다");
    for (const command of [
      "`speckiwi orchestrate wave check",
      "`speckiwi prd coverage",
      "`speckiwi coverage --tests",
      "`check_test_sufficiency`",
      "`Commit-Kind: test` 커밋이 `Commit-Kind: implementation` 커밋의 조상",
      "`speckiwi orchestrate preservation check --base",
      "`failing_tests ⊆ baseline_failing_tests`"
    ]) {
      expect(checks, `${rel}: ${command}`).toContain(command);
    }
    const rows = checks.split("\n").filter((line) => /^\| [^-|]/.test(line) && !line.startsWith("| 검사 |"));
    expect(rows.length, `${rel}: one row per machine check`).toBe(6);
    for (const row of rows) expect(row.split("|").filter((cell) => cell.trim() !== "").length, `${rel}: ${row}`).toBe(3);
    expect(text.indexOf("## 2. 기계 검사가 먼저다")).toBeLessThan(text.indexOf("## 3. "));
  });
});

describe("FR-FLOW-220 AC-1 — wave-master names what the preservation check reports", () => {
  it.each(WAVE_MASTER)("%s: §5.5.2 lists the classes once judged by a second verifier", (rel) => {
    // @req FR-FLOW-220 AC-1 — moved from FR-FLOW-048 AC-5 (expired): the classes are the tool's now.
    const text = read(rel);
    const start = text.indexOf("\n### 5.5.2 ");
    const scope = text.slice(start, text.indexOf("\n### ", start + 1));
    expect(scope, `${rel}: §5.5.2 not found`).toContain("`orchestrate preservation check` 가 삭제·이동된 기존 파일, 바뀐 기존 export, 지운 테스트 · 케이스 · 단언을 보고하고");
  });
});

describe("FR-FLOW-220 AC-2 — one new verifier per round, two under --max, given only the facts", () => {
  it.each(LOOP)("%s: §3 spawns a fresh verifier per round with the closed input list", (rel) => {
    // @req FR-FLOW-220 AC-2
    const verifier = chapter(read(rel), 3);
    expect(verifier).toContain("라운드마다 검증자를 **새로** 하나 띄운다 — `--max` 면 서로 다른 관점의 둘이다");
    expect(verifier).toContain(
      "검증자에게 주는 것은 PRD 경로와 wave 의 PRD 항목(`prd_items`), wave 의 요구 ID 와 AC, wave 의 diff 창, 통합 항목, PRD 의 제외 항목, run 의 제약 파일(`constraints_path`)뿐이다"
    );
    expect(verifier).toContain("호스트의 결론도 앞 검증자의 산출도 주지 않는다");
  });
});

describe("FR-FLOW-220 AC-2 — the skills that restate the input list carry the constraints file", () => {
  it.each([...WAVE_MASTER, ...ORCHESTRATOR])("%s: the verifier input sentence names constraints_path", (rel) => {
    // @req FR-FLOW-220 AC-2
    const sentence = read(rel).split("\n").find((line) => line.includes("검증자에게 주는 것은")) ?? "";
    expect(sentence, `${rel}: no verifier input sentence`).not.toBe("");
    expect(sentence).toContain("run 의 제약 파일(`constraints_path`)");
  });
});

describe("FR-FLOW-220 AC-3 — a finding is a test the verifier wrote that the host ran red", () => {
  it.each(LOOP)("%s: §4 keeps red tests, drops green or uncited ones, unions under --max", (rel) => {
    // @req FR-FLOW-220 AC-3
    const round = chapter(read(rel), 4);
    expect(round).toContain(
      "검증자는 결함을 드러낸다고 보는 테스트를 하나씩 임시 파일에 쓰고, 테스트마다 `<REQ-ID> AC-<n>` · 통합 항목 · `PRD-<n>` · 선언된 제약(`constraints_path` 의 항목 `id`) 가운데 하나를 인용한다"
    );
    expect(round).toContain(
      "호스트가 그 테스트를 돌려 red 인 것만 finding 으로 남기고(kept), green 인 테스트와 아무것도 인용하지 않은 테스트는 버린다(dropped)"
    );
    expect(round).toContain("`--max` 면 두 검증자의 kept finding 을 합집합으로 합친다");
  });
});

describe("FR-FLOW-220 AC-4 — kept defects go to the review loop, kept gaps to the delta path, kept tests stay", () => {
  it.each(LOOP)("%s: §7 routes by kind and commits every kept test", (rel) => {
    // @req FR-FLOW-220 AC-4
    const routing = chapter(read(rel), 7);
    const row = (head: string): string => routing.split("\n").find((line) => line.startsWith(`| ${head} |`)) ?? "";
    expect(row("kept 코드 결함")).toMatch(/`kiwi-review-fix-loop` 위임\. \*\*명시 범위\*\*\(`--base`\/`--head` 또는 `--commits`\)/);
    expect(row("kept 요구 갭")).toContain("`srs_deltas[]` 와 같은 모양의 델타로 `wave-srs-registration.md §2` 의 증분 저작에 넣는다(FR-FLOW-218)");
    expect(routing).toContain("kept 테스트는 고친 뒤 그 wave 의 회귀 테스트로 커밋한다");
  });
});

describe("FR-FLOW-220 AC-5 — a pass is a round with no red test and no fix; the cap is never a pass", () => {
  it.each(LOOP)("%s: §5 passes only a clean, fix-free round and keeps the caps", (rel) => {
    // @req FR-FLOW-220 AC-5
    const exit = chapter(read(rel), 5);
    expect(exit).toContain("새 검증자가 red 테스트를 하나도 쓰지 않았고 그 라운드에 수정이 적용되지 않은 라운드에서만 통과한다");
    expect(exit).toContain("**cap 소진은 PASS 가 아니다.**");
    expect(exit).toMatch(/기본 \*\*5\*\*, `--max` \*\*8\*\*, `--mini` 3/);
  });
});

describe("FR-FLOW-220 AC-6 — integration items come from cross-node links and edges", () => {
  it.each(LOOP)("%s: §3 defines the integration items", (rel) => {
    // @req FR-FLOW-220 AC-6
    expect(chapter(read(rel), 3)).toContain(
      "통합 항목은 서로 다른 노드의 요구 사이에 있는 `Requirement` / `depends_on` 링크와, 양 끝 노드가 서로 다른 요구를 가진 그래프 간선이다 — 항목마다 그 간선의 `reason` 을 설명으로 싣는다"
    );
  });
});

describe("FR-FLOW-220 AC-7 — the final verification reuses the checks and the verifier model over the whole run", () => {
  it.each(WAVE_MASTER)("%s: §5.6 runs the same checks and verifier over every AC and integration item", (rel) => {
    // @req FR-FLOW-220 AC-7
    const text = read(rel);
    const start = text.indexOf("\n## 5.6 ");
    const final = start < 0 ? "" : text.slice(start, text.indexOf("\n## ", start + 4));
    expect(final, `${rel}: §5.6 not found`).not.toBe("");
    expect(final).toContain(
      "최종 검증은 마지막 노드 뒤에 같은 기계 검사와 같은 검증자 모델을 run 의 모든 AC 와 모든 통합 항목의 합집합에 돈다 — 설계 기준선 분모는 없다"
    );
    expect(final, `${rel}: no design-baseline denominator remains`).not.toMatch(/design_items|설계 기준선 \*\*전체\*\*|정확히 2기/);
  });

  it.each(ORCHESTRATOR)("%s: loop F uses the same model, with no design-item denominator", (rel) => {
    // @req FR-FLOW-220 AC-7
    const text = read(rel);
    const start = text.indexOf("\n### §V.final-verify");
    const final = text.slice(start, text.indexOf("\n### §V.emit-and-finish", start));
    expect(final).toContain("`verify-loop.md` 의 기계 검사와 검증자 모델을 run 의 모든 AC 와 모든 통합 항목의 합집합에 돈다");
    expect(final, `${rel}: §V.final-verify still counts design items`).not.toContain("design_items");
  });
});
