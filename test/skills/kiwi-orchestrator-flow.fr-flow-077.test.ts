import { describe, expect, it } from "vitest";

import {
  criticalGateRows,
  gateSeverityRows,
  offsetOf,
  orderedOffsets,
  section,
  tableRows,
  tiedTogether,
  variantBodies,
  verbSection,
  verbSectionNames
} from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-077  intake: thin intent, document, or GitHub issue
// @req FR-FLOW-078  the design document is frozen before any implementation verb
// @req FR-FLOW-079  loop D's frozen denominator
// @req FR-FLOW-080  the per-wave English design document
// @req FR-FLOW-082  validate then sync-index at 3.k
// @req FR-FLOW-083  convergence recipes decide lane eligibility
// @req FR-FLOW-084  post-merge wave verification, one worker per wave
// @req FR-FLOW-085  the wave-boundary issue protocol
// @req FR-FLOW-087  requirement promotion, once, at the host
// @req FR-FLOW-090  the duplication audit and the recorded absence
// @req FR-FLOW-091  design-refuted and the mid-wave amendment
// @req FR-FLOW-092  committee-answered intake questions are recorded
// @req FR-FLOW-094  the ledger records the wave dispatch base
// @req FR-FLOW-095  every pre-merge loop's residual enters the issue ledger
// @req FR-FLOW-102  one worker per wave, parallel by default, serial under --serial

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


// FR-FLOW-081 is discarded in 4.0.0, and FR-FLOW-094 AC-1, AC-2, AC-5 and AC-6 are retired with it: the
// English handoff documents, loop H and the handoff validator leave (FR-FLOW-187 AC-4). Their absence is
// held once, in orchestrator-sds-waves.fr-flow-187.test.ts, rather than restated here.
describe("FR-FLOW-094 — the ledger records the wave dispatch base", () => {
  it("FR-FLOW-094 AC-3 — the dispatch base is the commit that lands the wave's inputs, its SDS included, before the worker is dispatched", () => {
    for (const variant of VARIANTS) {
      const verb = verbSection(variant.body, "commit-wave-inputs");
      expect(verb, `${variant.id}: §V.commit-wave-inputs`).not.toBe("");
      expect(
        tiedTogether(verb, /그 커밋의 sha 가 그 wave 의 dispatch base/, [/Phase 3\.d/, /SDS\(`docs\/sds\/\{run_id\}-wave-\{n\}\.sds\.md`\)/], 400),
        `${variant.id}: the dispatch base is the 3.d commit that carries the wave's SDS`
      ).toBe(true);
      const map = section(variant.body, /^##\s*3\.\s/m);
      const offsets = orderedOffsets(map, [/^\s+3\.d\s[^\n]*dispatch base/m, /^\s+3\.f\s[^\n]*dispatch/m]);
      expect(offsets.every((offset) => offset >= 0), `${variant.id}: ${JSON.stringify(offsets)}`).toBe(true);
      expect(offsets, `${variant.id}: the base is committed at 3.d, before the 3.f dispatch`).toEqual([...offsets].sort((a, b) => a - b));
      expect(section(variant.body, /^##\s*9\.\s/m)).toMatch(/워커의 dispatch base 에 SDS 가 있어야 워커가 그것을 읽는다/);
    }
  });

  it("FR-FLOW-094 AC-4 — the dispatch base is recorded on isolation.base_sha and open[].base_sha", () => {
    for (const variant of VARIANTS) {
      const verb = verbSection(variant.body, "commit-wave-inputs");
      expect(
        tiedTogether(verb, /dispatch base/, [/저널의 `isolation\.base_sha`/, /재개 카드의 `open\[\]\.base_sha`/], 300),
        `${variant.id}: the ledger carries the dispatch base in both places`
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-102 — one worker per wave, parallel by default, the stage plan still frozen and published", () => {
  it("FR-FLOW-102 AC-1 — the worker's executor invocation, run in parallel by default and one at a time under --serial", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*10\.\s/m);
      const fence = /```\n[/$]kiwi-pm SDS_PATH=[^\n]*\n[\s\S]*?```/.exec(body)?.[0] ?? "";
      expect(fence, `${variant.id}: §10 carries the worker's executor invocation as a fenced block`).not.toBe("");
      expect(fence).toContain("SDS_PATH=docs/sds/{run_id}-wave-{n}.sds.md");
      for (const flag of ["--session-suffix w{n}s{s}l{k}", "--no-final", "--no-pipeline-emit", "--commit-lane-work", "--defer-srs-mutation <queue>"]) {
        expect(fence, `${variant.id}: ${flag}`).toContain(flag);
      }
      for (const optional of ["[--resume]", "[--auto]", "[--max]", "[--model <name>]", "[--mini|--loops N]", "[--regression-baseline <the P.4 pin>]"]) {
        expect(fence, `${variant.id}: ${optional}`).toContain(optional);
      }
      expect(fence, `${variant.id}: the retired handoff input`).not.toContain("--handoff");
      expect(
        tiedTogether(body, /\*\*lane 하나는 wave 하나의 워커다\.\*\*/, [/\*\*기본이 병렬\*\*/, /`--serial` 이면 하나씩/, /격리 워커를 띄울 수 없는 런타임은 직렬로 돌고 이유를 기록한다/], 400),
        `${variant.id}: one worker per wave, parallel by default, serial under --serial or an incapable runtime`
      ).toBe(true);
    }
  });

  it("FR-FLOW-102 AC-2 — --commit-lane-work still required, the four Orch-* trailers, and --serial changes only the concurrency", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*10\.1\b/m);
      expect(tiedTogether(body, /`--commit-lane-work` 는 여전히 필수/, [/아무것도 커밋하지 않아/, /호스트가 병합할 것이 없다/], 300)).toBe(true);
      const trailers = [...new Set(body.match(/Orch-[A-Z][a-z]+/g) ?? [])].sort();
      expect(trailers, `${variant.id}: exactly the four Orch-* trailers`).toEqual(["Orch-Lane", "Orch-Run", "Orch-Stage", "Orch-Wave"]);
      expect(body).toMatch(/subject 표식을 담지 않는다/);
      expect(
        tiedTogether(body, /`--serial` 은 동시성만 바꾸고 실행자를 바꾸지 않는다/, [/`--defer-srs-mutation` 을 넘기고/, /`kiwi-coder` 의 네 의무 MCP mutation/, /호스트의 재생/], 300),
        `${variant.id}: a serial run still defers the SRS mutations to the host's replay`
      ).toBe(true);
    }
  });

  it("FR-FLOW-102 AC-3 — serial-unit-failed carries its three disjuncts", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*10\.2\b/m);
      const disjuncts = body.split("\n").filter((line) => /^- /.test(line));
      expect(disjuncts, `${variant.id}: three disjuncts`).toHaveLength(3);
      expect(disjuncts[0]).toMatch(/`verification_cmd` 가 \*\*같은 SDS 로 1회 재시도한 뒤에도\*\* 비-0/);
      expect(disjuncts[1]).toMatch(/워커가 \*\*커밋을 하나도 만들지 않았고\*\*[^\n]*`docs\/analysis\/` 번들에 `intentionally_empty` 사유를 선언하지도 않았다/);
      expect(disjuncts[2]).toMatch(/`NEEDS_USER` 또는 `FAILED` 를 반환했다/);
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "serial-unit-failed");
      expect(row?.location, `${variant.id}: 3.g`).toMatch(/3\.g/);
      for (const disjunct of [/같은 SDS 로 1회 재시도/, /intentionally_empty/, /`NEEDS_USER` 또는 `FAILED`/]) {
        expect(row?.reason, `${variant.id}: the row names ${disjunct}`).toMatch(disjunct);
      }
    }
  });

  it("FR-FLOW-102 AC-4 — the intentionally-empty disposition is per wave, with two conjuncts, and enters checked", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*10\.3\b/m);
      expect(tiedTogether(body, /\*\*wave 단위\*\*/, [/워커의 `docs\/analysis\/kiwi-pm-…` 번들/, /그 wave 의 sds-id/, /\*\*20자 이상의 `reason`\*\*/], 300)).toBe(true);
      expect(
        tiedTogether(body, /허용 조건은 두 연언이다/, [/그 wave 의 `verification_cmd` 가 0 으로 끝나고/, /SDS 쓰기 집합의 어떤 경로도 워커의 base 와 head 사이에서 \*\*달라지지 않았을 것\*\*/], 500)
      ).toBe(true);
      expect(body).toMatch(/\*\*워커의 주장이 아니라 호스트가 트리에서 다시 계산한다\*\*/);
      expect(body).toMatch(/wave 는 `expected` 에 남고[^\n]*`checked` 에 들어간다/);
      expect(tiedTogether(body, /\*\*landed\*\*/, [/`type="test"` 증거만/, /\*\*`type="commit"` 참조는 없다\*\*/], 300)).toBe(true);
    }
  });

  it("FR-FLOW-102 AC-6 — the stage plan is frozen and published before dispatch, and partition-review-unrecorded is a business-decision gate", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*10\.4\b/m);
      // AC-6 reads "frozen at 3.e′"; the skill freezes the lane plan at 3.e (`freeze-lane-plan`, in the phase
      // map and in §0.S) and publishes it at 3.e′. The skill is internally consistent, so the freeze point is
      // pinned where the skill puts it and the AC wording is reported for an SRS revision.
      expect(
        tiedTogether(body, /stage 계획은/, [/\*\*3\.e 에서 동결되고 3\.e′ 에서 dispatch 전에 공개된다\.\*\*/], 200),
        `${variant.id}: frozen at 3.e, then published at 3.e′ before dispatch`
      ).toBe(true);
      expect(
        tiedTogether(
          body,
          /`partition-review-unrecorded` 는 `business-decision` 게이트/,
          [/동결된 lane 계획 \*\*digest\*\* 와 같은 digest 를 기록하고/, /verdict 가 `pass`/, /`review-partition` result line/],
          400
        ),
        `${variant.id}: the recorded digest must equal the frozen one`
      ).toBe(true);
      const severity = gateSeverityRows(variant.body).find((row) => row.gateId === "partition-review-unrecorded");
      expect(severity?.severity, `${variant.id}: declared in §0.S`).toBe("business-decision");
      expect(criticalGateRows(variant.body).map((row) => row.gateId), `${variant.id}: not a critical gate`).not.toContain("partition-review-unrecorded");
      expect(section(variant.body, /^##\s*10\.\s/m), `${variant.id}: the serial-only disclaimer is gone`).not.toMatch(/벽시계 단축을 제공하지 않는다/);
    }
  });

  it("FR-FLOW-102 AC-7 — the resume contract for the worker executor", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*10\.4\b/m);
      expect(
        tiedTogether(
          body,
          /실행자의 재개 계약/,
          [/`Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` trailer/, /\*\*워커 브랜치나 `frozen\.integration_branch`\*\*/, /kiwi-pm` 을 다시 돌리지 않는다/],
          500
        ),
        `${variant.id}: recovery reads the four trailers on either branch and does not re-run the wave`
      ).toBe(true);
      expect(body).toMatch(/`pm-state\.json` 이 있으면 `[/$]kiwi-pm` 에 `--resume` 을 준다/);
      expect(verbSectionNames(variant.body), `${variant.id}: the host-root executor verb is gone`).not.toContain("execute-unit");
    }
  });
});

describe("FR-FLOW-083 — convergence recipes decide lane eligibility", () => {
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

  it("FR-FLOW-083 AC-3 — the four-row eligibility mapping, a lane being one wave's worker", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.2\b/m);
      const mapping = new Map<string, { eligibility: string; result: string }>();
      for (const row of tableRows(body)) {
        const kind = /^\*\*`([a-z-]+)`\*\*$/.exec(row.cells[0] ?? "")?.[1];
        if (kind) mapping.set(kind, { eligibility: row.cells[1] ?? "", result: row.cells[2] ?? "" });
      }
      expect([...mapping.keys()].sort(), `${variant.id}: one row per recipe.kind`).toEqual(["exclusive-lane", "orchestrator-only", "regenerate", "replay"]);
      expect(mapping.get("exclusive-lane")?.eligibility).toBe("적격");
      expect(mapping.get("exclusive-lane")?.result, `${variant.id}: under a whole-wave uniqueness constraint`).toMatch(/wave 전체 \*\*유일성 제약\*\*/);
      for (const kind of ["orchestrator-only", "regenerate", "replay"]) expect(mapping.get(kind)?.eligibility, `${variant.id}: ${kind}`).toBe("부적격");
      expect(body).toMatch(/lane 하나는 wave 하나의 워커다/);
    }
  });

  it("AC-4 — convergence-without-recipe at Phase 2.c with the closed-enum predicate", () => {
    for (const variant of VARIANTS) {
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "convergence-without-recipe");
      expect(row?.location, `${variant.id}: Phase 2.c`).toMatch(/2\.c/);
      expect(row?.reason).toMatch(/닫힌 enum/);
    }
  });

  // AC-5, AC-6 and AC-7 are retired in 4.0.0 (the serial epilogue and the phase-1/phase-2 split leave;
  // successors FR-FLOW-187 and FR-FLOW-188), so their assertions are removed.
});

describe("FR-FLOW-082 — validate then sync-index at 3.k", () => {
  it("FR-FLOW-082 AC-1 AC-2 — at activity (3), after the merge and the replay, before 3.l, validate first", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.3\b/m);
      expect(
        tiedTogether(body, /\*\*Phase 3\.k activity \(3\)\*\*/, [/워커가 병합되고\(3\.h\)/, /유예 SRS mutation 이 재생된\(3\.i\) \*\*뒤\*\*/, /\*\*3\.l 의 loop P 앞\*\*/], 300),
        `${variant.id}: after the merge and the replay, before loop P`
      ).toBe(true);
      expect(body, `${variant.id}: each wave passes it exactly once`).toMatch(/각 wave 는 자기 착지 뒤에 이 실행을 정확히 한 번 거친다/);
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

  it("FR-FLOW-082 AC-4 AC-5 — the charter C4 obligation attaches to the wave's merge and replay, with no deferral", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.3\b/m);
      expect(
        tiedTogether(body, /charter C4/, [/\*\*wave 워커의 병합과 그 유예 SRS mutation 의 재생 뒤\*\*/, /"모든 병합 뒤" 의무가 붙는 자리가 바로 여기다/], 300),
        `${variant.id}: C4 attaches after the worker's merge and the replay`
      ).toBe(true);
      expect(body).toMatch(/lane 하나가 wave 하나의 워커이므로 lane 의 병합이 곧 wave 의 병합이다/);
      expect(body, `${variant.id}: the per-merge attachment is not deferred`).not.toContain("2.6.0-phase2-parallel-lanes");
      expect(body).not.toMatch(/병합을 수행하지 않는다/);
    }
  });
});

describe("FR-FLOW-090 — the duplication audit and the recorded absence", () => {
  it("FR-FLOW-090 AC-1 AC-2 AC-3 — the commit-range input, the position, the artifact, the row shape and three verdicts", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.1\b/m);
      expect(
        tiedTogether(body, /\*\*Phase 3\.k activity \(2\) 에서\*\*/, [/`frozen\.integration_branch` 에 착지한 뒤에 실행된다/], 200),
        `${variant.id}: at activity (2), after the wave's work has landed`
      ).toBe(true);
      const input = body.split("\n").find((line) => /입력은 `frozen\.integration_branch` 위/.test(line)) ?? "";
      expect(input, `${variant.id}: §11.1 states the audit input`).not.toBe("");
      expect(input, `${variant.id}: the other waves of the stage that have landed`).toMatch(/같은 stage 의 다른 wave 들 중 착지한 것들의 커밋 범위/);
      // AC-1 names BOTH halves — the wave's own range and the other landed waves' ranges — and restricts
      // EACH range to its own wave's SDS write set. The waves of one stage have pairwise disjoint write sets
      // (FR-FLOW-188 AC-3), so restricting every range to the audited wave's write set leaves the others empty.
      expect(input, `${variant.id}: the audited wave's own commit range must be named`).toMatch(
        /그 wave (?:자신|자기)의 커밋 범위|그 wave 의 커밋 범위(?:와|에 더해)/
      );
      expect(input, `${variant.id}: each range must be restricted to its own wave's SDS write set`).toMatch(
        /각 범위는 (?:그 범위의|자기|제|해당) wave 의 SDS 쓰기 집합으로 제한/
      );
      expect(body).toMatch(/비교되는 lane 은 한 stage 의 워커들이다/);
      expect(body).toMatch(/워커 자신의 브랜치에서 입력을 가져오지 않는다/);
      expect(body).toMatch(/waves\/wave-\{n\}\/duplication-audit\.md/);
      for (const field of ["symbol_or_block", "lanes[]", "paths[]", "verdict"]) expect(body, `${variant.id}: ${field}`).toContain(field);
      expect(tiedTogether(body, /닫힌 3값/, [/duplicate/, /parallel-evolution/, /acceptable/], 200)).toBe(true);
    }
  });

  it("FR-FLOW-090 AC-4 — exactly one resolution form, and a note is not a resolution", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.1\b/m);
      expect(
        tiedTogether(body, /`duplicate` 행의 해소는 \*\*정확히 한 형태\*\*만 허용/, [/`issue:\{id\}`/, /그 wave 의 `issues\.md` 에 열린 `local-defect` 행/], 300),
        `${variant.id}: the only resolution is an issue reference to a local-defect row`
      ).toBe(true);
      expect(body).toMatch(/\*\*메모는 해소가 아니다\.\*\*/);
      expect(body, `${variant.id}: the epilogue-task form left with the serial epilogue`).not.toMatch(/epilogue/);
    }
  });

  it("AC-5/AC-6 — the gate at 3.k, and the tool checks only that a closed-enum verdict was recorded", () => {
    for (const variant of VARIANTS) {
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "cross-lane-duplication-unresolved");
      expect(row?.location, `${variant.id}: Phase 3.k`).toMatch(/3\.k/);
      const body = section(variant.body, /^###\s*11\.1\b/m);
      expect(body).toMatch(/기록된 서브에이전트 판단이고, 도구는 산출된 후보마다 닫힌 enum 의 verdict 가 기록되었는지만 검사한다/);
    }
  });

  // AC-7 and AC-8 are retired in 4.0.0 (the 3.f″ stage coupling check leaves; successor FR-FLOW-187), so
  // their assertions are removed. The check's absence is held in orchestrator-sds-waves.fr-flow-187.test.ts.

  it("FR-FLOW-090 AC-9 AC-10 — the preventive half is recorded as absent, with both reasons, escalated as X-04", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*11\.1\b/m);
      expect(
        tiedTogether(
          body,
          /예방 절반은 주장하지 않고 부재로 기록한다/,
          [/한 stage 의 wave 들이 이미 서로소인 SDS 쓰기 집합을 갖고/, /SDS Interfaces 가 선언한 심볼을 비교하는 검사가 \*\*없다\*\*/, /\*\*X-04\*\*/],
          500
        ),
        `${variant.id}: both reasons and the escalation`
      ).toBe(true);
      expect(variant.body, `${variant.id}: no shared-substrate gate`).not.toContain("shared-substrate-unhoisted");
      expect(body, `${variant.id}: no shared-substrate conflict reason`).toMatch(/`shared-substrate` 충돌 사유도 그에 딸린 게이트도 선언하지 않는다/);
    }
  });
});

describe("FR-FLOW-084 — loop P over five denominators with a one-worker unit layer", () => {
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

  it("FR-FLOW-084 AC-3 AC-4 AC-5 — one sub-denominator, the wave's one worker, the two-conjunct checked", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*12\.1\b/m);
      expect(body).toMatch(/\*\*단위 계층은 하위 분모 하나\*\*이며 둘로 쪼개지 않는다/);
      expect(tiedTogether(body, /`expected` = `lanes\.lock\.json` 이 그 wave 에 배정한 lane/, [/그 wave 의 워커 하나/], 200)).toBe(true);
      expect(
        tiedTogether(body, /`checked` = /, [/`Orch-Wave` 와 `Orch-Lane` trailer 를 운반하는 워커 커밋이 통합 head 에서 도달 가능/, /\*\*그리고\*\* `verification_cmd` 가 통과한/], 400),
        `${variant.id}: checked is the trailered commits reachable AND a passing verification_cmd`
      ).toBe(true);
      expect(
        tiedTogether(body, /허용 가능한 `intentionally_empty` 선언/, [/`expected` 에 남고 `checked` 에 들어가며/, /\*\*`expected` 에서 제거되지 않는다\*\*/], 300)
      ).toBe(true);
      expect(body, `${variant.id}: the per-task trailer has no unit`).not.toContain("Orch-Task");
    }
  });

  it("FR-FLOW-084 AC-7 — a worker scheduled but never landed forbids ALL_MATCH", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*12\.1\b/m);
      expect(body).toMatch(/스케줄되었으나 \*\*착지하지 않은 워커 하나가 `ALL_MATCH` 를 금지한다\*\*/);
    }
  });

  it("AC-2/AC-9/AC-10 — the intent layer's two halves, the bundle rows, and both pass preconditions", () => {
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

  it("FR-FLOW-084 AC-8 — the bundle carries the trailer-keyed commit range, the worker's analysis bundle, lanes.lock.json and the SDS", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*12\.1\b/m);
      expect(
        tiedTogether(
          body,
          /증거 번들은/,
          [/`lanes\.lock\.json`/, /그 wave 의 SDS/, /`Orch-Wave` 와 `Orch-Lane` trailer 로 키잉된 `frozen\.integration_branch` 위 이 wave 의 \*\*커밋 범위\*\*/, /워커의 `docs\/analysis\/kiwi-pm-…` 번들/],
          400
        ),
        `${variant.id}: the four bundle rows in the bundle sentence`
      ).toBe(true);
      expect(body, `${variant.id}: the handoffs are no longer a bundle row`).not.toMatch(/handoff/);
    }
  });
});

describe("FR-FLOW-085 / FR-FLOW-095 — the wave-boundary issue protocol", () => {
  it("FR-FLOW-095 AC-1 AC-3 — loops D, W and P are the residual sources, and the union is not vacuous", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.1\b/m);
      expect(
        tiedTogether(body, /\*\*모든 pre-merge 검증 루프의 잔여분\*\*/, [/loop P 의 `verification\.residual\[\]`/, /\*\*loop D · W\*\*/], 400),
        `${variant.id}: loops D, W and P`
      ).toBe(true);
      expect(body, `${variant.id}: loop H is retired with the handoff documents`).not.toMatch(/loop H\b/);
      expect(body).toMatch(/pass-with-residual/);
      expect(body).toMatch(/통과한 루프도 잔여를 운반할 수 있다/);
      expect(body).toMatch(/공허하지 않다/);
    }
  });

  // FR-FLOW-095 AC-2 is retired in 4.0.0: the skill runs no loop L (a lane is one wave's worker, reviewed
  // by its own kiwi-review-fix-loop), so the 3.m union has no loop-L residual to name (successor
  // FR-FLOW-188 AC-2). What remains checkable is that the union does not name one.
  it("FR-FLOW-095 AC-2 (retired) — the 3.m union names no loop-L residual", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.1\b/m);
      expect(body.length, `${variant.id}: §13.1 is missing`).toBeGreaterThan(0);
      expect(body, `${variant.id}: §13.1 still names a loop-L residual`).not.toMatch(/loop L/);
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

  it("FR-FLOW-085 AC-6 AC-7 AC-8 AC-9 — both gates at 3.m, the abort route, the append cap and the stated limitation", () => {
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
      expect(
        tiedTogether(
          precondition,
          /\*\*기록된 한계\*\*/,
          [/\*\*형식\*\*/, /\*\*옳음\*\*/, /wave 의 loop P 가 그 wave 가 의존하는 모든 wave 의 `out-of-run` 항목을 다시 검사/],
          500
        ),
        `${variant.id}: the limitation and its compensation over every wave depended on`
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-091 — design refutation and the sanctioned mid-wave amendment", () => {
  it("FR-FLOW-091 AC-1 AC-2 AC-3 AC-9 — the worker reports and stops, the gate at 3.g, the manifest carrier and refuted", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.4\b/m);
      expect(tiedTogether(body, /design_item_id/, [/증거를 보고하고 멈춘다/], 200)).toBe(true);
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "lane-design-refuted");
      expect(row?.location, `${variant.id}: Phase 3.g`).toMatch(/3\.g/);
      expect(row?.location, `${variant.id}: the phase-1 3.k location is gone`).not.toMatch(/3\.k/);
      expect(
        tiedTogether(body, /운반체는 호스트에 돌아오는 워커의/, [/\*\*lane 매니페스트의 `status: design-refuted`\*\*/], 200),
        `${variant.id}: the carrier is the worker's lane manifest`
      ).toBe(true);
      expect(body).toMatch(/되돌려지지 않은 채 그대로 남는다/);
      expect(body).toMatch(/\*\*`lane_disposition` 종류는 종단값 `refuted`\*\*/);
    }
  });

  it("AC-4/AC-5 — a new document and a new lock, never in place, and the pointer moves", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.4\b/m);
      expect(body).toMatch(/design\/00\.design\.\{seq\}\.md/);
      expect(body).toMatch(/\*\*어느 쪽도 제자리에서 편집하지 않는다\.\*\*/);
      expect(tiedTogether(body, /저널 줄을 append/, [/옛 lock digest/, /새 lock digest/, /\[D-nnn\]/, /증거/], 400)).toBe(true);
      expect(tiedTogether(body, /frozen\.design_lock/, [/invariant_digest/, /카드가 현재 지시하는/, /포인터를 그대로 두면/], 500)).toBe(true);
    }
  });

  it("FR-FLOW-091 AC-6 AC-7 AC-8 — loops re-freeze, the SDS re-authored and re-dispatched to one worker, two per wave", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*13\.4\b/m);
      expect(tiedTogether(body, /loop \*\*W · P · F\*\*/, [/다시 동결/, /다시 시작/], 300)).toBe(true);
      expect(
        tiedTogether(body, /SDS 를 `kiwi-sds` 로 \*\*다시 저작\*\*/, [/stage 계획 lock 을 다시 동결/, /워커 하나에 \*\*다시 dispatch\*\*/], 300),
        `${variant.id}: re-author through kiwi-sds, re-freeze the lanes lock, re-dispatch to one worker`
      ).toBe(true);
      expect(body).toMatch(/\*\*mid-wave 수정은 wave 당 2회로 제한된다\.\*\*/);
      expect(body).toMatch(/세 번째는 `design-contradiction-at-wave-boundary` 로 분류된다/);
    }
  });
});

describe("FR-FLOW-087 — requirement promotion at 3.n", () => {
  it("FR-FLOW-087 AC-1 AC-2 AC-3 — once per wave at the host root after loop P passes, the set, and landed", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*14\.\s/m);
      expect(body).toMatch(/\*\*wave 당 한 번, host root 에서, Phase 3\.n 에\*\*/);
      expect(body).toMatch(/loop P 의 3\.l verdict 가 `pass` 인 뒤에만/);
      expect(body).toMatch(/\*\*집합\*\*: 그 wave 의 한 워커가 착지했을 때 그 wave 의 Phase 3\.b 배정 집합, 착지하지 않았을 때 공집합/);
      expect(
        tiedTogether(body, /\*\*landed\*\*/, [/`Orch-Wave` 와 `Orch-Lane` trailer 를 운반하는 워커 커밋이 `frozen\.integration_branch` 위에/, /`verification_cmd` 가 통과한 것/, /허용 가능한 `intentionally_empty` 선언/], 500),
        `${variant.id}: landed is the trailered worker commits plus a passing verification_cmd, or an admissible empty declaration`
      ).toBe(true);
      expect(body).toMatch(/\*\*lane head 에 대한 `git-ancestor` 증명이나 통과한 클레임 감사나 워커 자신의 보고로 landed 를 정의하지 않는다\.\*\*/);
    }
  });

  it("FR-FLOW-087 AC-4 — both transition rows", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*14\.\s/m);
      expect(tiedTogether(body, /`planned` \/ `in_progress` \| `implemented`/, [/\*\*그 wave 가 landed\*\*/], 200)).toBe(true);
      expect(
        tiedTogether(body, /`implemented` \| `verified`/, [/loop P verdict 가 `pass`/, /지명하는 잔여가 없으며/, /verification_cmd/], 400)
      ).toBe(true);
    }
  });

  // AC-5 and AC-6 are retired in 4.0.0 (loop L's realised-with-test closure and the handoff's
  // `test_id: null` rows leave; successor FR-FLOW-186, the test-sufficiency check before promotion, held in
  // orchestrator-sds-waves.fr-flow-187.test.ts), so their assertions are removed.

  it("FR-FLOW-087 AC-7 AC-8 AC-9 AC-10 — the two evidence rows, the forbidden references, and the missing-task rule", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*14\.\s/m);
      expect(tiedTogether(body, /`type="test"` — 참조는/, [/`verification_cmd`/, /워커의 `docs\/analysis\/kiwi-pm-…` 번들/], 300)).toBe(true);
      expect(
        tiedTogether(body, /`type="commit"` — 참조는/, [/`frozen\.integration_branch` 위 그 wave 의 `Orch-Wave` trailer 가 붙은 워커 커밋 sha 각각/], 300)
      ).toBe(true);
      expect(body).toMatch(/\*\*lane `audit\.json` 이나 `integrate-lane` 병합 sha 를 증거 참조로 지명하지 않는다\.\*\*/);
      expect(tiedTogether(body, /`intentionally_empty` 선언으로 landed 한 wave 는/, [/워커가 커밋을 만들지 않았으므로/, /`type="test"` 증거만 운반하고 commit 참조가 없다/], 300)).toBe(true);
      expect(tiedTogether(body, /landed 하지 않은 wave 의 요구는 현재 status 에 그대로 두고/, [/`issues\.md` 에 `missing-task` 로 기록한다/], 200)).toBe(true);
      expect(body).toMatch(/landed 이므로 `missing-task` 가 아니다/);
    }
  });
});
