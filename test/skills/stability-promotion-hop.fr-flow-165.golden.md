skills/claude/kiwi-orchestrator/SKILL.md
---
**stability 승급 홉은 조건부다.** 그 wave 의 요구 중 `stability` 가 `draft` 이거나 implementability 가 미검증인 것이 하나라도 있으면, 3.b 직후이자 3.c′ 앞인 3.b′ 에서 `/kiwi-srs-feasibility` 를 `TARGET=wave-{n}` 으로 부른다. 전부 `evolving` 이상이면 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 홉이 없으면 3.b 가 저작한 요구가 `draft` 인 채로 3.c′ 에 도달하고, `requirement-not-ready` 는 §0.G 에 있어 `--auto` 로도 넘어가지 않는다. 범위는 `TARGET=wave-{n}` 으로 반드시 한정한다 — 이 스킬은 target 전수의 stability 를 일괄로 움직이므로 범위를 주지 않으면 다른 wave 의 요구까지 승급 평가 대상이 된다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

=== hop ===

skills/codex/kiwi-orchestrator/SKILL.md
---
**stability 승급 홉은 조건부다.** 그 wave 의 요구 중 `stability` 가 `draft` 이거나 implementability 가 미검증인 것이 하나라도 있으면, 3.b 직후이자 3.c′ 앞인 3.b′ 에서 `$kiwi-srs-feasibility` 를 `TARGET=wave-{n}` 으로 부른다. 전부 `evolving` 이상이면 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 홉이 없으면 3.b 가 저작한 요구가 `draft` 인 채로 3.c′ 에 도달하고, `requirement-not-ready` 는 §0.G 에 있어 `--auto` 로도 넘어가지 않는다. 범위는 `TARGET=wave-{n}` 으로 반드시 한정한다 — 이 스킬은 target 전수의 stability 를 일괄로 움직이므로 범위를 주지 않으면 다른 wave 의 요구까지 승급 평가 대상이 된다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

=== hop ===

skills/etc/kiwi-orchestrator/SKILL.md
---
**stability 승급 홉은 조건부다.** 그 wave 의 요구 중 `stability` 가 `draft` 이거나 implementability 가 미검증인 것이 하나라도 있으면, 3.b 직후이자 3.c′ 앞인 3.b′ 에서 `$kiwi-srs-feasibility` 를 `TARGET=wave-{n}` 으로 부른다. 전부 `evolving` 이상이면 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 홉이 없으면 3.b 가 저작한 요구가 `draft` 인 채로 3.c′ 에 도달하고, `requirement-not-ready` 는 §0.G 에 있어 `--auto` 로도 넘어가지 않는다. 범위는 `TARGET=wave-{n}` 으로 반드시 한정한다 — 이 스킬은 target 전수의 stability 를 일괄로 움직이므로 범위를 주지 않으면 다른 wave 의 요구까지 승급 평가 대상이 된다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

=== hop ===

.agents/skills/kiwi-orchestrator/SKILL.md
---
**stability 승급 홉은 조건부다.** 그 wave 의 요구 중 `stability` 가 `draft` 이거나 implementability 가 미검증인 것이 하나라도 있으면, 3.b 직후이자 3.c′ 앞인 3.b′ 에서 `$kiwi-srs-feasibility` 를 `TARGET=wave-{n}` 으로 부른다. 전부 `evolving` 이상이면 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 홉이 없으면 3.b 가 저작한 요구가 `draft` 인 채로 3.c′ 에 도달하고, `requirement-not-ready` 는 §0.G 에 있어 `--auto` 로도 넘어가지 않는다. 범위는 `TARGET=wave-{n}` 으로 반드시 한정한다 — 이 스킬은 target 전수의 stability 를 일괄로 움직이므로 범위를 주지 않으면 다른 wave 의 요구까지 승급 평가 대상이 된다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

=== hop ===

