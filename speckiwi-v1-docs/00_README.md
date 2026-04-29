# SpecKiwi v1 문서 세트

이 문서 세트는 SpecKiwi v1의 확정된 방향을 기준으로 작성되었다.

SpecKiwi v1은 데이터베이스, HTTP 서버, DB migration, 상주 daemon을 사용하지 않는다. 프로젝트 저장소 내부의 `.speckiwi/` 디렉토리에 있는 YAML 파일을 유일한 원본으로 사용하고, Node.js 기반 CLI와 stdio MCP 인터페이스를 제공한다.

## 문서 목록

| 파일 | 목적 |
|---|---|
| `01_SRS.md` | SpecKiwi v1 소프트웨어 요구사항 명세 |
| `02_ARCHITECTURE.md` | CLI, MCP, Core, File Store 아키텍처 |
| `03_DIRECTORY_STRUCTURE.md` | `.speckiwi/` 표준 디렉토리 구조 |
| `04_YAML_SCHEMA_SPEC.md` | index/overview/dictionary/srs/prd/technical/adr/rule/proposal YAML 스키마 명세 |
| `05_MCP_TOOL_SPEC.md` | stdio MCP tools/resources 명세 |
| `06_CLI_SPEC.md` | CLI 명령, 옵션, 출력 형식 명세 |
| `07_SEARCH_SPEC.md` | exact/BM25/한글 n-gram/dictionary/cache 검색 명세 |
| `08_VALIDATION_SPEC.md` | validation error/warning 및 diagnostics 명세 |
| `09_AGENT_WRITE_POLICY.md` | propose/apply 에이전트 쓰기 정책 |
| `10_MARKDOWN_EXPORT_SPEC.md` | YAML to Markdown export 명세 |
| `11_IMPLEMENTATION_PLAN.md` | 구현 순서와 v1 milestone |
| `12_IMPLEMENTATION_READINESS_DECISIONS.md` | 구현 모호성 제거를 위한 보완 결정, DTO, 테스트 기준 |

## 고정 결정

```text
Source of Truth: .speckiwi/**/*.yaml
Machine Output: JSON
Cache: .speckiwi/cache/*.json
Export: Markdown
Runtime: Node.js >= 20
Interface: CLI + stdio MCP
Database: 사용하지 않음
HTTP server: 사용하지 않음
Default write mode: propose
Search: exact + in-memory BM25 + Korean n-gram + dictionary
Implementation Contract: 12_IMPLEMENTATION_READINESS_DECISIONS.md 우선 적용
```

## 기본 실행 예

```bash
npm install -g speckiwi

speckiwi init
speckiwi validate
speckiwi search "상태 전이"
speckiwi req get FR-AGK-LOOP-0001
speckiwi export markdown
speckiwi mcp --root /path/to/project
```
