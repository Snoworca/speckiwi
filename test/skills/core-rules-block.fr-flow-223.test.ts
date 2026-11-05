import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";
import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";

// FR-FLOW-223 — kiwi-wave-master and kiwi-pm carry a short block of their core rules inside the
// first 5,000 estimated tokens, the part of a skill Claude Code re-attaches after a compaction.
//
// The block restates rules the body and the `_shared/kiwi/` contracts already hold; it must not add
// one. So every line is held twice: the block says it, and the source the line cites still says the
// same thing — a block line whose source sentence is gone or changed fails here, as does a block
// that names a stop the closed lists do not, or misses one they do.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const shipped = (rels: string[]): string[] => rels.filter((rel) => existsSync(path.join(REPO_ROOT, rel)));
/** claude ships Korean shared contracts; codex, etc and the mirror ship parallel-waves.md in English. */
const korean = (root: string): boolean => root === "skills/claude";

/** Turns a MUST into a SHOULD; no block line may carry one. */
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면/;

/** The block: its heading up to the first horizontal rule after it. */
function block(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const end = text.indexOf("\n\n---\n", start);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The block's bullet whose bold label is `label`. */
function bullet(core: string, label: string): string {
  return core.split("\n").find((line) => line.startsWith(`- **${label}** — `)) ?? "";
}

/** A `##` / `###` / `####` section of a document, heading included, up to the next heading of the same or higher level. */
function section(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#{2,4}\s/.test(line) && heading.test(line));
  if (start < 0) return "";
  const level = (lines[start]?.match(/^#+/) ?? [""])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]?.match(/^(#+)\s/);
    if (m && (m[1] ?? "").length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const WM_HEADING = "## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)";
const PM_HEADING = "## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)";
const PRD_CORE_HEADING = "## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)";

const WM_ROOTS = shipped(RENDERINGS.map((root) => `${root}/kiwi-wave-master/SKILL.md`)).map((rel) => rel.replace(/\/kiwi-wave-master\/SKILL\.md$/, ""));
const PM_ROOTS = shipped(RENDERINGS.map((root) => `${root}/kiwi-pm/SKILL.md`)).map((rel) => rel.replace(/\/kiwi-pm\/SKILL\.md$/, ""));

/** One AC-1 item: the bullet label, the clauses the bullet carries, and the sentence its cited source still holds. */
interface Item {
  readonly label: string;
  readonly clauses: readonly string[];
  readonly source: (root: string) => [string, string];
}

const ITEMS: readonly Item[] = [
  {
    label: "순서",
    clauses: ["PRD(위 블록) → 제품 target 의 SRS 저작 한 번 → 요구 분해(작업 그래프) → wave 워커", "`wave-decomposition.md §2`"],
    source: (root) => [`${root}/_shared/kiwi/wave-decomposition.md`, "2. **처음 저작** — `wave-srs-registration.md §1` 의 호출 하나로 제품 target 의 SRS 를 쓴다."]
  },
  {
    label: "단위",
    clauses: [
      "요구 하나는 한 노드에 통째로 든다",
      "범위의 살아 있는 AC 는 정확히 한 노드의 `acs` 에 들고",
      "`ac-split`",
      "`wave-decomposition.md §3`"
    ],
    source: (root) => [`${root}/_shared/kiwi/wave-decomposition.md`, "한 요구의 AC 가 여러 노드로 나뉘면 같은 검사가 `ac-split` 경고를 낸다 — 요구 하나는 한 노드에 통째로 든다."]
  },
  {
    label: "의존",
    clauses: ["요구 사이 의존은 `depends_on` 링크", "그래프의 `edges` 와 stage 는 도구가 계산한다", "`orchestrate wave propose`", "`orchestrate schedule waves`", "`parallel-waves.md §2`"],
    source: (root) => [
      `${root}/_shared/kiwi/parallel-waves.md`,
      korean(root) ? "노드 사이의 의존은 `edges` 다. 간선이 없으면 의존도 없다" : "the dependencies between nodes are its `edges`. No edge means no dependency"
    ]
  },
  {
    label: "쓰기 소유",
    clauses: [
      "워커는 SRS 를 쓰지 않고 `docs/spec/` · `docs/sds/` · `kiwi/pipeline.jsonl` · `kiwi/waves.jsonl` 에 쓰지 않는다",
      "`srs_deltas[]` 로 보고",
      "`parallel-waves.md` PW-1 · PW-6"
    ],
    source: (root) => [
      `${root}/_shared/kiwi/parallel-waves.md`,
      korean(root)
        ? "**워커는 SRS 를 쓰지 않고 `docs/spec/` · `docs/sds/` · `kiwi/pipeline.jsonl` · `kiwi/waves.jsonl` 에 쓰지 않는다.**"
        : "**A worker writes neither the SRS nor `docs/spec/`, `docs/sds/`, `kiwi/pipeline.jsonl` or `kiwi/waves.jsonl`.**"
    ]
  },
  {
    label: "범위",
    clauses: ["PRD 항목도 `fills:` 도 인용하지 않는 확장은 사용자가 정한다", "`prd-residual-user-decision`", "`wave-srs-registration.md §2`"],
    source: (root) => [`${root}/_shared/kiwi/wave-srs-registration.md`, "PRD 항목도 `fills:` 도 인용하지 않는 확장은 `prd-residual-user-decision` 으로 멈춘다"]
  },
  {
    label: "불변",
    clauses: ["dispatch 한 wave 의 순서 · 범위 · 의존은 바꾸지 않는다", "끝난 wave 의 `verified` 동작을 옮기는 길은 후속 요구와 AC 만료뿐이다", "(§0.5)"],
    source: (root) => [`${root}/kiwi-wave-master/SKILL.md`, "끝난 wave 의 `verified` 동작을 옮기는 길은 후속 요구와 AC 만료뿐이다(`wave-srs-registration.md §2`)."]
  },
  {
    label: "검증",
    clauses: ["심각도를 매기지 않는다", "검증자가 쓴 테스트 가운데 호스트가 돌려 red 인 것만 kept finding 으로 남는다", "`verify-loop.md §4`"],
    source: (root) => [`${root}/_shared/kiwi/verify-loop.md`, "호스트가 그 테스트를 돌려 red 인 것만 finding 으로 남기고(kept)"]
  },
  {
    label: "승급",
    clauses: ["착지한 요구만 승급한다", "`parallel-waves.md` PW-16"],
    source: (root) => [`${root}/_shared/kiwi/parallel-waves.md`, korean(root) ? "승급 집합은 착지한 요구뿐이다" : "The promotion set is the landed requirements only"]
  },
  {
    label: "재개",
    clauses: ["진행 상황과 재개 상태(재개 커서의 dispatch base 는 노드 행의 `base_sha`)는 `speckiwi orchestrate wave status --json` 하나로 읽고", "`kiwi/waves.jsonl` 과 그래프 파일을 손으로 읽지 않는다", "(§6)"],
    source: (root) => [`${root}/kiwi-wave-master/SKILL.md`, "진행 상황과 재개 상태는 `speckiwi orchestrate wave status --json` 으로 읽고, `kiwi/waves.jsonl` 과 그래프 파일을 손으로 읽지 않는다."]
  }
];

/** The stops §7.5.1's table and §7.5.2's sentence keep closed under `--drive`, read from the body. */
function closedStops(text: string): string[] {
  const table = section(text, /^####\s*7\.5\.1\s/);
  const rows = table.split("\n").filter((line) => /^\| `[a-z0-9-]+` \|/.test(line));
  const fromTable = rows.map((line) => line.match(/^\| `([a-z0-9-]+)` \|/)?.[1] ?? "");
  const residual = section(text, /^####\s*7\.5\.2\s/).split("\n").find((line) => line.includes("`--drive` 에서도 중단이다")) ?? "";
  const fromResidual = [...residual.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1] ?? "").filter((id) => id !== "--drive");
  return [...fromTable, ...fromResidual];
}

describe("FR-FLOW-223 AC-1 — kiwi-wave-master's core rules block, inside the first 5,000 estimated tokens", () => {
  for (const root of WM_ROOTS) {
    const rel = `${root}/kiwi-wave-master/SKILL.md`;

    it(`${rel}: the block exists, ends within ${COMPACTION_TOKEN_BUDGET} estimated tokens and follows the PRD block`, () => {
      // @req FR-FLOW-223 AC-1
      const text = read(rel);
      const core = block(text, WM_HEADING);
      expect(core, `${rel}: no core rules block`).not.toBe("");
      expect(tokensThrough(text, core)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
      expect(text.indexOf(PRD_CORE_HEADING), `${rel}: the PRD block must stay first`).toBeLessThan(text.indexOf(WM_HEADING));
      expect(core).toContain("이 블록은 본문과 `_shared/kiwi/` 계약에 이미 있는 규칙의 요약이다");
    });

    for (const item of ITEMS) {
      it(`${rel}: the ${item.label} line says what its source says`, () => {
        // @req FR-FLOW-223 AC-1
        const line = bullet(block(read(rel), WM_HEADING), item.label);
        expect(line, `${rel}: no ${item.label} line`).not.toBe("");
        for (const clause of item.clauses) expect(line, `${rel}: ${item.label}`).toContain(clause);
        expect(HEDGE.test(line), `${rel}: the ${item.label} line must not hedge`).toBe(false);
        const [source, sentence] = item.source(root);
        expect(read(source), `${source}: the source of the ${item.label} line`).toContain(sentence);
      });
    }

    it(`${rel}: the closed-stop line names exactly the stops §7.5.1 and §7.5.2 keep closed`, () => {
      // @req FR-FLOW-223 AC-1
      const text = read(rel);
      const line = bullet(block(text, WM_HEADING), "닫힌 중단");
      expect(line, `${rel}: no closed-stop line`).not.toBe("");
      expect(line).toContain("`--drive` 로도 열리지 않고(§7.5.1 · §7.5.2)");
      expect(line).toContain("`--auto` 는 critical gate 를 열지 않는다(§7.1)");
      const listed = [...line.slice(line.indexOf(":")).matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1] ?? "");
      const body = closedStops(text);
      expect(body.length, `${rel}: the closed lists were not found`).toBeGreaterThan(10);
      expect(listed).toEqual(body);
      expect(HEDGE.test(line), `${rel}: the closed-stop line must not hedge`).toBe(false);
    });
  }

  it("the block says the same thing in every rendering", () => {
    // @req FR-FLOW-223 AC-1 — no rendering may drift from the others.
    const blocks = WM_ROOTS.map((root) => block(read(`${root}/kiwi-wave-master/SKILL.md`), WM_HEADING));
    expect(new Set(blocks).size).toBe(1);
  });
});

describe("FR-FLOW-223 AC-2 — kiwi-pm's core rules block, inside the first 5,000 estimated tokens", () => {
  for (const root of PM_ROOTS) {
    const rel = `${root}/kiwi-pm/SKILL.md`;

    it(`${rel}: requirements are read by ID whatever their target, and the test commit comes first`, () => {
      // @req FR-FLOW-223 AC-2
      const text = read(rel);
      const core = block(text, PM_HEADING);
      expect(core, `${rel}: no core rules block`).not.toBe("");
      expect(tokensThrough(text, core)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
      expect(text.indexOf(PM_HEADING), `${rel}: the block must precede §0`).toBeLessThan(text.indexOf("\n## 0. "));

      const byId = bullet(core, "요구는 ID 로 읽는다");
      expect(byId).toContain("`--req-filter` 의 요구는 하나씩 `get_requirement` 로 읽는다");
      expect(byId).toContain("그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다");
      expect(byId).toContain("(§1.1)");
      expect(HEDGE.test(byId), `${rel}: the by-ID line must not hedge`).toBe(false);

      const testFirst = bullet(core, "테스트 커밋이 먼저다");
      expect(testFirst).toContain("요구마다 테스트 커밋이 구현 커밋보다 앞선다");
      expect(testFirst).toContain("`REQ: <요구 ID>`");
      expect(testFirst).toContain("`Commit-Kind: test` · `Commit-Kind: implementation`");
      expect(testFirst).toContain("(§1.5)");
      expect(HEDGE.test(testFirst), `${rel}: the test-first line must not hedge`).toBe(false);
    });

    it(`${rel}: both lines restate rules §1.1 and §1.5 already hold`, () => {
      // @req FR-FLOW-223 AC-2 — the block adds no rule.
      const text = read(rel);
      const body = text.slice(text.indexOf("\n## 0. "));
      expect(body).toContain("그 요구가 어느 target 에 있든 읽고, 활성 target 에 없다는 이유로 빼지 않는다");
      expect(body).toContain("테스트 커밋이 구현 커밋보다 앞선다");
    });
  }

  it("the block says the same thing in every rendering", () => {
    // @req FR-FLOW-223 AC-2
    const blocks = PM_ROOTS.map((root) => block(read(`${root}/kiwi-pm/SKILL.md`), PM_HEADING));
    expect(new Set(blocks).size).toBe(1);
  });
});
