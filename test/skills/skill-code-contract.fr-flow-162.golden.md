skills/claude/_shared/kiwi/waves-event.md
---
| `terminal_review` | object | 그 run 을 닫는 줄이 싣는 종료 리뷰 기록 — `{skill, base, head, verdict}`. `base` 는 같은 줄의 `run_diff_window.base_sha` 와 **같아야 하고**, `head` 는 실제로 심판한 범위의 head 다 — 리뷰가 고친 것을 커밋한 뒤 종료 줄을 쓰므로 run head 는 그보다 앞서 있는 것이 정상이며, head 까지 일치를 요구하면 올바른 run 이 거부된다. verdict 은 `pass` / `residual` / `not-applicable-empty-window` / `skipped-run-halted` 중 하나이며, 완료를 방면하는 값은 `pass` 와 `not-applicable-empty-window` 이고, 방면하지 않는 값은 `residual` 과 `skipped-run-halted` 이다. `phase="final-verify"` 종료 줄에 이 필드를 실을 때는 같은 줄에 `run_diff_window` 를 **반드시 함께** 싣는다 — 없으면 창 대조가 수행되지 않아 임의의 창을 적어도 통과한다 (1.5.0~, FR-NODE-188) |
=== verdict site ===
skills/claude/kiwi-orchestrator/SKILL.md
---
run 종료 줄에는 `terminal_review {skill, base, head, verdict}` 를 싣는다. `base` 는 그 줄의 `run_diff_window.base_sha` 와 같아야 한다. `head` 는 심판한 범위의 head 이며 run head 와 같을 필요가 없다 — 리뷰의 수정을 커밋한 뒤 이 줄을 쓰기 때문이다. verdict 은 완료를 방면하는 `pass` 와 `not-applicable-empty-window`, 그리고 방면하지 않는 `residual` 과 `skipped-run-halted` 로 갈린다(FR-NODE-188). 창이 비면 `not-applicable-empty-window`, 커밋 착지 뒤 중단이면 `skipped-run-halted`.
=== verdict site ===
skills/codex/_shared/kiwi/waves-event.md
---
| `terminal_review` | object | 그 run 을 닫는 줄이 싣는 종료 리뷰 기록 — `{skill, base, head, verdict}`. `base` 는 같은 줄의 `run_diff_window.base_sha` 와 **같아야 하고**, `head` 는 실제로 심판한 범위의 head 다 — 리뷰가 고친 것을 커밋한 뒤 종료 줄을 쓰므로 run head 는 그보다 앞서 있는 것이 정상이며, head 까지 일치를 요구하면 올바른 run 이 거부된다. verdict 은 `pass` / `residual` / `not-applicable-empty-window` / `skipped-run-halted` 중 하나이며, 완료를 방면하는 값은 `pass` 와 `not-applicable-empty-window` 이고, 방면하지 않는 값은 `residual` 과 `skipped-run-halted` 이다. `phase="final-verify"` 종료 줄에 이 필드를 실을 때는 같은 줄에 `run_diff_window` 를 **반드시 함께** 싣는다 — 없으면 창 대조가 수행되지 않아 임의의 창을 적어도 통과한다 (1.5.0~, FR-NODE-188) |
=== verdict site ===
skills/codex/kiwi-orchestrator/SKILL.md
---
run 종료 줄에는 `terminal_review {skill, base, head, verdict}` 를 싣는다. `base` 는 그 줄의 `run_diff_window.base_sha` 와 같아야 한다. `head` 는 심판한 범위의 head 이며 run head 와 같을 필요가 없다 — 리뷰의 수정을 커밋한 뒤 이 줄을 쓰기 때문이다. verdict 은 완료를 방면하는 `pass` 와 `not-applicable-empty-window`, 그리고 방면하지 않는 `residual` 과 `skipped-run-halted` 로 갈린다(FR-NODE-188). 창이 비면 `not-applicable-empty-window`, 커밋 착지 뒤 중단이면 `skipped-run-halted`.
=== verdict site ===
skills/etc/_shared/kiwi/waves-event.md
---
| `terminal_review` | object | 그 run 을 닫는 줄이 싣는 종료 리뷰 기록 — `{skill, base, head, verdict}`. `base` 는 같은 줄의 `run_diff_window.base_sha` 와 **같아야 하고**, `head` 는 실제로 심판한 범위의 head 다 — 리뷰가 고친 것을 커밋한 뒤 종료 줄을 쓰므로 run head 는 그보다 앞서 있는 것이 정상이며, head 까지 일치를 요구하면 올바른 run 이 거부된다. verdict 은 `pass` / `residual` / `not-applicable-empty-window` / `skipped-run-halted` 중 하나이며, 완료를 방면하는 값은 `pass` 와 `not-applicable-empty-window` 이고, 방면하지 않는 값은 `residual` 과 `skipped-run-halted` 이다. `phase="final-verify"` 종료 줄에 이 필드를 실을 때는 같은 줄에 `run_diff_window` 를 **반드시 함께** 싣는다 — 없으면 창 대조가 수행되지 않아 임의의 창을 적어도 통과한다 (1.5.0~, FR-NODE-188) |
=== verdict site ===
skills/etc/kiwi-orchestrator/SKILL.md
---
run 종료 줄에는 `terminal_review {skill, base, head, verdict}` 를 싣는다. `base` 는 그 줄의 `run_diff_window.base_sha` 와 같아야 한다. `head` 는 심판한 범위의 head 이며 run head 와 같을 필요가 없다 — 리뷰의 수정을 커밋한 뒤 이 줄을 쓰기 때문이다. verdict 은 완료를 방면하는 `pass` 와 `not-applicable-empty-window`, 그리고 방면하지 않는 `residual` 과 `skipped-run-halted` 로 갈린다(FR-NODE-188). 창이 비면 `not-applicable-empty-window`, 커밋 착지 뒤 중단이면 `skipped-run-halted`.
=== verdict site ===
.agents/skills/_shared/kiwi/waves-event.md
---
| `terminal_review` | object | 그 run 을 닫는 줄이 싣는 종료 리뷰 기록 — `{skill, base, head, verdict}`. `base` 는 같은 줄의 `run_diff_window.base_sha` 와 **같아야 하고**, `head` 는 실제로 심판한 범위의 head 다 — 리뷰가 고친 것을 커밋한 뒤 종료 줄을 쓰므로 run head 는 그보다 앞서 있는 것이 정상이며, head 까지 일치를 요구하면 올바른 run 이 거부된다. verdict 은 `pass` / `residual` / `not-applicable-empty-window` / `skipped-run-halted` 중 하나이며, 완료를 방면하는 값은 `pass` 와 `not-applicable-empty-window` 이고, 방면하지 않는 값은 `residual` 과 `skipped-run-halted` 이다. `phase="final-verify"` 종료 줄에 이 필드를 실을 때는 같은 줄에 `run_diff_window` 를 **반드시 함께** 싣는다 — 없으면 창 대조가 수행되지 않아 임의의 창을 적어도 통과한다 (1.5.0~, FR-NODE-188) |
=== verdict site ===
.agents/skills/kiwi-orchestrator/SKILL.md
---
run 종료 줄에는 `terminal_review {skill, base, head, verdict}` 를 싣는다. `base` 는 그 줄의 `run_diff_window.base_sha` 와 같아야 한다. `head` 는 심판한 범위의 head 이며 run head 와 같을 필요가 없다 — 리뷰의 수정을 커밋한 뒤 이 줄을 쓰기 때문이다. verdict 은 완료를 방면하는 `pass` 와 `not-applicable-empty-window`, 그리고 방면하지 않는 `residual` 과 `skipped-run-halted` 로 갈린다(FR-NODE-188). 창이 비면 `not-applicable-empty-window`, 커밋 착지 뒤 중단이면 `skipped-run-halted`.