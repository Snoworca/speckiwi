import { describe, expect, it } from "vitest";

import {
  ROUTING_GATE_IDS,
  WAVE_SEMANTIC_GATE_IDS,
  criticalGateRows,
  gateSeverityRows,
  offsetOf,
  section,
  tiedTogether,
  variantBodies
} from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-089  route-downgrade-available — three conditions, amended 2026-08-01
// @req FR-FLOW-096  the route is computed at Phase 1.c'
// @req FR-FLOW-097  routing is disqualifier-first
// @req FR-FLOW-098  the persisted work-mode never removes the step rung
// @req FR-FLOW-099  the route table
// @req FR-FLOW-100  R-ORCH drives the shared engine directly
// @req FR-FLOW-101  escalation is one-way
// @req FR-FLOW-103  the four business-decision routing gates

const VARIANTS = variantBodies();

describe("FR-FLOW-096 — route classification at Phase 1.c'", () => {
  it("AC-1 — 1.c' sits between 1.c and 1.d, and names its three routing artifacts", () => {
    for (const variant of VARIANTS) {
      const flow = section(variant.body, /^##\s*3\.\s/m);
      const offsets = [/1\.c\s+갭 열거/, /1\.c′ 라우팅 분류/, /1\.d\s+설계 저작/].map((re) => offsetOf(flow, re));
      expect(offsets.every((offset) => offset > -1), `${variant.id}: 1.c, 1.c-prime and 1.d must all appear`).toBe(true);
      expect(offsets, `${variant.id}: 1.c' sits between 1.c and 1.d`).toEqual([...offsets].sort((a, b) => a - b));

      const position = section(variant.body, /^###\s*4\.1\b/m);
      expect(tiedTogether(position, /routing\/probe\.json/, [/probe-route/, /게이트 \*\*전에\*\*/], 300)).toBe(true);
      expect(tiedTogether(position, /routing\/00\.routing\.md/, [/영문/, /게이트 \*\*전에\*\*/], 300)).toBe(true);
      expect(tiedTogether(position, /routing\/route\.lock\.json/, [/freeze-route/, /게이트 \*\*후에\*\*/], 300)).toBe(true);
    }
  });

  it("AC-1 — 1.c' precedes every SRS mutation, target registration and plan authoring", () => {
    for (const variant of VARIANTS) {
      const position = section(variant.body, /^###\s*4\.1\b/m);
      expect(position).toMatch(/1\.d 의 설계 저작 앞\*\*/);
      expect(position).toMatch(/SRS mutation·target 등록·계획 저작보다도 앞/);
    }
  });

  it("AC-2 — the probe's thirteen fields, each with a producer and a named call", () => {
    for (const variant of VARIANTS) {
      const probe = section(variant.body, /^###\s*4\.2\b/m);
      const ids = ["S1", "S2", "S3", "S3c", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"];
      expect(ids.length).toBe(13);
      const rows = probe.split("\n").filter((line) => /^\|\s*S\d/.test(line.trim()));
      expect(rows.length, `${variant.id}: thirteen probe rows`).toBe(13);
      for (const id of ids) expect(new RegExp(`^\\|\\s*${id}\\s*\\|`, "m").test(probe), `${variant.id}: probe row ${id}`).toBe(true);
      expect(probe).toMatch(/`producer` · `call` · `value` · `read_at`/);
    }
  });

  it("AC-3 — no predicate may read a value absent from probe.json", () => {
    for (const variant of VARIANTS) {
      const probe = section(variant.body, /^###\s*4\.2\b/m);
      expect(probe).toMatch(/\*\*`probe\.json` 에 없는 값을 읽는 술어는 허용되지 않는다\.\*\*/);
    }
  });

  it("AC-4 — what has not happened at 1.c', ending at the first SRS mutation being 3.b", () => {
    for (const variant of VARIANTS) {
      const position = section(variant.body, /^###\s*4\.1\b/m);
      for (const call of ["add_requirement", "update_status", "update_stability"]) expect(position, `${variant.id}: ${call}`).toContain(call);
      expect(position).toMatch(/target 등록 없음/);
      expect(position).toMatch(/계획 저작 없음/);
      expect(position).toMatch(/라우팅 아티팩트 커밋 없음/);
      expect(position).toMatch(/\*\*첫 SRS mutation 은 Phase 3\.b\*\*/);
    }
  });

  it("AC-5 — what has happened: P.1, P.4, P.5, 0.b with two commits, and P.3 read-not-written", () => {
    for (const variant of VARIANTS) {
      const position = section(variant.body, /^###\s*4\.1\b/m);
      expect(position).toMatch(/run root 고정\(P\.1\)/);
      expect(position).toMatch(/회귀 baseline 포착·고정\(P\.4\)/);
      expect(position).toMatch(/git common dir 위의 run lock 보유\(P\.5\)/);
      expect(tiedTogether(position, /kiwi\/orch\/\{run_id\}\/integration/, [/0\.b/, /commit-run-artifacts/, /2건/], 300)).toBe(true);
      expect(position).toMatch(/work-mode 를 \*\*읽었고 쓰지 않았음\*\*\(P\.3\)/);
    }
  });

  it("AC-6 — the magnitude fields drive no threshold and the splitter is not called", () => {
    for (const variant of VARIANTS) {
      const probe = section(variant.body, /^###\s*4\.2\b/m);
      expect(probe).toMatch(/\*\*크기 필드는 어떤 임계도 구동하지 않는다\.\*\*/);
      expect(tiedTogether(probe, /S5\.files/, [/게이트 증거표/, /사용자용 산문/], 200)).toBe(true);
      expect(tiedTogether(probe, /similarity_score/, [/임계를 구동하지 않는다/], 200)).toBe(true);
      expect(probe).toMatch(/`S9\.summary` 는 들어오는 작업이 아니라 \*\*target 에 이미 있는\*\* 요구를 센다/);
      expect(probe).toMatch(/wave splitter 는 1\.c′ 에서 호출되지 않는다/);
    }
  });
});

describe("FR-FLOW-097 — disqualifier-first routing", () => {
  it("AC-1 — D1..D8 with predicate, removed rung and a threshold in a stated unit", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.3\b/m);
      for (const id of ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"]) {
        expect(new RegExp(`\\|\\s*\\*\\*${id}\\*\\*`).test(body), `${variant.id}: disqualifier ${id}`).toBe(true);
      }
      expect(body).toMatch(/\*\*모든 술어는 rung 을 제거하고, 어떤 술어도 rung 을 선택하지 않는다\.\*\*/);
      expect(body).toMatch(/단위: scope 개수/);
    }
  });

  it("AC-2 — the fixed selection order, first survivor wins, R-ORCH never removed", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.3\b/m);
      expect(body).toContain("order: R-PLAN → R-STEP → R-ORCH");
      expect(body).toMatch(/첫 생존 rung 이 이긴다/);
      expect(body).toMatch(/\*\*`R-ORCH` 는 어떤 술어로도 제거되지 않으므로 사다리는 항상 정확히 하나의 rung 에서 끝난다\.\*\*/);
    }
  });

  it("AC-3 — no tie-breaking rule inside the classifier; the only tie is the gate's ballot", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.3\b/m);
      expect(body).toMatch(/분류기 안에는 tie-break 규칙이 없다\. 동점이 생길 수 없기 때문이다/);
      expect(body).toMatch(/위원회 ballot/);
    }
  });

  it("AC-4 — D8's map is total across all twelve field ids", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.3\b/m);
      expect(
        tiedTogether(body, /D8 의 사상은 전역/, [/`S3` · `S3c` · `S4` · `S5` · `S7` · `S8` · `S12` 는 `R-STEP` 을 제거/, /`S2` · `S9` · `S10` 은 `R-PLAN` 을 제거/, /`S1` 과 `S6` 은 \*\*아무것도 제거하지 않는다\*\*/, /`R-ORCH` 는 결코 제거되지 않는다/], 700)
      ).toBe(true);
    }
  });

  it("AC-5/AC-6 — the lock's recorded fields and the no-re-run rule on either override branch", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.3\b/m);
      for (const field of ["`rung`", "`proposed_rung`", "`overridden_by`", "`alternative`", "`decisive`", "`removed[]`"]) {
        expect(body, `${variant.id}: lock field ${field}`).toContain(field);
      }
      expect(body).toContain("{rung, by, observed}");
      expect(body).toMatch(/probe digest/);

      const ballot = section(variant.body, /^###\s*4\.6\b/m);
      expect(
        tiedTogether(ballot, /어느 override 분기에서도/, [/`proposed_rung`/, /"user"/, /"committee"/, /ballot 해소 행/], 500)
      ).toBe(true);
      expect(ballot).toMatch(/\*\*override 뒤에 `computeRoute` 를 다시 실행하지 않는다\.\*\*/);
    }
  });

  it("AC-1 — a wrong route is traceable to one predicate and one observed value, or to the override", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.3\b/m);
      expect(
        tiedTogether(body, /잘못된 라우팅은 추적 가능해야 한다/, [/removed\[\]/, /술어 하나와 관측값 하나/, /proposed_rung/], 500)
      ).toBe(true);
    }
  });

  it("AC-7 — the ballot is closed over the classifier's own outputs", () => {
    for (const variant of VARIANTS) {
      const ballot = section(variant.body, /^###\s*4\.6\b/m);
      expect(
        tiedTogether(ballot, /ballot 은 분류기 자신의 출력 위에서 닫혀 있으므로/, [/계산된 생존자/, /분류기가 만들지 않은 rung 을 결코 도입하지 못한다/], 400)
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-098 — work-mode never removes the step rung", () => {
  it("AC-1 — work-mode is not a disqualifier, with the wait/fail-open ground", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.4\b/m);
      expect(body).toMatch(/\*\*영속 work-mode 는 `R-STEP` rung 을 제거하지 않는다\.\*\*/);
      expect(
        tiedTogether(body, /오케스트레이터 자신의 판단이지 설정에서 읽은 모드가 아니고/, [/기본 모드는 `wait`/, /fail-open/], 300)
      ).toBe(true);
      expect(body).toMatch(/구조적으로 도달 불가/);
    }
  });

  it("AC-2 — the four classifier/mode cases and their recorded outcomes", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.4\b/m);
      const rows = body.split("\n").filter((line) => /^\|\s*rung `R-STEP`|^\|\s*D1–D4|^\|\s*`R-STEP` 은 생존/.test(line.trim()));
      expect(rows.length, `${variant.id}: four case rows`).toBe(4);
      expect(body).toMatch(/비치명 WARN 1건 — 모드와 rung 을 지명/);
      expect(body).toMatch(/비치명 WARN 1건 — 모드·rung·무효화된 라우팅 절을 지명/);
    }
  });

  it("AC-3 — the gate is business-decision, out of critical_gates[], three options, one recommended", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.4\b/m);
      expect(body).toMatch(/`business-decision` 이고 `critical_gates\[\]` 밖이며 세 선택지/);
      for (const option of ["switch-and-step", "stay-and-orchestrate", "abort"]) expect(body, `${variant.id}: ${option}`).toContain(option);
      expect(tiedTogether(body, /`stay-and-orchestrate`/, [/\*\*있음\*\*/], 400)).toBe(true);
      expect(tiedTogether(body, /`switch-and-step`/, [/docs\/spec\/steps\/state\.md/], 300)).toBe(true);
      expect(tiedTogether(body, /`abort`/, [/요구·target·계획·work-mode 를 하나도 변경하지 않는다/], 300)).toBe(true);

      const critical = new Set(criticalGateRows(variant.body).map((row) => row.gateId));
      expect(critical.has("route-step-requires-mode-switch"), `${variant.id}: stays out of critical_gates[]`).toBe(false);
    }
  });

  it("AC-4 — default-wait withholds the marker entirely and a 1-1-1 split halts", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.4\b/m);
      expect(
        tiedTogether(body, /`default-wait`/, [/통째로 보류/, /무숙고 경로/], 300)
      ).toBe(true);
      expect(body).toMatch(/1-1-1 분할은 다수가 없고, 다수가 없으면 게이트는 critical 로 격상되어 중단한다/);
    }
  });

  it("AC-5 — tdd-route-unattended is evaluated after the mode gate with the stated precondition", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.4\b/m);
      expect(
        tiedTogether(body, /tdd-route-unattended/, [/`route-step-requires-mode-switch` \*\*뒤에\*\* 평가/, /`switch-and-step` 으로 해소되지 않았을 때에만/, /proceed-step/, /orchestrate-instead/], 700)
      ).toBe(true);
      expect(body).toMatch(/`recommended: true` 는 `orchestrate-instead` 에 붙는다/);
      expect(body).toMatch(/rung 을 실격시키는 대신 게이트로 올린다/);
    }
  });

  it("AC-6/AC-7 — set_work_mode is never called on the orchestrator's own authority; tdd_policy flows", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.4\b/m);
      expect(body).toMatch(/\*\*오케스트레이터는 `set_work_mode` 를 자기 권한으로 호출하지 않는다\.\*\*/);
      expect(body).toMatch(/유일한 경로는 사람 또는 위원회가 게이트에서 `switch-and-step` 을 고르는 것/);
      expect(
        tiedTogether(body, /tdd_policy` 는 계속 흐른다/, [/`R-ORCH` 로 라우팅되어도/, /tdd_policy = strict/, /그 라우팅 절만 무효화된다/], 400)
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-099 — the per-rung route table", () => {
  it("AC-1 — R-STEP preconditions, including no design document and the reason", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.1\b/m);
      expect(body).toMatch(/rung = "R-STEP"/);
      expect(body).toMatch(/40자 이하 kebab/);
      expect(body).toMatch(/docs\/research\/\{work\}\/01\.intake\.md/);
      expect(body).toMatch(/`S1\.mode == "tdd"`/);
      expect(tiedTogether(body, /\*\*설계 문서 없음\*\*/, [/1\.d 는 실행되지 않았고/, /`kiwi-tdd` 가 자기 SDS 를 저작/], 300)).toBe(true);
    }
  });

  it("AC-2 — the invocation form and the exact flag set", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.1\b/m);
      expect(body).toContain('Skill({ skill: "kiwi-tdd", args: "<task> [--auto] [--mini | --loops N] [--model <name>]" })');
      expect(tiedTogether(body, /--auto` 는 일관성을 위해 전달하되/, [/조용히 무시/, /오류로 읽지 않는다/], 300)).toBe(true);
      expect(tiedTogether(body, /`--max` 와 네 pass-through/, [/--auto-integration/, /--auto-cost-warning/, /--force/, /--regression-baseline/, /전파하지 않는다/], 400)).toBe(true);
    }
  });

  it("AC-3 — three post-return outcomes with the close-out sequence", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.1\b/m);
      expect(body).toMatch(/outcome: "delegated-complete"/);
      expect(body).toMatch(/P\.5 run lock 을 해제/);
      expect(body).toContain("validate` → `sync-index` → `validate --fail-on-warning");
      expect(tiedTogether(body, /post-merge-index-drift/, [/critical/], 200)).toBe(true);
      expect(body).toMatch(/next_hint: null/);
      expect(body).toMatch(/\*\*다시 라우팅하지 않는다\.\*\*/);
      expect(body).toMatch(/E1 로 승격/);
    }
  });

  it("AC-4/AC-5 — R-PLAN preconditions, PLAN_PATH resolution and the --resume rule", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.2\b/m);
      expect(body).toMatch(/rung = "R-PLAN"/);
      expect(tiedTogether(body, /PLAN_PATH/, [/오케스트레이터가 명시적으로 해소한/, /최신 `generated_at` 폴백에 맡기지 않는다/], 400)).toBe(true);
      expect(body).toMatch(/계획의 target 과 같은 활성 target/);
      expect(body).toMatch(/\*\*설계 문서 없음, [^\n]*kiwi-srs[^\n]* 실행 없음\*\*/);
      expect(
        tiedTogether(body, /\.kiwi\/sessions\/\{plan run_id\}\/pm-state\.json/, [/status="done"/, /새 세션이 되어 완료된 Task 를 다시 실행한다/], 500)
      ).toBe(true);
    }
  });

  it("AC-6/AC-7 — the second hop is declared policy, and the flag set is stated", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.2\b/m);
      expect(body).toContain('Skill({ skill: "kiwi-review-fix-loop", args: "--close-reqs [--auto] [--max] [--mini|--loops N]" })');
      expect(
        tiedTogether(body, /두 번째 hop 은 오케스트레이터 자신이 선언한 정책/, [/상속된 의무가 아니다/, /`--close-reqs` 없이는 어떤 요구도 `verified` 에 도달하지 못하고/], 400)
      ).toBe(true);
      expect(body).toMatch(/`--auto` 는 \*\*명시적으로\*\* 전파한다/);
      expect(
        tiedTogether(body, /`--auto-cost-warning` · `--auto-integration` · `--force` 는 사용자가 지정했을 때에만 흐르고/, [/`--regression-baseline` 은 항상[\s\S]{0,40}P\.4 pin/], 300)
      ).toBe(true);
    }
  });

  it("AC-8/AC-9 — the close-out's three disjuncts, the residual row shape and the cap", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.2\b/m);
      expect(body).toMatch(/`plan-coverage-unclosed`\(critical\)는 세 disjunct/);
      expect(body).toMatch(/`verified` 도 아니고 `coverage_residual\[\]` 행에도 지명되지 않았을 때/);
      expect(body).toMatch(/\*\*사유와 owner 를 함께\*\* 지명하지 않을 때/);
      expect(body).toContain("max(--allow-plan-residual, ceil(|req_ids| / 4))");
      expect(body).toContain("{req_id, reason, owner}");
      expect(body).toMatch(/`reason` 은 20자 이상/);
      expect(
        tiedTogether(body, /`stability=draft` 이거나 `implemented` 가 아닌 요구를/, [/건너뛰고 보고/, /`TASK_DONE` 은 요구 집합이 닫혔다는 증거가 아니다/], 400)
      ).toBe(true);
      expect(body).toMatch(/close-out 뒤에 `validate` → `sync-index` → `validate --fail-on-warning`/);
    }
  });

  it("AC-10 — R-ORCH needs nothing beyond the probe and delegates by name per wave", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.3\b/m);
      expect(body).toMatch(/\*\*진입 전에 probe 말고 존재해야 하는 것은 없다\.\*\* 이 rung 은 자기 전제조건을 스스로 생산한다/);
      for (const child of ["kiwi-srs", "kiwi-planner", "kiwi-pm", "kiwi-review-fix-loop"]) expect(body, `${variant.id}: ${child}`).toContain(child);
      expect(
        tiedTogether(body, /.kiwi-review-fix-loop. 의 교정 hop/, [/커밋 범위/, /`--commit-lane-work` 도 `--close-reqs` 도 전달하지 않는다/], 400)
      ).toBe(true);
      expect(body).toMatch(/.kiwi-srs-feasibility. hop 이 \*\*없다\*\*/);
    }
  });

  it("AC-11 — the two inherited safety rules on the delegated rungs", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.3\b/m);
      expect(
        tiedTogether(body, /상속 안전 규칙 둘/, [/`NEEDS_USER` 또는 `FAILED`/, /--auto` 라도 부모가 중단/, /같은 이름의 행이 없어도 무조건 중단/], 500)
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-100 — R-ORCH drives the shared engine directly", () => {
  it("AC-1 — three shared modules and the artifact-root parameter", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.3\b/m);
      expect(body).toMatch(/\*\*`R-ORCH` 는 스킬 호출이 아니다\.\*\*/);
      for (const module of ["_shared/kiwi/wave-decomposition.md", "_shared/kiwi/verify-loop.md", "_shared/kiwi/run-ledger.md"]) {
        expect(body, `${variant.id}: ${module}`).toContain(module);
      }
      expect(body).toContain("docs/research/{work}/");
      expect(body).toContain("docs/analysis/kiwi-wave-master-{run_id}/");
    }
  });

  it("AC-2 — never invokes kiwi-wave-master, with all four grounds", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.3\b/m);
      expect(body).toMatch(/\*\*`kiwi-orchestrator` 는 `kiwi-wave-master` 를 결코 호출하지 않는다\.\*\* 근거 네 가지/);
      expect(body).toMatch(/\*\*중복 경로\*\*/);
      expect(body).toMatch(/\*\*입력 계약이 맞지 않는다\*\*/);
      expect(body).toMatch(/\*\*run 스코프 pin 이 충돌한다\*\*/);
      expect(body).toMatch(/두 번째 `run_id` 와 두 번째 engine 값/);
    }
  });

  it("AC-3 — an explicit user request naming the sibling is not intercepted and starts no run", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.3\b/m);
      expect(
        tiedTogether(body, /명시적으로 지목한 요청은 가로채지 않는다/, [/분류하지도 않고 run 을 시작하지도 않는다/, /형제 스킬을 지목했다고 보고하고 멈춘다/], 400)
      ).toBe(true);
    }
  });

  it("AC-4 — all thirteen wave-semantic gates are in the orchestrator's own critical_gates[]", () => {
    for (const variant of VARIANTS) {
      const declared = new Set(criticalGateRows(variant.body).map((row) => row.gateId));
      for (const gateId of WAVE_SEMANTIC_GATE_IDS) {
        expect(declared.has(gateId), `${variant.id}: ${gateId} must be declared, not inherited`).toBe(true);
      }
      const body = section(variant.body, /^####\s*4\.5\.3\b/m);
      expect(body).toMatch(/13개 전부/);
    }
  });

  it("AC-5 — the body records why they are declared rather than inherited", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.3\b/m);
      expect(body).toMatch(/\*\*`_shared` 모듈은 자식이 아니다\.\*\*/);
      expect(body).toMatch(/아무것도 bubble 하지 않는다/);
      expect(body).toMatch(/게이트 선언은 구조상 스킬 단위다/);
      expect(body).toMatch(/`business-decision` 으로 떨어져 `--auto` 아래에서 위원회가 승인한다/);
      expect(body).toMatch(/뒤 세션이 중복이라고 지우지 않게/);
    }
  });

  // @req FR-FLOW-129 — the object of this refusal used to be the `--cycle` flag. Once FR-FLOW-124
  // made the cycle the default, refusing the flag stopped refusing the chain: a bare
  // `kiwi-pipeline` call is exactly the fixed five-stage sequence this rung must not enter, so a
  // flag-shaped prohibition inverts into a permission while a byte-string check keeps passing. The
  // refusal now names the skill, and says so for every invocation form.
  it("AC-6 — per-wave delegation calls the four skills individually rather than invoking kiwi-pipeline", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^####\s*4\.5\.3\b/m);
      // Scoped to wave delegation, not to the skill outright: `wt-delegation-refused` (§0.G) needs a
      // delegation to refuse, and a blanket "never invokes it" leaves that gate with no subject.
      expect(body).toMatch(/이름으로 개별 호출한다\*\* — [^\n]*wave 위임[^\n]*kiwi-pipeline[^\n]*어떤 호출 형태로도[^\n]*거치지 않는다/);
      // Opting out is not the remedy either: a single-next-step advisor is not this rung's
      // behaviour, so `--none-cycle` must be named and rejected rather than left as an inference.
      expect(body).toMatch(/--none-cycle[^\n]*(?:해법이 아니다|아니다)/);
    }
  });
});

describe("FR-FLOW-101 — one-way escalation with landed-state gating", () => {
  it("AC-1 — E1's two triggers with their moment and cost, and the two non-triggers", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.7\b/m);
      expect(body).toMatch(/\*\*승격은 `R-STEP → R-ORCH` 와 `R-PLAN → R-ORCH` 두 방향뿐이다\. 하향은 거부된다\.\*\*/);
      expect(body).toMatch(/전이가 아니라 이미 착지한 것\*\*의 함수/);
      expect(tiedTogether(body, /SDS 가 200줄 상한에 접근/, [/첫 red 테스트 전/, /거의 0/], 300)).toBe(true);
      expect(tiedTogether(body, /MUTATION_DENIED/, [/Phase 6/, /구현이 이미 작성되어 있다/], 300)).toBe(true);
      expect(
        tiedTogether(body, /EVIDENCE_REQUIRED/, [/COMPLETION_GATE_BLOCKED/, /\*\*trigger 가 아니다\*\*/, /품질 실패로 승격하면/], 400)
      ).toBe(true);
    }
  });

  it("AC-2 — E2's three triggers and the deliberately excluded branch", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.7\b/m);
      expect(tiedTogether(body, /`NEEDS_USER` 3회가 누적/, [/존재하지 않는 요구가 필요하다/], 300)).toBe(true);
      expect(body).toMatch(/선행 작업 부재를 지명하는 `FAILED` 반환/);
      expect(tiedTogether(body, /빈 활성 target 에서 멈추는 경우/, [/D7/, /\*\*분류기 결함\*\*/], 300)).toBe(true);
      expect(
        tiedTogether(body, /`deprecated`\/`frozen` 분기/, [/도달 불가/, /의도적으로 trigger 가 아니다/], 300)
      ).toBe(true);
    }
  });

  it("AC-3 — every escalation writes misroute-{n}.json with the four fields", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.7\b/m);
      expect(
        tiedTogether(body, /routing\/misroute-\{n\}\.json/, [/probe id/, /trigger/, /발화했어야 할 술어/, /필요로 했을 값/], 400)
      ).toBe(true);
      expect(body).toMatch(/anchor 가 맞았어야 할 파일과 관측된 anchor coverage/);
    }
  });

  it("AC-4/AC-5 — the carry manifests, the already-implemented seal and its consent gate", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.7\b/m);
      expect(tiedTogether(body, /step 의 `design\.md` 와 `intent\.md`/, [/1\.d 의 연구 입력/, /--research-doc/], 400)).toBe(true);
      expect(
        tiedTogether(body, /exclusion_class = "already-implemented"/, [/out_of_scope/, /통합 브랜치에 남고/], 400)
      ).toBe(true);
      expect(body).toMatch(/\*\*green 구현은 결코 Task 로 다시 계획되지 않는다\*\*/);
      expect(body).toMatch(/의무적 red 확인/);
      expect(
        tiedTogether(body, /`already-implemented` 봉인은 `--auto` 라도 `out-of-scope-user-consent` 를 발화시킨다/, [/조용할 수 없다/], 300)
      ).toBe(true);
    }
  });

  it("AC-6 — lease hygiene: abandoned, not merged, with the reason", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.7\b/m);
      expect(
        tiedTogether(body, /update_step_state\(<task>, "abandoned"\)/, [/"merged"/, /는 호출하지 않는다/, /body scope 에 저작/], 400)
      ).toBe(true);
    }
  });

  it("AC-7/AC-8 — both critical gates declared, the free escalation, and the sole legal downgrade", () => {
    for (const variant of VARIANTS) {
      const declared = new Map(criticalGateRows(variant.body).map((row) => [row.gateId, row]));
      const escalation = declared.get("route-escalation-after-landed-state");
      expect(escalation, `${variant.id}: route-escalation-after-landed-state declared`).toBeDefined();
      expect(escalation?.reason).toMatch(/status/);
      expect(escalation?.reason).toMatch(/stability/);
      expect(declared.has("route-deescalation-refused"), `${variant.id}: route-deescalation-refused declared`).toBe(true);

      const body = section(variant.body, /^###\s*4\.7\b/m);
      expect(body).toMatch(/첫 red 테스트 전에 감지된 승격은 자유이며 게이트가 없다/);
      expect(body).toMatch(/\*\*유일하게 합법인 하향은 Phase 2 끝의 `route-downgrade-available` 이고 그 뒤로는 없다\.\*\*/);
      expect(
        tiedTogether(body, /최종 출구는 `abort-run`/, [/통합 브랜치와/, /run lock 을 해제/, /run 리포트에 지명/], 400)
      ).toBe(true);
    }
  });

  it("AC-9 — on resume the rung is read from the lock and computeRoute runs once per run", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.7\b/m);
      expect(
        tiedTogether(body, /`frozen\.route\.rung` 에서 읽고 결코 다시 계산하지 않는다/, [/probe_digest/, /run-invariant-drift/, /정확히 한 번/], 500)
      ).toBe(true);
      expect(body).toMatch(/재개 세션에는 대화도 조사자도 없으므로/);
    }
  });
});

describe("FR-FLOW-089 / FR-FLOW-103 — route-downgrade-available and the four routing gates", () => {
  it("089 AC-1 — three conditions, and no fourth over a design-item magnitude threshold", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.3\b/m);
      expect(body).toMatch(/\*\*세 조건이 모두 성립할 때\*\* 발화한다/);
      expect(body).toMatch(/분해가 정확히 \*\*wave 하나\*\*를 돌려주었다/);
      expect(body).toMatch(/\*\*어떤 disqualifier 도 `R-STEP` 을 제거하지 않았다\*\*/);
      expect(body).toMatch(/`status` 나 `stability` 를 움직이지 않았다\*\*/);
      const conditionRows = body.split("\n").filter((line) => /^\d\.\s/.test(line.trim()));
      expect(conditionRows.length, `${variant.id}: exactly three numbered conditions`).toBe(3);
    }
  });

  it("089 AC-1 — the design_items count is gate evidence and drives no predicate", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.3\b/m);
      expect(body).toMatch(/`design_items` 개수는 게이트 증거에 실려 나가고 어떤 술어도 구동하지 않는다/);
    }
  });

  it("089 AC-2 — the third condition is stated as an SRS mutation, with the commit-based reason", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.3\b/m);
      expect(
        tiedTogether(body, /통합 브랜치 커밋의 부재가 아니다/, [/commit-run-artifacts/, /항상 거짓/], 400)
      ).toBe(true);
    }
  });

  it("089 AC-3/AC-4 — exactly two options with the structured marker on continue-orchestrated", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.3\b/m);
      expect(body).toMatch(/선택지는 정확히 둘이다/);
      expect(
        tiedTogether(body, /`continue-orchestrated`/, [/구조화 필드 `recommended: true`/, /`downgrade-to-step`/], 300)
      ).toBe(true);
      expect(body).toMatch(/조용히 하향시키지 않는다/);

      const severity = gateSeverityRows(variant.body).find((row) => row.gateId === "route-downgrade-available");
      expect(severity?.severity, `${variant.id}: business-decision`).toBe("business-decision");
      expect(
        criticalGateRows(variant.body).map((row) => row.gateId),
        `${variant.id}: absent from critical_gates[]`
      ).not.toContain("route-downgrade-available");
    }
  });

  it("089 AC-5/AC-6 — the legality window and what downgrade-to-step does", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.3\b/m);
      expect(
        tiedTogether(body, /\*\*합법 구간\*\*/, [/2\.e 에 존재하고 그 뒤 어디에도 없다/, /route-deescalation-refused/], 300)
      ).toBe(true);
      expect(
        tiedTogether(body, /`downgrade-to-step` 이 하는 일/, [/route-step-requires-mode-switch/, /downgrade-route/, /append-new-artifact/, /invariant_digest/, /매몰 아티팩트/, /kiwi-tdd` 에 넘기지 않는다/], 900)
      ).toBe(true);
    }
  });

  it("089 AC-7 — no --serial degradation is offered and the floor's only outright refusal is named", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*7\.3\b/m);
      expect(body).toMatch(/`--serial` 로의 저하를 제안하지 않고 오케스트레이터가 동시성을 끈다고 말하지도 않는다/);
      expect(body).toMatch(/\*\*유일한 명시적 거부는 `decomposition-input-missing`\*\*/);
    }
  });

  it("103 AC-1 — all four gate ids with severity and firing condition", () => {
    for (const variant of VARIANTS) {
      const rows = gateSeverityRows(variant.body);
      expect([...rows.map((row) => row.gateId)].sort()).toEqual([...ROUTING_GATE_IDS].sort());
      const byId = new Map(rows.map((row) => [row.gateId, row]));
      expect(byId.get("route-proposal")?.condition).toMatch(/모든 run/);
      expect(byId.get("route-proposal")?.condition).toMatch(/1\.c′/);
      expect(byId.get("route-step-requires-mode-switch")?.condition).toMatch(/`R-STEP`/);
      expect(byId.get("route-step-requires-mode-switch")?.condition).toMatch(/tdd/);
      expect(byId.get("tdd-route-unattended")?.condition).toMatch(/switch-and-step/);
      expect(byId.get("route-downgrade-available")?.condition).toMatch(/Phase 2 끝/);
    }
  });

  it("103 AC-2 — the three critical routing gates do appear in the table with reason and location", () => {
    for (const variant of VARIANTS) {
      const declared = new Map(criticalGateRows(variant.body).map((row) => [row.gateId, row]));
      for (const gateId of ["route-probe-unreadable", "route-escalation-after-landed-state", "route-deescalation-refused"]) {
        const row = declared.get(gateId);
        expect(row, `${variant.id}: ${gateId} in critical_gates[]`).toBeDefined();
        expect(row?.reason.length, `${variant.id}: ${gateId} reason`).toBeGreaterThan(0);
        expect(row?.location.length, `${variant.id}: ${gateId} location`).toBeGreaterThan(0);
      }
    }
  });

  it("103 AC-3/AC-4 — why route-proposal is not critical, and why declaring the severity buys the threshold", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*0\.S\b/m);
      expect(
        tiedTogether(body, /`route-proposal` 은 \*\*모든 run 에서\*\* 발화하므로/, [/무인 실행 100% 가 첫 결정에서 멈춘다/, /--auto` 와 무관하게 중단한다는 뜻/], 500)
      ).toBe(true);
      expect(
        tiedTogether(body, /confidence 하한 0\.7 을 고정/, [/미선언 게이트의 기본값에 맡기지 않고/, /하향 조정/], 400)
      ).toBe(true);
    }
  });

  it("103 AC-5/AC-6/AC-7 — the ballot shape, the five recommended clauses and the committee input rule", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*4\.6\b/m);
      expect(
        tiedTogether(body, /`route-proposal` 의 ballot 은/, [/decision\.alternative/, /`abort`/, /동점은 산술적으로 불가능/, /degraded quorum/, /critical 로 격상되어 중단/], 700)
      ).toBe(true);
      expect(body).toMatch(/\*\*다섯 절이 모두 성립할 때뿐\*\*/);
      const clauses = body.split("\n").filter((line) => /^\d\.\s/.test(line.trim()));
      expect(clauses.length, `${variant.id}: exactly five recommended clauses`).toBe(5);
      expect(body).toMatch(/withheld_because\[\]/);
      expect(
        tiedTogether(body, /위원회 입력은 사실만 운반하고/, [/잠정 제안을 절대 운반하지 않는다/, /probe 표/, /제거 표/, /사용자가 읽는 것/], 600)
      ).toBe(true);
      expect(body).toContain('{"rule": "recommended-fastpath", "committee_size": 0, "marked_by": …}');
    }
  });
});
