# AGENT_WRITE_POLICY — SpecKiwi v1 에이전트 쓰기 정책

## 1. 목적

AI 코딩 에이전트가 요구사항과 기술 문서를 수정할 수 있게 하되, 오수정 위험을 줄이기 위해 기본 쓰기 모드를 `propose`로 고정한다.

Proposal patch format, base hash, stale proposal rejection, apply exit code의 최종 결정은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`를 따른다.

## 2. 기본 정책

```yaml
agent:
  defaultWriteMode: propose
  allowApply: true
```

원칙:

```text
- propose는 원본 YAML을 수정하지 않는다.
- apply는 validation 통과 후에만 원본 YAML을 수정한다.
- apply는 allowApply=false 설정에서 거부된다.
- 변경 이력은 Git이 1차로 담당한다.
```

## 3. Write Mode

| Mode | 원본 수정 | 산출물 | 사용 상황 |
|---|---:|---|---|
| `propose` | 아니오 | `.speckiwi/proposals/*.yaml` | 기본 모드, 에이전트 안전 쓰기 |
| `apply` | 예 | 수정된 YAML 원본 | 사용자가 명시적으로 허용한 경우 |

## 4. Proposal 파일명

```text
.speckiwi/proposals/<timestamp>.<operation>.<target>.yaml
```

예:

```text
.speckiwi/proposals/2026-04-28T091500.update.FR-AGK-LOOP-0001.yaml
```

## 5. Proposal 스키마

```yaml
schemaVersion: speckiwi/proposal/v1

id: proposal.2026-04-28T091500.update.FR-AGK-LOOP-0001
type: proposal
status: proposed
operation: update_requirement

target:
  kind: requirement
  requirementId: FR-AGK-LOOP-0001
  documentId: srs.agent-kernel.loop

base:
  documentId: srs.agent-kernel.loop
  documentPath: srs/agent-kernel.loop.yaml
  target:
    entityType: requirement
    id: FR-AGK-LOOP-0001
    jsonPointer: /requirements/0
  documentHash: sha256:<file-bytes-hash>
  targetHash: sha256:<canonical-target-json-hash>
  schemaVersion: speckiwi/srs/v1
  generatedAt: "2026-04-28T09:15:00.000Z"

changes:
  - op: replace
    path: /requirements/0/statement
    value: >
      에이전트 커널은 LLM 응답 타입과 tool_call 여부에 따라 상태를 전이해야 한다.

reason: >
  기존 statement가 tool_call 조건을 충분히 구체화하지 못한다.
```

`base`는 필수다. `create_requirement`처럼 target entity가 아직 없는 proposal의 `targetHash`는 RFC 8785 canonical JSON `null`의 SHA-256으로 계산한다.

## 6. Operation Type

```text
create_requirement
update_requirement
change_requirement_status
add_relation
remove_relation
update_document
```

## 7. Patch Operation

```text
add
replace
remove
```

Path는 document-root 기준 RFC 6901 JSON Pointer 형식을 사용한다.

예:

```text
/requirements/0/statement
/requirements/2/relations/0
/items/1/body
```

## 8. Propose Flow

```text
1. 요청 수신
2. workspace load
3. target resolve
4. 현재 문서 확인
5. patch operation 구성
6. proposal YAML 생성
7. proposal schema validation
8. .speckiwi/proposals/에 저장
9. proposal path 반환
```

Propose는 절대 원본 YAML을 수정하지 않는다.

## 9. Apply Flow

```text
1. 요청 수신
2. allowApply 확인
3. proposal 또는 직접 변경 로드
4. target path safety 검증
5. patch를 in-memory document에 적용
6. YAML serialization preview 생성
7. 전체 workspace validation 실행
8. validation error 있으면 중단
9. temp file write
10. atomic rename
11. cache stale 처리
12. apply result 반환
```

직접 변경 apply는 proposal file을 저장하지 않는 편의 경로일 뿐이다. Core는 동일한 in-memory proposal model을 만들고 `base.documentHash`, `base.targetHash`, path safety, validation, atomic write 규칙을 동일하게 적용해야 한다.

## 10. Apply 거부 조건

```text
- allowApply=false
- confirm 없음 또는 false
- target path가 .speckiwi 외부
- target document 없음
- patch path invalid
- YAML parse 실패
- schema validation 실패
- workspace validation error 존재
- duplicate requirement id 발생
- unknown relation target 발생
```

## 11. Atomic Write

파일 수정은 다음 전략을 사용한다.

```text
1. target 파일과 같은 디렉토리에 temp 파일 생성
2. temp 파일에 전체 YAML serialize
3. fsync 가능하면 수행
4. rename으로 원자적 교체
5. 실패 시 temp 파일 제거
```

## 12. Backup 정책

v1에서는 Git을 1차 변경 이력으로 본다. 다만 apply 안정성을 위해 선택적으로 backup 파일을 만들 수 있다.

```text
.speckiwi/cache/backups/<timestamp>/<relative-path>.yaml
```

Backup은 원본이 아니다.

## 13. MCP 정책

```text
speckiwi_propose_change:
  - 항상 원본 수정 금지
  - proposal만 생성

speckiwi_apply_change:
  - allowApply 확인
  - confirm 필요
  - validation 통과 필요
  - path safety 필요
```

## 14. CLI 정책

기본은 propose다.

```bash
speckiwi req update FR-AGK-LOOP-0001 --statement "..."
```

apply는 명시 옵션이 필요하다.

```bash
speckiwi req update FR-AGK-LOOP-0001 --statement "..." --apply
```

## 15. 결과 모델

Propose 결과:

```json
{
  "ok": true,
  "mode": "propose",
  "applied": false,
  "proposal": {
    "id": "proposal.2026-04-28T091500.update.FR-AGK-LOOP-0001",
    "path": ".speckiwi/proposals/2026-04-28T091500.update.FR-AGK-LOOP-0001.yaml",
    "operation": "update_requirement",
    "target": {
      "requirementId": "FR-AGK-LOOP-0001"
    }
  },
  "diagnostics": {
    "errors": [],
    "warnings": [],
    "infos": [],
    "summary": {
      "errorCount": 0,
      "warningCount": 0,
      "infoCount": 0
    }
  }
}
```

Apply 결과:

```json
{
  "ok": true,
  "mode": "apply",
  "applied": true,
  "modifiedFiles": [
    ".speckiwi/srs/agent-kernel.loop.yaml"
  ],
  "cacheStale": true,
  "diagnostics": {
    "errors": [],
    "warnings": [],
    "infos": [],
    "summary": {
      "errorCount": 0,
      "warningCount": 0,
      "infoCount": 0
    }
  }
}
```

Apply 거부 결과:

```json
{
  "ok": false,
  "mode": "apply",
  "applied": false,
  "error": {
    "code": "APPLY_REJECTED_VALIDATION_ERROR",
    "message": "Apply rejected because validation errors exist."
  },
  "diagnostics": {
    "errors": [],
    "warnings": [],
    "infos": [],
    "summary": {
      "errorCount": 0,
      "warningCount": 0,
      "infoCount": 0
    }
  }
}
```
