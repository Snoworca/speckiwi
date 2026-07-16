# work-mode ↔ `tdd_policy` 파생 매핑 SSOT v1.0

work-mode 는 상위 선언(top-level declaration)이고, `tdd_policy` 는 plan 계약 필드로 존속하되 그 **기본값(default)이 현재 work-mode 에서 파생(derive)**된다. 본 문서를 참조하는 모든 kiwi 스킬은 아래 매핑을 read-time 에 동일하게 적용한다.

work-mode 표면: MCP `get_work_mode` / `set_work_mode`, CLI `speckiwi mode`. 저장 위치는 `docs/spec/steps/state.md` 이며, 미설정 시 기본 모드는 `wait` 이다.

## 1. 파생 매핑 (work-mode → `tdd_policy` 기본값)

| work-mode | 파생 `tdd_policy` 기본값 |
|---|---|
| `tdd` | `strict` |
| `sdd` | `relaxed` |
| `wait` | `relaxed` |
| `vibe` | `relaxed` |

- 즉: **tdd → strict**, 그 외 (sdd / wait / vibe) → **relaxed**.
- work-mode 조회 순서: MCP `get_work_mode`(가용 시 우선) → CLI `speckiwi mode`(fallback) → 둘 다 부재 시 `wait` 로 간주(**fail-open** — mode 를 못 읽는다고 작업을 막지 않는다).

## 2. `disabled` 는 절대 파생되지 않는다 (never-derived)

- `tdd_policy = disabled` 는 **어떤 work-mode 로부터도 파생되지 않는다**. `disabled` 는 오직 명시적 `--tdd-policy=disabled` 플래그로만 설정된다.
- 근거: `disabled` 는 TDD 게이트 전체를 끄는 opt-out 이며, work-mode 파생으로 우발적으로 켜지면 안 된다. 그래서 어떤 mode 도 `disabled` 로 파생하지 않고, `wait`·`vibe` 처럼 TDD 강제가 약한 mode 도 `relaxed` 로만 파생한다.

## 3. 명시 플래그 우선 (explicit-over-derived)

- 사용자가 `--tdd-policy <value>` 를 **명시(explicit)**하면 그 값이 work-mode 파생 기본을 **항상 이긴다(wins)**.
- 명시 플래그가 파생 기본을 이길 때(즉 명시 값 ≠ 파생 값): **비-치명 경고(non-fatal WARN)** 1줄을 출력한다 — 예: "명시 `--tdd-policy=<value>` 가 work-mode `<mode>` 파생 기본 `<derived>` 를 override 함". WARN 은 진행을 막지 않는다(non-fatal). 명시 값과 파생 값이 같으면 WARN 없이 진행한다.
- 근거: 명시적·구체적 플래그가 파생 기본을 override 하는 것은 kiwi 관례다 — loop-option `--loops` > `--mini`, auto-option specific `--auto-apply` > broad `--auto`, FR-FLOW-022 `--model` > session default.

## 4. 소비자 (consumers)

| 스킬 | 적용 |
|---|---|
| kiwi-planner | Phase 0(Bootstrap)에서 work-mode 를 읽고 `--tdd-policy` 미지정 시 §1 파생 기본을 plan.md frontmatter·사이드카 `tdd_policy` 에 기록. 명시 플래그는 §3 대로 우선. |
| kiwi-pm | 입력 plan 의 `tdd_policy` 가 현재 work-mode 파생 기본과 모순(예: work-mode=tdd + plan `relaxed`)이면 §3 근거로 **non-HALT WARN** 1줄. 기존 `tdd_policy=disabled` 거부/HALT 는 별개·불변. |
| kiwi-pipeline | work-mode 라우팅(FR-FLOW-039)은 별도다 — mode=tdd + step-scoped 는 kiwi-tdd 로 라우팅하며, 본 문서의 tdd_policy 파생과 직교한다. |
