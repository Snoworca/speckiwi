skills/claude/kiwi-coder/SKILL.md
---
sidecar `trace_links[i].trace_intent` 은 평탄화 대상이면서 flat schema 에 대응 인자가 없다. 값은 `notes` 에 `trace_intent=<값>` 으로 인코딩해 넘기고 최상위 인자로는 싣지 않는다 — 스키마에 없는 이름은 거부가 아니라 조용히 버려지며, 그 순간 kiwi-srs 가 `addition_site` 잔존으로 status 상한을 거는 근거가 사라진다.
=== trace_intent site ===
skills/claude/kiwi-planner/SKILL.md
---
| `trace_intent` | `notes` 에 `trace_intent=<값>` 으로 인코딩 — flat schema 에 이 이름의 인자가 없으므로, 최상위 인자로 실으면 거부가 아니라 조용히 버려지고 kiwi-srs 의 `addition_site` status 상한이 읽을 데이터가 사라진다 |
=== trace_intent site ===
skills/claude/kiwi-planner/SKILL.md
---
trace_intent?: "verifies"|"addition_site"|"negative";  // 평탄화 시 실 MCP `notes` 에 `trace_intent=<값>` 으로 인코딩 — "sidecar nested ↔ 실 MCP flat 변환 매핑" 표 참조. flat schema 에 이 이름의 인자는 없다
=== trace_intent site ===
skills/claude/kiwi-srs/SKILL.md
---
| §0.14 | **Trace intent 분리**. `add_trace_link` 에는 `trace_intent` 인자가 없다. 스키마가 받는 것은 `id` · `type` · `reference` · `relation` · `notes` · `dryRun` · `ignoreLock` 이며, 이 일곱에 없는 인자는 조용히 버려진다. intent 는 `notes` 안에 `trace_intent=<값>` 으로 적는다. Code 타입 trace entry 에만 적용 — Requirement 타입 trace_link 의 `notes` 에는 `trace_intent` 미부착. Code trace `trace_intent` enum: `verifies` (기존 코드가 statement 동작 수행) / `addition_site` (해당 위치에 구현 추가 예정) / `negative` (의도된 부재). **Dual-intent split**: 동일 file:line-range 가 두 intent 를 동시에 가지면 범위 폭이 다른 별도 entry로 분리 등록. **Status cap**: 어느 trace 라도 `trace_intent=addition_site` 잔존 시 해당 REQ 의 status 는 `planned` 상한. 라이브 모드에서 `update_status(in_progress\|implemented)` 호출 시도 → 차단 + AskUserQuestion "구현 증거가 있습니까? (코드 path:line)" |
=== trace_intent site ===
skills/claude/kiwi-srs/SKILL.md
---
| REQ 의 어느 Code trace 라도 `notes` 에 `trace_intent=addition_site` 잔존 | status 상한 = `planned` |
=== trace_intent site ===
skills/claude/kiwi-srs/SKILL.md
---
5. `add_trace_link { id: NEW-ID, type: "Code", reference: "{path:line}", relation: "implements", notes: "trace_intent=verifies|addition_site" }` — `add_trace_link` 에는 `trace_intent` 인자가 없다. 스키마가 받는 것은 `id` · `type` · `reference` · `relation` · `notes` · `dryRun` · `ignoreLock` 이며, 이 일곱에 없는 인자는 조용히 버려진다. intent 는 `notes` 안에 `trace_intent=<값>` 으로 적는다.
=== trace_intent site ===
skills/claude/kiwi-srs/SKILL.md
---
1. `add_requirement` — type / scope / target / title / requirement / acceptanceCriteria / trace=[Code, `notes` 에 `trace_intent=<값>`] / status=planned / priority / tags=[feasibility:{level}]
=== trace_intent site ===
skills/codex/kiwi-coder/references/extended-workflow.md
---
sidecar `trace_links[i].trace_intent` 은 평탄화 대상이면서 flat schema 에 대응 인자가 없다. 값은 `notes` 에 `trace_intent=<값>` 으로 인코딩해 넘기고 최상위 인자로는 싣지 않는다 — 스키마에 없는 이름은 거부가 아니라 조용히 버려지며, 그 순간 kiwi-srs 가 `addition_site` 잔존으로 status 상한을 거는 근거가 사라진다.
=== trace_intent site ===
skills/codex/kiwi-planner/references/extended-workflow.md
---
| `trace_intent` | `notes` 에 `trace_intent=<값>` 으로 인코딩 — flat schema 에 이 이름의 인자가 없으므로, 최상위 인자로 실으면 거부가 아니라 조용히 버려지고 kiwi-srs 의 `addition_site` status 상한이 읽을 데이터가 사라진다 |
=== trace_intent site ===
skills/codex/kiwi-planner/references/extended-workflow.md
---
trace_intent?: "verifies"|"addition_site"|"negative";  // 평탄화 시 실 MCP `notes` 에 `trace_intent=<값>` 으로 인코딩 — "sidecar nested ↔ 실 MCP flat 변환 매핑" 표 참조. flat schema 에 이 이름의 인자는 없다
=== trace_intent site ===
skills/codex/kiwi-srs/SKILL.md
---
| §0.14 | **Trace intent 분리**. `add_trace_link` 에는 `trace_intent` 인자가 없다. 스키마가 받는 것은 `id` · `type` · `reference` · `relation` · `notes` · `dryRun` · `ignoreLock` 이며, 이 일곱에 없는 인자는 조용히 버려진다. intent 는 `notes` 안에 `trace_intent=<값>` 으로 적는다. Code 타입 trace entry 에만 적용 — Requirement 타입 trace_link 의 `notes` 에는 `trace_intent` 미부착. Code trace `trace_intent` enum: `verifies` (기존 코드가 statement 동작 수행) / `addition_site` (해당 위치에 구현 추가 예정) / `negative` (의도된 부재). **Dual-intent split**: 동일 file:line-range 가 두 intent 를 동시에 가지면 범위 폭이 다른 별도 entry로 분리 등록. **Status cap**: 어느 trace 라도 `trace_intent=addition_site` 잔존 시 해당 REQ 의 status 는 `planned` 상한. 라이브 모드에서 `update_status(in_progress\|implemented)` 호출 시도 → 차단 + Codex clarification gate "구현 증거가 있습니까? (코드 path:line)" |
=== trace_intent site ===
skills/codex/kiwi-srs/SKILL.md
---
| REQ 의 어느 Code trace 라도 `notes` 에 `trace_intent=addition_site` 잔존 | status 상한 = `planned` |
=== trace_intent site ===
skills/codex/kiwi-srs/references/extended-workflow.md
---
5. `add_trace_link { id: NEW-ID, type: "Code", reference: "{path:line}", relation: "implements", notes: "trace_intent=verifies|addition_site" }` — `add_trace_link` 에는 `trace_intent` 인자가 없다. 스키마가 받는 것은 `id` · `type` · `reference` · `relation` · `notes` · `dryRun` · `ignoreLock` 이며, 이 일곱에 없는 인자는 조용히 버려진다. intent 는 `notes` 안에 `trace_intent=<값>` 으로 적는다.
=== trace_intent site ===
skills/codex/kiwi-srs/references/extended-workflow.md
---
1. `add_requirement` — type / scope / target / title / requirement / acceptanceCriteria / trace=[Code, `notes` 에 `trace_intent=<값>`] / status=planned / priority / tags=[feasibility:{level}]
=== trace_intent site ===
skills/etc/kiwi-coder/references/extended-workflow.md
---
sidecar `trace_links[i].trace_intent` 은 평탄화 대상이면서 flat schema 에 대응 인자가 없다. 값은 `notes` 에 `trace_intent=<값>` 으로 인코딩해 넘기고 최상위 인자로는 싣지 않는다 — 스키마에 없는 이름은 거부가 아니라 조용히 버려지며, 그 순간 kiwi-srs 가 `addition_site` 잔존으로 status 상한을 거는 근거가 사라진다.
=== trace_intent site ===
skills/etc/kiwi-planner/references/extended-workflow.md
---
| `trace_intent` | `notes` 에 `trace_intent=<값>` 으로 인코딩 — flat schema 에 이 이름의 인자가 없으므로, 최상위 인자로 실으면 거부가 아니라 조용히 버려지고 kiwi-srs 의 `addition_site` status 상한이 읽을 데이터가 사라진다 |
=== trace_intent site ===
skills/etc/kiwi-planner/references/extended-workflow.md
---
trace_intent?: "verifies"|"addition_site"|"negative";  // 평탄화 시 실 MCP `notes` 에 `trace_intent=<값>` 으로 인코딩 — "sidecar nested ↔ 실 MCP flat 변환 매핑" 표 참조. flat schema 에 이 이름의 인자는 없다
=== trace_intent site ===
skills/etc/kiwi-srs/SKILL.md
---
| §0.14 | **Trace intent 분리**. `add_trace_link` 에는 `trace_intent` 인자가 없다. 스키마가 받는 것은 `id` · `type` · `reference` · `relation` · `notes` · `dryRun` · `ignoreLock` 이며, 이 일곱에 없는 인자는 조용히 버려진다. intent 는 `notes` 안에 `trace_intent=<값>` 으로 적는다. Code 타입 trace entry 에만 적용 — Requirement 타입 trace_link 의 `notes` 에는 `trace_intent` 미부착. Code trace `trace_intent` enum: `verifies` (기존 코드가 statement 동작 수행) / `addition_site` (해당 위치에 구현 추가 예정) / `negative` (의도된 부재). **Dual-intent split**: 동일 file:line-range 가 두 intent 를 동시에 가지면 범위 폭이 다른 별도 entry로 분리 등록. **Status cap**: 어느 trace 라도 `trace_intent=addition_site` 잔존 시 해당 REQ 의 status 는 `planned` 상한. 라이브 모드에서 `update_status(in_progress\|implemented)` 호출 시도 → 차단 + User clarification gate "구현 증거가 있습니까? (코드 path:line)" |
=== trace_intent site ===
skills/etc/kiwi-srs/SKILL.md
---
| REQ 의 어느 Code trace 라도 `notes` 에 `trace_intent=addition_site` 잔존 | status 상한 = `planned` |
=== trace_intent site ===
skills/etc/kiwi-srs/references/extended-workflow.md
---
5. `add_trace_link { id: NEW-ID, type: "Code", reference: "{path:line}", relation: "implements", notes: "trace_intent=verifies|addition_site" }` — `add_trace_link` 에는 `trace_intent` 인자가 없다. 스키마가 받는 것은 `id` · `type` · `reference` · `relation` · `notes` · `dryRun` · `ignoreLock` 이며, 이 일곱에 없는 인자는 조용히 버려진다. intent 는 `notes` 안에 `trace_intent=<값>` 으로 적는다.
=== trace_intent site ===
skills/etc/kiwi-srs/references/extended-workflow.md
---
1. `add_requirement` — type / scope / target / title / requirement / acceptanceCriteria / trace=[Code, `notes` 에 `trace_intent=<값>`] / status=planned / priority / tags=[feasibility:{level}]
=== trace_intent site ===
.agents/skills/kiwi-coder/references/extended-workflow.md
---
sidecar `trace_links[i].trace_intent` 은 평탄화 대상이면서 flat schema 에 대응 인자가 없다. 값은 `notes` 에 `trace_intent=<값>` 으로 인코딩해 넘기고 최상위 인자로는 싣지 않는다 — 스키마에 없는 이름은 거부가 아니라 조용히 버려지며, 그 순간 kiwi-srs 가 `addition_site` 잔존으로 status 상한을 거는 근거가 사라진다.
=== trace_intent site ===
.agents/skills/kiwi-planner/references/extended-workflow.md
---
| `trace_intent` | `notes` 에 `trace_intent=<값>` 으로 인코딩 — flat schema 에 이 이름의 인자가 없으므로, 최상위 인자로 실으면 거부가 아니라 조용히 버려지고 kiwi-srs 의 `addition_site` status 상한이 읽을 데이터가 사라진다 |
=== trace_intent site ===
.agents/skills/kiwi-planner/references/extended-workflow.md
---
trace_intent?: "verifies"|"addition_site"|"negative";  // 평탄화 시 실 MCP `notes` 에 `trace_intent=<값>` 으로 인코딩 — "sidecar nested ↔ 실 MCP flat 변환 매핑" 표 참조. flat schema 에 이 이름의 인자는 없다
=== trace_intent site ===
.agents/skills/kiwi-srs/SKILL.md
---
| §0.14 | **Trace intent 분리**. `add_trace_link` 에는 `trace_intent` 인자가 없다. 스키마가 받는 것은 `id` · `type` · `reference` · `relation` · `notes` · `dryRun` · `ignoreLock` 이며, 이 일곱에 없는 인자는 조용히 버려진다. intent 는 `notes` 안에 `trace_intent=<값>` 으로 적는다. Code 타입 trace entry 에만 적용 — Requirement 타입 trace_link 의 `notes` 에는 `trace_intent` 미부착. Code trace `trace_intent` enum: `verifies` (기존 코드가 statement 동작 수행) / `addition_site` (해당 위치에 구현 추가 예정) / `negative` (의도된 부재). **Dual-intent split**: 동일 file:line-range 가 두 intent 를 동시에 가지면 범위 폭이 다른 별도 entry로 분리 등록. **Status cap**: 어느 trace 라도 `trace_intent=addition_site` 잔존 시 해당 REQ 의 status 는 `planned` 상한. 라이브 모드에서 `update_status(in_progress\|implemented)` 호출 시도 → 차단 + Codex clarification gate "구현 증거가 있습니까? (코드 path:line)" |
=== trace_intent site ===
.agents/skills/kiwi-srs/SKILL.md
---
| REQ 의 어느 Code trace 라도 `notes` 에 `trace_intent=addition_site` 잔존 | status 상한 = `planned` |
=== trace_intent site ===
.agents/skills/kiwi-srs/references/extended-workflow.md
---
5. `add_trace_link { id: NEW-ID, type: "Code", reference: "{path:line}", relation: "implements", notes: "trace_intent=verifies|addition_site" }` — `add_trace_link` 에는 `trace_intent` 인자가 없다. 스키마가 받는 것은 `id` · `type` · `reference` · `relation` · `notes` · `dryRun` · `ignoreLock` 이며, 이 일곱에 없는 인자는 조용히 버려진다. intent 는 `notes` 안에 `trace_intent=<값>` 으로 적는다.
=== trace_intent site ===
.agents/skills/kiwi-srs/references/extended-workflow.md
---
1. `add_requirement` — type / scope / target / title / requirement / acceptanceCriteria / trace=[Code, `notes` 에 `trace_intent=<값>`] / status=planned / priority / tags=[feasibility:{level}]