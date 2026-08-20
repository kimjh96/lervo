# ADR-0064: 선택에 결속된 운영 검색 품질 관측

- 상태: 채택
- 날짜: 2026-08-20

## 배경

기존 검색 품질 report는 명시적으로 평가된 attempt를 전체 합계로 보여 주지만, 어떤 검색 엔진 선택에서 나온 결과인지 분리하지 않았습니다. 후보 선택과 rollback 뒤 baseline의 관측이 섞이면 특정 후보나 build의 품질로 오해할 수 있습니다. Build ID나 replay receipt를 attempt에 새로 복제하면 이미 immutable selection·review에 있는 좌표가 여러 원본으로 퍼지고 legacy attempt hash도 바뀝니다.

## 결정

`SearchSelectionQualityReport` v2를 파생 report로 추가합니다. 기존 전체 시도·평가·미평가·수락·실패 및 사유별 합계를 유지하고, attempt의 nullable `selectionTransitionId`별 slice를 함께 반환합니다. 전이 없는 lexical 시도는 `implicit_baseline`, candidate activation·refresh 시도는 `candidate`, baseline을 선택한 rollback 시도는 `recorded_baseline`으로 구분합니다.

로컬 조합은 attempt·assessment 전체와 선택 chain을 읽고 schema·content ID·project·시간·engine 관계를 다시 확인합니다. 선택 chain은 정책·review·comparison으로 검증하고, 후보 slice의 adapter build ID는 activation이 가리키는 review에서 파생합니다. V2 review는 `bound`, v1 legacy review는 `legacy_unbound`, baseline은 `not_applicable`입니다. Attempt, assessment와 선택 원본에 build ID나 verification receipt를 새로 쓰지 않습니다. Attempt가 없는 선택 전이는 빈 slice로 만들지 않습니다.

각 slice는 명시적 assessment만 집계합니다. 미평가 attempt는 미평가로 남고, 빈 결과·클릭·추천·context 선택·provider 실행·verification 성공으로 assessment를 만들지 않습니다. `no_failures_observed`는 평가된 범위에 실패가 없었다는 뜻일 뿐 표본 충분성이나 rollout 성공이 아닙니다. `rolloutDecision`, `rollbackDecision`, `embeddingDecision`은 항상 `not_determined`이며 report가 선택 전이·정책·문서를 수정하거나 자동 rollback을 만들지 않습니다.

## 개인정보와 실패 의미

Slice에는 선택 전이 ID, 공개 engine 좌표, nullable adapter build ID와 수량 집계만 둡니다. Raw query와 digest, nonce, index·result-set hash, source ID·content hash·path·본문, prompt, provider 응답, credential과 verification receipt는 출력하지 않습니다. Report는 로컬 파생 조회이며 새 파일·event·Hub 원본을 만들지 않습니다.

Attempt가 가리키는 전이가 없거나 engine이 선택과 다르거나 policy·review·comparison chain을 검증할 수 없으면 기존 `invalid_attempt`, `invalid_assessment` 또는 로컬 `observation_invalid`·`engine_selection_unavailable` 의미로 전체 조회를 실패시킵니다. 일부 선택만 빼고 정상 report처럼 반환하지 않습니다.

## 검증

- 전이 없는 baseline, build-bound candidate와 rollback baseline attempt를 서로 다른 slice로 집계함
- Candidate build ID를 attempt에 복제하지 않고 검증된 review 원본에서 다시 찾음
- 평가·미평가, 수락·실패와 controlled 실패 사유가 전체와 slice에서 일치함
- 평가된 실패가 없더라도 rollout·rollback·embedding 결정을 만들지 않음
- 존재하지 않는 선택 전이, engine 불일치와 변조된 chain에서 일부 report를 반환하지 않음
- Report 출력에 query·문서 좌표·receipt를 추가하거나 새 원본을 저장하지 않음
