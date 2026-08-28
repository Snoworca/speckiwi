run 종료 줄에는 `terminal_review {skill, base, head, verdict}` 를 싣는다. `base` 는 그 줄의 `run_diff_window.base_sha` 와 같아야 한다. `head` 는 심판한 범위의 head 이며 run head 와 같을 필요가 없다 — 리뷰의 수정을 커밋한 뒤 이 줄을 쓰기 때문이다. verdict 은 완료를 방면하는 `pass` 와 `not-applicable-empty-window`, 그리고 방면하지 않는 `residual` 과 `skipped-run-halted` 로 갈린다(FR-NODE-188). 창이 비면 `not-applicable-empty-window`, 커밋 착지 뒤 중단이면 `skipped-run-halted`.

종료 줄을 쓴 직후 그 줄을 검증기에 통과시킨다 — `terminal_review` 가 계약대로 실렸는지는 이 절의 산문이 아니라 `validateWavesJournal` 이 판정한다. `kiwi-orchestrator` 가 쓴 저널이면 MCP `orchestrate_validate` 를 `runId` 와 `strict: true` 로 부르고, MCP 가 없으면 CLI `speckiwi orchestrate validate --run-id {run_id} --strict --json` 으로 같은 판정을 받는다. `kiwi-wave-master` 가 쓴 저널은 **MCP 로 검증하지 않는다** — 그 도구에는 엔진 인자가 없다. 그 저널은 CLI 로만 검증하며 `--engine kiwi-wave-master` 를 함께 준다. error 급 진단이 하나라도 나오면 `terminal-review-loop-missing` 으로 run 을 중단하고 **종료 줄을 다시 쓰지 않는다** — 거부를 없애려는 재작성은 결함을 고치는 것이 아니라 기록을 고치는 행위다. MCP 로 보내면 기본값 `kiwi-orchestrator` 로 파싱되어 그 run 의 줄을 한 줄도 보지 않은 채 깨끗하다고 답한다.

복구: 라운드를 다시 한다.
게이트: `final-verify-residual-critical` · `wave-append-cap-exhausted`.
