import { describe, expect, it } from "vitest";

import { criticalGateRows, offsetOf, section, tiedTogether, variantBodies, verbSection } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-077  intake: thin intent, document, or GitHub issue
// @req FR-FLOW-078  the design document is frozen before any implementation verb
// @req FR-FLOW-079  loop D's frozen denominator
// @req FR-FLOW-080  the per-wave English design document
// @req FR-FLOW-081  the English handoff document per lane
// @req FR-FLOW-082  validate then sync-index at 3.k
// @req FR-FLOW-083  convergence recipes decide execution order
// @req FR-FLOW-084  post-merge wave verification
// @req FR-FLOW-085  the wave-boundary issue protocol
// @req FR-FLOW-087  requirement promotion, once, at the host
// @req FR-FLOW-090  the duplication audit and the recorded absence
// @req FR-FLOW-091  design-refuted and the mid-wave amendment
// @req FR-FLOW-092  committee-answered intake questions are recorded
// @req FR-FLOW-094  a handoff never carries the sha of the commit containing it
// @req FR-FLOW-095  every pre-merge loop's residual enters the issue ledger
// @req FR-FLOW-102  phase 1 runs serially at the host root

const VARIANTS = variantBodies();

describe("FR-FLOW-077 — intake source classification, parallel investigators, gap QnA", () => {
  it("AC-1 — three intake sources, each mapped to its own verb", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*5\.1\b/m);
      expect(body).toMatch(/얇은 의도/);
      expect(body).toMatch(/연구 또는 설계 문서/);
      expect(body).toMatch(/GitHub 이슈/);
      for (const verb of ["intake-qna", "intake-document", "intake-issue"]) expect(body, `${variant.id}: ${verb}`).toContain(verb);
      expect(body).toMatch(/닫힌 분류/);
    }
  });

  it("AC-2 — three investigators in parallel, all three stances named", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*5\.1\b/m);
      expect(
        tiedTogether(body, /조사자 3 기를 병렬로/, [/intent/, /code-context/, /architecture-fit/], 400),
        `${variant.id}: the count and all three stances must sit together`
      ).toBe(true);
      expect(body).toContain("intake-investigate");
    }
  });

  it("AC-3 — every gap the investigators cannot close goes to the user as QnA", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*5\.1\b/m);
      expect(body).toMatch(/조사자가 닫지 못한 갭은 전부 사용자에게 QnA/);
    }
  });

  it("AC-4 — the record is 01.intake.md and it is loop D's open-question denominator", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*5\.1\b/m);
      expect(tiedTogether(body, /01\.intake\.md/, [/loop D/, /분모/], 300), `${variant.id}: the artifact must be tied to loop D's denominator`).toBe(true);
    }
  });
});

describe("FR-FLOW-092 — three-place record of committee-answered intake questions", () => {
  it("AC-1/AC-2 — three records, with the count on the 1.c line and not in the Phase 0 header", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*5\.2\b/m);
      expect(body).toMatch(/\*\*세 곳에\*\* 기록한다/);
      expect(body).toMatch(/셋 중 둘만 기록하는 것은 이 규칙을 만족시키지 못한다/);
      expect(tiedTogether(body, /Phase 1\.c 줄/, [/실제 질문 개수|개수/], 300), `${variant.id}: the count sits on the 1.c line`).toBe(true);
      expect(body).toMatch(/\*\*Phase 0 헤더에 개수를 넣지 않는다\*\*/);
    }
  });

  it("AC-3 — the intake_autonomy block sits in 00.run-contract.md with its three contents", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*5\.2\b/m);
      expect(
        tiedTogether(body, /intake_autonomy/, [/00\.run-contract\.md/, /Phase 1 끝/, /몇 개인지/, /감사 기록이 어디/], 500),
        `${variant.id}: block location, write point and three contents`
      ).toBe(true);
    }
  });

  it("AC-4 — one journal line per committee-decided row with all seven keys and origin intake", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*5\.2\b/m);
      for (const key of ["question", "options", "decision", "rule", "committee_size", "confidence"]) expect(body, `${variant.id}: ${key}`).toContain(key);
      expect(body).toMatch(/origin: "intake"/);
      expect(body).toMatch(/일곱 키를 전부/);
    }
  });

  it("AC-5/AC-6 — a recorded divergence, not a user-accepted degradation, and the gate still fires", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*5\.2\b/m);
      expect(body).toMatch(/기록된 이탈/);
      expect(body).toMatch(/사용자가 수락한 저하가 아니다/);
      expect(tiedTogether(body, /design-intake-insufficient/, [/cap 소진/, /needs-decision/, /contradicts-existing/], 300), `${variant.id}: the gate is unchanged`).toBe(true);
    }
  });
});

describe("FR-FLOW-078 — the design document's marked structure and its freeze", () => {
  it("AC-1 — English, body scope, and tdd step routing does not re-route the wave flow", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.1\b/m);
      expect(body).toMatch(/design\/00\.design\.md/);
      expect(tiedTogether(body, /\*\*영문\*\*/, [/body scope/], 200), `${variant.id}: English and body-scope together`).toBe(true);
      expect(body).toMatch(/`tdd` 모드의 step 스코프 라우팅은[^\n]*다시 라우팅하지 않는다/);
    }
  });

  it("AC-2 — the marking rule: top-level list row, [D-nnn]/[I-nnn], unique, contiguous, never reused", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.1\b/m);
      expect(body).toMatch(/최하위 heading 아래의 최상위 목록 행/);
      expect(body).toContain("[D-nnn]");
      expect(body).toContain("[I-nnn]");
      expect(body).toMatch(/고유하고 연속이며[^\n]*재사용되지 않는다/);
    }
  });

  it("AC-3 — exactly one normative token per item, MUST NOT counted once", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.1\b/m);
      expect(body).toMatch(/\*\*정확히 한 개의 규범 토큰 출현\*\*/);
      expect(body).toMatch(/`MUST NOT` 은 한 번으로 세고 두 번으로 세지 않는다/);
      expect(body).toMatch(/출현이 없는 항목은 거부되고 둘인 항목은 쪼갠다/);
    }
  });

  it("AC-4 — blockquote and fenced code are excluded from both scans", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.1\b/m);
      expect(body).toMatch(/인용문과 코드펜스 내용은 항목 스캔과 미표시 산문 스캔 양쪽에서 제외/);
    }
  });

  it("AC-5 — unmarked normative prose is a critical gate naming the exact lines, with two remedies", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.1\b/m);
      expect(
        tiedTogether(body, /unmarked-normative-prose/, [/critical 게이트/, /정확한 줄 번호를 지명/], 400),
        `${variant.id}: critical and line-naming must sit together`
      ).toBe(true);
      expect(body).toMatch(/그 줄을 표시하거나 다시 쓰는 것 둘뿐/);
      expect(body).toMatch(/적게 센 `design_items\[\]`[^\n]*동결 분모를 줄이는데/);
    }
  });

  it("AC-6 — no implementation verb runs before P-DESIGN-FROZEN, freeze then implement", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.1\b/m);
      expect(tiedTogether(body, /P-DESIGN-FROZEN/, [/design-not-frozen/, /구현 동사/], 300), `${variant.id}: gate and predicate together`).toBe(true);
      expect(body).toMatch(/\*\*동결 다음 구현\*\*이며 그 반대가 아니다/);
    }
  });
});

describe("FR-FLOW-079 — loop D's frozen denominator", () => {
  it("AC-1 — three sets, computed externally before round 1, frozen at entry, never by a verifier", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.2\b/m);
      expect(body).toMatch(/\*\*정확히 세 집합\*\*/);
      expect(body).toMatch(/라운드 1 전에 외부에서 계산/);
      expect(body).toMatch(/\*\*검증자가 계산하지 않는다\*\*/);
    }
  });

  it("AC-2 — the open-question set is the QnA residuals plus every preserved dissent item", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.2\b/m);
      expect(tiedTogether(body, /열린 질문 집합/, [/01\.intake\.md/, /kiwi-srs-research/, /이견 항목/], 400), `${variant.id}: both halves of the set`).toBe(true);
    }
  });

  it("AC-3/AC-4 — the closed three-value verdict vocabulary and the file:line requirement", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.2\b/m);
      expect(tiedTogether(body, /구현가능성 집합/, [/implementable/, /needs-decision/, /contradicts-existing/, /설계 항목마다 한 행/], 400)).toBe(true);
      expect(tiedTogether(body, /contradicts-existing` 은/, [/file:line/, /의견/], 300), `${variant.id}: the pointer requirement and its reason`).toBe(true);
    }
  });

  it("AC-5 — constraints.json is always written, even when empty", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.2\b/m);
      expect(body).toMatch(/비어 있어도 항상 기록되는\*\* `design\/constraints\.json`/);
    }
  });

  it("AC-6 — five pass conjuncts including the no-edit-in-that-round rule", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.2\b/m);
      expect(body).toMatch(/\*\*PASS 는 다섯 연언이 모두 성립할 때다\*\*/);
      for (const conjunct of [/답 포인터로 해소/, /`needs-decision` 0/, /`contradicts-existing` 0/, /제약 위반 0/, /어떤 수정도 적용되지 않았을 것/]) {
        expect(conjunct.test(body), `${variant.id}: conjunct ${conjunct}`).toBe(true);
      }
    }
  });

  it("AC-7 — a needs-decision row routes back to intake-qna and cap exhaustion is the gate", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*6\.2\b/m);
      expect(tiedTogether(body, /`needs-decision` 행을 낸/, [/intake-qna/, /재진입/], 300), `${variant.id}: routes back as a verb`).toBe(true);
      expect(tiedTogether(body, /design-intake-insufficient/, [/cap/, /needs-decision/, /contradicts-existing/], 300)).toBe(true);
    }
  });
});

describe("FR-FLOW-080 — the per-wave English design document and loop W", () => {
  it("AC-1/AC-2 — the path, English, both stances and the frozen denominator", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*8\.\s/m);
      expect(body).toMatch(/waves\/wave-\{n\}\/design\.md/);
      expect(body).toMatch(/\*\*영문\*\*/);
      expect(body).toMatch(/커버리지/);
      expect(body).toMatch(/동결된 설계 lock 에 대한 내부 정합성/);
      expect(body).toMatch(/그 wave 의 `design_items` 조각/);
    }
  });

  it("AC-3 — 3.a precedes 3.b, and 3.b consumes the document as its research document", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*8\.\s/m);
      expect(body).toMatch(/loop W 는 3\.b 의 [^\n]*kiwi-srs[^\n]* 등록 전에 통과해야 한다/);
      expect(body).toMatch(/3\.a 가 3\.b 앞이고/);
      expect(body).toMatch(/연구 문서로 소비한다/);
    }
  });

  it("AC-4/AC-5 — cap exhaustion is not a pass, and the same marking rules apply at 3.a", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*8\.\s/m);
      expect(tiedTogether(body, /wave-design-insufficient/, [/통과로 세지 않는다/], 200)).toBe(true);
      expect(tiedTogether(body, /같은 표시 항목 규칙/, [/unmarked-normative-prose/, /3\.a/], 400)).toBe(true);
    }
  });
});

describe("FR-FLOW-081 / FR-FLOW-094 — the handoff document", () => {
  it("081 AC-1 — one handoff per lane, English, with the three-field non-Latin denominator", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*9\.1\b/m);
      expect(body).toMatch(/waves\/wave-\{n\}\/lanes\/lane-\{k\}\.md/);
      expect(
        tiedTogether(body, /handoff-not-english/, [/escalation/, /untested_reason/, /코드펜스/], 400),
        `${variant.id}: the scanned denominator and its exclusions`
      ).toBe(true);
    }
  });

  it("081 AC-2 — ten body headings, in order, with the count stated as ten", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*9\.1\b/m);
      expect(body).toMatch(/\*\*정확히 열 개의 필수 본문 heading\*\*/);
      expect(body).toMatch(/그것이 \*\*열 개\*\*다/);
      expect(body).toMatch(/아홉이나 열하나를 지명하는 본문은 잘못이다/);
      const headings = ["## Setup", "## Objective", "## Context", "## Interfaces", "## Tasks", "## Acceptance", "## Constraints", "## Out of scope", "## Manifest", "## Escalation"];
      const offsets = headings.map((heading) => body.indexOf(heading));
      expect(offsets.every((offset) => offset > -1), `${variant.id}: all ten headings named`).toBe(true);
      expect(offsets, `${variant.id}: named in the stated order`).toEqual([...offsets].sort((a, b) => a - b));
    }
  });

  it("081 AC-3 — five mechanical layers, and handoff_kind decides which apply", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*9\.2\b/m);
      expect(body).toMatch(/\*\*다섯\*\* 기계적 계층/);
      expect(body).toMatch(/`handoff_kind` 가 결정한다/);
      expect(body).toContain("validateHandoff");
      expect(body).toMatch(/열세 필드/);
      expect(body).toMatch(/13 × \|task_ids\|/);
    }
  });

  it("081 AC-4/AC-5 — loop H's two denominators, the null rows inside verifier 2's", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*9\.3\b/m);
      expect(tiedTogether(body, /검증자 1/, [/열세 필드/, /설계 항목/, /무효/], 400), `${variant.id}: verifier 1 denominator and the invalid-round rule`).toBe(true);
      expect(
        tiedTogether(body, /검증자 2/, [/`write_set` ∪ `test_id: null`/, /`write_set` 만 적는 본문은 잘못이다/], 600),
        `${variant.id}: verifier 2 denominator includes the null rows`
      ).toBe(true);
    }
  });

  it("081 AC-6 — the executability probe runs in the final round only, applies no edits", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*9\.3\b/m);
      expect(
        tiedTogether(body, /실행가능성 프로브는 마지막 라운드에서만/, [/handoff 문서만/, /어떤 편집도 적용하지 않는다/, /write_set/, /코더 결함이 아니라 handoff 결함/], 700),
        `${variant.id}: probe scope, no-edit, comparison and attribution`
      ).toBe(true);
    }
  });

  it("081 AC-7/AC-8 — four pass conjuncts, and phase 1 fires the gate with no demotion", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*9\.3\b/m);
      expect(body).toMatch(/\*\*PASS 는 네 연언이다\*\*/);
      for (const conjunct of [/`validateHandoff` 가 ok/, /두 분모가 모두 완결/, /CRITICAL 과 HIGH 가 0/, /어떤 수정도 적용되지 않았을 것/]) {
        expect(conjunct.test(body), `${variant.id}: conjunct ${conjunct}`).toBe(true);
      }
      expect(tiedTogether(body, /handoff-verify-failed/, [/강등을 시도하지 않는다/, /강등할 곳이 없다/], 400)).toBe(true);
    }
  });

  it("094 AC-1/AC-2 — base_sha is rejected, with the hash-over-its-own-tree reason", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*9\.1\b/m);
      expect(body).toMatch(/`base_sha` front matter 필드를 담은 handoff 는 거부된다/);
      expect(body).toMatch(/그 커밋 자신의 트리에 대한 해시/);
      expect(body).toMatch(/그 커밋 안의 어떤 파일에 쓴 값도 그것과 같을 수 없다/);
      expect(body).toMatch(/base 커밋이 이미 checkout 되어 있다고만 적고 sha 를 지명하지 않는다/);
      expect(tiedTogether(body, /`dod` 절/, [/원장이 공급한 값/], 200)).toBe(true);
    }
  });

  it("094 AC-3/AC-4/AC-5 — per-stage dispatch base in the ledger, HEAD-at-3.f resolution, host execution", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*9\.1\b/m);
      expect(
        tiedTogether(body, /dispatch base sha/, [/3\.f′ 커밋의 sha/, /stage 당/, /isolation\.base_sha/, /open\[\]\.base_sha/], 500),
        `${variant.id}: the ledger carries it, per stage`
      ).toBe(true);
      expect(body).toMatch(/spawn prompt 운반 절은 여기 없고 `2\.6\.0-phase2-parallel-lanes` 로 지명된다/);
      const layers = section(variant.body, /^###\s*9\.2\b/m);
      expect(layers).toMatch(/3\.f 의 HEAD 에 3\.f′ 가 stage 하려는 경로 집합을 더한 것/);
      expect(layers).toMatch(/아직 존재하지 않는 sha 에 대해 해소하지 않는다/);
    }
  });
});

describe("FR-FLOW-102 — serial host-root execution with the analysis still produced", () => {
  it("AC-1 — the executor invocation carries the five mandatory flags and the optional set", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*10\.\s/m);
      for (const flag of ["--handoff", "--session-suffix w{n}s{s}l{k}", "--no-final", "--no-pipeline-emit", "--commit-lane-work"]) {
        expect(body, `${variant.id}: ${flag}`).toContain(flag);
      }
      for (const optional of ["[--resume]", "[--auto]", "[--max]", "[--model <name>]", "[--mini|--loops N]"]) {
        expect(body, `${variant.id}: ${optional}`).toContain(optional);
      }
      expect(body).toContain("[--regression-baseline <the P.4 pin>]");
      expect(tiedTogether(body, /host root/, [/직렬/, /stage 순서/, /lane-id 순서/], 400), `${variant.id}: the walk order`).toBe(true);
    }
  });

  it("AC-1/AC-6 — no wall-clock speedup, yet the analysis is frozen, published and reviewed per wave", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*10\.\s/m);
      expect(body).toMatch(/벽시계 단축을 제공하지 않는다/);
      expect(tiedTogether(body, /병렬화 분석/, [/동결/, /공개/, /검토/], 300), `${variant.id}: frozen, published, reviewed`).toBe(true);
      const review = section(variant.body, /^###\s*10\.4\b/m);
      expect(tiedTogether(review, /partition-review-unrecorded/, [/3\.e′/, /digest/, /`pass`/], 400)).toBe(true);
    }
  });

  it("AC-2 — the six differences from a concurrent dispatch, each with its reason", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*10\.1\b/m);
      expect(body).toMatch(/worktree 도 unit 브랜치도 없다/);
      expect(tiedTogether(body, /--defer-srs-mutation` 을 전달하지 않는다/, [/kiwi-coder/, /host root/], 400)).toBe(true);
      expect(tiedTogether(body, /클레임 감사가 없다/, [/커밋 범위/, /파생된 것/], 300)).toBe(true);
      expect(tiedTogether(body, /--commit-lane-work` 는 여전히 필수/, [/아무것도 커밋하지 않아/], 300)).toBe(true);
      for (const trailer of ["Orch-Run", "Orch-Wave", "Orch-Stage", "Orch-Lane", "Orch-Task"]) expect(body, `${variant.id}: ${trailer}`).toContain(trailer);
      expect(body).toMatch(/subject 표식을 담지 않는다/);
      expect(tiedTogether(body, /serial_epilogue` 에 착지/, [/order-last/, /\*\*실행자\*\*는 바뀌지 않는다/], 400)).toBe(true);
    }
  });

  it("AC-3 — serial-unit-failed carries its three disjuncts", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*10\.2\b/m);
      expect(body).toMatch(/같은 handoff 로 1회 재시도한 뒤에도\*\* 비-0/);
      expect(body).toMatch(/커밋을 하나도 만들지 않았고[\s\S]{0,80}intentionally_empty/);
      expect(body).toMatch(/`NEEDS_USER` 또는 `FAILED` 를 반환했다/);
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "serial-unit-failed");
      expect(row?.location, `${variant.id}: 3.g and 3.k activity (0)`).toMatch(/3\.g/);
    }
  });

  it("AC-4 — the intentionally-empty disposition is per task, with two conjuncts, and enters checked", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*10\.3\b/m);
      expect(body).toMatch(/\*\*단위별이 아니라 task 별\*\*/);
      expect(body).toMatch(/docs\/analysis\/kiwi-pm-…/);
      expect(body).toMatch(/20자 이상의 `reason`/);
      expect(tiedTogether(body, /허용 조건은 두 연언이다/, [/`verification_cmd` 가 0 으로 끝나고/, /`write_set` 의 어떤 경로도[\s\S]{0,40}달라지지 않았을 것/], 500)).toBe(true);
      expect(body).toMatch(/단위의 주장이 아니라 오케스트레이터가 트리에서 다시 계산한다/);
      expect(body).toMatch(/`expected` 에 남고[\s\S]{0,40}`checked` 에 들어간다/);
      expect(tiedTogether(body, /landed/, [/type="test"/, /`type="commit"` 참조는 없다/], 300)).toBe(true);
    }
  });

  it("AC-7 — the resume contract for execute-unit", () => {
    for (const variant of VARIANTS) {
      const verb = verbSection(variant.body, "execute-unit");
      expect(verb).toMatch(/externally-visible/);
      expect(tiedTogether(verb, /Orch-Task/, [/workflow_plan_status/, /trailer 도 체크된 박스도 없는 Task 에 대해서만/], 500)).toBe(true);
      const body = section(variant.body, /^###\s*10\.4\b/m);
      expect(body).toContain(".kiwi/sessions/{plan_run_id}/lanes/w{n}s{s}l{k}/pm-state.json");
    }
  });
});

describe("FR-FLOW-083 — convergence recipes decide execution order", () => {
  it("AC-1 — exactly the four recipe.kind values", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.2\b/m);
      expect(body).toMatch(/닫힌 4값 enum/);
      for (const kind of ["exclusive-lane", "orchestrator-only", "regenerate", "replay"]) expect(body, `${variant.id}: ${kind}`).toContain(kind);
    }
  });

  it("AC-2 — the most-restrictive-wins precedence order, applied identically at every site", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.2\b/m);
      expect(body).toContain("orchestrator-only > replay > regenerate > exclusive-lane");
      expect(body).toMatch(/모든 자리에서 동일하게 적용/);
    }
  });

  it("AC-3 — the four-row eligibility mapping", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.2\b/m);
      expect(tiedTogether(body, /exclusive-lane[^|]*\| 적격/, [/유일성 제약/, /한 lane 으로 강제/], 300)).toBe(true);
      for (const kind of ["orchestrator-only", "regenerate", "replay"]) {
        expect(tiedTogether(body, new RegExp(`${kind}[^|]*\\| 부적격`), [/serial_epilogue/], 200), `${variant.id}: ${kind} routes to serial_epilogue`).toBe(true);
      }
    }
  });

  it("AC-4 — convergence-without-recipe at Phase 2.c with the closed-enum predicate", () => {
    for (const variant of VARIANTS) {
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "convergence-without-recipe");
      expect(row?.location, `${variant.id}: Phase 2.c`).toMatch(/2\.c/);
      expect(row?.reason).toMatch(/닫힌 enum/);
    }
  });

  it("AC-5/AC-6 — position not executor, and the phase-2 clauses are named as deferred", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.2\b/m);
      expect(body).toMatch(/실행 \*위치\* 를 바꾸고 \*실행자\* 를 바꾸지 않는다/);
      expect(body).toMatch(/order-last/);
      expect(body).toMatch(/3\.k activity \(0\)/);
      expect(tiedTogether(body, /phase 2 절은 여기 없고 이연으로 지명한다/, [/병합 시점에 경로별로 복원/, /지연 mutation replay/], 400)).toBe(true);
    }
  });
});

describe("FR-FLOW-082 — validate then sync-index at 3.k", () => {
  it("AC-1/AC-2 — once per wave at activity (3), after activity (0), before 3.l, validate first", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.3\b/m);
      expect(body).toMatch(/wave 당 정확히 한 번, Phase 3\.k activity \(3\)/);
      expect(body).toMatch(/3\.k activity \(0\) 에서 실행된 뒤/);
      expect(body).toMatch(/3\.l 의 loop P 앞/);
      expect(body).toMatch(/\*\*`validate` 가 먼저, `sync-index` 가 나중\*\*/);
      // Scoped past the section heading, which names both commands as its own title.
      const prose = body.slice(body.indexOf("\n"));
      const validateAt = offsetOf(prose, /speckiwi validate/);
      const syncAt = offsetOf(prose, /sync-index/);
      expect(validateAt, `${variant.id}: validate is named before sync-index`).toBeGreaterThan(-1);
      expect(validateAt, `${variant.id}: validate is named before sync-index`).toBeLessThan(syncAt);
    }
  });

  it("AC-3 — post-merge-index-drift declared with 3.k among its locations and the stated predicate", () => {
    for (const variant of VARIANTS) {
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "post-merge-index-drift");
      expect(row, `${variant.id}: post-merge-index-drift declared`).toBeDefined();
      expect(row?.location).toMatch(/3\.k/);
      expect(row?.reason).toMatch(/sync_index/);
      expect(row?.reason).toMatch(/validate --fail-on-warning/);
    }
  });

  it("AC-4/AC-5 — no merge in phase 1, obligation attaches to the wave, per-merge return is deferred", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.3\b/m);
      expect(body).toMatch(/이 run 은 phase 1 에서 병합을 수행하지 않는다/);
      expect(body).toMatch(/\*\*wave 마감 지점\*\*에 붙는다/);
      expect(tiedTogether(body, /per-merge 부착은 `2\.6\.0-phase2-parallel-lanes` 에서 돌아온다/, [/integrate-lane/, /이연이지 삭제가 아니다/], 300)).toBe(true);
    }
  });
});

describe("FR-FLOW-090 — the duplication audit and the recorded absence", () => {
  it("AC-1/AC-2 — the phase-1 input, the position, the artifact, the row shape and three verdicts", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.1\b/m);
      expect(body).toMatch(/Phase 3\.k activity \(2\) 에서\*\*/);
      expect(body).toMatch(/activity \(0\) 에서 실행된 뒤/);
      expect(body).toMatch(/커밋 범위를 모든 단위의 `write_set` 합집합으로 제한한 것/);
      expect(body).toMatch(/lane diff 의 합집합이 아니다/);
      expect(body).toMatch(/waves\/wave-\{n\}\/duplication-audit\.md/);
      for (const field of ["symbol_or_block", "lanes[]", "paths[]", "verdict"]) expect(body, `${variant.id}: ${field}`).toContain(field);
      expect(tiedTogether(body, /닫힌 3값/, [/duplicate/, /parallel-evolution/, /acceptable/], 200)).toBe(true);
    }
  });

  it("AC-3 — exactly two resolution forms, and a note is not a resolution", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.1\b/m);
      expect(body).toMatch(/\*\*정확히 두 형태\*\*만 허용/);
      expect(body).toMatch(/\*\*이미 실행된\*\* epilogue task 의 id/);
      expect(body).toMatch(/`issue:\{id\}`/);
      expect(body).toMatch(/local-defect/);
      expect(body).toMatch(/\*\*메모는 해소가 아니다\.\*\*/);
    }
  });

  it("AC-4/AC-5 — the gate at 3.k, and the tool checks only that a closed-enum verdict was recorded", () => {
    for (const variant of VARIANTS) {
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "cross-lane-duplication-unresolved");
      expect(row?.location, `${variant.id}: Phase 3.k`).toMatch(/3\.k/);
      const body = section(variant.body, /^###\s*11\.1\b/m);
      expect(body).toMatch(/기록된 서브에이전트 판단이고, 도구는 산출된 후보마다 닫힌 enum 의 verdict 가 기록되었는지만 검사한다/);
    }
  });

  it("AC-6 — the 3.f'' coupling check with predicate, action, bound and the un-re-sought verdict", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.2\b/m);
      expect(body).toMatch(/한 lane 의 `write_set` 에 있고 다른 lane 의 `read_set` 에 있다/);
      expect(tiedTogether(body, /행동/, [/append-new-artifact/, /lanes\.lock\.json/, /다시 저작/, /loop H/], 500)).toBe(true);
      expect(body).toMatch(/\*\*3\.e′ 의 분할 검토 verdict 는 다시 구하지 않는다\.\*\*/);
      expect(body).toMatch(/\*\*stage 당 1회\*\*/);
      expect(body).toContain("stage-coupling-unresolved");
    }
  });

  it("AC-7 — the preventive half is recorded as absent, with both reasons, escalated as X-04", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.1\b/m);
      expect(tiedTogether(body, /예방 절반은 주장하지 않고 부재로 기록한다/, [/write-set-overlap/, /심볼을 운반하지 않는다/, /X-04/], 500)).toBe(true);
      expect(variant.body, `${variant.id}: no shared-substrate conflict reason`).not.toContain("shared-substrate-unhoisted");
    }
  });
});

describe("FR-FLOW-084 — loop P over five denominators with a single-witness unit layer", () => {
  it("AC-1 — five frozen denominators plus the intent layer", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*12\.1\b/m);
      expect(body).toMatch(/\*\*다섯 동결 분모\*\*/);
      for (const layer of [/REQ\/AC/, /설계 항목/, /제약/, /보존 계층/, /\*\*단위 계층\*\*/, /\*\*의도 계층\*\*/]) {
        expect(layer.test(body), `${variant.id}: ${layer}`).toBe(true);
      }
      expect(body).toMatch(/네 분모만 지명하거나 의도 계층을 빠뜨린 본문은 잘못이다/);
    }
  });

  it("AC-2/AC-3 — one sub-denominator, its expected union and the two-conjunct checked", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*12\.1\b/m);
      expect(body).toMatch(/\*\*단위 계층은 하위 분모 하나\*\*이며 둘로 쪼개지 않는다/);
      expect(tiedTogether(body, /`expected` = `lanes\.lock\.json`/, [/serial_epilogue/, /unassigned/], 300)).toBe(true);
      expect(
        tiedTogether(body, /`checked` = 통합 head/, [/Orch-Task/, /verification_cmd/, /intentionally_empty/, /`expected` 에서 제거되지 않는다/], 600)
      ).toBe(true);
    }
  });

  it("AC-4/AC-5 — one witness where phase 2 has two, and one unlanded task forbids ALL_MATCH", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*12\.1\b/m);
      expect(body).toMatch(/phase 1 은 증인이 하나이고 phase 2 는 둘이다/);
      expect(body).toMatch(/클레임 감사 연언은 phase 1 대응물이 없다/);
      expect(body).toMatch(/착지하지 않은 task 하나가 `ALL_MATCH` 를 금지한다/);
    }
  });

  it("AC-6/AC-7 — the intent layer's two halves, the bundle rows, and both pass preconditions", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*12\.1\b/m);
      expect(tiedTogether(body, /\*\*의도 계층\*\*:/, [/loop D 의 열린 질문 집합/, /여전히 그 해소를 지키는/], 300)).toBe(true);
      expect(body).toContain("00.charter.md");
      expect(body).toContain("01.intake.md");
      expect(body).toMatch(/unapproved-damage = 0/);
      expect(body).toMatch(/failing_tests ⊆ baseline_failing_tests/);
      expect(body).toMatch(/worklog `TASK_DONE` 은 `checked` 의 연언으로 인정하지 않는다/);
    }
  });

  it("AC-8 — the bundle swaps the lane-manifest row for the commit range and the analysis bundle", () => {
    // The phase-1 substitution is the whole point of this row: there are no lane manifests, so the
    // wave's trailer-keyed commit range plus each unit's own /kiwi-pm analysis bundle stand in for
    // them, while lanes.lock.json and the handoffs survive unchanged.
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*12\.1\b/m);
      expect(
        tiedTogether(body, /커밋 범위/, [/Orch-Lane/, /Orch-Task/, /frozen\.integration_branch/, /docs\/analysis\/kiwi-pm-…/], 500),
        `${variant.id}: the commit range must be keyed by both trailers and paired with the analysis bundle`
      ).toBe(true);
      expect(body, `${variant.id}: lanes.lock.json stays a bundle row`).toContain("lanes.lock.json");
      expect(body, `${variant.id}: every handoff stays a bundle row`).toMatch(/모든 handoff/);
    }
  });
});

describe("FR-FLOW-085 / FR-FLOW-095 — the wave-boundary issue protocol", () => {
  it("095 AC-1/AC-2/AC-3 — loops D, W, H and P are the phase-1 residual sources; loop L is phase 2", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.1\b/m);
      expect(tiedTogether(body, /pre-merge 검증 루프의 잔여분/, [/loop D · W · H/, /loop P/], 400)).toBe(true);
      expect(body).toMatch(/pass-with-residual/);
      expect(body).toMatch(/통과한 루프도 잔여를 운반할 수 있다/);
      expect(body).toMatch(/공허하지 않다/);
      expect(tiedTogether(body, /loop L 의 잔여는/, [/2\.6\.0-phase2-parallel-lanes/, /phase 1 출처로 열거하지 않는다/], 300)).toBe(true);
    }
  });

  it("095 AC-4 — a residual receives a closed classification and is subject to the precondition", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.1\b/m);
      expect(tiedTogether(body, /닫힌 6값 분류/, [/P-WAVE-ISSUES-CLOSED/, /wave-issues-open/], 300)).toBe(true);
    }
  });

  it("085 AC-1/AC-2/AC-3 — six classes with routes, exactly one per issue, at 3.m between loop P and promotion", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.2\b/m);
      expect(body).toMatch(/3\.m 에서, loop P 뒤·`promote-requirements` 앞/);
      expect(body).toMatch(/waves\/wave-\{n\}\/issues\.md/);
      expect(body).toMatch(/issues\.lock\.json/);
      expect(body).toMatch(/\*\*모든 이슈는 정확히 하나의 분류를 받고 목록은 닫혀 있다\.\*\*/);
      for (const cls of ["local-defect", "missing-task", "design-gap", "new-wave-required", "design-contradiction", "out-of-run"]) {
        expect(body, `${variant.id}: class ${cls}`).toContain(cls);
      }
    }
  });

  it("085 AC-4/AC-5 — P-WAVE-ISSUES-CLOSED's four conjuncts, its evaluator, and consent under --auto", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.3\b/m);
      expect(body).toContain("orchestrate wave close --wave N");
      expect(body).toMatch(/네 연언이다/);
      expect(body).toMatch(/종단 분류/);
      expect(tiedTogether(body, /해소 증거/, [/file:line/, /테스트 id/, /커밋 sha/], 300)).toBe(true);
      expect(body).toMatch(/`design-gap` 이 새 설계 lock digest 를 지명한다/);
      expect(tiedTogether(body, /기록된 사용자 결정/, [/out-of-run/, /new-wave-required/], 200)).toBe(true);
      expect(body).toMatch(/`out-of-run` 은 `--auto` 라도 사용자 동의를 요구한다/);
      expect(body).toMatch(/`--auto` 나 위원회가 이를 대신 이행할 수 없다/);
    }
  });

  it("085 AC-6/AC-7 — both gates at 3.m, the abort route, the append cap and the stated limitation", () => {
    for (const variant of VARIANTS) {
      for (const gateId of ["wave-issues-open", "design-contradiction-at-wave-boundary"]) {
        const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === gateId);
        expect(row?.location, `${variant.id}: ${gateId} at 3.m`).toMatch(/3\.m/);
      }
      const classes = section(variant.body, /^###\s*13\.2\b/m);
      expect(tiedTogether(classes, /design-contradiction-at-wave-boundary/, [/\[D-nnn\]/, /증거와 함께 지명/, /abort-run/], 400)).toBe(true);
      // The route is not committee-decidable: a committee would be voting on which half of the
      // design to discard, which is not a question a majority can answer.
      expect(
        tiedTogether(classes, /위원회가 결정할 수 없다/, [/design-contradiction/, /설계의 어느 쪽 절반을 버릴지/], 400),
        `${variant.id}: the not-committee-decidable clause must sit with its reason`
      ).toBe(true);
      expect(tiedTogether(classes, /new-wave-required/, [/run 당 3개 상한/, /wave-append-cap-exhausted/], 300)).toBe(true);
      const precondition = section(variant.body, /^###\s*13\.3\b/m);
      expect(tiedTogether(precondition, /기록된 한계/, [/형식/, /옳음/, /다음 wave 의 loop P/, /out-of-run/], 500)).toBe(true);
    }
  });
});

describe("FR-FLOW-091 — design refutation and the sanctioned mid-wave amendment", () => {
  it("AC-1/AC-2 — the unit reports and stops; the gate carries both phase-1 locations", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.4\b/m);
      expect(tiedTogether(body, /design_item_id/, [/증거를 보고하고 멈춘다/], 200)).toBe(true);
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "lane-design-refuted");
      expect(row?.location, `${variant.id}: 3.g and 3.k activity (0)`).toMatch(/3\.g/);
      expect(row?.location).toMatch(/3\.k activity \(0\)/);
      expect(body).toMatch(/lane manifest 의 `status: design-refuted` 가 아니다/);
      expect(body).toMatch(/되돌려지지 않은 채 그대로 남는다/);
      expect(body).toMatch(/`lane_disposition` 종류는 `refuted`/);
    }
  });

  it("AC-3/AC-4 — a new document and a new lock, never in place, and the pointer moves", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.4\b/m);
      expect(body).toMatch(/design\/00\.design\.\{seq\}\.md/);
      expect(body).toMatch(/\*\*어느 쪽도 제자리에서 편집하지 않는다\.\*\*/);
      expect(tiedTogether(body, /저널 줄을 append/, [/옛 lock digest/, /새 lock digest/, /\[D-nnn\]/, /증거/], 400)).toBe(true);
      expect(tiedTogether(body, /frozen\.design_lock/, [/invariant_digest/, /카드가 현재 지시하는/, /포인터를 그대로 두면/], 500)).toBe(true);
    }
  });

  it("AC-5/AC-6/AC-7 — loops re-freeze, one execute-unit re-run, and the two-per-wave bound", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.4\b/m);
      expect(tiedTogether(body, /loop \*\*W · P · F\*\*/, [/다시 동결/, /다시 시작/], 300)).toBe(true);
      expect(tiedTogether(body, /`execute-unit` 한 번/, [/새로 저작한 handoff/, /재-dispatch 상한 1 은 phase 2/], 300)).toBe(true);
      expect(body).toMatch(/\*\*mid-wave 수정은 wave 당 2회로 제한된다\.\*\*/);
      expect(body).toMatch(/세 번째는 `design-contradiction-at-wave-boundary` 로 분류된다/);
    }
  });
});

describe("FR-FLOW-087 — requirement promotion at 3.n", () => {
  it("AC-1/AC-2 — once per wave at the host root after loop P passes, with landed defined for phase 1", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*14\.\s/m);
      expect(body).toMatch(/\*\*wave 당 한 번, host root 에서, Phase 3\.n 에\*\*/);
      expect(body).toMatch(/loop P 의 3\.l verdict 가 `pass` 인 뒤에만/);
      expect(tiedTogether(body, /\*\*landed\*\*/, [/Orch-Task/, /frozen\.integration_branch/, /verification_cmd/, /intentionally_empty/], 500)).toBe(true);
      expect(body).toMatch(/`git-ancestor` 증명이나 통과한 클레임 감사로 landed 를 정의하지 않는다/);
    }
  });

  it("AC-3 — both transition rows", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*14\.\s/m);
      expect(tiedTogether(body, /`planned` \/ `in_progress` \| `implemented`/, [/모든 task 가 landed/], 200)).toBe(true);
      expect(
        tiedTogether(body, /`implemented` \| `verified`/, [/loop P verdict 가 `pass`/, /지명하는 잔여가 없으며/, /verification_cmd/], 400)
      ).toBe(true);
    }
  });

  it("AC-4/AC-5 — loop L's closure is named deferred, and test_id: null bars verified", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*14\.\s/m);
      expect(tiedTogether(body, /realised-with-test/, [/phase 1 에서 사용할 수 없고 이연으로 지명한다/], 200)).toBe(true);
      expect(body).toMatch(/조용히 빠뜨리지도, phase 1 연언이라고 주장하지도 않는다/);
      expect(tiedTogether(body, /`test_id: null`/, [/`implemented` 에 도달할 수 있고/, /`verified` 에 도달할 수 없다/, /untested_owner/], 400)).toBe(true);
    }
  });

  it("AC-6/AC-7 — the two evidence rows with their phase-1 substitutions, and the missing-task rule", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*14\.\s/m);
      expect(tiedTogether(body, /type="test"/, [/verification_cmd/, /docs\/analysis\/kiwi-pm-…/], 300)).toBe(true);
      expect(tiedTogether(body, /type="commit"/, [/Orch-Task/, /frozen\.integration_branch/], 300)).toBe(true);
      expect(body).toMatch(/lane `audit\.json` 이나 `integrate-lane` 병합 sha 를 phase 1 참조로 지명하지 않는다/);
      expect(body).toMatch(/`type="test"` 증거만 운반하고 commit 참조가 없다/);
      expect(tiedTogether(body, /landed 하지 않은 요구는 현재 status 에 그대로 두고/, [/missing-task/], 200)).toBe(true);
      expect(body).toMatch(/landed 이므로 `missing-task` 가 아니다/);
    }
  });
});
