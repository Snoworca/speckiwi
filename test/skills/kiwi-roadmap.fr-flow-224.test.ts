import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { toolSchemas } from "../../src/mcp/server.js";
import { mcp, roadmapWorkspace } from "../cli/roadmap-surface-fixture.js";

import { BILINGUAL_SEARCH_RULE } from "../../src/core/bootstrap/templates.js";
import { mirrorSkills } from "../../src/core/skills/mirror-skills.js";
import { EXPECTED_KIWI_SKILLS } from "../../src/doctor/package-doctor.js";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, readRepoFile } from "./kiwi-renderings.js";
import { COMPACTION_TOKEN_BUDGET, estimateTokens, tokensThrough } from "./skill-token-estimate.js";

// @req FR-FLOW-224 — kiwi-roadmap turns the user's words about features, milestones and schedules into
// roadmap tool calls, keeps its four core rules in its first ten lines, stays small, and hands a started
// item to kiwi-prd. The AC numbers are the FR-FLOW-224 block in docs/spec/60.workflow-release.srs.md.
//
// Each rule is held as a WHOLE LINE, not a substring: an exception appended to a rule ("— `--auto` 면
// 예외"), a hedge inside it or a rule moved below line ten changes the line and turns this red. What a
// line does not cover — a contrary block written beside the rules — is held by the section hashes of
// roadmap-rule-blocks.fr-flow-224-226.test.ts.

const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
type Rendering = (typeof RENDERINGS)[number];
/** How each rendering calls another skill: `/kiwi-x` for Claude Code, `$kiwi-x` for Codex, a bare name for etc. */
const CALL_PREFIX: Record<Rendering, string> = { "skills/claude": "/", "skills/codex": "$", "skills/etc": "", ".agents/skills": "$" };
const copy = (root: Rendering): string => `${root}/kiwi-roadmap/SKILL.md`;
const read = (root: Rendering): string => readRepoFile(copy(root)).replace(/\r\n/g, "\n");
const lines = (root: Rendering): string[] => read(root).split("\n");

/** FR-FLOW-224 AC-2: the four rules, in this order, as lines 7–10 of every rendering. */
const ROADMAP_CORE_RULES = [
  "1. 로드맵은 로드맵 도구(`add_roadmap_item` · `update_roadmap_item` · `sync_roadmap_actuals`)로만 바꾼다 — `docs/roadmap.md` 를 손으로 고치지 않는다.",
  "2. 로드맵에 상태를 쓰지 않는다 — 상태와 진행률은 도구가 SRS 에서 계산하고, 멈춤과 취소만 `lifecycle` 의 `paused` · `cancelled` 로 적는다.",
  "3. 로드맵을 쓰는 호출(`add_roadmap_item` · `update_roadmap_item`, `dryRun` 으로 부를 때 포함)에는 늘 `reason` 을 넣고, 일정을 바꾸는 쓰기에는 사용자 원문을 따옴표째 넣는다.",
  "4. 항목을 `cancelled` 로 바꾸는 것은 사용자가 취소하라고 말했을 때뿐이다 — `--auto` 에서도 그렇다.",
] as const;

/** FR-FLOW-224 AC-4: the order of one run, each step a whole line. */
const ORDER_STEPS = [
  ["read before asking, with a bilingual search",
    `1. 묻기 전에 \`list_roadmap_items\` 와 \`get_active_target\` 을 부르고, 사용자 말의 낱말로 \`search_requirements\` 를 부른다. ${BILINGUAL_SEARCH_RULE}`],
  ["the user's words are sorted into tool calls",
    "2. 사용자 말을 나눈다 — 새 항목은 `add_roadmap_item`(등록된 target 의 항목이면 `fromTarget`), 일정·범위·연결 변경과 멈춤·취소는 `update_roadmap_item`, 조회는 `list_roadmap_items` · `get_roadmap_item`, 착수는 §2."],
  ["a date the user did not give stays -, and one question at a time",
    "3. 쓰기에 꼭 필요한 값은 `kind` · `title` · `reason` 뿐이다. 사용자가 말하지 않은 날짜는 `-` 로 둔다. 읽은 것이 답하지 못한 것만 묻고, 질문은 한 번에 하나만 한다."],
  ["the dry-run is shown before writing; only --auto writes at once",
    "4. 쓰기는 먼저 `dryRun` 을 true 로 불러 그 결과를 사용자에게 보이고, 사용자가 승인하면 같은 입력으로 쓴다. `--auto` 에서만 dry-run 을 건너뛰고 바로 쓴다."],
  ["the write is reported from the tool's answer",
    "5. 쓴 뒤에는 도구가 돌려준 항목 ID 와 바뀐 필드를 보고한다."],
] as const;

/** FR-FLOW-224 AC-5: the start handoff, two paragraphs, with the rendering's call prefix. */
const handoff = (prefix: string): string[] => [
  `사용자가 항목을 시작하자고 하면 \`get_roadmap_item\` 으로 그 항목을 읽고, 항목의 제목·Purpose·Features 를 요청 원문으로 \`ROADMAP_ITEM=RM-<n>\` 과 함께 \`${prefix}kiwi-prd\` 에 넘긴다.`,
  `\`kiwi-prd\` 가 돌아오면 돌려받은 PRD 경로를 \`update_roadmap_item\` 의 \`prd\` 로 그 항목에 기록한다. 다음 단계는 \`kiwi-prd\` 가 안내한 \`${prefix}kiwi-srs REQ_PATH=<PRD 경로> ROADMAP_ITEM=RM-<n>\` 이다.`,
];

/**
 * The roadmap grammar, which the tools enforce and the skill must not restate (AC-4): the item heading,
 * the metadata table, the item sections, the diagnostic codes and the coarse-date forms.
 */
const GRAMMAR = [
  ["the item heading", /^#{3} RM-/m],
  ["the metadata table", /\| Field \| Value \|/],
  ["an item section heading", /^#{4} /m],
  ["the Change History table", /Change History/],
  ["a roadmap diagnostic code", /ROADMAP-[EW]\d{3}/],
  ["a coarse-date form", /YYYY-(?:MM|Q)/],
] as const;

describe("FR-FLOW-224 AC-1 — kiwi-roadmap ships in every rendering and in the mirror", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-224 AC-1
    it(`${copy(root)} exists and is named kiwi-roadmap`, () => {
      expect(read(root), `${copy(root)} is missing`).not.toBe("");
      expect(read(root)).toMatch(/^---\nname: kiwi-roadmap\ndescription: "[^"\n]+"\n---\n/);
    });
  }

  // @req FR-FLOW-224 AC-1 — the mirror is produced by `skills mirror --write`, so it is not excluded from it.
  it("the .agents mirror does not exclude kiwi-roadmap, and skills mirror --check reports no divergence", async () => {
    expect(MIRROR_EXCLUDED).not.toContain("kiwi-roadmap");
    const result = await mirrorSkills({ projectRoot: REPO_ROOT, mode: "check" });
    expect(result.divergences).toEqual([]);
    expect(result.ok).toBe(true);
  });

  // @req FR-FLOW-224 AC-1 — the bundle doctor expects every shipped skill; one it does not list ships unchecked.
  it("the bundle doctor expects kiwi-roadmap in every variant", () => {
    expect(EXPECTED_KIWI_SKILLS).toContain("kiwi-roadmap");
  });

  // @req FR-FLOW-224 AC-1 — the Codex rendering carries the agent card every Codex skill carries.
  it.each(["skills/codex", ".agents/skills"])("%s/kiwi-roadmap carries agents/openai.yaml", (root) => {
    expect(existsSync(path.join(REPO_ROOT, root, "kiwi-roadmap", "agents", "openai.yaml"))).toBe(true);
    expect(readRepoFile(`${root}/kiwi-roadmap/agents/openai.yaml`)).toMatch(/display_name: "Kiwi Roadmap"/);
  });
});

describe("FR-FLOW-224 AC-2 — the four core rules are lines 7 to 10 of every rendering", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-224 AC-2
    it(`${copy(root)}: the first ten lines are the frontmatter, the title and exactly the four rules`, () => {
      const head = lines(root).slice(0, 10);
      expect(head[0]).toBe("---");
      expect(head[1]).toBe("name: kiwi-roadmap");
      expect(head[2]).toMatch(/^description: "/);
      expect(head[3]).toBe("---");
      expect(head[4]).toBe("# kiwi-roadmap v0.1");
      expect(head[5]).toBe("");
      expect(head.slice(6, 10)).toEqual([...ROADMAP_CORE_RULES]);
    });

    // @req FR-FLOW-224 AC-2 — measured with the shared estimate the compaction rules use.
    it(`${copy(root)}: the last core rule ends within ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
      const through = tokensThrough(read(root), ROADMAP_CORE_RULES[3]);
      expect(through).toBeGreaterThan(0);
      expect(through).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    });

    // @req FR-FLOW-224 AC-2 — a rule stated twice can be stated the second time with the exception.
    it(`${copy(root)}: no core rule line appears a second time`, () => {
      for (const rule of ROADMAP_CORE_RULES) expect(lines(root).filter((line) => line === rule)).toHaveLength(1);
    });
  }
});

describe("FR-FLOW-224 AC-3 — every rendering stays within 3,000 estimated tokens", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-224 AC-3
    it(`${copy(root)} is at most 3000 estimated tokens`, () => {
      expect(read(root)).not.toBe("");
      expect(estimateTokens(read(root))).toBeLessThanOrEqual(3000);
    });
  }
});

describe("FR-FLOW-224 AC-4 — read before asking, one question, `-` for an ungiven date, dry-run first, no grammar", () => {
  for (const root of RENDERINGS) {
    for (const [label, step] of ORDER_STEPS) {
      // @req FR-FLOW-224 AC-4
      it(`${copy(root)}: the order carries, as a whole line — ${label}`, () => {
        expect(lines(root)).toContain(step);
      });
    }

    // @req FR-FLOW-224 AC-4 — the steps are §1 itself, in order, with nothing between them.
    it(`${copy(root)}: §1 is exactly the five steps`, () => {
      const all = lines(root);
      const start = all.indexOf("## 1. 순서");
      expect(start).toBeGreaterThan(0);
      expect(all.slice(start, start + 8)).toEqual(["## 1. 순서", "", ...ORDER_STEPS.map(([, step]) => step), ""]);
      expect(all[start + 8]).toMatch(/^## 2\. /);
    });

    for (const [label, pattern] of GRAMMAR) {
      // @req FR-FLOW-224 AC-4
      it(`${copy(root)} does not restate the roadmap grammar — ${label}`, () => {
        expect(read(root)).not.toBe("");
        expect(read(root)).not.toMatch(pattern);
      });
    }
  }
});

describe("FR-FLOW-224 AC-2 · AC-4 — the reason the skill names is the one the tools take, so its dry-run is not refused", () => {
  /** The write tools core rule 3 names as the calls that always carry a reason. */
  const reasonTools = (root: Rendering): string[] =>
    [...(/^3\. 로드맵을 쓰는 호출\((.*?)\)에는/.exec(lines(root)[8] ?? "")?.[1] ?? "").matchAll(/`([a-z_]+_roadmap_[a-z_]+)`/g)].map((match) => match[1] as string);

  for (const root of RENDERINGS) {
    // @req FR-FLOW-224 AC-2 — every write the rule names takes a `reason`, and every roadmap write that takes one is named.
    it(`${copy(root)}: core rule 3 names exactly the roadmap writes whose schema declares reason`, () => {
      const writes = ["add_roadmap_item", "update_roadmap_item", "sync_roadmap_actuals"];
      const takesReason = writes.filter((tool) => "reason" in (toolSchemas[tool] as Record<string, unknown>));
      expect(takesReason.length).toBeGreaterThan(0);
      expect(reasonTools(root)).toEqual(takesReason);
    });

    // @req FR-FLOW-224 AC-4 — the dry-run built from exactly the values §1 step 3 names is a dry-run, not a refusal.
    it(`${copy(root)}: a new item's dry-run built from the values §1 step 3 names returns a dry-run result`, async () => {
      const step = lines(root).find((line) => line.startsWith("3. 쓰기에 꼭 필요한 값은")) ?? "";
      const named = [...(/^3\. 쓰기에 꼭 필요한 값은 (.*?) 뿐이다/.exec(step)?.[1] ?? "").matchAll(/`([a-zA-Z]+)`/g)].map((match) => match[1] as string);
      const values: Record<string, string> = { kind: "feature", title: "Ranked search", reason: "사용자: \"검색을 로드맵에 넣어줘\"" };
      expect(named.length, `${root}: §1 step 3 names the required values`).toBeGreaterThan(0);
      for (const name of named) expect(values, `${root}: ${name} is a value this test can supply`).toHaveProperty(name);
      const answer = await mcp(await roadmapWorkspace(), "add_roadmap_item", { ...Object.fromEntries(named.map((name) => [name, values[name]])), dryRun: true });
      expect({ ok: answer.ok, error: answer.error?.message ?? null }).toEqual({ ok: true, error: null });
    });
  }
});

describe("FR-FLOW-224 AC-5 — a started item goes to kiwi-prd with ROADMAP_ITEM, and its PRD path is recorded", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-224 AC-5
    it(`${copy(root)}: §2 is exactly the handoff to ${CALL_PREFIX[root]}kiwi-prd and the PRD-path update`, () => {
      const all = lines(root);
      const start = all.indexOf("## 2. 착수 — kiwi-prd 로 넘긴다");
      expect(start).toBeGreaterThan(0);
      const [first, second] = handoff(CALL_PREFIX[root]);
      expect(all.slice(start, start + 5)).toEqual(["## 2. 착수 — kiwi-prd 로 넘긴다", "", first, "", second]);
    });
  }
});
