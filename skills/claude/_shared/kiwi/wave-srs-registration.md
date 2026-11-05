# kiwi wave-srs-registration v1.0.0

run 이 SRS 를 쓰는 `kiwi-srs` 호출의 **계약** SSOT. `kiwi-wave-master` 와 `kiwi-orchestrator` 가 이 문서를 참조한다. 호출은 **둘뿐이다** — run 당 한 번의 처음 저작(§1)과 워커 델타의 증분 저작(§2). wave 마다 target 을 만들거나 wave 마다 저작하는 호출은 없다. 두 호출 모두 호스트가 run root 에서 하나씩 부른다 — 요구 ID 발급 · SRS 락 · 활성 target 이 run root 하나의 전역 상태이기 때문이다(`parallel-waves.md §1`).

---

## 1. 처음 저작 — run 당 한 번, 분해 앞

```
Skill({ skill: "kiwi-srs", args: "PRD_PATH=<run 의 PRD> TARGET=<제품 target> --research-doc <입력 문서> --constraints-doc <constraints_path> [--auto] [--max] [--mini|--loops N]" })
```

`--constraints-doc` 은 `wave-decomposition.md §1` 의 `constraints_path` 아티팩트다 — 저작 입력에 없는 제약은 검증에서 잡혀도 반영할 근거가 없다. `existing_modules` 도 같은 호출의 **저작 입력**으로 넘긴다 — 검증자만 읽는 목록은 무엇이 저작되는지를 바꾸지 못한다. `--research-doc` 은 입력이 연구·설계 문서일 때만 준다. 미등록 제품 target 을 생성 옵션과 함께 등록하는 것은 이 호출의 정상 경로다. 재개는 이 호출을 다시 돌리지 않는다 — 그래프가 커밋되어 있으면 저작은 끝났다.

## 2. 증분 저작 — stage 당 한 번, PW-10 재생 뒤 · PW-13 검증 앞

워커는 매니페스트의 `srs_deltas[]` 로 빠졌거나 틀린 요구를 보고하고 멈추지 않는다(`parallel-waves.md` PW-6). 호스트는 `evidence` 가 red 테스트나 명령 출력이 아닌 델타를 버리고 그 델타를 보고에 적는다. 남은 델타를 `{artifact_root}waves/stage-{s}/srs-deltas.md` 에 모아 한 번 부른다:

```
Skill({ skill: "kiwi-srs", args: "REQ_PATH={artifact_root}waves/stage-{s}/srs-deltas.md PRD_PATH=<run 의 PRD> TARGET=<제품 target> [--auto] [--max] [--mini|--loops N]" })
```

PRD 항목도 `fills:` 도 인용하지 않는 확장은 `prd-residual-user-decision` 으로 멈춘다(`kiwi-srs` 의 PRD 판정). 델타가 없으면 이 호출을 건너뛴다. 저작 뒤 `wave-decomposition.md §5` 의 PRD 커버리지를 다시 돈다.

델타는 종류마다 이렇게 간다.

| 델타 | 처리 |
|---|---|
| `new-requirement` | 저작이 돌려준 ID 를 `wave-decomposition.md §6` 의 R1 ~ R5 로 배치한다 |
| `ac-change` — 현재 wave 의 `verified` 아닌 요구 | 그 AC 를 고치고 그 wave 를 재진입 `r{m}` 으로 다시 돈다(`parallel-waves.md §3`) |
| `ac-change` — 끝난 wave 의 `verified` 요구 | 그 요구를 고치지 않는다. 뒤 wave 에 후속 요구를 저작하고, 옛 AC 를 그 후속 요구를 지명해 만료한다(MCP `expire_acceptance_criterion`) |
| 옛 동작 자체가 틀림 | `wave-verify-cross-wave-fix-required` 로 멈춘다. 하향 · 수정 · 재승급은 사용자가 결정한 뒤에만 한다 |
| `residual` | 저작이 돌려준 ID 로 받는 wave 에 넣는다 |
