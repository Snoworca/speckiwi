# kiwi wave-srs-registration v1.0.0

wave(또는 그에 준하는 단위)마다 `/kiwi-srs` 를 호출해 전용 target 의 SRS 를 저작할 때의 **호출 계약** SSOT. `kiwi-wave-master` §4 에서 **등록 계약 줄만** 이동해 만들었으며, `kiwi-wave-master` 와 `kiwi-orchestrator` 가 **모두 본 문서를 참조**한다 — 규칙을 텍스트가 아니라 참조로 중복시키기 위해서다.

target 등록 자체(범위 한정, 미등록 target 의 생성 옵션 등록)는 호출자의 본문에 남는다. 본 문서는 **저작 입력**과 **멱등 표식**만 규정한다. 아래 이동된 본문이 `§4` · `§5` 를 가리킬 때 그것은 **호출자의** 절이다.

---

## 1. 저작 입력 — 무엇을 넘기는가

wave 진입 시 `carried_into` 가 이 wave 인 residual 을 **전량** 수집해 증분 **저작 입력**에 포함한다 — 이월된 결함은 이 wave 의 REQ/AC 분모에 들어가지 않으면 다시 검출되지 않고 조용히 종결된다.

이때 `/kiwi-srs` 호출의 **리서치 문서** 인자(`--research-doc`)로 그 wave 의 `design_baseline` 이 가리키는 `excerpt_path` 를 전달하고, 원본 `source_file` 도 함께 넘긴다. wave 본문을 **인라인**으로 넘기는 것만으로는 리서치 검증·개선 루프가 작동하지 않는다 — 그 루프는 경로로 지정된 문서를 분모로 삼기 때문이다. 좌표 매핑 JSON(`design_baseline.path` 가 가리키는 `design-baseline.json`)을 대신 넘기는 것도 같은 이유로 부족하다 — 대조할 산문이 없으면 그 루프가 갭을 만들지 못한다. 전달하는 경로는 `waves.jsonl` 에 기록한 것과 **같은** 경로다 — 증거 번들과 저작 입력이 갈라지면 두 계층이 서로 다른 설계를 본다.

같은 호출에 `constraints_path` 아티팩트를 `--constraints-doc` 인자로 전달한다 — 저작 입력에 없는 제약은 검증에서 잡혀도 반영할 근거가 없고, 인라인 전달은 §4 가 바로 앞에서 부정한 경로다.

그 wave 의 `existing_modules` 도 같은 호출의 **저작 입력**으로 전달한다 — 검증자만 읽는 목록은 무엇이 저작되는지를 바꾸지 못한다.

---

## 2. 저작 완료 표식 — 멱등 재개

그 wave 의 이벤트 중 `srs_authored` = `true` 를 실은 줄이 **하나라도** 있으면 본 절과 target 등록을 건너뛰고 곧바로 pipeline 단계(§5)로 들어간다 — 저작은 이미 끝났고, 다시 돌리면 같은 요구를 두 번 저작한다. 저작을 마친 직후 `phase="srs-authoring"` 이벤트에 그 표식을 실어 append 하며, **표식 없는 줄**은 `srs-authoring` 줄만 저작 진행 중으로 읽는다 — wave-verify 줄에는 그 표식이 없는 것이 정상이므로, 최신 줄 하나로 판정하면 검증 기록 뒤마다 저작이 되살아난다.
