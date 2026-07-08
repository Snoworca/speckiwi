# SpecKiwi v3.0.0 SRS-first 재정비 실행계획

> 2026-07-08 · 이 세션에서 확정한 결정적(deterministic) 재정비 명세.
> v3 코드/테스트는 빌드·테스트 통과 상태이며 `wip/v3.0.0` 브랜치에 보존됨.
> 재작성 불필요 — REQ ID 재매핑 + SRS 등록만 하면 재커밋 가능.

## 1. 상황 요약

- **Active Target**: `v2.3.0` (도구 개선, verified 53 / discarded 19 / implemented 2).
- v3.0.0 WIP(110 신규 + 39 수정 파일)는 이전 "v3.0.0" 계획(2026-06-17, 206-task)으로 구현됐으나, v2.3.0과 **독립적으로 REQ 번호를 매겨** 광범위 ID 충돌 발생.
- 근본 원인: REQ ID는 전역 유일(scope+번호). v3 계획이 v2.3.0을 몰랐고, 그 사이 v2.3.0이 같은 번호대를 **다른 의미로 완료**함.

## 2. 정밀 인벤토리 (id-map 카논 기준, 읽기전용 확정)

id-map 5종(`docs/analysis/*id-map*.json`)이 v3 계획의 title→ID 카논. 등록된 189개 ID(docs/spec)와 교차검증:

| 분류 | 개수 | 처리 |
|---|---|---|
| **충돌** (v3 ID가 이미 v2.3.0에 등록됨) | **52** | 새 번호로 remap 필수 |
| **신규** (v3 ID 미사용, 비어있음) | **47** | 그대로 등록 |

### 2.1 충돌 scope별 remap 범위 (결정적)

각 충돌 ID는 해당 scope에서 `등록됨 ∪ 유지되는-신규`의 최대값 위로 연속 배정:

| scope | 건수 | old 범위 | → new 범위 |
|---|---|---|---|
| FR-MCP | 14 | 021..036 | **040..053** |
| FR-NODE | 16 | 017..032 | **055..070** |
| FR-PARSE | 4 | 019..026 | **029..032** |
| IR-CLI | 17 | 028..045 | **056..072** |
| REL-PARSE | 1 | 002 | **004** |

전체 old→new 매핑 52행은 `remap-table.md` / `remap.json` 참조 (이 문서와 동봉).

### 2.2 신규(그대로 등록) scope별

`DR-PARSE:1  FR-ARCH:1(006)  FR-FLOW:8(014~023)  FR-NODE:20(033~054)  FR-PARSE:6  IR-CLI:10(046~055)  REL-ARCH:1(002)`

## 3. 실행 절차 (SRS-first, TDD 보존)

> 원칙: v2.3.0의 verified 53개 REQ는 **절대 건드리지 않는다**. 신규/충돌 요구만 다룬다.
> 증거 없는 verified 금지 — 코드가 있다는 사실만으로 자동 verified 처리하지 않는다.

1. **타깃 결정 (선행 제품결정, §4)**: v3.0.0을 신규 타깃으로 등록할지 확정.
2. **REQ 등록**: 99개(52 remapped + 47 new) 요구를 kiwi-planner/kiwi-srs 파이프라인으로 정식 SRS 블록(Statement/AC/Stability=draft→) 작성. 코드에서 역추출하되 **의도를 사람이 검토**.
3. **코드/테스트 ID 재매핑**: `remap.json` 기반으로 52개 충돌 ID를 치환 —
   - 테스트 파일명 (`*.fr-node-017.test.ts` → `*.fr-node-055.test.ts` 등)
   - `@req` / Requirement ID 주석
   - ToolSpec registry(`schemas.ts`)·문서(`90.appendix.md`) 내 참조
4. **검증**: `speckiwi validate --fail-on-warning --json` (중복 0 확인) → build green(tsc/lint 0) → vitest green → `summary`.
5. **재커밋**: 재매핑·등록 완료 후 feat/2.3(또는 v3 타깃 브랜치)에 커밋.

## 4. 남은 제품결정 (사용자 소유 — 자동결정 부적합)

**99개 v3 요구를 지금 v3.0.0 신규 타깃으로 정식 등록할 것인가?**

- 현 Active Target은 v2.3.0(도구 개선). 99개 v3 요구를 v2.3.0에 넣으면 타깃 범위 붕괴.
- v3.0.0은 별개 major. 99-REQ 타깃 등록 + SRS 저술은 다중시간 작업이며 로드맵 결정.
- 선택지:
  - **A. 지금 v3.0.0 타깃 등록 후 재정비 완주** (kiwi 파이프라인, 다중시간).
  - **B. v2.3.0 마무리 우선, v3는 `wip/v3.0.0`에 보존한 채 이 계획으로 후속 착수.**

이 결정은 범위·우선순위에 대한 것이라 무인 자동결정 대신 사용자 확인이 적절.

## 5. 보존 상태

- `wip/v3.0.0` 브랜치: v3 코드/테스트/문서 + 이 계획 + remap 표 (런타임 캐시 `.kiwi`/`.serena` 제외).
- `feat/2.3`: aac7115(v2.3.0) 깨끗 복원.
