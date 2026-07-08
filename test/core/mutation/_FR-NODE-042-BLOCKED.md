# FR-NODE-057 RED test parked (BLOCKED)

`fr-node-042-req-id-reservation.test.ts.blocked-srs` 는 vitest glob 밖으로 이름변경되어 있다.

사유: FR-NODE-057 AC-3(promote rejects non-minter id) 의 reservation provenance ledger 메커니즘이 SRS 미명시 + FR-NODE-046 promote 계약과 정합 필요. 3인 위원회 자동결정 결과 /kiwi-srs 정합화 + 재계획 사안.

참조: `.kiwi/sessions/2026-06-17.speckiwi.v3-0-0/reports/decision-T-PH003-52.md`

재작업 시: SRS 정합화 후 RED 재작성(501 blanket-reject 대신 reservation-state 모델링) → `.test.ts` 로 복원 → GREEN.
