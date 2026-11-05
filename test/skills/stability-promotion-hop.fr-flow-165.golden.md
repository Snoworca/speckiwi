skills/claude/kiwi-orchestrator/SKILL.md
---
**stability 승급은 run 당 한 번(2.a′)과 노드마다의 스케줄 직전(3.c′)이다.** 2.a′ 는 처음 저작 뒤 `/kiwi-srs-feasibility` 를 `TARGET=<제품 target>` 으로 한 번 부르고, wave 마다 부르지 않는다. 뒤 wave 의 요구는 `draft` 로 남아도 되고, 3.c′ 가 그 노드를 스케줄하기 직전에 `--req-filter <그 draft 요구>` 로 올린다(`parallel-waves.md` PW-4). 노드의 요구가 전부 `evolving` 이상이면 그 승급은 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

=== hop ===

skills/codex/kiwi-orchestrator/SKILL.md
---
**stability 승급은 run 당 한 번(2.a′)과 노드마다의 스케줄 직전(3.c′)이다.** 2.a′ 는 처음 저작 뒤 `$kiwi-srs-feasibility` 를 `TARGET=<제품 target>` 으로 한 번 부르고, wave 마다 부르지 않는다. 뒤 wave 의 요구는 `draft` 로 남아도 되고, 3.c′ 가 그 노드를 스케줄하기 직전에 `--req-filter <그 draft 요구>` 로 올린다(`parallel-waves.md` PW-4). 노드의 요구가 전부 `evolving` 이상이면 그 승급은 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

=== hop ===

skills/etc/kiwi-orchestrator/SKILL.md
---
**stability 승급은 run 당 한 번(2.a′)과 노드마다의 스케줄 직전(3.c′)이다.** 2.a′ 는 처음 저작 뒤 `$kiwi-srs-feasibility` 를 `TARGET=<제품 target>` 으로 한 번 부르고, wave 마다 부르지 않는다. 뒤 wave 의 요구는 `draft` 로 남아도 되고, 3.c′ 가 그 노드를 스케줄하기 직전에 `--req-filter <그 draft 요구>` 로 올린다(`parallel-waves.md` PW-4). 노드의 요구가 전부 `evolving` 이상이면 그 승급은 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

=== hop ===

.agents/skills/kiwi-orchestrator/SKILL.md
---
**stability 승급은 run 당 한 번(2.a′)과 노드마다의 스케줄 직전(3.c′)이다.** 2.a′ 는 처음 저작 뒤 `$kiwi-srs-feasibility` 를 `TARGET=<제품 target>` 으로 한 번 부르고, wave 마다 부르지 않는다. 뒤 wave 의 요구는 `draft` 로 남아도 되고, 3.c′ 가 그 노드를 스케줄하기 직전에 `--req-filter <그 draft 요구>` 로 올린다(`parallel-waves.md` PW-4). 노드의 요구가 전부 `evolving` 이상이면 그 승급은 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

=== hop ===

