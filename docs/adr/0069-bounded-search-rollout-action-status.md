# ADR-0069: 제한된 검색 rollout 조치 상태 조회

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

후보 유지 확인은 독립 acknowledgement이고 정책에 따라 실행한 rollback은 schema v3 엔진 선택 전이입니다. 두 원본의 저장 위치와 형태가 달라 운영자가 어떤 검토에 어떤 조치가 있었는지 확인하기 어렵습니다. 일부 손상된 원본을 건너뛴 목록은 실제 조치 이력을 정상처럼 보이게 할 수 있습니다.

## 결정

`lervo search rollout action status`는 keep acknowledgement와 schema v3 rollback만 하나의 읽기 전용 상태 페이지로 조합합니다. 기존 일반 rollback은 rollout 조치 정책을 증명하지 않으므로 포함하지 않습니다. 기본 20개, 최대 50개를 조치 시각과 ID 역순으로 반환하고 다음 cursor는 현재 페이지 마지막 action ID에 결속합니다.

각 항목은 조치 원본, 연결된 rollout 검토, 조회 시각에 다시 만든 품질 snapshot을 가집니다. 검토 대상 전이가 현재 head인지와 schema v3 rollback 전이 자체가 현재 head인지를 별도 관계로 표시합니다. 품질 입력 변경은 snapshot ID가 아니라 attempt·assessment 입력 digest로 구분합니다.

페이지를 자르기 전에 모든 acknowledgement와 전체 엔진 선택 chain을 검증합니다. Keep은 action·review policy, candidate review, 조치 당시 선택 head와 품질 입력을 다시 확인합니다. Schema v3 rollback은 기존 운영 resolver와 같은 정책·검토·품질 검증을 통과해야 합니다. 따라서 요청한 페이지 밖의 증거가 끊겨도 일부 결과를 반환하지 않습니다.

## 실패와 정보 경계

입력·limit·cursor·조합 관계 오류는 `invalid_rollout_action_status`입니다. 로컬 정책·검토·선택·품질 원본이 없거나 변조되면 기존 구체 오류로 전체 조회를 실패시킵니다. 조회는 파일, 선택 전이, acknowledgement, 승인, event와 Hub sync를 만들지 않습니다.

응답은 로컬 operator·reviewer ID, 정책·검토·선택 ID, 시각과 품질 집계를 포함할 수 있습니다. Query와 query digest, nonce, index·result-set hash, 문서 좌표·본문, prompt, provider 결과, credential과 verification receipt는 포함하지 않습니다.

## 결과

운영자는 서로 다른 불변 원본을 한정된 목록에서 함께 볼 수 있습니다. 조회는 최신 항목을 실행 대상으로 고르지 않으며, 손상된 과거 증거를 pagination으로 숨길 수 없습니다. 전체 원본 수 경계 안에서 먼저 검증하므로 원본 수에 비례한 읽기 비용이 있습니다.
