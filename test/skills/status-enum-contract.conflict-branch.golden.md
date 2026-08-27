#### conflict

1. `get_requirement { id: REQ-X }`
2. `add_requirement` — new REQ
   - `status: "planned"`
   - `tags: ["conflict-with:REQ-X", "feasibility:{level}"]`
   - `rationale: "Conflicts with REQ-X: {reason}. Pending user resolution."`
   - `trace`: 코드 증거
3. `add_trace_link { id: NEW-ID, type: "Requirement", reference: "REQ-X", relation: "conflicts_with", notes: "{reason}; re_stated_from: REQ-X#AC1, REQ-X#AC2; reason_detail: {refinement-detail}" }`
   - `re_stated_from` provenance 는 `notes` 에 grammar `re_stated_from:\s*REQ-ID#ACn(,\s*REQ-ID#ACn)*` 로 인라인 인코딩 (speckiwi `add_trace_link` 가 별도 필드 미지원)
4. `update_stability { id: "REQ-X", stability: "draft", reason: "Conflicts with {NEW-ID}: {reason}. Pending user resolution." }` — 자동 폐기 회피. `Stability` 만 변경하고 `Status` 는 건드리지 않는다. 보류를 뜻하는 Status 값은 존재하지 않으며 `status: "draft"` 는 `update_status` 가 `USAGE` 로 거부한다. `reason` 이 §7 Change Notes 행을 자동 생성하므로 별도 기재하지 않는다. `reason` 은 500 UTF-16 code unit 이내의 한 줄 요약으로 쓴다 — 길이를 넘기거나 제어문자를 담거나 heading 또는 fence 로 시작하는 줄을 넣으면 `update_stability` 가 `USAGE` 로 거부한다. REQ-X 의 status 가 이미 `verified` 이면 이 호출은 `MUTATION_DENIED` 로 거부되므로, 그때는 demote 를 시도하지 않고 3단계의 `conflicts_with` trace link 만 남긴 뒤 6단계 보고에서 "verified REQ 와 충돌하여 보류 불가" 를 사용자에게 함께 보고한다
5. **Final `validate_spec`** — Markdown sync 완료 후 호출
6. **사용자에게 충돌 보고** — `--qna` 미사용 시에도 conflict 발견은 사용자 결정 필요. §6.4 boundary 게이트와 동시 발동 시 §0.G5 적용

