# kiwi pipeline event v1.0.0

본 파일은 모든 `kiwi-*` 스킬이 종료 시점에 append 해야 하는 **파이프라인 이벤트** 의 SSOT. 변경은 SemVer 를 따른다 (minor: 필드 추가만 / major: breaking).

본 문서는 Codex-local `kiwi-*` 스킬이 공유하는 이벤트 schema 와 emit 규칙의 SSOT 다. 파이프라인 단계 책임과 다음 단계 추천 규칙은 `pipeline-v1.md` 를 참조한다.

---

## 1. 파일 위치 (IR-PIPE-002)

해석 순서:

1. `git rev-parse --show-toplevel` exit 0 → `{git_root}/kiwi/pipeline.jsonl`
2. 위 실패 + cwd 에 `kiwi/` 디렉토리 존재 → `{cwd}/kiwi/pipeline.jsonl`
3. 둘 다 부재 → `~/.kiwi/pipeline.jsonl` (홈 fallback)

결정 후 `{pipeline_dir}/.pipeline-path` 마커 파일에 절대 경로 1줄 기록 (같은 cwd 의 모든 스킬이 동일 경로 사용).

디렉토리 부재 시 현재 OS에 맞는 디렉토리 생성 명령으로 생성한다.

**Run-root pin**: 위 순서는 run 시작 시 한 번만 평가해 root 를 pin 하고, 그 run 의 이후 emit 마다 재해석하지 않는다 — 실행 도중 cwd 나 git root 가 바뀌어도 한 run 의 저널이 두 저장소로 갈라지지 않게 한다.

---

## 2. 이벤트 JSON schema (IR-PIPE-001)

각 줄은 정확히 1개의 JSON object. JSONL 표준 (RFC 7464 호환): 줄 끝 `\n` (LF) 단일.

### 2.1 필수 필드

| 필드 | 타입 | 값 |
|---|---|---|
| `ts` | string (ISO-8601 UTC) | `2026-05-19T13:45:12.345Z` |
| `schema_version` | string (SemVer) | `1.0.0` |
| `skill` | string (enum) | 아래 §3 참조 |
| `run_id` | string | 호출 스킬의 run_id (e.g. `2026-05-19.skillfactory.add-auth`) |
| `status` | string (enum) | `TASK_DONE` / `NEEDS_USER` / `FAILED` / `DRY_RUN` / `CORRECTION` |
| `summary` | string | 1-3 문장 사람-읽기용 요약 |
| `next_hint` | string \| null | 추천 다음 스킬 (§4 enum) 또는 `null` (종료) |
| `artifacts` | object | §2.2 |
| `dry_run` | boolean | --dry-run 또는 KIWI_DRY_RUN=1 시 `true` |

### 2.2 artifacts 객체

```json
{
  "spec_files": ["docs/spec/...srs.md", ...],
  "plan_file": "docs/plans/{run-id}.plan.md" | null,
  "sidecar_file": "docs/plans/{run-id}.sidecar.json" | null,
  "analysis_dir": "docs/analysis/kiwi-{skill}-{run-id}/" | null
}
```

생성하지 않은 산출물은 `null` 또는 빈 배열.

### 2.3 선택 필드

| 필드 | 타입 | 용도 |
|---|---|---|
| `target` | string \| null | speckiwi active target |
| `req_ids` | string[] | 영향 받은 REQ-ID 목록 |
| `duration_sec` | number | 실행 시간 (초) |
| `notes` | string | 자유 텍스트 부연 |
| `corrects_run_id` | string | `status=CORRECTION` 인 경우 정정 대상 |

---

## 3. skill enum

```
kiwi-srs
kiwi-srs-from-code
kiwi-srs-sync
kiwi-srs-feasibility
kiwi-srs-research
kiwi-planner
kiwi-coder
kiwi-pm
kiwi-commit-auto-push
kiwi-commit-auto-pr
kiwi-hot-fix
kiwi-review-fix-loop
kiwi-pipeline
kiwi-wave-master
kiwi-orchestrator
kiwi-tdd
```

위 외 값은 invalid (메타 스킬이 WARN + skip).

---

## 4. next_hint 결정표 (Table T1, SRS §3.3)

| 직전 skill | 직전 status | next_hint |
|---|---|---|
| kiwi-srs / kiwi-srs-from-code | TASK_DONE | `kiwi-srs-feasibility` |
| kiwi-srs-sync | TASK_DONE | `kiwi-pipeline` (재평가) |
| kiwi-srs-feasibility | TASK_DONE | `kiwi-planner` (stability ≥ evolving 시) 또는 `kiwi-srs-research` (블로커 모호 시) |
| kiwi-srs-research | TASK_DONE | `kiwi-srs-feasibility` (재평가) |
| kiwi-planner | TASK_DONE | `kiwi-pm` |
| kiwi-pm | TASK_DONE | `kiwi-review-fix-loop` (`--close-reqs` 검증 후) |
| kiwi-coder (단독) | TASK_DONE | `kiwi-review-fix-loop` (`--close-reqs` 검증 후) 또는 `kiwi-commit-auto-push` |
| kiwi-review-fix-loop | TASK_DONE | `kiwi-commit-auto-push` (self mode) 또는 `null` (PR mode) |
| kiwi-hot-fix | TASK_DONE | `kiwi-commit-auto-push` 또는 `kiwi-pipeline` (sync 후속 검토 필요 시) |
| kiwi-commit-auto-push | TASK_DONE | `kiwi-pipeline` (다음 plan or 종료) |
| kiwi-commit-auto-pr | TASK_DONE | `kiwi-pipeline` (다음 plan or 종료) |
| kiwi-tdd | TASK_DONE | `kiwi-review-fix-loop` (step 승격 후 셀프 리뷰 게이트) |
| kiwi-wave-master | TASK_DONE | `null` (종료) |
| kiwi-orchestrator | TASK_DONE | `null` (종료) — run 은 **자기 통합 브랜치** 위에서 검증까지 마치고 끝난다. base 브랜치로의 commit·push 와 PR 생성은 **의도적으로** 자동 연결하지 않는다 |
| any | NEEDS_USER | `null` |
| any | FAILED | `null` |
| any | DRY_RUN | (직전 동일 skill 의 실제 실행) |

스킬은 본 표의 자기 행을 적용하여 `next_hint` 를 결정. 모호한 경우 (e.g. feasibility 결과가 mixed) `null` + `notes` 에 사유 기록.

---

## 5. Emit 구현 패턴

각 스킬은 종료 직전 (사용자 보고 출력 직후) 다음 절차를 정확히 1회 수행:

### 5.1 Cross-platform append pattern

PowerShell 예시:

```powershell
$gitRoot = git rev-parse --show-toplevel 2>$null
$pipeDir = if ($LASTEXITCODE -eq 0 -and $gitRoot) { Join-Path $gitRoot "kiwi" } elseif (Test-Path -LiteralPath ".\kiwi") { ".\kiwi" } else { Join-Path $HOME ".kiwi" }
New-Item -ItemType Directory -Force -Path $pipeDir | Out-Null
$event = '{"ts":"<ISO-8601>","schema_version":"1.0.0","skill":"kiwi-<name>","run_id":"<rid>","target":"<t>","status":"TASK_DONE","summary":"<one-liner>","next_hint":"kiwi-<next>","artifacts":{"spec_files":[],"plan_file":null,"sidecar_file":null,"analysis_dir":null},"dry_run":false}'
Add-Content -LiteralPath (Join-Path $pipeDir "pipeline.jsonl") -Value $event -Encoding UTF8
```

POSIX shell 예시:

```bash
PIPE_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$PIPE_ROOT" ]; then PIPE_DIR="$PIPE_ROOT/kiwi"
elif [ -d "./kiwi" ]; then PIPE_DIR="./kiwi"
else PIPE_DIR="$HOME/.kiwi"; fi
mkdir -p "$PIPE_DIR"
EVENT=$(cat <<'EOF'
{"ts":"<ISO-8601>","schema_version":"1.0.0","skill":"kiwi-<name>","run_id":"<rid>","target":"<t>","status":"TASK_DONE","summary":"<one-liner>","next_hint":"kiwi-<next>","artifacts":{"spec_files":[],"plan_file":null,"sidecar_file":null,"analysis_dir":null},"dry_run":false}
EOF
)
echo "$EVENT" >> "$PIPE_DIR/pipeline.jsonl"
```

### 5.2 멱등성

동일 `run_id` 의 이벤트가 이미 존재하면 append skip + 안내. 검사:

```text
Before appending, read pipeline.jsonl if it exists and skip append when any line contains `"run_id":"<rid>"`.
```

이는 동일 run_id 의 재실행이 두 줄을 만들지 않도록 보호 (FR-PIPE-001 AC-5).

### 5.3 dry-run

`--dry-run` 또는 `KIWI_DRY_RUN=1` 시 이벤트 필드 `dry_run: true` + `status: "DRY_RUN"` (FR-PIPE-001 AC-3). 실제 mutation 없이 추적 가능.

### 5.4 재진입 멱등 키

부모 오케스트레이터(`kiwi-wave-master`)의 개선 위임이 같은 run 을 다시 돌리는 **재진입** 실행은 emit 키에 회차 접미사를 붙인다: `{run_id}#r{n}` (`n` = 그 run 의 재진입 회차, 1-based).

§5.2 의 멱등 skip 은 **같은 키**에만 적용한다 — bare `run_id` 를 재사용하면 재진입이 skip 되어 체인이 볼 새 `TASK_DONE` 이 생기지 않는다.

본 규약은 `kiwi-pipeline` · `kiwi-planner` · `kiwi-pm` 이 함께 따른다 — 세 스킬 모두 run 을 재사용해 다시 실행될 수 있고, 한 곳만 접미사를 쓰면 나머지가 이벤트를 남기지 못한다.

emit 키는 계획 산출물의 `run_id` 와 **다른 id 공간**이다 — 사이드카 id 정규식 `[a-z0-9.-]{4,40}` 은 emit 키에 **적용하지 않는다**. 그 정규식은 계획 산출물의 식별자를 검사하는 규칙이고, emit 키는 저널의 중복 판정에만 쓰인다.

### 5.5 실패 시

emit 실패가 스킬 본 작업의 실패로 이어지면 안 됨 — emit 은 best-effort. 실패 시 stderr WARN + 본 작업 보고는 정상 출력.


### 5.6 kiwi-orchestrator emit 경로 (v1.4.0 등록)

`kiwi-orchestrator` 는 §5.1 의 손으로 짠 append 블록을 쓰지 않고 **MCP `workflow_pipeline_emit` 도구**로 emit 한다 — 같은 append 로직을 스킬 본문에 한 번 더 복제하지 않기 위해서다. 다른 모든 스킬은 §5.1 을 그대로 쓴다.

MCP 서버가 부재하면 §5.1 의 shell **fallback** 을 그대로 쓴다. emit 은 §5.5 대로 **best-effort** 이므로, 도구 부재가 run 의 실패가 되어서는 안 된다.

**run 수준(run-level) 이벤트의 emit 키**: bare `{run_id}` 를 쓰고, 재개된 run 은 §5.4 의 `{run_id}#r{n}` 형태를 쓴다. 다른 어떤 emit 키도 이 키와 **충돌하지 않는다** — 하위 unit·lane 은 자기 emit 을 `--no-pipeline-emit` 으로 억제하거나 접미사가 붙은 별도 키를 쓰기 때문이다.

---

## 6. 외부 스킬에서 본 파일을 참조하는 절

각 kiwi-* 스킬의 마지막 Phase (Finalize / Phase 7 / 종료 직전) 에 다음 1줄 추가:

```
- **Pipeline emit (의무)**: 각 kiwi-* 스킬의 skill-root 기준 shared pipeline-event 문서 v1.0.0 를 따라 종료 이벤트 1줄 append. 멱등성 보장 (run_id 기준).
```

스킬 본문에 구체적인 bash 명령을 인라인할 필요 없음 — 본 SSOT 참조만으로 충분.

---

## 7. kiwi-pipeline 메타 스킬과의 분리

- 본 SSOT 는 **이벤트 schema + emit 규칙** 만 정의.
- 이벤트를 *읽고* 다음 단계를 추천하는 로직은 `../../kiwi-pipeline/SKILL.md` 에 별도.
- 메타 스킬도 본 schema 를 따라 자기 실행 이벤트를 1줄 append (FR-PIPE-002 AC-3).
