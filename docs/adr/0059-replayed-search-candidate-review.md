# ADR-0059: 재현 검증을 거치는 검색 후보 검토

- 상태: 채택
- 날짜: 2026-08-20

## 배경

후보 비교가 특정 표본에서 더 나은 결과를 보여도 그 관측만으로 운영 검색을 바꿀 수는 없습니다. 비교 뒤 bundle이나 문서가 바뀌었을 수 있고, 같은 engine 이름을 가진 구현이 다른 결과를 낼 수도 있습니다. 관측 결과와 사람의 채택·기각 판단을 한 필드에 섞으면 누가 어떤 원본을 보고 결정했는지도 잃습니다.

검토 단계는 기존 비교를 다시 확인하고 후보가 같은 결과를 내는지 재현한 뒤, 운영 활성화와 분리된 작은 결정 원본을 남겨야 합니다.

## 결정

### 전체 비교 원본 재확인

검토기는 요청한 comparison ID를 안전한 고정 패턴으로 확인한 뒤 해당 파일만 읽습니다. Comparison의 content ID를 확인하고 현재 case·bundle·coverage·등록 문서 corpus, baseline과 candidate run, 두 run의 모든 result를 다시 읽습니다. 같은 project, bundle ID·hash, coverage, corpus digest, 활성 case, 평가 시각, engine·index·run과 case별 result·집계가 아니면 검토를 만들지 않습니다.

CLI는 comparison에 기록된 candidate engine 좌표를 정적 allowlist에서 해석합니다. Candidate ID를 파일 경로, package, URL 또는 동적 import로 해석하지 않습니다.

### 후보 재현과 결정

현재 등록 후보를 비교 당시 corpus, 활성 case와 평가 시각으로 한 번 재실행합니다. 공통 평가 계약을 다시 통과하고 새 run ID가 기존 candidate run ID와 정확히 같을 때만 replay를 `matched`로 기록합니다. Engine 이름이나 실행 성공만으로 같은 결과라고 추정하지 않습니다.

Reviewer는 `adopt_candidate`, `reject_candidate`, `more_samples_required` 중 하나를 명시합니다. 관측 집계는 결정을 자동 생성하지 않습니다. 첫 채택 gate는 후보 승리가 하나 이상이고 baseline 승리가 0인 비교만 허용합니다. 이 조건은 채택을 보장하는 정책이 아니라 명백한 무개선과 관측 회귀를 다음 활성화 단계로 넘기지 않는 최소 조건입니다.

채택 검토의 `promotionReadiness`는 `eligible_for_activation_review`, 기각은 `rejected`, 표본 추가 결정은 `more_evidence_required`입니다. 어느 값도 운영 engine을 바꾸지 않습니다.

### 항목별 immutable 원본

`SearchCandidateReview`는 comparison·bundle·coverage·corpus, candidate ID·engine, 기존·재현 run ID, reviewer·검토 시각·결정, 전체 case와 승·패·동률, 비교·재현 확인 상태를 content-bound review ID에 묶습니다. `.lervo/state/search/evaluation-reviews/<reviewId>.json`에 mode `0600`으로 게시하며 기존 검토를 덮어쓰거나 하나의 이력 파일에 덧붙이지 않습니다.

여러 reviewer나 후속 검토가 있으면 각 결정은 독립 원본으로 남습니다. 어떤 검토가 현재 운영 선택을 지배하는지는 이번 단계에서 정하지 않습니다. 모든 검토는 `activationState=not_applied`, `embeddingDecision=not_determined`입니다.

## 개인정보와 Event

Reviewer ID는 project-local 검토 원본에만 남습니다. Query, 문서 본문·path, prompt, provider 응답과 credential은 comparison이나 review에 복제하지 않습니다. 후보 재현에는 로컬 corpus와 case query를 메모리에서 사용하지만 새 원문 저장소를 만들지 않습니다.

새 event와 Hub sync는 없습니다. 검토는 verification, context `selected`·`loaded`·`injected`·`used`, 임베딩 필요성이나 운영 활성화 증거가 아닙니다.

## 실패 의미

- `evaluation_comparison_not_found`: 요청한 comparison ID가 유효하지 않거나 안전하게 읽을 비교 디렉터리·원본이 없습니다.
- `invalid_evaluation_comparison`: comparison이 현재 bundle·coverage·case·corpus·run·result 원본과 다릅니다.
- `evaluation_candidate_not_registered`: comparison의 candidate engine이 현재 정적 allowlist에 없습니다.
- `evaluation_candidate_failed`: 후보 재실행이 실패했거나 engine·index·응답 계약을 지키지 않습니다.
- `invalid_candidate_review`: reviewer·candidate·재현 run, 합계, 상태 또는 content-bound review ID가 유효하지 않습니다.
- `candidate_review_not_eligible`: 후보 승리가 없거나 baseline 승리가 있어 채택 검토의 최소 조건을 충족하지 않습니다.
- `observation_write_failed` / `observation_conflict`: 검토 원본을 immutable하게 게시하지 못했습니다. 완료된 검토를 주장하지 않습니다.

검토 게시 전 실패하면 evaluation review 파일을 만들지 않으며 기존 comparison·run·result는 수정하지 않습니다.

## 검증

- Comparison과 현재 bundle·coverage·case·corpus, 두 run·result 전체를 다시 확인함
- 등록 후보를 원래 시각·corpus·case로 재실행하고 같은 run ID인지 확인함
- 일치하지 않는 replay와 현재 원본이 달라진 comparison을 거부함
- 후보 승리와 baseline 무회귀가 함께 있는 경우만 채택 검토를 허용함
- 기각과 표본 추가 필요를 채택 및 관측 결과와 다른 상태로 보존함
- 검토를 query 없는 항목별 immutable 파일로 마지막에 게시함
- 실패한 채택은 검토 파일을 남기지 않음
- 검토 뒤에도 운영 `lexical-v1`, context 상태와 임베딩 판단이 바뀌지 않음
