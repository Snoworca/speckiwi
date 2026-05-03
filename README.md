# SpecKiwi

SpecKiwi는 Git 저장소 안의 요구사항과 설계 지식을 검증 가능한 로컬 YAML 그래프로 만들어, 사람과 AI 코딩 에이전트가 같은 맥락 위에서 안전하게 구현하도록 돕는 도구다.

## Installation

```bash
npm install -g speckiwi
```

## Core Commands

```bash
speckiwi init
speckiwi validate
speckiwi search "상태 전이"
speckiwi search "상태 전이" --limit 10 --offset 0
speckiwi req get FR-CORE-0001
speckiwi list docs
speckiwi list reqs
speckiwi list reqs --scope core --status active --project speckiwi
speckiwi req update FR-CORE-0001 --statement "Updated requirement" --apply --no-cache
speckiwi export markdown
speckiwi export markdown --no-cache
speckiwi mcp --root /path/to/project
```

`--no-cache` bypasses generated cache reads and writes for read, export, and apply flows. Search defaults to 10 results with a maximum of 100, while list commands default to 50 results with a maximum of 500.

## Source And History Policy

SpecKiwi treats validated source YAML documents under `.speckiwi/` as the source of truth, excluding managed proposal YAML under `.speckiwi/proposals/`. Generated JSON cache files and Markdown exports are rebuildable artifacts, not authoritative records.

Repository Git history is the primary change history. Proposal YAML files under `.speckiwi/proposals/`, cache stale markers, and cache backups are managed review/apply artifacts; SpecKiwi does not create a separate history database.

## Runtime Boundary

SpecKiwi runs as a local CLI and stdio-only MCP server. The MCP entry point connects through `StdioServerTransport`; it does not start an HTTP server, daemon, or background network listener.

HTTP-oriented packages that appear under the `@modelcontextprotocol/sdk` entry in `package-lock.json` are transitive-only SDK dependencies. They are not direct SpecKiwi dependencies and are not used as runtime server transports.

SpecKiwi v1.0 also does not use SQLite, database migration systems, or vector databases/vector stores. Runtime database and vector-store packages such as `sqlite`, `better-sqlite3`, `postgres`/`pg`, `mysql`, `mongodb`, `duckdb`, `lancedb`, `qdrant`, `chroma`, `weaviate`, `typeorm`, `prisma`, `knex`, and `sequelize` must not be added as direct dependencies. Product workflows must not create database files, migration directories, or vector index artifacts. If these package families appear transitively in `package-lock.json`, they are treated as parent-package internals unless SpecKiwi source imports them directly.

## Development Release Gate

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run release:acceptance
npm run release:check
npm run perf:srs
npm pack --dry-run
```
