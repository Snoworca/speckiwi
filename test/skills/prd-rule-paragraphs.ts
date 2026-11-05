// The PRD rule paragraphs FR-FLOW-219 AC-3 pins in kiwi-wave-master and kiwi-orchestrator. The core
// block test of FR-FLOW-204 AC-10 and AC-11 pins the same paragraphs, so the text lives here once.

export const WAVE_MASTER_PRD_RULE =
  "입력 문서에 PRD 경로가 없으면 SRS 저작보다 먼저 `kiwi-prd` 를 불러 그 입력 문서를 `U-1` 의 원천으로 승인된 PRD 를 만든다. 요청이 이미 `docs/prd/` 의 PRD 를 가리키면 그 PRD 를 쓴다. 모든 `kiwi-srs` 호출 — run 앞의 처음 저작과 stage 마다의 증분 저작 — 에 그 PRD 경로를 `PRD_PATH` 로 넘긴다. wave 의 PRD 항목은 그 wave 요구들이 Rationale 에서 인용한 항목의 합집합이고 `speckiwi orchestrate wave show` 로 읽는다 — wave 마다 PRD 항목을 적는 발췌를 쓰지 않는다. 저작이 끝날 때마다 run 의 PRD 커버리지를 `speckiwi prd coverage` 로 확인한다(`wave-decomposition.md §5`). `--auto` 면 `kiwi-prd` 가 `Status` 행을 `unapproved` 로 둔 채 돌려준 PRD 를 쓰고 run 보고에 미승인임을 적는다. PRD 는 `kiwi-prd` 만 고친다.";

export const ORCHESTRATOR_PRD_RULE =
  "intake 가 받은 요청에 PRD 경로가 없으면 조사보다 먼저 `kiwi-prd` 를 불러 승인된 PRD 를 만든다. 요청이 이미 `docs/prd/` 의 PRD 를 가리키면 그 PRD 를 쓴다. 모든 `kiwi-srs` 호출 — 설계 동결 뒤의 처음 저작과 stage 마다의 증분 저작 — 에 그 PRD 경로를 `PRD_PATH` 로 넘긴다. wave 의 PRD 항목은 그 wave 요구들이 Rationale 에서 인용한 항목의 합집합이고 `speckiwi orchestrate wave show` 로 읽는다 — wave 마다 PRD 항목을 적는 발췌를 쓰지 않는다. 저작이 끝날 때마다 run 의 PRD 커버리지를 `speckiwi prd coverage` 로 확인한다(`wave-decomposition.md §5`). `--auto` 면 `kiwi-prd` 가 `Status` 행을 `unapproved` 로 둔 채 돌려준 PRD 를 쓰고 run 보고에 미승인임을 적는다. PRD 는 `kiwi-prd` 만 고친다 — intake 기록(`01.intake.md`)이 요청을 요약하더라도 판정 기준은 PRD 다.";
