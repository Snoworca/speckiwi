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
