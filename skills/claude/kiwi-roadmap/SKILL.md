---
name: kiwi-roadmap
description: "기능·마일스톤·일정에 관한 사용자 말을 로드맵 도구 호출로 바꾸는 로드맵 스킬. docs/roadmap.md 는 로드맵 도구로만 기록·조회하고, 상태는 도구가 SRS 에서 계산한 값을 읽기만 한다. 일정 변경에는 사용자 원문을 사유로 남기고, 사용자가 착수하는 항목은 kiwi-prd 로 넘긴다. 트리거 — kiwi roadmap, 로드맵, 기능 로드맵, 마일스톤, 일정 잡아줘, 일정 변경, 로드맵에 추가, /kiwi-roadmap. 옵션 — --auto."
---
# kiwi-roadmap v0.1

1. 로드맵은 로드맵 도구(`add_roadmap_item` · `update_roadmap_item` · `sync_roadmap_actuals`)로만 바꾼다 — `docs/roadmap.md` 를 손으로 고치지 않는다.
2. 로드맵에 상태를 쓰지 않는다 — 상태와 진행률은 도구가 SRS 에서 계산하고, 멈춤과 취소만 `lifecycle` 의 `paused` · `cancelled` 로 적는다.
3. 로드맵을 쓰는 호출(`add_roadmap_item` · `update_roadmap_item`, `dryRun` 으로 부를 때 포함)에는 늘 `reason` 을 넣고, 일정을 바꾸는 쓰기에는 사용자 원문을 따옴표째 넣는다.
4. 항목을 `cancelled` 로 바꾸는 것은 사용자가 취소하라고 말했을 때뿐이다 — `--auto` 에서도 그렇다.

> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

기능·마일스톤·일정에 관한 사용자 말을 로드맵 도구 호출로 바꾼다. 로드맵은 계획 기록이고 요구 원본은 `docs/spec` 의 SRS 다. 로드맵 문법은 도구가 지키므로 여기 옮겨 적지 않는다. 근거 요구: FR-FLOW-224.

## 1. 순서

1. 묻기 전에 `list_roadmap_items` 와 `get_active_target` 을 부르고, 사용자 말의 낱말로 `search_requirements` 를 부른다. Search in both languages: put the words you would search for and their equivalents in the other language into the same query string (add English words to a Korean request; add Korean words to an English request or to a requirement you are writing in English).
2. 사용자 말을 나눈다 — 새 항목은 `add_roadmap_item`(등록된 target 의 항목이면 `fromTarget`), 일정·범위·연결 변경과 멈춤·취소는 `update_roadmap_item`, 조회는 `list_roadmap_items` · `get_roadmap_item`, 착수는 §2.
3. 쓰기에 꼭 필요한 값은 `kind` · `title` · `reason` 뿐이다. 사용자가 말하지 않은 날짜는 `-` 로 둔다. 읽은 것이 답하지 못한 것만 묻고, 질문은 한 번에 하나만 한다.
4. 쓰기는 먼저 `dryRun` 을 true 로 불러 그 결과를 사용자에게 보이고, 사용자가 승인하면 같은 입력으로 쓴다. `--auto` 에서만 dry-run 을 건너뛰고 바로 쓴다.
5. 쓴 뒤에는 도구가 돌려준 항목 ID 와 바뀐 필드를 보고한다.

## 2. 착수 — kiwi-prd 로 넘긴다

사용자가 항목을 시작하자고 하면 `get_roadmap_item` 으로 그 항목을 읽고, 항목의 제목·Purpose·Features 를 요청 원문으로 `ROADMAP_ITEM=RM-<n>` 과 함께 `/kiwi-prd` 에 넘긴다.

`kiwi-prd` 가 돌아오면 돌려받은 PRD 경로를 `update_roadmap_item` 의 `prd` 로 그 항목에 기록한다. 다음 단계는 `kiwi-prd` 가 안내한 `/kiwi-srs REQ_PATH=<PRD 경로> ROADMAP_ITEM=RM-<n>` 이다.

실제 날짜는 로드맵 항목을 받은 `kiwi-wave-master` run 이 기록한다.
