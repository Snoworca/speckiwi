import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";
import { readResolvedSkill } from "../support/resolved-skill.js";

// FR-FLOW-212 — kiwi-wave-master authors the product target's SRS once from the PRD and decomposes the
// requirement set into a work graph. A SKILL.md is agent instruction, so the AC is pinned on the text the
// agent reads: the order of the shared decomposition contract, the two kiwi-srs calls, and the absence
// of the heading-based, per-wave-target procedure it replaces.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const SKILL_ROOTS = ["skills/claude", "skills/codex", "skills/etc"] as const;
const WAVE_MASTER = SKILL_ROOTS.map((root) => `${root}/kiwi-wave-master/SKILL.md`);
const SHARED = (name: string): string[] => RENDERINGS.map((root) => `${root}/_shared/kiwi/${name}`);

/** The index of each needle in turn, each searched after the previous one; -1 once one is missing. */
function inOrder(text: string, needles: readonly string[]): number[] {
  const out: number[] = [];
  let from = 0;
  for (const needle of needles) {
    const at = from < 0 ? -1 : text.indexOf(needle, from);
    out.push(at);
    from = at < 0 ? -1 : at + needle.length;
  }
  return out;
}

/** A `## n.` section of a shared contract, heading included, up to the next `## ` heading. */
function h2(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return "";
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

describe("FR-FLOW-212 AC-1 — PRD, one SRS authoring, impact analysis, propose, metadata, a committed 2.0.0 graph", () => {
  // @req FR-FLOW-212 AC-1
  it.each(SHARED("wave-decomposition.md"))("%s: the run order is fixed in this order", (rel) => {
    const order = h2(read(rel), "2. 순서");
    const at = inOrder(order, [
      "`kiwi-prd`",
      "`wave-srs-registration.md §1`",
      "영향 분석",
      "`{artifact_root}waves/expected-files.json`",
      "speckiwi orchestrate wave propose",
      "`title` · `purpose` · `description` · `cautions` · `done_when` · `on_complete` · `github_issues`",
      "`{artifact_root}waves/waves.json` 에 `schema_version` 2.0.0 으로 쓰고",
      "명시 pathspec 으로 커밋한다"
    ]);
    expect(at, `${rel}: ${JSON.stringify(at)}`).not.toContain(-1);
  });

  // @req FR-FLOW-212 AC-1 — the one authoring call that precedes decomposition names the PRD and the product target.
  it.each(SHARED("wave-srs-registration.md"))("%s: the initial authoring call passes the PRD and the product target", (rel) => {
    const initial = h2(read(rel), "1. 처음 저작");
    expect(initial).toContain('Skill({ skill: "kiwi-srs", args: "PRD_PATH=<run 의 PRD> TARGET=<제품 target>');
    expect(initial).toContain("run 당 한 번, 분해 앞");
  });

  // @req FR-FLOW-212 AC-1 — moved from FR-FLOW-050 AC-1: the one authoring call receives the input document and
  // the constraint artifact, so a constraint caught in verification has a basis in the authoring input.
  it.each(SHARED("wave-srs-registration.md"))("%s: the initial call carries the research document and the constraints", (rel) => {
    const initial = h2(read(rel), "1. 처음 저작");
    const call = initial.split("\n").find((line) => line.startsWith('Skill({ skill: "kiwi-srs"')) ?? "";
    expect(call).toContain("--research-doc <입력 문서>");
    expect(call).toContain("--constraints-doc <constraints_path>");
    expect(initial).toContain("`existing_modules` 도 같은 호출의 **저작 입력**으로 넘긴다");
  });

  // @req FR-FLOW-212 AC-1 — wave-master runs that order by citing the contract, not by restating it.
  it.each(WAVE_MASTER)("%s: §3 runs the shared decomposition order", (rel) => {
    const body = read(rel);
    const s3 = body.slice(body.indexOf("\n## 3. "), body.indexOf("\n## 4. "));
    expect(s3).toContain("wave-decomposition.md");
    expect(s3).toContain("§2");
    expect(readResolvedSkill(rel.split("/")[1] ?? "", "kiwi-wave-master")).toContain("speckiwi orchestrate wave propose");
  });
});

describe("FR-FLOW-212 AC-2 — no heading decomposition, no wave-{n} targets, no per-wave authoring, no design_items", () => {
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["headers-first decomposition", /headers-first|헤더 우선/],
    ["3 to 8 sub-goals", /3\s*[~–-]\s*8\s*(?:개의\s*)?(?:하위|sub)/],
    ["a per-wave TARGET argument", /TARGET=wave-/],
    ["a wave-{n} target", /`wave-\{n\}` \**target|wave target|그 wave 의 target|전용 target|전용 `wave-\{n\}`/],
    ["per-wave /kiwi-srs authoring", /wave 마다 `?[/$]kiwi-srs|wave 별 target 등록|wave 하나씩 직렬로/],
    ["the design baseline design_items", /design_items/]
  ];
  for (const rel of [...WAVE_MASTER, ...SHARED("wave-decomposition.md")]) {
    for (const [what, re] of FORBIDDEN) {
      // @req FR-FLOW-212 AC-2
      it(`${rel}: carries no ${what}`, () => {
        const hit = read(rel).split("\n").find((line) => re.test(line));
        expect(hit, `${rel}: ${hit}`).toBeUndefined();
      });
    }
    // @req FR-FLOW-212 AC-2 — what stays.
    it(`${rel}: keeps existing_modules and constraints_path`, () => {
      const text = read(rel);
      expect(text).toContain("`existing_modules`");
      expect(text).toContain("`constraints_path`");
    });
  }

  // @req FR-FLOW-212 AC-2 — in the shared contract both stay as input parameters, each its own row.
  it.each(SHARED("wave-decomposition.md"))("%s: the inputs table keeps an existing_modules row and a constraints_path row", (rel) => {
    const rows = h2(read(rel), "1. 입력").split("\n").filter((line) => line.startsWith("| `"));
    expect(rows.some((line) => line.startsWith("| `existing_modules` |")), `${rel}: existing_modules`).toBe(true);
    expect(rows.some((line) => line.startsWith("| `constraints_path` |")), `${rel}: constraints_path`).toBe(true);
  });

  // @req FR-FLOW-212 AC-2 — with no wave-{n} target left, the event's target field is the product target.
  it.each(SHARED("waves-event.md"))("%s: the target row is the run's product target, the same on every node", (rel) => {
    const row = read(rel).split("\n").find((line) => line.startsWith("| `target` |")) ?? "";
    expect(row, `${rel}: no target row`).toContain("run 의 제품 target(모든 노드가 같다)");
    expect(row).not.toContain("`wave-{n}`");
    // The example lines of the 2.0.0 contract show the same: the product target as the value (verify r3).
    const examples = read(rel).split("\n").filter((line) => line.startsWith('{"schema_version":"2.0.0"') && line.includes('"target":'));
    expect(examples.length, `${rel}: no 2.0.0 example line`).toBeGreaterThan(0);
    expect(examples.filter((line) => /"target":\s*"wave-\d+"/.test(line))).toEqual([]);
  });
});

describe("FR-FLOW-212 AC-3 — two kiwi-srs calls only, and PW-1 is the incremental one", () => {
  // @req FR-FLOW-212 AC-3
  it.each(SHARED("wave-srs-registration.md"))("%s: defines the initial and the incremental call and no other", (rel) => {
    const text = read(rel);
    expect(text.match(/Skill\(\{ skill: "kiwi-srs", args: /g)?.length).toBe(2);
    expect(h2(text, "1. 처음 저작")).not.toBe("");
    expect(h2(text, "2. 증분 저작")).toContain("REQ_PATH={artifact_root}waves/stage-{s}/srs-deltas.md");
    expect(text).not.toContain("srs_authored");
    expect(text.split("\n").filter((line) => line.startsWith("## "))).toHaveLength(2);
  });

  // @req FR-FLOW-212 AC-3 — moved from FR-FLOW-046 AC-6, FR-FLOW-056 AC-4 and FR-FLOW-051 AC-5: with the SRS
  // authored once, a wave has no authoring stage, so neither the `srs-authoring` label, the `srs_authored`
  // marker, nor the three-stage resume remains in wave-master or the registration contract.
  it.each([...WAVE_MASTER, ...SHARED("wave-srs-registration.md")])("%s: no per-wave authoring stage, marker or resume stage", (rel) => {
    const text = read(rel);
    expect(text).not.toContain("srs-authoring");
    expect(text).not.toContain("srs_authored");
    expect(text).not.toMatch(/재개 단위\*\*는 \*\*3단계/);
  });

  // @req FR-FLOW-212 AC-3 — moved from FR-FLOW-051 AC-3: registering the unregistered product target is the normal
  // path of the initial call, and a resume does not run that call again.
  it.each(SHARED("wave-srs-registration.md"))("%s: registration is the normal path and resume never re-authors", (rel) => {
    const initial = h2(read(rel), "1. 처음 저작");
    expect(initial).toContain("미등록 제품 target 을 생성 옵션과 함께 등록하는 것은 이 호출의 정상 경로다");
    expect(initial).toContain("재개는 이 호출을 다시 돌리지 않는다 — 그래프가 커밋되어 있으면 저작은 끝났다");
  });

  // @req FR-FLOW-212 AC-3 — the resume unit inside a wave is two stages, and the SRS is not one of them.
  it.each(WAVE_MASTER)("%s: resume runs worker and verification only, the SRS was authored before", (rel) => {
    const line = read(rel).split("\n").find((entry) => entry.startsWith("wave 안의 **재개 단위**")) ?? "";
    expect(line).toContain("**2단계**다 — 워커 실행(`--sds` 면 SDS 작성 포함) / wave 검증");
    expect(line).toContain("SRS 저작은 wave 의 단계가 아니다");
  });

  // @req FR-FLOW-212 AC-3 — the language-neutral tokens: the claude contract is Korean, codex and etc are English.
  it.each(SHARED("parallel-waves.md"))("%s: PW-1 is the incremental authoring call only", (rel) => {
    const text = read(rel);
    const start = text.indexOf("**PW-1 ·");
    const pw1 = text.slice(start, text.indexOf("**PW-2 ·", start));
    expect(start, `${rel}: no PW-1`).toBeGreaterThan(0);
    expect(pw1).toContain("`wave-srs-registration.md §2`");
    expect(pw1).toContain("srs_deltas[]");
    expect(pw1).not.toMatch(/TARGET=wave-|allocation|배정 집합|kiwi-srs-feasibility|`wave-srs-registration\.md`\)/);
  });
});

describe("FR-FLOW-212 AC-4 — the graph's acs are the allocation, checked by wave check", () => {
  // @req FR-FLOW-212 AC-4
  it.each(SHARED("wave-decomposition.md"))("%s: the partition check replaces the allocation gate", (rel) => {
    const allocation = h2(read(rel), "3. 배정은");
    for (const token of ["`orchestrate wave check`", "`ac-unassigned`", "`ac-assigned-twice`", "`ac-out-of-scope`", "저작 전후 요구 스냅샷의 차집합도"]) {
      expect(allocation, `${rel}: ${token}`).toContain(token);
    }
  });

  // @req FR-FLOW-212 AC-4 — a narrowed run lists the kept requirements and records the user's consent once.
  it.each(SHARED("wave-decomposition.md"))("%s: a narrowed run lists the kept requirements in scope.requirements with consent once", (rel) => {
    const order = h2(read(rel), "2. 순서");
    const line = order.split("\n").find((entry) => entry.includes("`scope.requirements`")) ?? "";
    expect(line).toContain("--requirements <남기는 요구 ID>");
    expect(line).toContain("사용자 동의를 run 당 한 번 받아 기록한다(`out-of-scope-user-consent`");
  });

  // @req FR-FLOW-212 AC-4 — the replaced gate is gone from wave-master and the shared contracts it reads.
  it.each([...WAVE_MASTER, ...SHARED("wave-decomposition.md"), ...SHARED("parallel-waves.md"), ...SHARED("wave-srs-registration.md")])(
    "%s: no unallocated-req-id gate",
    (rel) => {
      expect(read(rel)).not.toContain("unallocated-req-id");
    }
  );
});

describe("FR-FLOW-212 AC-5 — expected files come from the impact analysis and go to --files only", () => {
  // @req FR-FLOW-212 AC-5
  it.each(SHARED("wave-decomposition.md"))("%s: the impact analysis writes the map, propose reads it, no SRS field holds it", (rel) => {
    const order = h2(read(rel), "2. 순서");
    const analysis = order.split("\n").find((line) => line.includes("**영향 분석**")) ?? "";
    expect(analysis).toContain("서브에이전트 하나가");
    expect(analysis).toContain("`--files` 로만 넘기고 어느 SRS 필드에도 쓰지 않는다");
    expect(order).toContain("--files {artifact_root}waves/expected-files.json");
  });

  // @req FR-FLOW-212 AC-5 — moved from FR-FLOW-047 AC-4: the impact analysis reads the existing module and dependency
  // structure, and the decomposition records the modules each node is expected to touch.
  it.each(SHARED("wave-decomposition.md"))("%s: the impact analysis reads existing_modules and the node map is written", (rel) => {
    const text = read(rel);
    const analysis = h2(text, "2. 순서").split("\n").find((line) => line.includes("**영향 분석**")) ?? "";
    expect(analysis).toContain("입력은 요구 ID 와 AC, `existing_modules`, 저장소다");
    const row = h2(text, "1. 입력").split("\n").find((line) => line.startsWith("| `existing_modules` |")) ?? "";
    expect(row).toContain("기존 모듈과 그 의존 방향의 요약");
    expect(row).toContain("노드마다 건드릴 것으로 예상되는 기존 모듈을 `{artifact_root}existing-modules.json`(노드 → 모듈 목록)에 적는다");
  });
});
