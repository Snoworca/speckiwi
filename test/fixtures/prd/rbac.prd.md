# PRD: Java Express 의 RBAC 저장소

> 입력 기록이다. 요구 원본이 아니다 — 무엇을 만들지는 `docs/spec` 의 SRS 가 정한다.
> 이 문서는 kiwi-prd 만 쓴다. 검증·개선 루프는 읽기만 한다.

| Field | Value |
|---|---|
| Status | approved |
| Approved | 2026-11-03 |
| Request SHA256 | cd65b3e26e01cd32f07b3161ea4a025fb0add2ca088f52e24197d888be94ee4f |

## 1. User Request

### U-1 — 2026-11-03 request

> nodejs 의 express 를 자바 버전으로 만드는데, 여기에 사용자 편의 기능을 RBAC 을 붙이고 내가 인터페이스와 파일 스토어만 만들어서 사용자가 상속 받아서 DB로 붙일 수 있게 하라.

### U-2 — 2026-11-03 answer to Q-1

> 질문: 파일 스토어는 실행 중에 역할·권한을 바꿔 파일에 저장하는 것까지 해야 하나요, 아니면 시작할 때 읽기만 하면 되나요?
>
> 답: 저장까지 해야 합니다.

## 2. Items

### PRD-1 — 권한 관리를 바로 쓰되 저장소는 자기 DB 에 붙인다

| Field | Value |
|---|---|
| Kind | intent |
| Source | U-1 |
| State | confirmed |

> 사용자가 상속 받아서 DB로 붙일 수 있게

권한 관리를 바로 쓰되, 저장소는 사용자가 자기 DB 에 붙인다.

### PRD-2 — 자바 웹 프레임워크

| Field | Value |
|---|---|
| Kind | in-scope |
| Source | U-1 |
| State | confirmed |

> nodejs 의 express 를 자바 버전으로 만드는데

### PRD-3 — 역할 기반 접근 제어

| Field | Value |
|---|---|
| Kind | in-scope |
| Source | U-1 |
| State | confirmed |

> 사용자 편의 기능을 RBAC 을 붙이고

### PRD-4 — 저장소 인터페이스 하나와 읽기·쓰기 파일 구현 하나

| Field | Value |
|---|---|
| Kind | in-scope |
| Source | U-1, U-2 |
| State | confirmed |

> 인터페이스와 파일 스토어만 만들어서

U-2 에서 실행 중 저장까지 하기로 했다.

### PRD-5 — 사용자 구현으로 파일 스토어를 바꿔 끼운다

| Field | Value |
|---|---|
| Kind | in-scope |
| Source | U-1 |
| State | confirmed |

> 사용자가 상속 받아서 DB로 붙일 수 있게

### PRD-6 — DB 별 저장소 구현과 스키마 생성은 만들지 않는다

| Field | Value |
|---|---|
| Kind | exclusion |
| Exclusion Class | user-excluded |
| Source | U-1 |
| State | confirmed |

> 인터페이스와 파일 스토어만

PostgreSQL·MySQL·Oracle 구현, 테이블·스키마 생성, 초기값 적재는 만들지 않는다.

### PRD-7 — DB 연동은 프레임워크 사용자가 맡는다

| Field | Value |
|---|---|
| Kind | exclusion |
| Exclusion Class | external-ownership |
| Source | U-1 |
| State | confirmed |

> 사용자가 상속 받아서 DB로 붙일 수 있게

### PRD-8 — 파일 형식은 JSON

| Field | Value |
|---|---|
| Kind | proposal |
| Effect | in-scope |
| Reason | 의존성이 없고 사람이 고치기 쉽다 |
| State | confirmed |

## 3. Approval

> 사용자: 이대로 진행하세요.
