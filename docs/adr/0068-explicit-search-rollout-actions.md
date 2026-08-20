# ADR-0068: 명시적 검색 rollout 조치와 원자적 rollback

- 상태: 채택
- 날짜: 2026-08-20

## 배경

정책을 충족한 rollout 검토도 사람의 판단 기록일 뿐 실행 권한이 아닙니다. 검토를 곧바로 후보 유지나 rollback으로 적용하면 reviewer와 operator의 책임이 섞이고, 검토 뒤 품질 입력이나 현재 선택이 달라진 상태에서 오래된 판단을 실행할 수 있습니다. Rollback 전이와 별도 조치 파일을 차례로 쓰면 둘 중 하나만 남는 부분 완료도 생깁니다.

## 결정

`SearchRolloutActionPolicy` v1을 검토 정책과 분리합니다. 정책 하나는 정확한 rollout 검토 정책, `acknowledge_keep` 또는 `execute_rollback` 한 가지 조치, 허용 operator와 작성 시각을 고정합니다. Rollback 정책은 기존 검색 엔진 활성화 정책 하나도 결속하며 허용 operator가 그 엔진 정책 범위를 넓힐 수 없습니다. 후보 유지 정책은 엔진 정책을 갖지 않습니다.

조치 정책은 `.lervo/search-rollout-action-policies/<actionPolicyId>.yaml`에 최대 64 KiB, 전체 최대 32개, mode `0600` 불변 파일로 둡니다. 정책 이력을 한 파일에 누적하거나 검토 정책에 실행 권한 필드를 덧붙이지 않습니다.

조치는 최신 검토를 자동 선택하지 않고 rollout review ID, 조치 종류, 조치 정책과 operator를 명시적으로 받습니다. 실행 직전에 다음을 모두 확인합니다.

- 검토가 exact rollout 정책에 결속된 v2이며 당시 판단이 그 정책을 충족함
- 유지 확인은 `keep_candidate`, rollback은 `rollback_recommended` 검토만 사용함
- 검토 대상 선택 전이가 여전히 현재 head임
- 조치 시각까지의 attempt·assessment 입력 digest가 검토 snapshot과 같음
- 조치 정책과 operator 범위가 맞고 rollback은 엔진 정책도 같은 operator를 허용함

후보 유지 확인은 `SearchRolloutKeepAcknowledgement`를 `.lervo/state/search/rollout-acknowledgements/<acknowledgementId>.json`에 최대 256개, 항목별 mode `0600` 파일로 기록합니다. 이 원본은 `acknowledgement_recorded`만 주장하며 선택 변경·rollback·승인을 만들지 않습니다.

Rollback은 별도 조치 receipt를 쓰지 않습니다. 기존 선택 전이의 schema v3가 action policy, rollout policy·review, 조치 시각의 quality snapshot·input digest를 함께 내용 기반 ID에 결속합니다. 기존 engine policy의 operator·fallback 검증과 같은 previous-head CAS 게시를 사용하므로 rollback과 rollout 근거가 하나의 immutable 전이로 공개됩니다. 기존 schema v1·v2 전이는 수정하지 않습니다.

선택 chain을 소비할 때 schema v3 근거를 구조만 확인하지 않습니다. 조치·검토·엔진 정책, 후보 검토, 검토 당시와 rollback 당시 attempt·assessment를 다시 읽어 exact snapshot과 digest를 재생성합니다. 하나라도 없거나 다르면 운영 resolver는 `engine_selection_unavailable`로 닫고 baseline으로 조용히 대체하지 않습니다.

## 개인정보와 실패 의미

조치 정책과 원본에는 project, 정책·검토·선택·snapshot ID, input digest, 로컬 operator ID와 시각만 들어갑니다. Raw query·nonce, 문서 좌표·본문, prompt, provider 응답, credential, 검색 결과와 verification receipt는 넣지 않습니다. Operator ID는 로컬 운영 식별자이므로 비밀정보나 외부 계정 원문을 사용하지 않아야 합니다. 새 event와 Hub sync 원본은 만들지 않습니다.

조치 정책 계약은 `invalid_rollout_action_policy`, acknowledgement 계약은 `invalid_rollout_action`, 현재 head·입력·판단·operator 불일치는 `rollout_action_not_eligible`입니다. 로컬 정책 형식·조회·읽기·쓰기는 `rollout_action_policy_invalid`, `rollout_action_policy_not_found`, `rollout_action_policy_read_failed`, `rollout_action_policy_write_failed`입니다. Schema v3 근거 재검증 실패는 `observation_invalid`를 거쳐 운영에서 `engine_selection_unavailable`로 드러납니다. 실패하면 기존 검토·정책·선택·품질 원본을 수정하지 않습니다.

## 검증

- 검토 정책과 operator 조치 정책을 분리하고 rollback operator를 엔진 정책과 교차 확인함
- 명시한 review ID와 조치 종류만 사용하고 최신 판단을 자동 선택하지 않음
- 유지 검토 뒤 입력이 추가되면 오래된 유지 확인을 거부함
- 유지 확인은 별도 원본만 만들고 검색 엔진 선택 파일을 늘리지 않음
- 새 rollback 검토는 근거와 전이를 schema v3 파일 하나로 원자적으로 게시함
- Rollback 뒤 같은 검토를 다시 실행하지 못함
- Schema v3 digest를 내용 기반 ID와 함께 바꿔도 원본 재생성 검증에서 운영 선택을 닫음
- Query·문서 좌표·provider 결과·credential을 저장하거나 event·Hub sync를 만들지 않음
