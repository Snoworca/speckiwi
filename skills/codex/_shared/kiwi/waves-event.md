# kiwi waves event v1.0.0

본 파일은 `kiwi-wave-master`(FR-FLOW-029) 가 멀티-웨이브 진행을 추적하기 위해 append 하는 **wave 진행 이벤트**(`./kiwi/waves.jsonl`) 의 SSOT. `_shared/kiwi/pipeline-event.md` 를 모델로 하며, 변경은 SemVer 를 따른다 (minor: 필드 추가만 / major: breaking).

`./kiwi/pipeline.jsonl`(스킬-간 파이프라인 이벤트) 와는 **별개 파일**이다 — `waves.jsonl` 은 wave-master 한 실행 안의 wave 별 상태만 담는다.

---

## 1. 파일 위치

해석 순서 (pipeline-event.md §1 과 동일):

1. `git rev-parse --show-toplevel` exit 0 → `{git_root}/kiwi/waves.jsonl`
2. 위 실패 + cwd 에 `kiwi/` 디렉토리 존재 → `{cwd}/kiwi/waves.jsonl`
3. 둘 다 부재 → `~/.kiwi/waves.jsonl` (홈 fallback)

디렉토리 부재 시 `mkdir -p`.

---

## 2. 이벤트 JSON schema

각 줄은 정확히 1개의 JSON object (JSONL, 줄 끝 LF 단일).

### 2.1 필수 필드

| 필드 | 타입 | 값 |
|---|---|---|
| `ts` | string (ISO-8601 UTC) | `2026-07-10T13:45:12.345Z` |
| `schema_version` | string (SemVer) | `1.0.0` |
| `run_id` | string | wave-master 실행의 run_id |
| `wave` | string | `wave-{n}` (예: `wave-1`) |
| `order` | number | wave 실행 순서 (1-based) |
| `target` | string | 그 wave 의 전용 SRS target (`wave-{n}`) |
| `status` | string (enum) | `pending` / `in_progress` / `complete` / `failed` |
| `summary` | string | 1-3 문장 사람-읽기용 요약 |

### 2.2 선택 필드

| 필드 | 타입 | 용도 |
|---|---|---|
| `scope` | string | wave 에 지정한 작업 범위 (해당 wave 로 한정) |
| `pipeline_run_id` | string | 그 wave 의 `/kiwi-pipeline` 사이클 run_id |
| `req_ids` | string[] | 그 wave 에서 다룬 REQ-ID 목록 |
| `notes` | string | 자유 텍스트 부연 |

---

## 3. status 전이 규칙

```
pending → in_progress → complete
                     ↘ failed
```

- wave 시작 시 `in_progress` 1줄 append.
- **`complete` 는 그 wave 의 `/kiwi-pipeline` 이 성공적으로 완료된 뒤에만** append (mark-complete-only-after-success). 실행 중/실패 wave 는 `complete` 로 기록하지 않는다.
- 실패 시 `failed` append 후 오케스트레이션 중단(사용자 결정).

---

## 4. 재개 (resume) 규약

`waves.jsonl` 을 읽어 각 wave 의 **마지막(latest)** 이벤트 status 를 계산한다:

- 모든 wave 가 `complete` → 전체 완료.
- 그 외 → status 가 `complete` 가 아닌 **첫 번째 미완료(first incomplete) wave** 부터 재개한다. 이미 `complete` 인 앞 wave 는 건너뛴다.

append-only 이므로 최신 상태는 항상 각 `wave` 의 마지막 줄이다.

---

## 5. Emit 패턴

```bash
WAVE_DIR=$(git rev-parse --show-toplevel 2>/dev/null)/kiwi
[ -z "$WAVE_DIR" ] && [ -d "./kiwi" ] && WAVE_DIR="./kiwi"
[ -z "$WAVE_DIR" ] && WAVE_DIR="$HOME/.kiwi"
mkdir -p "$WAVE_DIR"
echo '{"ts":"<ISO>","schema_version":"1.0.0","run_id":"<rid>","wave":"wave-1","order":1,"target":"wave-1","status":"complete","summary":"<one-liner>"}' >> "$WAVE_DIR/waves.jsonl"
```

emit 은 best-effort — 실패가 본 오케스트레이션 실패로 이어지면 안 된다 (stderr WARN).
