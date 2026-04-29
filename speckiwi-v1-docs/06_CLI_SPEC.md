# CLI_SPEC — SpecKiwi v1 CLI 명세

## 1. 목적

SpecKiwi CLI는 개발자와 AI 코딩 에이전트가 `.speckiwi/` YAML 원본을 조회, 검증, 검색, 변경 제안, export할 수 있게 하는 명령줄 인터페이스다.

CLI JSON 출력, exit code, pagination, cache mode의 세부 결정은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`를 따른다.
`--json`은 stdout에 Core DTO JSON 객체 하나만 출력해야 한다.

## 2. 설치

```bash
npm install -g speckiwi
```

요구 런타임:

```text
Node.js >= 20
```

## 3. 기본 명령 구조

```bash
speckiwi <command> [subcommand] [options]
```

공통 옵션:

```text
--root <path>     workspace root 명시
--json            JSON 출력
--no-cache        cache 사용 안 함
--offset <n>      list/search pagination offset
--verbose         상세 로그
--quiet           최소 출력
```

## 4. Exit code

| Code | 의미 |
|---:|---|
| 0 | 성공 |
| 1 | 일반 오류 |
| 2 | validation error |
| 3 | workspace not found |
| 4 | invalid argument |
| 5 | apply rejected |

## 5. 명령 목록

```bash
speckiwi init
speckiwi validate
speckiwi doctor
speckiwi overview
speckiwi list docs
speckiwi list reqs
speckiwi search "..."
speckiwi req get <id>
speckiwi req create
speckiwi req update <id>
speckiwi graph
speckiwi impact <id>
speckiwi export markdown
speckiwi cache rebuild
speckiwi cache clean
speckiwi mcp
```

## 6. `speckiwi init`

workspace를 초기화한다.

```bash
speckiwi init
speckiwi init --project-id speckiwi --project-name "SpecKiwi"
```

생성 구조:

```text
.speckiwi/
├─ index.yaml
├─ overview.yaml
├─ dictionary.yaml
├─ prd/
├─ srs/
├─ tech/
├─ adr/
├─ rules/
├─ proposals/
├─ templates/
├─ cache/
└─ exports/
```

성공 출력:

```text
Initialized SpecKiwi workspace at .speckiwi
```

JSON 출력:

```json
{
  "ok": true,
  "workspaceRoot": "/path/to/project",
  "created": [
    ".speckiwi/index.yaml",
    ".speckiwi/overview.yaml"
  ]
}
```

## 7. `speckiwi validate`

YAML 구조와 link/relation을 검증한다.

```bash
speckiwi validate
speckiwi validate --json
speckiwi validate --root /path/to/project
```

출력 예:

```text
SpecKiwi validation failed

Errors:
  DUPLICATE_REQUIREMENT_ID .speckiwi/srs/agent-kernel.loop.yaml
    Duplicate requirement id: FR-AGK-LOOP-0001

Warnings:
  MISSING_ACCEPTANCE_CRITERIA .speckiwi/srs/agent-kernel.loop.yaml
    Requirement FR-AGK-LOOP-0002 has no acceptanceCriteria
```

## 8. `speckiwi doctor`

실행 환경과 workspace 상태를 점검한다.

```bash
speckiwi doctor
speckiwi doctor --json
```

점검 항목:

```text
- Node.js version
- package version
- .speckiwi 존재 여부
- 필수 파일 존재 여부
- YAML parse 가능 여부
- schema validation 가능 여부
- cache 상태
- MCP 실행 가능 여부
```

## 9. `speckiwi overview`

overview 문서를 출력한다.

```bash
speckiwi overview
speckiwi overview --json
```

## 10. `speckiwi list docs`

문서 목록을 출력한다.

```bash
speckiwi list docs
speckiwi list docs --type srs
speckiwi list docs --scope agent-kernel.loop
speckiwi list docs --json
```

기본 출력:

```text
ID                         TYPE        SCOPE                PATH
srs.agent-kernel.loop      srs         agent-kernel.loop    srs/agent-kernel.loop.yaml
tech.agent-state-machine   technical   agent-kernel.loop    tech/agent-state-machine.yaml
```

## 11. `speckiwi list reqs`

Requirement 목록을 출력한다.

```bash
speckiwi list reqs
speckiwi list reqs --scope agent-kernel.loop
speckiwi list reqs --type functional
speckiwi list reqs --status draft,active
speckiwi list reqs --tag state-machine
speckiwi list reqs --json
```

## 12. `speckiwi search`

검색을 수행한다.

```bash
speckiwi search "상태 전이"
speckiwi search "FR-AGK-LOOP-0001"
speckiwi search "상태 전이" --mode bm25
speckiwi search "상태 전이" --scope agent-kernel.loop
speckiwi search "상태 전이" --json
```

옵션:

```text
--mode auto|exact|bm25
--scope <scope-id>
--type <domain-type>
--status <status-list>
--tag <tag>
--limit <n>
--offset <n>
```

## 13. `speckiwi req get`

Requirement ID exact lookup.

```bash
speckiwi req get FR-AGK-LOOP-0001
speckiwi req get FR-AGK-LOOP-0001 --json
speckiwi req get FR-AGK-LOOP-0001 --relations
```

## 14. `speckiwi req create`

Requirement를 생성한다.

기본은 propose mode다.

```bash
speckiwi req create \
  --scope agent-kernel.loop \
  --type functional \
  --title "LLM 응답 기반 상태 전이" \
  --statement "에이전트 커널은 LLM 응답 타입에 따라 상태를 전이해야 한다."
```

명시 ID:

```bash
speckiwi req create \
  --id FR-AGK-LOOP-0001 \
  --scope agent-kernel.loop \
  --type functional \
  --title "..." \
  --statement "..."
```

apply:

```bash
speckiwi req create ... --apply
```

ID preview:

```bash
speckiwi req id preview --scope agent-kernel.loop --type functional
speckiwi req create ... --preview-id
```

Preview는 proposal, 원본 YAML, cache를 쓰지 않는다.

## 15. `speckiwi req update`

Requirement를 수정한다.

```bash
speckiwi req update FR-AGK-LOOP-0001 \
  --statement "새 statement" \
  --reason "tool_call 조건 구체화"
```

기본은 proposal 생성이다.

apply:

```bash
speckiwi req update FR-AGK-LOOP-0001 \
  --statement "새 statement" \
  --reason "tool_call 조건 구체화" \
  --apply
```

## 16. `speckiwi graph`

graph를 출력한다.

```bash
speckiwi graph
speckiwi graph --type traceability
speckiwi graph --type requirement
speckiwi graph --type document
speckiwi graph --type requirements
speckiwi graph --type documents
speckiwi graph --json
```

`--type`의 canonical 값은 `document`, `scope`, `requirement`, `dependency`, `traceability`다. Plural alias `documents`, `scopes`, `requirements`, `dependencies`는 각각 singular canonical 값으로 정규화한다. 기본값은 `traceability`다.

## 17. `speckiwi impact`

변경 영향 범위를 계산한다.

```bash
speckiwi impact FR-AGK-LOOP-0001
speckiwi impact FR-AGK-LOOP-0001 --json
```

v1 impact는 requirement ID 전용이다. `--document`와 `--scope` impact는 v1에서 지원하지 않으며, document/scope 관계 조회는 `speckiwi graph --type document|scope|traceability`를 사용한다.

## 18. `speckiwi export markdown`

Markdown export를 수행한다.

```bash
speckiwi export markdown
speckiwi export markdown --out .speckiwi/exports
speckiwi export markdown --type srs
speckiwi export markdown --document srs.agent-kernel.loop
```

출력:

```text
Exported Markdown files:
  .speckiwi/exports/index.md
  .speckiwi/exports/overview.md
  .speckiwi/exports/srs/agent-kernel.loop.md
```

## 19. `speckiwi cache`

```bash
speckiwi cache rebuild
speckiwi cache clean
```

## 20. `speckiwi mcp`

stdio MCP 서버를 실행한다.

```bash
speckiwi mcp --root /absolute/path/to/project
```

주의:

```text
- protocol 외 로그를 stdout에 쓰지 않는다.
- 로그는 stderr로 출력한다.
- HTTP port를 열지 않는다.
```

## 21. 출력 정책

```text
stdout:
  - 사용자 결과
  - JSON 결과

stderr:
  - diagnostic log
  - verbose log
  - warning
```

MCP 모드에서는 stdout 정책이 더 엄격하다.

```text
MCP stdout:
  protocol message only
```
