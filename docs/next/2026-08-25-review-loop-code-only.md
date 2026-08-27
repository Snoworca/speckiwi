# 리뷰 루프 코드 전용화 — 세션 핸드오프

| Field | Value |
| --- | --- |
| 작성일 | 2026-08-25 |
| 저장소 / 브랜치 | `C:\Work\git\_Snoworca\speckiwi` / `feat/2.3.0.1` |
| 최종 작업 목표 | `kiwi-review-fix-loop` 이 코드만 검증·개선하게 하고, 연구 산문 리뷰 금지를 배포되는 스킬 텍스트에 심는다 |
| 현재 상태 | **두 작업 모두 커밋 완료.** 워킹트리에 이 문서 외 미커밋 없음 |
| SSOT | `C:\Work\git\_Snoworca\speckiwi\docs\spec\60.workflow-release.srs.md` 의 `FR-FLOW-152` · `FR-FLOW-153` |
| 다음 세션 첫 행동 | 사용자에게 푸시·태그·publish 를 할지 묻는다. 코드 작업은 남아 있지 않다 |

> 이 문서는 다음 세션이 **이 문서와 SSOT 만 읽고** 자율적으로 이어갈 수 있도록 정리한 것이다. 대화 히스토리에 의존하지 말 것.

---

## 0. 다음 세션의 첫 행동

1. 이 문서를 끝까지 읽는다.
2. `git status --porcelain` 과 `git log --oneline -3` 으로 아래 §3 과 실제가 일치하는지 확인한다.
3. **이 세션에서 이어질 코드 작업은 없다.** 사용자가 새 지시를 주지 않으면, 아래 §7 의 후속 항목 중 무엇을 할지 묻는다.
4. 사용자가 릴리스를 원하면 §6 의 "사용자 몫" 절차를 안내한다 — **직접 실행하지 않는다.**

## 1. 최종 작업 목표

사용자 지시는 두 단계로 왔다.

1. "검증개선할 때 speckiwi 에서 직접 작성한 문서가 아닌 불필요한 문서(연구 문서, 기타 계획 문서 등)를 모두 수정하는 경우가 종종 있는데, speckiwi 가 작성한 문서들만 검증 개선하라"
2. "`kiwi-review-fix-loop` 는 코드만 검증 개선해야 합니다"

두 번째가 첫 번째보다 강한 제약이며 이 스킬에 한정된다. 완료 조건은 **요구 두 건이 `verified` 이고 전체 스위트가 green** 인 것이며, 2026-08-25 기준 충족되었다.

## 2. 현재까지 완료한 작업

- [x] **3.0.0 릴리스** — 커밋 `4ca4716` `release: 3.0.0`. `npm run release:check -- --strict` 가 `ready: true` 반환(2026-08-25 실행).
- [x] **`kiwi-review-fix-loop` 코드 전용화 + 연구 산문 금지 배포** — 커밋 `f4d2bd5`.
- [x] **요구 저작** — `FR-FLOW-152`(AC 9개) · `FR-FLOW-153`(AC 4개), 둘 다 target `3.0.1`, Status `verified`. `node bin/speckiwi summary --target 3.0.1 --json` 결과 `countsByStatus` 가 `{"verified":2}`, `missingEvidence` 가 빈 배열(2026-08-25 실행). AC 커버리지는 별도 명령이다 — `node bin/speckiwi coverage --target 3.0.1 --json` 결과 `acCoverageGaps` 가 빈 배열.
- [x] **전체 스위트** — `NODE_ENV=test npm test` 실행(2026-08-25), **435 파일 / 6,460 통과 / 4 skipped / 0 실패**, exit code 0.
- [x] **`node bin/speckiwi validate --json`** — errors 0 / warnings 3 (warnings 는 `SRS-W015` 로 `REL-MCP-004` · `IR-CLI-076` 관련 기존 항목이며 이번 작업과 무관).
- [x] **뮤테이션 검사** — `FR-FLOW-152` 13건 심어 13건 red, `FR-FLOW-153` 6건 심어 5건 red(1건은 의도적 제외, 아래 §6 참조). **⚠️ 미검증 —** 뮤테이션 건수와 red 결과는 두 요구의 VE-1 에 기재되어 대조 가능하지만, 그 작업이 워킹트리가 아닌 임시 트리에서 이루어졌다는 사실은 저장소에 흔적이 남지 않는다. 다음 세션이 확인할 방법: 없음(세션 중 행위에 대한 진술이다).
- [x] **독립 검증 6라운드** — 서브에이전트가 수행. 최종 라운드 판정 CRITICAL 0 · HIGH 0.

### 2.1 기억과 실제가 달랐던 항목

| 기록된 진술 | 실제 (확인 수단이 있으면 함께 적는다) |
| --- | --- |
| 4차 검증 전까지 "술어 확장이 네 렌더링에 반영됐다"고 믿고 있었다 | **`skills/claude/` 하나에만 들어갔다.** `git diff --stat` 에 나타난 스킬 파일이 claude 판본 둘뿐이었다 |
| "3001 → 3001 이어도 규칙이 고정되었다"고 여겼다 | **단언이 한 건도 늘지 않아 초록이 그 변경을 증언하지 않았다.** 그래서 위 드리프트를 아무 테스트도 잡지 못했다 |
| 한때 "2,847건 통과"로 보고했다 | **⚠️ 미검증 — 테스트 파일 하나가 `Unterminated regular expression` 파싱 오류로 통째로 수집되지 않은 채, 그 파일의 154건이 빠진 나머지만 통과로 집계된 상태였다.** 세션 중 일시적 워킹트리 상태에 대한 진술이라 커밋된 저장소에서 재확인할 수단이 없다. 다음 세션이 확인할 방법: 없음. 다만 같은 부류를 예방하려면 스위트 결과를 받을 때 `Test Files` 수가 예상과 맞는지 함께 본다 |

## 3. 현재 워킹트리·저장소 상태

`git status --porcelain` 기준(2026-08-25):

- 브랜치: `feat/2.3.0.1`. **origin 대비 ahead 34** (`git log --oneline origin/feat/2.3.0.1..HEAD | wc -l` = 34).
- 추적 파일 중 미커밋: **없음.**
- 미추적(`??`): `.claude/` · `.codex/` · `.mcp.json` · `docs/spec/steps/` — **넷 다 커밋 금지 대상이다**(§9). 그리고 이 핸드오프 문서 자신(`docs/next/2026-08-25-review-loop-code-only.md`)과 `docs/next/LATEST.md` 가 새로 생긴다.
- 커밋 여부 판단: 코드·요구는 이미 커밋됐다. 이 핸드오프 문서는 `docs/next/` 소속이라 SRS·코드 커밋에 섞지 않는다(§9).

## 4. 관련 문서·코드 (절대경로)

`<REPO>` = `C:\Work\git\_Snoworca\speckiwi`

| 문서 | 절대경로 | 역할 |
| --- | --- | --- |
| SSOT | `C:\Work\git\_Snoworca\speckiwi\docs\spec\60.workflow-release.srs.md` | `FR-FLOW-152` · `FR-FLOW-153` · `FR-FLOW-136` · `FR-FLOW-137` · `FR-FLOW-131` 이 전부 여기 있다 |
| 인덱스 | `C:\Work\git\_Snoworca\speckiwi\docs\spec\00.index.md` | Active Target `3.0.1`, Target Map |
| 프로젝트 규칙 | `C:\Work\git\_Snoworca\speckiwi\CLAUDE.md` | SRS 워크플로, 검증 강도 정책 |

**이번에 바뀐 스킬 텍스트** (커밋 `f4d2bd5`):

- `C:\Work\git\_Snoworca\speckiwi\skills\claude\kiwi-review-fix-loop\SKILL.md` — §11 「파일 부류 경계」 신설, front matter `description` 에 경계 추가, `doc_only` 제거, `--close-reqs` 게이트 행 추가
- `C:\Work\git\_Snoworca\speckiwi\skills\codex\kiwi-review-fix-loop\SKILL.md` · `...\skills\etc\...` · `...\.agents\skills\...` — 같은 규칙의 각 렌더링
- `C:\Work\git\_Snoworca\speckiwi\skills\claude\_shared\kiwi\verify-loop.md` — §9 「연구 산문은 이 루프의 대상이 아니다」 신설, §10 「산문 델타 리뷰 — 검증 장부」 이관, §2 에 산문 판정 대상 제외 선언, §7 라우팅 행 추가 (codex·etc·.agents 렌더링 동일)
- `C:\Work\git\_Snoworca\speckiwi\skills\claude\kiwi-srs\SKILL.md` 와 codex·etc·.agents 의 `kiwi-srs\references\extended-workflow.md` — 프로세스 A 에 리서치 문서 수정 금지 문단 추가

**테스트**:

- `C:\Work\git\_Snoworca\speckiwi\test\skills\review-loop-file-class.fr-flow-152.test.ts` — 신규, 182 단언
- `C:\Work\git\_Snoworca\speckiwi\test\skills\research-prose-no-review.fr-flow-153.test.ts` — 신규, 100 단언
- `C:\Work\git\_Snoworca\speckiwi\test\skills\verification-ledger-content.fr-flow-136.test.ts` — 수정, 소비자를 `verify-loop.md` 로 재지정
- `C:\Work\git\_Snoworca\speckiwi\test\skills\kiwi-wave-continuity-r2-content.test.ts` — 수정, 정본 게이트 목록에 `empty-code-scope` 등재

## 5. 확정된 결정 (변경 금지)

1. **`kiwi-review-fix-loop` 의 대상**: 코드 전용 — **확정**. (사용자 직접 지시. 근거: `FR-FLOW-152` 요구 본문)
2. **`FR-FLOW-136` 처리**: supersede 하지 않고 소비자만 `_shared/kiwi/verify-loop.md` 로 이관하며 AC-6 만 개정 — **확정**. (근거: 그 요구 본문이 "The document review loop SHALL…" 로 역할을 주어로 삼아 여전히 참이고, AC-6 이 소비자 이동을 이미 예비해 두었다)
3. **`IR-CLI-094` 의 CLI 두 동사(`workflow verification-ledger plan|record`)**: 유지 — **확정**. (근거: 이미 배포된 명령이고 `#### Requirement` 본문에 스킬 이름이 없다. 호출자는 이관된 `verify-loop.md` §10 에 살아 있고, 명령 자체는 `src/cli/commands/read.ts` 의 `workflow.command("verification-ledger")` 로 실재한다. **단 그 요구의 Implementation Notes 는 `kiwi-review-fix-loop` 을 "유일한 소비자"로 지목하고 있으며 이관으로 그 기재가 낡았다** — §7 후속 항목 참조)
4. **조문 표현**: "코드만" 이라는 형용사를 쓰지 않고 닫힌 표로 적는다 — **확정**. (근거: `FR-FLOW-152` AC-1. 검증에서 형용사 서술이 반전을 통과시킴이 실측됨)
5. **커밋 창은 사람의 지목이 아니다**: `--base`/`--head`·`--commits`·`--since` 는 부류 필터를 면제하지 않고 `--files` 만 인정 — **확정**. (근거: `FR-FLOW-152` AC-2)
6. **산문만 든 창의 종료 hop 교착**: 해소하지 않고 한계로 기록 — **확정**. (근거: `FR-FLOW-152` AC-9, 그리고 그 요구의 VE-1 이 "That attempt was WITHDRAWN rather than repaired — the two orchestrator files carry no diff" 로 같은 사실을 기록한다. 철회 사실과 diff 0 은 `git show --stat f4d2bd5` 로 확인된다. **⚠️ 미검증 —** 4차 라운드가 낸 심각도 개수(CRITICAL 2 · HIGH 4)는 저장소 어디에도 기재되어 있지 않다)
7. **버킷 이름**: 파일 분류의 네 번째 버킷은 `unclassified_files[]` — **확정**. (근거: `unclassified` 는 같은 문서 §0.G5 에서 finding 분류의 금지 값이자 "0건 확인" 게이트다)

## 6. 미결정·유예 항목

- **`FR-FLOW-153` 뮤테이션 1건이 green** — 엔진 §9 절을 같은 파일 최상단으로 옮기는 훼손. AC-1 이 "루프가 산문을 읽는 각 **파일**에 규칙이 있을 것"을 요구하고 스킬 텍스트는 전문이 한 번에 로드되므로, 파일 안 위치는 의미를 갖지 않는다고 판단해 **의도적으로 잡지 않았다.** 이 판단을 뒤집으려면 AC-1 을 파일 안 위치까지 요구하도록 고쳐야 한다.
- **동결 선언의 조회 경로** — `kiwi-review-fix-loop` 은 오케스트레이터의 `frozen` 블록에 닿을 인자가 없다. 지금은 닫힌 목록(`*.jsonl`·`*.lock`·`*.lock.json`·`resume-card.json`·run contract·`routing/probe.json`·`design/constraints.json`)을 규칙으로 두고 "run 이 동결로 선언한 것"이라는 원리는 목록을 늘리는 근거로만 남겼다. 결정 방법: 호출 계약에 `--frozen-manifest <path>` 같은 인자를 추가할지 사용자 확인.

**사용자 몫(에이전트가 실행하지 않는다)**: `git push`(현재 ahead 34), `git tag srs-3.0.0-baseline`, `npm publish`. 이 세 가지는 사용자가 직접 해 온 작업이다.

## 7. 남은 작업 전체 목록

- [ ] **`AC-9` 의 교착 해소** — 산문만 든 커밋 창에서 종료 hop 이 통과할 경로가 없다. 완료 조건: `FR-FLOW-131` 을 개정해 `not-applicable-empty-window` 의 술어를 넓히거나 새 verdict 을 도입하고, `src/core/orchestrator/journal-schema.ts` 의 `TERMINAL_REVIEW_VERDICTS` · `test/core/orchestrator/terminal-review.fr-node-188.test.ts` 의 `toEqual` · `_shared/kiwi/waves-event.md`(네 렌더링) · `kiwi-orchestrator`(네 렌더링) · `kiwi-wave-master`(**세 렌더링** — `.agents/skills/.speckiwi-mirror-exclusions.json` 이 `kiwi-wave-master` 와 `kiwi-step` 을 미러에서 제외한다)를 함께 고친 뒤, 전체 창 + 면제 verdict 조합이 자기증명이 되지 않도록 대조 근거를 저널에 싣는다. **요구 수준 결정이므로 사용자 확인 후 착수.**
- [ ] **`FR-FLOW-140` 핀 확장** — 그 계약 테스트(`test/skills/comment-wording-no-rework.fr-flow-140.test.ts`)의 `COPIES` 는 `kiwi-coder` 네 사본뿐인데, `kiwi-review-fix-loop` 이 §0.1 과 본문에서 `kiwi-coder` 8축을 차용한다. 그래서 주석 표현 finding 이 `kiwi-coder` 에서는 재작업 라운드 0 이고 `kiwi-review-fix-loop` 에서는 라운드를 소비한다. 완료 조건: `COPIES` 에 `kiwi-review-fix-loop` 네 사본 추가 후 red → 문안 보강 → green.
- [ ] **`IR-CLI-094` 의 Implementation Notes 갱신** — 그 노트는 `kiwi-review-fix-loop` 을 "유일한 소비자"로 지목하며, 그 스킬이 §0.8 로 MCP mutation 을 금지하므로 MCP 대응 도구를 만들지 않는다고 적었다(2026-08-17 결정). 소비자가 `_shared/kiwi/verify-loop.md` 로 이관되면서 그 전제가 깨졌다 — 그 파일을 인용하는 호출자는 `kiwi-orchestrator`(§0.7)와 `kiwi-wave-master`(§0.10) 둘이고, 두 스킬 모두 MCP mutation 을 정상 경로로 쓴다(claude 렌더링 기준 각 `SKILL.md:5` 의 Kiwi MCP rule 머리말. `skills/etc/` 렌더링에는 그 머리말이 없다). 완료 조건: 그 노트의 재개 조건을 재판정하고 결과를 노트에 덧붙인다. 그러지 않으면 다음 세션이 이미 무효인 근거를 읽고 결정을 되풀이한다.
- [ ] **동결 선언 조회 경로** — §6 참조. 완료 조건: 사용자가 호출 계약 변경을 승인하면 인자를 추가하고, 승인하지 않으면 현재 닫힌 목록을 유지한다는 결정을 요구에 기록한다.
- [ ] **이 저장소의 `.claude/skills/` 설치본 갱신** — `C:\Work\git\_Snoworca\speckiwi\.claude\skills\kiwi-review-fix-loop\SKILL.md` 에는 새 규칙이 없고 `doc_only` 도 남아 있다. **⚠️ 미검증 — 이번 세션에서 그 파일을 직접 열어 확인하지 않았고, 검증 서브에이전트의 보고를 근거로 적는다.** 완료 조건: 사용자가 재설치를 승인하고 실행한다. **에이전트는 `speckiwi init` · `skills install` 을 실행하지 않는다**(§9).

## 8. 다음 세션 지시서

이어서 할 코드 작업은 없다. 사용자가 새 지시를 주면 그것을 따르고, 위 §7 중 하나를 고른다면 다음 순서로 한다.

1. 착수 전 `node bin/speckiwi active-target --json` 또는 MCP `get_active_target` 으로 활성 target 을 확인한다 → 검증: `3.0.1` 이 나오는지. (CLI 명령은 `active-target` 이다. `get-active-target` 은 존재하지 않는다) 새 요구가 필요하면 새 target 을 열지 여부를 먼저 정한다.
2. 요구를 먼저 저작하거나 개정한다 → 검증: `node bin/speckiwi validate --json` 의 `errors` 가 0.
3. **실패하는 테스트를 먼저 쓰고 red 를 눈으로 확인한다** → 검증: 실패 건수를 기록. 통과한 단언이 있으면 그것이 공허하지 않은지 개별 확인한다(§9 함정).
4. 구현 후 `NODE_ENV=test npx vitest run test/skills/` → 검증: 실패 0.
5. 뮤테이션으로 강제력을 확인한다 → 검증: 심은 훼손이 red 가 되는지. green 이면 단언이 그 규칙을 고정하지 못한 것이다.
6. 서브에이전트 독립 검증 → 검증: CRITICAL 0 · HIGH 0.
7. `NODE_ENV=test npm test` → 검증: 실패 0.

## 9. 거버넌스·게이트·함정

**규칙**

- `docs/spec/` 이 요구의 유일한 SSOT. 증거 없이 `verified` 로 올리지 않는다. bulk-archive / bulk-finalize 금지.
- **`speckiwi init`(특히 `--force`) · `skills install` · `upgrade` · `remove` 를 이 저장소에 실행하지 않는다.** `--force` 는 `docs/spec/00.index.md` 를 템플릿으로 덮어쓴다. `node bin/speckiwi skills mirror --write` 는 허용되며 `.agents/skills/**` 의 유일한 authorized writer 다.
- **`git checkout` · `git restore` · `git stash` · `git clean` · `git reset --hard` 를 실행하지 않는다.**
- **커밋 금지**: `.claude/` · `.codex/` · `.mcp.json` · `docs/spec/steps/`. `docs/research/**` 와 `docs/next/**` 를 SRS·코드 커밋에 섞지 않는다.
- **커밋 메시지에 어떤 시그니처도 넣지 않는다**(`Co-Authored-By`, `Generated with/by`, `[bot]`, `🤖` 등). 커밋 후 `git log -1 --format="%B"` 로 확인한다. 제목에 `Phase {n}` · `Step {n}` · `TASK-XXX` 를 넣지 않는다.
- **TDD test-first 강제.** 구현을 먼저 썼으면 그것을 버리고 test-first 로 다시 한다.
- **판단이 개입하는 검증은 서브에이전트에 위임한다.** 자기 결론·정당화를 서브에이전트에 넘기지 않는다.
- `AskUserQuestion` 을 쓰지 않는다. 사용자 결정은 5인 결정위원회가 조사 후 자동결정한다.
- `npm install` 을 맨몸으로 돌리지 않는다(셸에 `NODE_ENV=production` 이 실려 devDependencies 가 잘린다). 빌드·pack 은 `NODE_ENV=development`, vitest 는 `NODE_ENV=test`.

**이번 세션에 실제로 밟은 함정**

- **어휘 존재 검사는 규칙과 그 부정을 똑같이 통과시킨다.** `/면제/` 는 "면제하지 않는다"와 "면제한다"를 둘 다 만족한다. 검증자가 규칙 다섯을 정반대로 뒤집었는데 스위트가 green 이었다. → 안전 경계 문장은 정확한 문장으로 핀하고, 반전이 **추가**되는 것을 따로 잡고, 표는 판정 칸을 읽는다.
- **단언이 늘지 않은 라운드의 초록은 그 변경을 증언하지 않는다.** 규칙을 추가했으면 핀도 추가해야 한다. 안 그러면 네 렌더링 중 하나만 고친 드리프트를 아무도 못 잡는다.
- **빈 대상 위에서 공허하게 통과하는 단언.** 섹션이 없으면 그 안의 위반도 0건이라 헤지 검사가 통과했다. → 검사 대상이 존재하는지를 먼저 단언한다.
- **⚠️ 미검증(조기 return 하던 중간 버전이 커밋되지 않아 대조 대상이 없다) — 조건부 가드는 "바뀌었다"를 "검사할 것이 없다"로 읽는다.** 예외 문단 핀이 자기 trigger 문구에 의존해, 문단을 바꿔 쓰면 조기 return 했다. → 양성 단언으로.
- **⚠️ 미검증(실행 타이밍에 대한 세션 내 관측이라 저장소에 산출물이 없다) — 배경 스위트를 돌려 놓고 소스를 편집하면 유령 실패가 잡힌다.** 중간 편집 상태를 스위트가 읽는다. → 스위트 시작 후에는 파일을 건드리지 않거나, 편집이 필요하면 스위트를 먼저 멈춘다.
- **⚠️ 미검증(세션 중 셸 입력에 대한 진술이라 저장소에 흔적이 없다) — 인라인 `node -e` 와 heredoc 의 이스케이프가 반복해서 깨진다.** `[^\n]` 이 실제 개행이 되고 `\|` 의 백슬래시가 사라져 `^|` 교대가 됐다. 한 번은 테스트 파일이 파싱 오류로 통째로 수집되지 않은 채 나머지만 "통과"로 보고됐다. → 복잡한 편집은 스크립트를 **파일로 써서** 실행한다.
- **다른 요구가 소유한 술어를 범위 밖에서 넓히지 않는다.** 그렇게 했더니 반박 불가능한 완료 경로가 열렸다. → 고치는 대신 철회하고 한계를 AC 로 기록한다.
- **`test/release/release-readiness.test.ts` 의 "prints targetSource…" 케이스는 5초 타임아웃이라 병렬 부하에서 간헐 실패한다.** 단독 실행은 4.58초에 통과했다(2026-08-25 실측). 이번 작업과 무관한 환경 의존 flake 다.

**테스트 실행 명령(복붙 가능)**

```
NODE_ENV=test npm test
NODE_ENV=test npx vitest run test/skills/
NODE_ENV=development npx tsc --noEmit -p tsconfig.json
node bin/speckiwi validate --json
node bin/speckiwi skills mirror --write
```

## 10. 리스크·잔존 이슈

- **`AC-9` 의 교착이 실제로 발생 가능하다.** `kiwi-wave-master` Phase 2 가 `/kiwi-srs` 로 wave target 을 저작하므로, 요구부터 시작하는 run 의 첫 wave 는 전형적으로 산문만 산출한다. 그 wave 는 종료 hop 을 통과할 방법이 없어 `complete` 로 기록되지 못한다. 영향: 오케스트레이터 run 이 그 지점에서 사용자 결정을 요구하며 멈춘다. 대응: §7 첫 항목.
- **이 저장소의 세션은 구버전 스킬을 읽는다.** `.claude/skills/` 설치본이 갱신되지 않아, 새 경계가 이 저장소에서 도는 에이전트를 아직 구속하지 않는다. **⚠️ 미검증 — 서브에이전트 보고 근거이며 직접 확인하지 않았다.** 영향: 이 저장소에서 `kiwi-review-fix-loop` 을 호출하면 옛 규칙으로 동작한다. 대응: 사용자가 재설치.
- **미푸시 34 커밋.** 로컬에만 있다. 영향: 다른 기기·세션에서 이 작업을 볼 수 없다. 대응: 사용자가 푸시.
