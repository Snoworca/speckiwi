# worktree-lane v1.0.0 — run 이 워크트리를 만들고 그 안에서 작업하는 법

`kiwi-orchestrator` 와 `kiwi-wave-master` 가 공유하는 SSOT. 두 스킬은 이 절차를 각자 다시 적지 않고 §0 에서 본 문서를 지목한다 — 같은 책임을 두 곳이 나눠 가지면 한쪽만 고쳐지고 다른 쪽은 조용히 어긋난다.

관장 요구: `FR-FLOW-122`(본 계약) · `FR-NODE-186`(위상 분류와 role 게이트) · `FR-NODE-185`(재생 승인·체크포인트) · `FR-FLOW-121`(`--defer-srs-mutation`).

---

## 1. 두 개의 root — 이름을 먼저 가른다

| 이름 | 무엇인가 | 무엇을 소유하는가 |
|---|---|---|
| **run root** | MCP workspace 에 결속된 호스트 체크아웃 | Requirement ID 할당, **모든 SRS mutation**, 인덱스 롤업, `waves.jsonl`, run 락 |
| **lane workspace** | run 이 만든 git worktree | 코드·테스트 편집과 자기 브랜치 커밋 **뿐** |

**MCP root 는 세션 도중 옮길 수 없다.** 서버 프로세스의 cwd 에 묶여 있고 재기동 수단이 없다. 그래서 이 설계는 세션을 워크트리로 옮기지 않는다 — **호스트가 제자리에 머문 채 `--root` 로 레인 안쪽에 손을 뻗는다.** 방향은 호스트 → 레인 **단방향**이다.

이것이 제약이 아니라 자산인 이유: MCP 표면에는 레인을 가리킬 방법이 아예 없으므로, 레인이 MCP 핸들을 들고 있어도 그것으로 자기 워크트리를 건드릴 수 없다.

---

## 2. 만들기 — 기본 HEAD 를 믿지 않는다

```
git worktree add <lane-root> -b kiwi/orch/{run_id}/{lane_key} <base_sha>
```

**base 를 세 번째 인자로 준다 — 두 줄로 나누지 않는다.** `add -b BR` 뒤에 `checkout <base_sha>` 를
따로 부르면 `-b` 가 만든 브랜치는 현재 tip 에 생기고 그 다음 줄이 HEAD 를 그 브랜치에서 **떼어낸다**.
레인의 커밋은 detached HEAD 위에 쌓이고 브랜치는 제자리에 남는다 — 재현 확인. 그러면 §1 표가 레인의
소유라고 적은 "자기 브랜치 커밋"이 존재하지 않게 되고, §5 의 `base..head` 판정은 레인이 일했는데
0 으로 읽으며, 워크트리를 제거하는 순간 그 커밋은 참조 없는 객체가 된다.

런타임이 워크트리를 이미 만들어 건네준 경우처럼 **한 줄로 만들 수 없는 자리**에서는
`git -C <lane-root> switch -C <branch> <base_sha>` 를 쓴다. 브랜치를 base 로 옮기면서 HEAD 를 그
브랜치에 **붙인 채로** 둔다. `checkout <sha>` 는 어느 경우에도 답이 아니다.

**base 를 명시하는 것 자체가 선택이 아니다.** 실측: 런타임이 만든 워크트리의 기본 HEAD 는 `origin/<기본 브랜치>` 였고, 작업 중인 브랜치보다 **114 커밋 뒤**였다. 그 상태로 고친 diff 는 **깨끗하게 병합된다** — 몇 달 전 코드를 고쳤다는 사실이 어디에도 드러나지 않는다.

워크트리는 객체 DB 를 공유하므로, 워크트리가 만들어진 **뒤에** 생긴 커밋으로도 이동할 수 있다(실측 확인). 그래서 "앞 단위의 통합 tip 위에서 시작한다"가 기계적으로 가능하다.

**부트스트랩**은 호스트가 레인에 에이전트를 넣기 **전에** 끝낸다.

```
npm ci --include=dev --ignore-scripts
```

`--include=dev` 는 장식이 아니다. `NODE_ENV=production` 인 셸에서 npm 의 유효 설정은 `omit=dev` 가 되고, 그 상태의 `npm ci` 는 **devDependencies 를 조용히 빠뜨린 채 exit 0** 으로 끝난다. 레인은 테스트 러너가 없는 툴체인에서 green 을 보고하게 된다. `--include=dev` 는 셸 문법에 의존하지 않고 그 설정을 상쇄한다.

---

## 3. 레인이 절대 하지 않는 세 가지

1. **SRS mutation 을 직접 호출하지 않는다.** `--defer-srs-mutation <path>` 로 받은 큐에 **기록만** 한다. 기록은 skip 이 아니다 — 네 mutation 은 그대로 회계되고 호스트가 재생한다.
2. **`docs/spec/` 아래를 커밋하지 않는다.** 레인의 커밋은 자기 `write_set` pathspec 으로 한정된다.
3. **`--root` 를 쓰지 않는다.** `--root` 를 쓰는 순간 그것은 레인 작업이 아니라 오케스트레이터 연산이다.

세 금지는 전부 **호스트가 레인의 자기보고 없이 검사할 수 있다** — 공유 객체 DB 위의 커밋 범위만 보면 된다.

---

## 4. 게이트 — 다름이 계획된 것인가

run root 검사는 두 root 의 **일치**가 아니라 **다름이 동결된 계획에 소속되는가**를 본다. `role` 은 호출자가 **선언**하고 도구는 그 선언을 저장소 자신으로 반증한다.

| role | 통과 조건 |
|---|---|
| `host` | 두 root 가 일치하고, 그 root 가 linked worktree 가 **아니다** |
| `lane` | git common dir 이 호스트와 같고, toplevel 은 다르고, 그 common dir 에 **등록**돼 있고, `lane_id` 가 동결 lane plan 에 있고, 그 레인의 `write_set` 이 `docs/spec/` 을 건드리지 않는다 |

판별자는 **git common directory** 다 — 한 저장소의 모든 linked worktree 가 같은 값을 보고하고 toplevel 만 다르며, 어느 값도 호출자가 고르지 않는다.

`role` 을 추론하지 않는 이유: "두 root 가 다른데 common dir 이 같으니 레인이겠지"는 저장소의 **아무 워크트리나** 만족시킨다. 그중에는 run 이 계획한 적 없는 것도 있다. 계획에의 소속이 호출자가 고르지 않은 부분이다.

---

## 5. 판정 — 레인의 green 은 판정이 아니다

레인이 자기 `verification_cmd` 를 도는 것은 **빠른 실패용**이다. **판정은 호스트가 낸다** — 호스트가 cwd 를 레인 워크스페이스로 놓고 같은 검증 명령을 직접 1회 실행한다.

이유는 §2 의 함정이다. devDependencies 가 빠진 레인은 자기가 green 이라고 믿는다. 호스트가 직접 돌리면 그 거짓이 즉시 드러난다.

호스트가 커밋 범위로 확인하는 것:

```
base..head 커밋이 0 이 아니다              (뭔가 했다)
base 가 head 의 조상이다                   (올바른 기준선에서 했다)
변경 경로 ⊆ write_set                      (리스 안에서 했다)
변경 경로 ∩ docs/spec/ = ∅                 (SRS 를 안 건드렸다)
```

---

## 6. 재생 — 허용된 것만, 한 번만

호스트는 수확한 큐를 계획하고(`orchestrate replay plan`) **승인된 것만** 적용한다.

허용 집합은 `kiwi-coder §0.12` 의 넷이고 **모듈 상수**다 — 인자로 넓힐 수 있는 allowlist 는 allowlist 가 아니다.

```
add_trace_link · add_verification_evidence · update_status · add_completed_work
```

그 밖의 도구 이름은 `tool-not-deferrable` 로 거부한다. 동결 target 과 다른 target 을 실은 호출은 `target-not-frozen` 으로 거부한다. **큐는 레인이 쓴다** — 큐를 신뢰하지 않는 것이 방어이지, 큐의 위치를 신뢰하는 것이 방어가 아니다.

`add_completed_work` 와 `add_verification_evidence` 는 append 이므로, 중단된 run 을 그냥 재개하면 행이 중복된다. 시도 1건당 1줄인 **append-only 기록**에서 남은 호출을 환원한다. 기록이 실패로 남긴 호출은 실패로 보고하되 조용히 재시도하지 않는다 — 재시도는 실패를 손에 쥔 호출자가 명시적으로 할 결정이다.

---

## 7. 정리

**수확 전에 reap 하지 않는다.** 워크트리를 제거하면 그 안의 gitignore 된 산출물이 함께 증발한다. 순서는 언제나 harvest → verify → integrate → release 다.

레인이 살아 있는 동안(`git worktree list --porcelain` 이 `locked … (pid N)` 을 보고) **재-dispatch 하지 않는다.** 워크트리는 세션 이름과 달리 디스크 아티팩트이므로 재개에 강하다 — 그것이 이 조정 방식의 부수 이점이다.
