# ADR-0065: 사람의 검색 rollout 검토와 실행 경계

- 상태: 채택
- 날짜: 2026-08-20

## 배경

선택 전이별 품질 report는 후보 검색 엔진에서 실제로 관측된 시도와 평가를 분리하지만 rollout이나 rollback을 결정하지 않습니다. 사람이 이 관측을 검토한 결과도 report의 파생 필드를 바꾸거나 선택 전이에 덧붙이면 당시 입력과 판단의 경계가 사라집니다. 표본 수나 허용 실패 기준을 아직 정의하지 않은 상태에서 수치만으로 결론을 계산하는 것도 안전하지 않습니다.

## 결정

`SearchRolloutReview` v1을 별도 content-bound 원본으로 둡니다. 검토자는 현재 선택된 build-bound 후보 전이 하나에 대해 `keep_candidate`, `rollback_recommended`, `more_assessments_required` 중 하나를 명시합니다. 원본은 project, 선택 전이, candidate·engine·adapter build·기존 후보 review, reviewer와 검토 시각을 결속합니다.

검토 시점의 해당 전이 attempt와 assessment ID를 정렬해 `inputDigest`를 만들고, 전체·평가·미평가·수락·실패와 controlled 실패 사유를 `SearchRolloutQualitySnapshot`에 고정합니다. Snapshot과 검토는 각각 내용 기반 ID를 가집니다. 이후 attempt나 assessment가 추가되어도 기존 snapshot과 검토 파일을 수정하지 않습니다.

이 ADR의 v1에는 최소 표본과 허용 실패 정책이 없으므로 `thresholdPolicyState=not_defined`입니다. 이후 정책 결속 v2는 [ADR-0067](./0067-policy-bound-search-rollout-review.md)에서 별도로 확장하며 v1을 소급 변경하지 않습니다. 세 판단은 사람이 명시한 검토 결과이며 수치에서 자동 도출한 승인이나 실행 지시가 아닙니다. 원본은 `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`를 항상 기록합니다. 롤백 권고를 실제 rollback으로 실행하거나 후보 유지 판단을 운영 승인으로 사용하려면 별도 정책과 명시적 명령이 필요합니다.

로컬 조합은 전체 선택 chain과 품질 원본을 다시 검증하고 현재 head가 같은 후보 전이인지 확인합니다. Attempt가 없거나 baseline·과거 전이·legacy-unbound 후보이면 검토를 만들지 않습니다. 검토는 `.lervo/state/search/rollout-reviews/<rolloutReviewId>.json`에 최대 256개를 항목별 immutable mode `0600` 파일로 저장합니다. 한 파일에 이력을 누적하거나 event·Hub 원본으로 승격하지 않습니다.

## 개인정보와 실패 의미

검토 원본에는 raw query와 digest, nonce, index·result-set hash, source ID·content hash·path·본문, prompt, provider 응답, credential과 verification receipt를 넣지 않습니다. Reviewer ID는 로컬 운영 식별자이므로 gitignore 대상 mode `0600` 상태 파일에만 두며 Hub로 보내지 않습니다. `inputDigest`는 attempt·assessment ID 목록의 canonical hash이고 목록 자체는 복제하지 않습니다.

형식·내용·snapshot 관계가 다르면 `invalid_rollout_review`, 현재 후보 전이가 아니거나 attempt가 없거나 build에 결속되지 않으면 `rollout_review_not_eligible`로 전체 작업을 실패시킵니다. 파일 읽기·쓰기·충돌·개수 초과는 기존 `observation_*` 오류를 유지합니다. 실패해도 선택 전이, attempt, assessment와 기존 rollout 검토를 수정하지 않습니다.

## 검증

- 입력 순서가 달라도 같은 품질 snapshot과 검토 ID를 만듦
- 나중에 추가된 attempt·assessment를 기존 snapshot 근거로 조용히 포함하지 않음
- 현재 build-bound 후보 전이와 하나 이상의 실제 attempt만 검토함
- 세 사람 판단을 표본 기준이나 자동 eligibility로 해석하지 않음
- 검토 생성 전후 검색 선택 chain이 바뀌지 않고 rollback도 실행되지 않음
- Rollback 뒤에도 기존 검토 파일이 그대로 남고 과거 전이에 새 검토를 만들지 않음
- 원본에 query·문서 좌표·provider 결과·credential을 저장하거나 event·Hub sync를 만들지 않음
