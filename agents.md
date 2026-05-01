# AI Coding Agent 작업 지침

이 문서는 SpecKiwi 저장소에서 작업하는 AI 코딩 에이전트가 반드시 따라야 하는 운영 지침이다. 모든 구현 작업은 SRS와 관련 명세를 만족하도록 계획, 검토, TDD 구현, 코드 리뷰 순서로 진행해야 한다.

## 1. 기본 원칙

- 구현 작업을 시작하기 전에 반드시 계획을 세운다.
- 모든 계획은 AI 코딩 에이전트가 그대로 실행할 수 있는 작업 지침이어야 한다.
- 모든 개발은 반드시 TDD로 진행한다.
- 계획과 구현은 SRS 요구사항을 기준으로 추적 가능해야 한다.
- 계획 리뷰와 코드 리뷰에서 개선사항이 발견되면 개선사항이 없어질 때까지 반복한다.

## 2. 계획 문서 작성 규칙

구현 작업 전에는 `docs/plan/step{n}.{계획이름}/` 디렉토리를 만든다.

예시:

```text
docs/plan/step1.core-contract-freeze/
```

계획 디렉토리에는 반드시 `00.index.md`를 만든다. `00.index.md`에는 다음 내용을 포함해야 한다.

- 작업 목적
- 참조해야 할 SRS 및 세부 명세 문서
- phase 목록
- phase 간 의존성
- SRS 요구사항 추적표
- TDD 수행 원칙
- 계획 리뷰 절차
- 코드 리뷰 절차
- 완료 기준

계획은 먼저 큰 단위로 나눈다. 큰 단위는 AI 코딩 에이전트가 독립적으로 목적, 산출물, 완료 기준을 이해할 수 있는 구현 흐름이어야 한다.

권장 큰 단위는 다음과 같다.

- Foundation: 패키지 골격, 타입 계약, 테스트 환경, 공통 유틸리티
- Core: workspace load, YAML loader, schema validation, diagnostics
- Graph: document, scope, requirement relation graph와 impact 계산
- Search: exact index, tokenizer, BM25, dictionary expansion, cache 연동
- Write: proposal, apply, path safety, atomic write, stale 처리
- Interfaces: CLI 명령, MCP tools/resources, JSON 출력 계약
- Export: Markdown export, template, export index, deterministic output
- Verification: 통합 테스트, 회귀 테스트, SRS traceability 점검

큰 단위는 필요할 때만 더 작게 나눈다. 단순히 파일이나 함수 기준으로 계획을 쪼개지 말고, 사용자가 검증 가능한 제품 능력 기준으로 나눈다.

각 phase는 하나의 문서로 작성한다.

예시:

```text
docs/plan/step1.core-contract-freeze/01.phase-contract-types.md
docs/plan/step1.core-contract-freeze/02.phase-schema-fixtures.md
docs/plan/step1.core-contract-freeze/03.phase-adapter-skeleton.md
```

각 phase 문서 내부에는 여러 step을 둔다. 각 step은 다음 형식을 포함해야 한다.

- 목표
- 관련 SRS 요구사항 ID
- 선행 조건
- Red 단계: 먼저 작성할 실패 테스트
- Green 단계: 테스트를 통과시키기 위한 최소 구현
- Refactor 단계: 중복 제거와 구조 정리
- 검증 명령
- 완료 기준

## 3. 계획 리뷰 규칙

phase별 계획 문서가 작성되면 계획 리뷰어 서브 에이전트가 계획을 검토해야 한다.

계획 리뷰어는 다음 항목을 평가한다.

- SRS를 만족하기 위한 계획인지
- 누락된 요구사항이 없는지
- phase 순서와 의존성이 올바른지
- 각 step이 TDD로 실행 가능하게 작성되었는지
- AI 코딩 에이전트가 모호함 없이 실행할 수 있는지
- 검증 명령과 완료 기준이 충분한지

계획 리뷰 결과 개선사항이 있으면 계획 문서를 수정한 뒤 다시 리뷰한다. 개선사항이 없다는 평가가 나올 때까지 이 과정을 반복한다.

## 4. 구현 진행 규칙

계획 리뷰가 완료되기 전에는 코딩을 시작하지 않는다.

구현은 승인된 계획의 phase 순서대로 진행한다. 각 step은 반드시 다음 순서로 수행한다.

```text
1. Red: 실패하는 테스트를 먼저 작성한다.
2. Red 확인: 테스트가 기대한 이유로 실패하는지 확인한다.
3. Green: 테스트를 통과시키는 최소 코드를 작성한다.
4. Green 확인: 관련 테스트를 실행한다.
5. Refactor: 동작을 유지하면서 구조를 정리한다.
6. Regression 확인: 관련 테스트를 다시 실행한다.
```

계획과 다른 구현이 필요해지면 즉시 계획 문서를 갱신하고, 필요한 경우 계획 리뷰를 다시 수행한다.

## 5. 코드 리뷰 규칙

코딩이 끝나면 까칠한 코드 리뷰어 서브 에이전트가 먼저 TDD 준수 여부를 확인해야 한다.

코드 리뷰어는 다음 항목을 우선 검토한다.

- 테스트가 구현보다 먼저 작성되었는지
- 실패 테스트를 확인한 기록이 있는지
- 구현이 SRS 요구사항을 만족하는지
- 테스트가 요구사항의 핵심 동작을 검증하는지
- 불필요한 범위 확장이나 임의 해석이 없는지
- 회귀 테스트가 실행되었는지

TDD로 개발되지 않았다고 판단되면 해당 코딩 task의 변경을 물리고, 실패 테스트 작성부터 다시 시작한다.

리뷰 결과 개선사항이 있으면 수정 후 다시 리뷰한다. 리뷰어가 개선사항 없음으로 평가할 때까지 리뷰와 개선을 반복한다.

## 6. 완료 조건

작업은 다음 조건을 모두 만족할 때만 완료로 본다.

- 계획 문서가 `docs/plan/step{n}.{계획이름}/`에 존재한다.
- `00.index.md`와 phase별 문서가 작성되어 있다.
- 계획 리뷰어가 개선사항 없음을 확인했다.
- 모든 구현 step이 TDD 순서로 진행되었다.
- 까칠한 코드 리뷰어가 TDD 준수와 코드 품질을 확인했다.
- 관련 테스트와 검증 명령이 통과했다.
- 변경 결과가 SRS 요구사항과 추적 가능하다.
