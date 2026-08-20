# ADR-0063: 검색 adapter build identity와 재생성 가능한 검증 receipt

- 상태: 채택
- 날짜: 2026-08-20

## 배경

Candidate ID와 engine ID/version만으로는 현재 등록된 adapter 구현이 비교·검토 당시 구현과 같은지 구분할 수 없습니다. 구현이 바뀌어도 같은 입력에서 우연히 같은 run과 index를 만들 수 있으며, 이를 같은 build의 재현으로 받아들이면 선택 증거의 범위가 실제보다 넓어집니다. 반대로 매 운영 검증 결과를 새 파일로 저장하면 같은 파생 상태가 계속 쌓이고 원본과 파생 인덱스의 경계도 흐려집니다.

## 결정

모든 `SearchEnginePort`는 engine 좌표와 별도로 content-bound `adapterBuildId`를 선언합니다. 정적 registry는 candidate ID, engine 좌표와 build ID의 형식·중복을 모두 확인합니다. `lervo search candidates`도 공개 가능한 build ID를 표시합니다. Adapter release manifest가 실행 동작이나 의존성이 달라질 때 이 ID를 갱신할 책임을 갖습니다. Lervo는 선언된 build ID만으로 module bytes, 서명이나 공급망 동일성을 주장하지 않습니다.

신규 `SearchEvaluationComparison`과 `SearchCandidateReview`는 schema v2로 adapter build ID를 content ID에 포함합니다. Review, activation, refresh와 현재 후보 resolver는 비교·검토·registry의 build ID를 후보 호출 전에 맞춥니다. ID가 없거나 다르면 `evaluation_candidate_build_mismatch`로 중단하고 baseline으로 낮추지 않습니다. 신규 활성화와 refresh에는 v2 review·comparison이 필요합니다.

기존 v1 comparison과 review는 필드를 삽입하거나 content ID를 다시 계산하지 않고 계속 읽습니다. 이미 기록된 legacy 선택은 기존 replay 의미로 검증할 수 있지만 v1 원본에서 새 검토·활성화·refresh를 만들지는 않습니다. 더 강한 build 결속이 필요하면 현재 adapter로 새 comparison과 review를 만들어야 합니다.

V2 후보 replay가 성공하면 `SearchCandidateVerificationReceipt`를 project·candidate·engine·adapter build·comparison·review·corpus·run·index 좌표에서 결정적으로 만듭니다. 같은 원본은 같은 receipt ID를 만듭니다. Receipt는 별도 파일, event나 Hub 원본으로 저장하지 않으며 일반 검색 결과와 status에는 nullable ID만 반환합니다. 이는 resolver가 해당 좌표를 replay했다는 파생 확인일 뿐 query 실행, 결과 사용이나 검색 품질 증거가 아닙니다.

## 개인정보와 실패 의미

Build ID와 receipt에는 query, query digest, 문서 path·본문, prompt, provider 응답, credential과 내부 추론을 넣지 않습니다. Project·candidate·engine과 기존 comparison·review·run·index·corpus 좌표만 사용합니다. 새 event와 Hub sync는 없습니다.

`evaluation_candidate_build_mismatch`는 저장된 v2 비교·검토의 build ID가 없거나 현재 registry와 다르므로 후보를 실행하지 않았다는 뜻입니다. 운영 resolver에서는 기존 `engine_selection_unavailable` 경계로 감싸 attempt·recommendation·provider 시작 전에 중단합니다. 형식이 잘못된 build ID는 `invalid_evaluation_engine`, 변조된 comparison·review·receipt는 각각 기존 `invalid_evaluation_comparison` 또는 `invalid_candidate_review`입니다.

## 검증

- Registry와 공통 adapter 계약이 올바른 build ID를 요구하고 중복을 거부함
- 신규 comparison·review가 build ID를 content ID에 포함하고 기존 v1 원본은 ID를 바꾸지 않고 검증됨
- 같은 engine ID/version과 같은 응답 구현이라도 build ID가 달라지면 review와 운영 replay 전에 중단함
- 현재 build의 replay가 같은 receipt ID를 재생성하고 receipt 파일이나 event를 만들지 않음
- 운영 status와 검색 결과가 후보 receipt ID를 반환하되 baseline과 실패 상태는 null을 유지함
