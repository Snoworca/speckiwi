# kiwi code-comments v1.0.0

코드 설명 주석을 끄는 설정의 뜻을 정하는 SSOT (FR-FLOW-234). 이 설정의 목적은 설명 주석을 쓰지 않아 토큰 소비를 줄이는 것이다. 추적 태그의 AC 번호는 설정과 관계없이 남는다. 설정은 사용자가 CLI `speckiwi comments on|off` 로 바꾸고(IR-CLI-121), 에이전트는 MCP `get_work_mode` 응답의 `codeComments` 로 읽기만 한다(MCP 가 없으면 CLI `speckiwi mode --json`). 값이 없으면 `on` 이다. 에이전트는 사용자가 요청할 때만 이 설정을 바꾼다. 코드를 쓰거나 고치는 스킬은 코드를 쓰기 전에 `codeComments` 를 읽고, 이 문서를 경로로 인용하며 규칙을 다시 적지 않는다.

## 1. `off` 일 때 쓰지 않는 것 (omit)

에이전트가 새로 쓰거나 고치는 코드에 **설명 주석**을 쓰지 않는다.

- 왜 그렇게 했는지 적는 why-comment
- JSDoc · docstring 의 설명 문장
- 코드 줄을 풀어 쓰는 인라인 해설
- 할 일을 주석으로 남기는 TODO · FIXME 설명

## 2. `off` 여도 그대로 쓰는 것 (keep)

- 추적 태그 `@req <REQ-ID> AC-<n>[ AC-<m>…]`. 그 코드가 구현하는 AC 번호를 설정과 관계없이(on 이든 off 든) 늘 함께 쓰고, 한 줄에 REQ-ID 하나만 둔다(형식·위치·중복 처리는 `kiwi-coder` §0.17). step 작업(vibe, `kiwi-tdd`)의 작업 이름(task-name) 태그는 `@step <task-name>: AC-<n>[ AC-<m>…]` 로 그 step 의 AC 번호를 함께 쓴다(`speckiwi step synthesize` 가 이 표식을 읽는다). vibe step 은 코드를 먼저 쓰는 동안 태그를 `@step <task-name>:` 로 시작할 수 있다. 그 코드를 싣는 커밋마다 그 전에 acceptance 줄(`docs/spec/steps/<task-name>/intent.md` 의 `## Acceptance` 아래 `AC-<n>: WHEN … THE SYSTEM SHALL …`)을 쓰되 어느 줄에도 해당하지 않는 태그 달린 코드에는 그 코드를 다루는 줄을 더하고, 각 `@step <task-name>:` 태그에 그 코드가 구현하는 AC 번호를 채운다. 그 task 를 싣는 커밋 전에는 AC 번호를 채운 뒤 step SRS 를 합성한다. 합성은 표식 뒤 내용을 옮기되 step SRS 가 이미 있으면 건너뛰므로, 태그를 채우기 전에 합성했으면 `docs/spec/steps/<task-name>/<task-name>.srs.md` 를 지우고 다시 합성한다. 그래서 커밋되는 추적 태그에는 늘 AC 번호가 있다. `off` 이면 태그 줄에는 태그와 AC 번호만 두고 설명 문장을 붙이지 않는다.
- 시험 줄의 `<REQ-ID> AC-<n>` 인용과 `SDS-AC-<n>` 인용. 어떤 상황에서도 빼지 않는다. 시험 충분성이 이 줄을 읽는다(`_shared/kiwi/test-sufficiency.md`).
- 언어·도구가 요구하는 지시 주석: `// eslint-disable-next-line`, `// @ts-expect-error`, `# type: ignore`, `@req-lint: ignore`, shebang, 라이선스 머리글처럼 동작·빌드·검사에 필요한 것.

## 3. 이미 있는 주석 (existing)

- 이미 있는 주석은 지우지 않는다. 요청 범위 밖의 변경이다.
- 에이전트가 고친 코드 때문에 사실과 맞지 않게 된 주석은 그 주석만 고치거나 지울 수 있다.

## 4. `on` 일 때 (on)

지금까지처럼 주석을 쓴다. 이 문서의 1절은 적용하지 않는다.

## 5. 리뷰

`off` 이면 리뷰어는 주석이 없거나 부족한 것을 finding 으로 내지 않고, fixer 는 설명 주석을 더하지 않는다. 2절의 항목이 빠진 것을 finding 으로 낼지는 각 스킬의 기존 규칙을 따른다(예: `kiwi-coder` 는 `@req` 태그를 리뷰 대상으로 삼지 않는다).
