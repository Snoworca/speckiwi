skills/claude/kiwi-review-fix-loop/SKILL.md
#### §0.G7 — REQ close 게이트 (`--close-reqs` 활성 시)
---
| `--close-reqs` + 처분 대조 불일치 (`전이 성공 수 + 제외 수 ≠ scoped 크기`) | 그 실행은 **무효**. `FAILED` 로 종료 + 처분 없는 REQ 열거 |
=== terminal status section ===
skills/claude/kiwi-review-fix-loop/SKILL.md
### 7.3 Pipeline event emit (의무)
---
- `status`: 모든 immediate_fix 처리 + 회귀 PASS **+ 승급 결과 조건** = `TASK_DONE`; discussion_needed 가 사용자 대기 = `NEEDS_USER`; dry-run = `DRY_RUN`; 실패 = `FAILED`. **승급 결과 조건**: `--close-reqs` 활성 실행에서 `eligible` 이 **1 이상인데 전이 0건**이면 `TASK_DONE` 을 반환하지 않는다 — `FAILED` 다. 처분 대조가 어긋난 실행도 마찬가지다. `--close-reqs` 가 없는 실행에는 이 조건이 적용되지 않는다. 값은 `_shared/kiwi/pipeline-event.md` §2 의 enum 안에서만 고른다 — 새 값을 만들지 않는다
=== terminal status section ===
skills/claude/kiwi-review-fix-loop/references/conditional-sections.md
#### 6.6.1 영향 REQ-ID 추출
---
**처분 대조**: `전이 성공 수 + 제외 수 = scoped 크기` 가 성립해야 한다. **항등식이 성립하지 않으면 그 실행은 무효다** — 처분을 받지 못한 REQ 가 있다는 뜻이고, "덜 추출" 이 바로 여기서 개수 불일치로 드러난다. 산문 증거 REQ 와 `draft`·`deprecated` REQ 는 `eligible` 에서 빠지지만 **`scoped` 에는 남고** 제외 사유를 받는다 — `scoped` 에서 빼면 항등식이 그 REQ 의 부재를 보지 못한다.
=== terminal status section ===
skills/codex/kiwi-review-fix-loop/references/extended-workflow.md
## Close Requirements
---
Accounting identity: `transitioned + excluded == scoped`. A run whose
=== terminal status section ===
skills/codex/kiwi-review-fix-loop/references/extended-workflow.md
## Pipeline Event
---
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN`. Under `--close-reqs`, `TASK_DONE` additionally requires the promotion result: if `eligible` is at least one and `transitioned` is zero, the run is `FAILED`, and so is one whose accounting identity does not hold. A run without `--close-reqs` is unaffected. Values come from the enum `_shared/kiwi/pipeline-event.md` declares; no new value is introduced |
=== terminal status section ===
skills/etc/kiwi-review-fix-loop/references/extended-workflow.md
## Close Requirements
---
Accounting identity: `transitioned + excluded == scoped`. A run whose
=== terminal status section ===
skills/etc/kiwi-review-fix-loop/references/extended-workflow.md
## Pipeline Event
---
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN`. Under `--close-reqs`, `TASK_DONE` additionally requires the promotion result: if `eligible` is at least one and `transitioned` is zero, the run is `FAILED`, and so is one whose accounting identity does not hold. A run without `--close-reqs` is unaffected. Values come from the enum `_shared/kiwi/pipeline-event.md` declares; no new value is introduced |
=== terminal status section ===
.agents/skills/kiwi-review-fix-loop/references/extended-workflow.md
## Close Requirements
---
Accounting identity: `transitioned + excluded == scoped`. A run whose
=== terminal status section ===
.agents/skills/kiwi-review-fix-loop/references/extended-workflow.md
## Pipeline Event
---
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN`. Under `--close-reqs`, `TASK_DONE` additionally requires the promotion result: if `eligible` is at least one and `transitioned` is zero, the run is `FAILED`, and so is one whose accounting identity does not hold. A run without `--close-reqs` is unaffected. Values come from the enum `_shared/kiwi/pipeline-event.md` declares; no new value is introduced |