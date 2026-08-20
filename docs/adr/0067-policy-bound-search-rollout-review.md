# ADR-0067: 정책에 결속된 검색 rollout 검토

- 상태: 채택
- 날짜: 2026-08-20

## 배경

기존 rollout 검토는 사람이 당시 관측을 기록하지만 최소 평가 수와 실패 기준을 정의하지 않습니다. 나중에 만든 기준으로 과거 검토를 다시 해석하면 당시 판단의 의미가 바뀌고, 수치만 보고 결정을 자동 선택하면 사람 검토와 실제 실행 경계도 사라집니다.

## 결정

`SearchRolloutReviewPolicy` v1을 project별 불변 원본으로 둡니다. 정책은 허용 검토자·후보, 후보 유지에 필요한 최소 평가 수와 최대 실패 수, 롤백 권고에 필요한 최소 평가 수와 최소 실패 수를 고정합니다. 후보 유지의 최대 실패 수는 롤백 권고의 최소 실패 수보다 작아야 하며, 작성자는 허용 검토자에 포함되어야 합니다. `more_assessments_required`는 정책·검토자·후보 결속이 맞으면 항상 허용합니다.

정책은 `.lervo/search-rollout-policies/<policyId>.yaml`에 정책별 최대 64 KiB, 전체 최대 32개, mode `0600` 파일로 저장합니다. 내용 기반 ID를 검증하고 파일명과 ID가 다르거나 일반 파일이 아니거나 심볼릭 링크이면 전체 읽기를 닫습니다. 한 파일에 정책 이력을 누적하거나 기존 정책을 덮어쓰지 않습니다.

정책을 명시한 새 `SearchRolloutReview`는 schema v2로 만들고 정확한 `rolloutPolicyId`와 `thresholdPolicyState=bound`를 내용 기반 ID에 포함합니다. 정책은 검토보다 먼저 만들어졌어야 하며 project·검토자·후보와 사람이 고른 판단의 수치 기준이 모두 맞아야 검토 파일을 게시합니다. 기준을 충족하지 못하면 검토를 다른 판단으로 바꾸지 않고 기록을 거부합니다.

기존 schema v1 검토는 `thresholdPolicyState=not_defined`인 원본 그대로 읽고 `legacy_unbound`로 판정합니다. 나중에 만든 정책을 붙이거나 새 기준으로 소급 해석하지 않습니다. 다른 정책에 묶인 v2 검토도 `different_policy`로 구분합니다.

`lervo search rollout policy check`는 저장된 검토 snapshot이 지정한 정책에 맞았는지만 다시 계산하는 읽기 전용 조회입니다. 이후 attempt·assessment가 추가됐는지는 판단하지 않으며 그 상태는 `search rollout status`로 별도 확인합니다. 정책 확인은 결정을 대신 선택하지 않고 선택 유지, rollback 또는 승인을 실행하지 않습니다.

## 개인정보와 실패 의미

정책에는 project ID, 허용 검토자·후보 ID, 작성자 ID, 수치 기준과 시각이 들어갑니다. Raw query·digest, nonce, 문서 좌표·본문, prompt, provider 응답, credential, 검색 결과와 verification receipt는 넣지 않습니다. 검토자·작성자 ID는 커밋될 수 있는 로컬 정책 식별자이므로 비밀정보나 외부 계정 원문을 사용하지 않아야 합니다. 정책·판정은 새 event나 Hub sync 원본을 만들지 않습니다.

형식·내용·ID·목록·수치가 잘못되면 `invalid_rollout_policy`, 로컬 파일 형식·조회·읽기·쓰기는 각각 `rollout_policy_invalid`, `rollout_policy_not_found`, `rollout_policy_read_failed`, `rollout_policy_write_failed`입니다. 결속·시각·범위·수치가 맞지 않아 검토를 게시할 수 없으면 `rollout_review_not_eligible`입니다. 판정 결과는 `policy_not_bound`, `policy_mismatch`, `policy_created_after_review`, `reviewer_not_allowed`, `candidate_not_allowed`, `insufficient_assessed_attempts`, `too_many_failed_attempts`, `too_few_failed_attempts`를 조합해 설명합니다. 실패해도 정책·검토·선택·품질 원본은 수정하지 않습니다.

## 검증

- 허용 검토자·후보와 서로 겹치지 않는 유지·롤백 수치 기준을 내용 기반 정책에 고정함
- 정책보다 늦은 검토와 정확한 policy ID 결속만 허용함
- 기준 미충족 검토는 파일을 남기지 않고 다른 판단으로 자동 변경하지 않음
- 기존 v1 검토를 `legacy_unbound`, 다른 정책의 v2 검토를 `different_policy`로 구분함
- 정책별 immutable YAML과 검토별 immutable JSON을 분리하고 기존 엔진 정책 저장 경계도 그대로 유지함
- 판정은 저장 당시 snapshot만 확인하며 현재 입력 변경을 숨기거나 실행·승인을 만들지 않음
- Query·문서 좌표·provider 결과·credential을 정책이나 판정에 추가하지 않음
