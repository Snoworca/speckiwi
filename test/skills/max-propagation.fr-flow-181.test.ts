import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_MIRROR, ORCHESTRATOR_VARIANTS, readVariant, section, stripFrontmatter } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-181 — kiwi-orchestrator, kiwi-pipeline and kiwi-wave-master propagate --max to every
// sub-skill call that consumes it.
//
// Every check reads a flag from the place an agent copies it from: the argument string of a
// `Skill({ skill, args: "…" })` call, or the fenced invocation block of a handoff. A flag written
// beside the call, or in prose near it, is not credited — that is how an earlier version of this
// file passed with `[--max]` moved out of the §10 block into the paragraph below it.

const FLAG_SET = "[--auto] [--max] [--mini|--loops N]";

interface Rendering {
  id: string;
  relPath: string;
}

const ORCHESTRATOR: Rendering[] = [...ORCHESTRATOR_VARIANTS, { id: "mirror", relPath: ORCHESTRATOR_MIRROR }];
const PIPELINE: Rendering[] = [
  { id: "claude", relPath: "skills/claude/kiwi-pipeline/SKILL.md" },
  { id: "codex", relPath: "skills/codex/kiwi-pipeline/SKILL.md" },
  { id: "etc", relPath: "skills/etc/kiwi-pipeline/SKILL.md" },
  { id: "mirror", relPath: ".agents/skills/kiwi-pipeline/SKILL.md" }
];
// kiwi-wave-master has no .agents mirror; the mirror leaves it out on purpose.
const WAVE_MASTER: Rendering[] = [
  { id: "claude", relPath: "skills/claude/kiwi-wave-master/SKILL.md" },
  { id: "codex", relPath: "skills/codex/kiwi-wave-master/SKILL.md" },
  { id: "etc", relPath: "skills/etc/kiwi-wave-master/SKILL.md" }
];

const R_STEP = /^####\s+4\.5\.1\s+`R-STEP`/m;
const R_ORCH = /^####\s+4\.5\.3\s+`R-ORCH`/m;
// @req FR-FLOW-181 AC-3 — the worker executor lives in §10 (Phase 3.f – 3.j) since each wave runs in its own worker.
const PHASE_3F = /^##\s+10\.\s+Phase 3\.f/m;
/** The shared contract the R-ORCH row cites for the worker chain (FR-FLOW-188 AC-1). */
const PARALLEL_WAVES: Rendering[] = [
  { id: "claude", relPath: "skills/claude/_shared/kiwi/parallel-waves.md" },
  { id: "codex", relPath: "skills/codex/_shared/kiwi/parallel-waves.md" },
  { id: "etc", relPath: "skills/etc/_shared/kiwi/parallel-waves.md" },
  { id: "mirror", relPath: ".agents/skills/_shared/kiwi/parallel-waves.md" }
];
const FINAL_VERIFY_HOP = /^####\s+run 창 종료 리뷰 홉/m;

/** The four options kiwi-tdd has no gate for; none of them may reach it. */
const NOT_FOR_KIWI_TDD = ["--auto-integration", "--auto-cost-warning", "--force", "--regression-baseline"];

/**
 * The four children kiwi-pipeline spawns outside its five-stage chain that have no --max of their own
 * in the claude and codex renderings (in etc they run --max by default; AC-10).
 */
const PIPELINE_CHILDREN_WITHOUT_MAX = ["kiwi-srs-research", "kiwi-srs-from-code", "kiwi-commit-auto-pr", "kiwi-commit-auto-push"];

/**
 * The text this requirement owns, compared whole after bold markup is dropped and whitespace is
 * collapsed. Phrase checks alone let a qualifier slip into the middle of a pinned sentence ("전파한다,
 * 단 `--auto` 가 있을 때에 한해서"); a whole-text comparison does not. A rewording here is a change
 * to this contract and should fail loudly until the golden is updated with it.
 */
const GOLDEN = {
  rStepGrant:
    "`--auto` 와 `--max` 는 `kiwi-tdd` 자신에게도 전달한다: `kiwi-tdd` 는 `_shared/kiwi/auto-option.md` 를 따르고 자기 `critical_gates[]`(§0.AG)를 선언했으므로 `--auto` 는 자식에서 활성이다. 그 표 밖의 `sds-architecture-decision-approval` 은 business-decision 이라 `--auto` 에서 결정 위원회가 정하고, 그 위원회는 `--auto --max` 에서 5인이다(auto-option.md §2 · §7) — `--max` 를 빼면 무인 run 의 SDS 설계 결정이 3인 위원회로 조용히 줄어든다. `kiwi-tdd` 자신에게는 네 pass-through 를 전파하지 않는다 — 그 자식에게는 해당 게이트가 없다. 리뷰 hop 의 자식에 대한 전파는 이 문단 앞부분이 정한다.",
  rOrchRouted:
    "3.m 이 §13.2 의 분류로 라우팅하는 호출과 `verify-loop.md` §7 의 개선 위임이 부르는 호출도 위 블록의 호출 형태를 그대로 쓰고 `[--auto] [--max] [--mini|--loops N]` 을 함께 싣는다 — 범위를 좁히려고 `--req-filter` 나 `--sds-id` 를 더한 재실행도 마찬가지다.",
  pipelineTdd:
    "§2.8.2 가 사이클 대신 `kiwi-tdd` 로 라우팅할 때도 `--max` 를 그 `kiwi-tdd` 호출에 전파한다 — 위 목록만 읽으면 이 경로가 빠진다. `kiwi-tdd` 는 `_shared/kiwi/auto-option.md` 를 따르므로 `--auto` 와 함께일 때 결정 위원회를 5인으로 소집하고, 부모가 리뷰 홉 소유를 알리지 않는 이 경로에서는 자체 리뷰 홉(`kiwi-tdd` §2.6.1)에도 `[--max]` 를 넘긴다.",
  pipelineOutside:
    "사이클 밖에서 spawn 하는 자식에도 같은 기준을 쓴다 — 작업 입력 없는 단일 단계 `--run` 이 고른 스킬, T1 `DRY_RUN` 행이 다시 실행하는 직전 스킬(`kiwi-srs-sync` · `kiwi-hot-fix` 등), §6.2 에서 사용자가 직접 지정한 스킬이 여기 든다. 이 가운데 자기 `--max` 옵션이 있는 자식과, 자기 옵션은 없지만 자기 자식에게 `--max` 를 넘기는 자식(`kiwi-tdd`)에는 `--max` 를 그대로 전파한다. 아래 문단의 네 자식은 이 경로로 spawn 되어도 이 문단이 아니라 그 문단을 따른다.",
  pipelineFour:
    "사이클 밖에서 spawn 하는 자식 가운데 자기 `--max` 옵션이 없는 `kiwi-srs-research`(§2.7.1) · `kiwi-srs-from-code`(§3) · `kiwi-commit-auto-pr`(§2.6.3) · `kiwi-commit-auto-push`(§5.1 T1)에는 `--auto` 가 함께 켜졌을 때 `--auto --max` 를 전파한다(`auto-option.md` §7) — 이들에게 `--max` 가 바꾸는 것은 결정 위원회 규모뿐이다. `--auto` 없이 `--max` 만 켜졌으면 이 넷에는 `--max` 도 `--auto` 도 붙이지 않는다 — 사용자가 주지 않은 `--auto` 를 부모가 만들지 않는다(`auto-option.md` §7 표는 부모가 `--auto` 일 때만 자식 인자를 정한다).",
  // etc runs these four at --max by default, so "no --max of their own" would be false there, and
  // its default does not size the committee (local-llm-profile.md), so only a user-given --max counts.
  pipelineFourEtc:
    "사이클 밖에서 spawn 하는 `kiwi-srs-research`(§2.7.1) · `kiwi-srs-from-code`(§3) · `kiwi-commit-auto-pr`(§2.6.3) · `kiwi-commit-auto-push`(§5.1 T1)에는 `--auto` 가 함께 켜졌을 때 `--auto --max` 를 전파한다(`auto-option.md` §7) — etc 프로필에서는 넷이 이미 `--max` 로 돌므로 이것이 바꾸는 것은 결정 위원회 규모뿐이고, 그래서 여기서 `--max` 는 사용자가 명시한 것만 센다(etc 의 기본 `--max` 는 위원회를 5인으로 만들지 않는다 — `local-llm-profile.md`). `--auto` 없이 `--max` 만 켜졌으면 이 넷에는 `--max` 도 `--auto` 도 붙이지 않는다 — 사용자가 주지 않은 `--auto` 를 부모가 만들지 않는다(`auto-option.md` §7 표는 부모가 `--auto` 일 때만 자식 인자를 정한다).",
  pipelineRoutedSentence: "라우팅한 `kiwi-tdd` 호출에도 `--max` 를 전파한다(§7.1).",
  waveDelegation:
    "`--max` 는 개선 위임(§5.5.5 — 엔진 `verify-loop.md` §7, §5.5 와 §5.6 이 함께 쓴다)이 본 스킬이 직접 호출하는 세 호출에도 전파한다 — `kiwi-review-fix-loop` 위임, 그 wave target 의 `kiwi-srs` 증분 재진입, `--req-filter` 를 준 `kiwi-srs-feasibility` 재실행. 셋 다 계약의 wave 단계가 아니라 본 스킬이 spawn 하므로 위 첫 문단의 목록으로 덮이지 않는다. 같은 위임의 wave 재진입은 첫 문단이 덮고, §5.55 의 run 창 hop 은 호출 형태에 `[--max]` 를 이미 싣는다."
} as const;

/**
 * Sentence counts of text this requirement wrote into. §7.1 and R-STEP are counted with fenced blocks
 * removed so that a code block never merges with the sentence around it; the other units contain no
 * fence today. What each count catches is narrower than "any change":
 *
 * - pipeline71, routingBullet, wave72, rStepFlagParagraph count EVERY sentence of their unit, so a
 *   sentence added inside that unit is caught whatever it says.
 * - pipeline71Auto, rStepMaxSentences and rStepAutoSentences count only sentences that write the
 *   `--auto` or `--max` token. They catch a new paragraph or a rewording that names the token (an
 *   --auto handed to the four children in §7.1's first paragraph, a paragraph under the kiwi-tdd block
 *   that strips [--max] or calls the child's --auto ignored); one written without the token passes.
 * - A sentence REWRITTEN in place, keeping every count, is caught only where a golden above pins the
 *   text. FR-FLOW-026's §7.1 first paragraph, FR-FLOW-039's bullet sentences, FR-FLOW-029's §7.2
 *   paragraphs and the R-STEP paragraphs of FR-FLOW-099/132/172 are not pinned word for word.
 *
 * These units are shared with those requirements, so an edit made for one of them fails here too and
 * must update the count in the same change.
 */
const SECTION_SENTENCES = {
  pipeline71: 9,
  pipeline71Auto: 3,
  routingBullet: 3,
  wave72: 8,
  rStepFlagParagraph: 14,
  rStepMaxSentences: 3,
  rStepAutoSentences: 3
} as const;

/** The text with fenced code blocks replaced by a paragraph break, so sentence splitting ignores them. */
function withoutFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "\n\n");
}

/** Bold removed and whitespace collapsed, for whole-text comparison. */
function normalized(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function body(relPath: string): string {
  const text = readVariant(relPath);
  expect(text, `${relPath} is missing or empty`).not.toBe("");
  return stripFrontmatter(text);
}

function sectionOf(relPath: string, heading: RegExp): string {
  const found = section(body(relPath), heading);
  expect(found, `${relPath}: section ${heading} not found`).not.toBe("");
  return found;
}

/**
 * The argument string of the first `Skill({ skill: "<skill>", args: "…" })` call in `text`: only
 * the characters between the quotes after `args:`, and only when both quotes close before the call
 * does. A flag placed after `" })` is outside the string an agent sends and is not returned.
 */
function argsOf(text: string, skill: string): string {
  const call = text.indexOf(`skill: "${skill}"`);
  expect(call, `no Skill call for ${skill}`).toBeGreaterThanOrEqual(0);
  const callEnd = text.indexOf("})", call);
  const argsKey = text.indexOf("args:", call);
  const open = text.indexOf('"', argsKey);
  const close = text.indexOf('"', open + 1);
  expect(callEnd, `${skill}: the call never closes`).toBeGreaterThan(call);
  expect(argsKey > call && argsKey < callEnd, `${skill}: args is not part of this call`).toBe(true);
  expect(close > open && close < callEnd, `${skill}: args string does not close inside the call`).toBe(true);
  return text.slice(open + 1, close);
}

/** The fenced code block that contains `needle`; fails when `needle` first appears outside a fence. */
function fencedBlockContaining(text: string, needle: string): string {
  const at = text.indexOf(needle);
  expect(at, `${needle} not found`).toBeGreaterThanOrEqual(0);
  const fencesBefore = text.slice(0, at).split("```").length - 1;
  expect(fencesBefore % 2, `${needle} first appears outside a fenced block`).toBe(1);
  const open = text.lastIndexOf("```", at);
  const close = text.indexOf("```", at);
  expect(close, `the fenced block holding ${needle} never closes`).toBeGreaterThan(at);
  return text.slice(open, close);
}

/** Bold markup removed, so a rewording that only moves `**` does not decide a check. */
function plain(text: string): string {
  return text.replace(/\*\*/g, "");
}

/** Verbs that turn a propagation clause into a refusal. A clause that must propagate may use none. */
const REFUSAL = /전파하지 않는다|전달하지 않는다|넘기지 않는다|주지 않는다|싣지 않는다|보내지 않는다/;

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/);
}

/** Sentences of a Korean paragraph: a full stop followed by whitespace ends one. */
function sentences(paragraph: string): string[] {
  return paragraph
    .split(/\.\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

/**
 * The paragraphs this requirement wrote are pinned by sentence count as well as by wording. A
 * refusal can be phrased in an unbounded vocabulary ("생략한다", "떼어 낸다", "보내지 말고"), so no
 * word list closes it; a sentence appended to withdraw the clause changes the count whatever it
 * says. The price is that a legitimate new sentence here must update the count, which is review
 * this contract should get anyway.
 */
function expectSentenceCount(text: string | undefined, expected: number, what: string): void {
  expect(text, `${what} not found`).toBeDefined();
  expect(sentences(text as string).length, `${what}: sentence count changed — was a sentence added or removed?`).toBe(expected);
}

/** Sentences of a section body (heading line excluded) that name `--max`. */
function maxSentencesIn(sectionText: string): number {
  return sentences(sectionText.split("\n").slice(1).join("\n")).filter((sentence) => sentence.includes("--max")).length;
}

/**
 * The per-wave /kiwi-sds call site: the R-ORCH row when it writes the call, otherwise the shared
 * parallel-waves contract the row cites (FR-FLOW-181 AC-1 as revised — "wherever it is written").
 */
function perWaveSdsSite(rendering: Rendering): string {
  const rOrch = sectionOf(rendering.relPath, R_ORCH);
  if (rOrch.includes('skill: "kiwi-sds"')) return rOrch;
  const root = rendering.relPath.replace(/\/kiwi-orchestrator\/SKILL\.md$/, "");
  return readVariant(`${root}/_shared/kiwi/parallel-waves.md`);
}

describe("FR-FLOW-181 AC-1 — the per-wave /kiwi-sds call carries --max inside its argument string", () => {
  for (const rendering of ORCHESTRATOR) {
    it(`${rendering.id}`, () => {
      expect(sectionOf(rendering.relPath, R_ORCH), "the R-ORCH row still calls the retired kiwi-planner").not.toContain('skill: "kiwi-planner"');
      expect(argsOf(perWaveSdsSite(rendering), "kiwi-sds")).toContain(FLAG_SET);
    });
  }
});

describe("FR-FLOW-181 AC-2 — R-ORCH wave remediation hop, the host's review of its own post-merge commits, carries --max inside its argument string", () => {
  for (const rendering of ORCHESTRATOR) {
    it(`${rendering.id}`, () => {
      const hop = argsOf(sectionOf(rendering.relPath, R_ORCH), "kiwi-review-fix-loop");
      // FR-FLOW-188 AC-8: the host reviews only the commits it made after the merge.
      expect(hop).toContain("{last_merge_commit}");
      expect(hop).toContain("{host_tip}");
      expect(hop).toContain(FLAG_SET);
    });
  }
});

describe("FR-FLOW-181 AC-3 — kiwi-orchestrator call sites that already carried --max keep it inside the call", () => {
  for (const rendering of ORCHESTRATOR) {
    it(`${rendering.id}: R-ORCH /kiwi-srs and /kiwi-srs-feasibility`, () => {
      const rOrch = sectionOf(rendering.relPath, R_ORCH);
      expect(argsOf(rOrch, "kiwi-srs")).toContain(FLAG_SET);
      expect(argsOf(rOrch, "kiwi-srs-feasibility")).toContain(FLAG_SET);
    });

    it(`FR-FLOW-181 AC-3 ${rendering.id}: the R-ORCH row defers the worker kiwi-pm to §10, whose invocation block carries [--max]`, () => {
      expect(sectionOf(rendering.relPath, R_ORCH)).toMatch(/kiwi-pm SDS_PATH=docs\/sds\/\{run_id\}-wave-\{n\}\.sds\.md …\s*\(wave 의 워커가 — §10\)/);
      const block = fencedBlockContaining(sectionOf(rendering.relPath, PHASE_3F), "kiwi-pm SDS_PATH=");
      expect(block).toContain("--commit-lane-work");
      expect(block).toContain("[--max]");
    });

    it(`FR-FLOW-181 AC-3 ${rendering.id}: the worker review of its own window, written in the shared contract, carries the flag set`, () => {
      const contract = PARALLEL_WAVES.find((c) => c.id === rendering.id) as Rendering;
      const worker = section(stripFrontmatter(readVariant(contract.relPath)), /^##\s+5\./);
      expect(worker, `${contract.relPath}: §5 not found`).not.toBe("");
      const hop = argsOf(worker, "kiwi-review-fix-loop");
      expect(hop).toContain("--base <base_sha> --head HEAD");
      expect(hop).not.toContain("--close-reqs");
      expect(hop).toContain(FLAG_SET);
    });

    it(`${rendering.id}: R-STEP review hop`, () => {
      const hop = argsOf(sectionOf(rendering.relPath, R_STEP), "kiwi-review-fix-loop");
      expect(hop).toContain("{step_window_base}");
      expect(hop).toContain("[--max]");
      // The four pass-throughs reach neither kiwi-tdd nor its review hop; checked here too because
      // this suite, unlike the FR-FLOW-099 one, also reads the .agents mirror.
      for (const option of NOT_FOR_KIWI_TDD) expect(hop, `${option} must not reach the R-STEP review hop`).not.toContain(option);
    });

    it(`${rendering.id}: final-verify run-window review hop`, () => {
      const hop = argsOf(sectionOf(rendering.relPath, FINAL_VERIFY_HOP), "kiwi-review-fix-loop");
      expect(hop).toContain("{run_diff_window.base_sha}");
      expect(hop).toContain("[--max]");
    });
  }
});

describe("FR-FLOW-181 AC-4 — R-STEP passes --max to kiwi-tdd itself, and nothing kiwi-tdd has no gate for", () => {
  for (const rendering of ORCHESTRATOR) {
    it(`${rendering.id}: the kiwi-tdd argument string`, () => {
      const tdd = argsOf(sectionOf(rendering.relPath, R_STEP), "kiwi-tdd");
      expect(tdd).toContain("[--max]");
      expect(tdd).toContain("--review-hop-owned-by-parent");
      expect(tdd).toContain("--no-pipeline-emit");
      for (const option of NOT_FOR_KIWI_TDD) expect(tdd, `${option} must not reach kiwi-tdd`).not.toContain(option);
    });

    it(`${rendering.id}: the flag paragraph gives the reason and no longer withholds --max from kiwi-tdd`, () => {
      const flags = paragraphs(sectionOf(rendering.relPath, R_STEP)).find((p) => p.startsWith("**플래그**"));
      expect(flags, "R-STEP flag paragraph not found").toBeDefined();
      const paragraph = plain(flags as string);

      const anchor = paragraph.search(/`--auto` 와 `--max` 는 `kiwi-tdd` 자신에게도 전달한다/);
      expect(anchor, "the paragraph must say kiwi-tdd itself receives --auto and --max").toBeGreaterThanOrEqual(0);
      const reason = paragraph.slice(anchor, anchor + 500);
      expect(reason).toContain("auto-option.md");
      expect(reason).toContain("`--auto --max`");
      expect(reason).toContain("5인");

      expect(paragraph).toContain("`kiwi-tdd` 자신에게는 네 pass-through 를 전파하지 않는다");
      // Any sentence naming both kiwi-tdd and --max must not deny, drop or discount it, whatever the verb.
      const aboutTddMax = sentences(paragraph).filter((s) => s.includes("kiwi-tdd") && s.includes("--max"));
      for (const sentence of aboutTddMax) expect(sentence, "a sentence withholds or discounts --max for kiwi-tdd").not.toMatch(/않|없다|무시|빼고|빼면|제외/);
      // Exactly one sentence of this paragraph speaks of kiwi-tdd and --max together: the one that
      // grants it. A second one, in any vocabulary, is a qualification this contract did not make.
      expect(aboutTddMax.length, "a second sentence about kiwi-tdd and --max was added").toBe(1);
      // The review hop's propagation is stated earlier in the paragraph. A bare "as above" now sits
      // after the pass-through exclusion and would read as sending those four options to the hop.
      expect(paragraph).not.toContain("위 문장대로 전파한다");
      expect(paragraph).toContain("리뷰 hop 의 자식에 대한 전파는 이 문단 앞부분이 정한다");
      expect(normalized(paragraph), "the grant, its reason and the exclusion changed wording").toContain(GOLDEN.rStepGrant);
      // A sentence appended to the flag paragraph that discounts the grant without naming kiwi-tdd or
      // --max ("자식의 --auto 는 효력이 없다고 본다") changes its sentence count.
      expect(sentences(paragraph).length, "the R-STEP flag paragraph gained or lost a sentence").toBe(SECTION_SENTENCES.rStepFlagParagraph);
      // A new paragraph anywhere in R-STEP that names --max or --auto — stripping [--max] ("실제 spawn
      // 에서는 [--max] 를 지우고 보낸다") or declaring the child's --auto ignored ("자식은 이 호출의 --auto 를
      // 무시한다"), including one placed directly under the invocation block — adds a sentence outside
      // fences to one of these counts. A new paragraph that names neither token is not counted.
      const rStepBody = sentences(withoutFences(sectionOf(rendering.relPath, R_STEP).split("\n").slice(1).join("\n")));
      expect(rStepBody.filter((s) => s.includes("--max")).length, "R-STEP gained or lost a --max sentence").toBe(SECTION_SENTENCES.rStepMaxSentences);
      expect(rStepBody.filter((s) => s.includes("--auto")).length, "R-STEP gained or lost an --auto sentence").toBe(SECTION_SENTENCES.rStepAutoSentences);
    });
  }
});

const PIPELINE_71 = /^###\s+7\.1\s/m;

describe("FR-FLOW-181 AC-5 — kiwi-pipeline carries --max to kiwi-tdd on the §2.8.2 route", () => {
  for (const rendering of PIPELINE) {
    it(`${rendering.id}: §7.1 names the §2.8.2 kiwi-tdd route`, () => {
      const clause = paragraphs(sectionOf(rendering.relPath, PIPELINE_71)).find(
        (p) => p.includes("`kiwi-tdd`") && p.includes("§2.8.2") && p.includes("`--max`")
      );
      expect(clause, "no §7.1 paragraph propagates --max to the kiwi-tdd route").toBeDefined();
      expect(plain(clause as string)).toMatch(/`--max` 를 그 `kiwi-tdd` 호출에 전파한다/);
      expect(clause).not.toMatch(REFUSAL);
      expectSentenceCount(clause, 2, "§7.1 kiwi-tdd route paragraph");
      expect(normalized(clause as string)).toBe(GOLDEN.pipelineTdd);
    });

    it(`${rendering.id}: the §2.8.2 routing bullet says the kiwi-tdd call carries --max`, () => {
      const routing = sectionOf(rendering.relPath, /^###\s+2\.8\.2\s/m)
        .split("\n")
        .find((line) => line.includes("`kiwi-tdd` 스킬로 **라우팅**"));
      expect(routing, "the §2.8.2 routing bullet is not found").toBeDefined();
      expect(plain(routing as string)).toMatch(/라우팅한 `kiwi-tdd` 호출에도 `--max` 를 전파한다\(§7\.1\)/);
      expect(routing).not.toMatch(REFUSAL);
      expect(sentences(routing as string).filter((s) => s.includes("--max")).length, "a second --max sentence in the routing bullet").toBe(1);
      // The sentence this requirement added closes the bullet, and the bullet keeps its sentence count:
      // a withdrawal written without the --max token ("단 --auto 가 없으면 이 전파는 생략한다") changes it.
      expect(normalized(routing as string).endsWith(GOLDEN.pipelineRoutedSentence), "the routing bullet no longer ends with the --max sentence").toBe(true);
      expect(sentences(routing as string).length, "the routing bullet gained or lost a sentence").toBe(SECTION_SENTENCES.routingBullet);
    });

    it(`${rendering.id}: §7.1 keeps its sentence count and its --max sentence count`, () => {
      // A withdrawal placed in a paragraph of its own escapes every per-paragraph check above,
      // whether or not it names --max.
      const s71 = sectionOf(rendering.relPath, PIPELINE_71);
      const s71Sentences = sentences(withoutFences(s71.split("\n").slice(1).join("\n")));
      expect(s71Sentences.length, "§7.1 gained or lost a sentence").toBe(SECTION_SENTENCES.pipeline71);
      // Rewording a sentence of the first paragraph to hand the four children --auto keeps both counts
      // above but adds a sentence naming `--auto`. A rewording that never writes the token ("사용자 승인
      // 게이트를 건너뛰는 자동 진행 플래그를 붙인다") is not caught here.
      expect(s71Sentences.filter((s) => s.includes("--auto")).length, "§7.1 gained or lost an --auto sentence").toBe(SECTION_SENTENCES.pipeline71Auto);
      expect(maxSentencesIn(s71), "§7.1 gained or lost a --max sentence").toBe(7);
    });
  }
});

describe("FR-FLOW-181 AC-9 — kiwi-pipeline carries --max to children outside the chain that have or forward one", () => {
  for (const rendering of PIPELINE) {
    it(`${rendering.id}`, () => {
      const clause = paragraphs(sectionOf(rendering.relPath, PIPELINE_71)).find((p) => p.includes("`DRY_RUN`"));
      expect(clause, "no §7.1 paragraph covers the DRY_RUN re-run and the other outside-chain spawns").toBeDefined();
      expect(clause).toContain("단일 단계 `--run`");
      expect(clause).toContain("§6.2");
      // kiwi-tdd has no --max row of its own but forwards one to its review hop, so a kiwi-tdd the
      // user names at §6.2 falls inside this clause; the example is attached to that condition only,
      // so the clause does not read as naming kiwi-tdd as its only recipient.
      expect(plain(clause as string)).toMatch(
        /자기 `--max` 옵션이 있는 자식과, 자기 옵션은 없지만 자기 자식에게 `--max` 를 넘기는 자식\(`kiwi-tdd`\)에는 `--max` 를 그대로 전파한다/
      );
      expect(clause).not.toMatch(REFUSAL);
      expectSentenceCount(clause, 3, "§7.1 outside-chain paragraph");
      expect(normalized(clause as string)).toBe(GOLDEN.pipelineOutside);
    });
  }
});

describe("FR-FLOW-181 AC-11 — the four children of AC-10 follow AC-10 on every path, and that paragraph comes next", () => {
  for (const rendering of PIPELINE) {
    it(`${rendering.id}`, () => {
      const all = paragraphs(sectionOf(rendering.relPath, PIPELINE_71));
      const outside = all.findIndex((p) => p.includes("`DRY_RUN`"));
      const four = all.findIndex((p) => p.includes("`--auto --max`") && p.includes("`kiwi-srs-research`"));
      expect(outside, "outside-chain paragraph not found").toBeGreaterThanOrEqual(0);
      // In the etc rendering the four have a --max of their own, and all four can be named directly at
      // §6.2 (some also re-run through a DRY_RUN row), so without the deferral one child would get two
      // answers. The deferral names them by position, so the four-children paragraph must come next.
      expect(plain(all[outside] as string)).toMatch(/아래 문단의 네 자식은 이 경로로 spawn 되어도 이 문단이 아니라 그 문단을 따른다/);
      expect(four, "the paragraph the deferral points at is not directly below it").toBe(outside + 1);
    });
  }
});

describe("FR-FLOW-181 AC-10 — kiwi-pipeline passes --auto --max to the four children only under --auto, and never mints --auto", () => {
  for (const rendering of PIPELINE) {
    it(`${rendering.id}`, () => {
      const clause = paragraphs(sectionOf(rendering.relPath, PIPELINE_71)).find(
        (p) => p.includes("`--auto --max`") && p.includes("`kiwi-srs-research`")
      );
      expect(clause, "no §7.1 paragraph states --auto --max propagation to the four children").toBeDefined();
      for (const child of PIPELINE_CHILDREN_WITHOUT_MAX) expect(clause, `${child} is not named`).toContain(`\`${child}\``);
      expect(clause).toContain("auto-option.md");
      // The --auto condition is a safety boundary: without it the parent would mint an --auto the
      // user never gave and hand the child's user gates to a committee. The condition alone reads as
      // "when", so the paragraph also states what happens without --auto, names what is withheld
      // (not "nothing", which would also withhold --model and --mini), and says why.
      expect(plain(clause as string)).toMatch(/`--auto` 가 함께 켜졌을 때 `--auto --max` 를 전파한다/);
      expect(plain(clause as string)).toMatch(/`--auto` 없이 `--max` 만 켜졌으면 이 넷에는 `--max` 도 `--auto` 도 붙이지 않는다/);
      expect(plain(clause as string)).toMatch(/사용자가 주지 않은 `--auto` 를 부모가 만들지 않는다/);
      expect(clause).not.toMatch(/언제나|항상|무조건/);
      expect(clause).not.toMatch(REFUSAL);
      expectSentenceCount(clause, 2, "§7.1 four-children paragraph");
      // One grant of --auto --max, under its condition. A second one inside the same sentence would
      // not change the sentence count, so the token itself is counted.
      expect((clause as string).split("`--auto --max`").length - 1, "a second --auto --max grant in the paragraph").toBe(1);
      expect(normalized(clause as string)).toBe(rendering.id === "etc" ? GOLDEN.pipelineFourEtc : GOLDEN.pipelineFour);
    });
  }
});

describe("FR-FLOW-181 AC-6 — kiwi-wave-master carries --max to the calls its improvement delegation makes directly", () => {
  for (const rendering of WAVE_MASTER) {
    it(`${rendering.id}`, () => {
      const clause = paragraphs(sectionOf(rendering.relPath, /^###\s+7\.2\s/m)).find(
        (p) => p.includes("`--max`") && p.includes("verify-loop.md")
      );
      expect(clause, "no §7.2 paragraph propagates --max to the improvement delegation").toBeDefined();
      expect(clause).toContain("직접 호출");
      expect(clause).toContain("§5.5.5");
      expect(clause).toMatch(/`kiwi-review-fix-loop` 위임/);
      expect(clause).toMatch(/`kiwi-srs` 증분 재진입/);
      expect(clause).toMatch(/`--req-filter` 를 준 `kiwi-srs-feasibility` 재실행/);
      expect(plain(clause as string)).toMatch(/세 호출에도 전파한다/);
      expect(clause).not.toMatch(REFUSAL);
      expectSentenceCount(clause, 3, "§7.2 improvement-delegation paragraph");
      expect(normalized(clause as string)).toBe(GOLDEN.waveDelegation);
      const s72 = sectionOf(rendering.relPath, /^###\s+7\.2\s/m);
      expect(maxSentencesIn(s72), "§7.2 gained or lost a --max sentence").toBe(7);
      // A withdrawal in a paragraph of its own that never names --max escapes the count above.
      expect(sentences(s72.split("\n").slice(1).join("\n")).length, "§7.2 gained or lost a sentence").toBe(SECTION_SENTENCES.wave72);
    });
  }
});

describe("FR-FLOW-181 AC-8 — R-ORCH states the flag set for the calls 3.m and the improvement delegation route", () => {
  for (const rendering of ORCHESTRATOR) {
    it(`${rendering.id}`, () => {
      const clause = paragraphs(sectionOf(rendering.relPath, R_ORCH)).find((p) => p.includes("§13.2") && p.includes("verify-loop.md"));
      expect(clause, "no R-ORCH paragraph covers the 3.m and verify-loop.md §7 calls").toBeDefined();
      expect(clause).toContain(FLAG_SET);
      expect(clause).toContain("`--req-filter`");
      expect(clause).toContain("`--sds-id`");
      expect(plain(clause as string)).toMatch(/호출 형태를 그대로 쓰고 `\[--auto\] \[--max\] \[--mini\|--loops N\]` 을 함께 싣는다/);
      expect(clause).not.toMatch(REFUSAL);
      expectSentenceCount(clause, 1, "R-ORCH 3.m / verify-loop.md paragraph");
      // The narrowed re-run is included, not carved out: the clause ends by saying so.
      expect(clause).toMatch(/`--sds-id` 를 더한 재실행도 마찬가지다/);
      expect(normalized(clause as string)).toBe(GOLDEN.rOrchRouted);
    });
  }
});
