# ADR-0061: Fail-closed 운영 검색 엔진 선택 해석

- 상태: 채택
- 날짜: 2026-08-20

## 배경

정책에 결속된 선택 전이가 있어도 일반 검색과 managed context가 이를 읽지 않으면 선택은 운영 효과가 없습니다. 반대로 후보를 곧바로 연결하면 adapter 누락, 바뀐 corpus, 변조된 정책이나 재현되지 않는 검토를 숨긴 채 baseline 결과를 반환할 위험이 있습니다. 이 경우 출력만 보면 후보가 사용된 것처럼 오해할 수 있습니다.

평가 baseline은 후보와 비교할 고정 기준이어야 하므로 운영 선택과 분리해야 합니다. 또한 후보가 사용할 수 없을 때도 이미 기록된 baseline rollback은 과거 후보 재실행 없이 복구할 수 있어야 합니다.

## 결정

### 공통 engine 계약과 resolver

평가용 engine·index port를 공급자 중립 `SearchEnginePort`와 `SearchIndexPort`로 일반화하고 기존 평가 이름은 호환 alias로 유지합니다. 일반 검색, managed context와 상태 조회는 `@lervo/search-local`의 같은 resolver를 사용합니다.

선택 전이가 없으면 resolver는 현재 등록 corpus에서 `lexical-v1` index를 만듭니다. 전이가 있으면 전체 append-only chain을 읽고 각 전이를 당시 정책·review·comparison으로 재생성해 content ID와 project 좌표를 확인합니다. 현재 선택이 후보면 정적 registry의 engine으로 현재 corpus, comparison과 review replay를 다시 검증하고 comparison에 결속된 candidate index ID와 같은 index만 반환합니다.

현재 선택이 baseline이면 현재 corpus로 baseline index를 만들며, 과거 후보의 현재 replay는 요구하지 않습니다. 따라서 후보가 사라지거나 corpus가 바뀐 뒤에도 명시적 rollback 전이가 기록되면 baseline으로 복구할 수 있습니다. Evaluation runner와 candidate comparison baseline은 resolver를 사용하지 않고 `lexical-v1`에 고정합니다.

### 실패와 사용 증거

전이가 있는 선택의 chain·정책·review·comparison·registry·현재 corpus·replay·index·응답 중 하나라도 검증되지 않으면 `engine_selection_unavailable`로 실패합니다. 후보 선택을 조용히 baseline으로 대체하지 않고 search attempt, managed recommendation과 provider 실행을 만들지 않습니다. 선택 전이가 없는 baseline의 corpus 오류는 기존 `corpus_read_failed`를 유지합니다.

`SearchAttempt`는 실제 engine과 nullable `selectionTransitionId`를 가집니다. 후보 attempt에는 전이 ID가 필수입니다. 전이 없는 baseline은 null이고 rollback으로 돌아온 baseline은 rollback 전이 ID를 기록합니다. Recommendation과 `context.recommended`도 같은 ID를 이어받습니다. 이 좌표는 선택을 소비한 검색 응답을 증명할 뿐 결과가 `selected`, `loaded`, `injected`, `used`됐거나 모델이 이해했다는 뜻이 아닙니다.

선택 전이는 실제 적용 상태를 영구 필드로 주장하지 않고 `recordState=selection_recorded`만 가집니다. `engine status`는 같은 resolver로 현재 index까지 검증한 경우에만 `resolverState=ready`를 반환합니다. `ready`도 실제 query 실행을 뜻하지 않습니다.

## 개인정보와 저장

새 event와 Hub 원본 종류는 없습니다. 기존 attempt는 항목별 mode `0600` 로컬 원본이며 `context.recommended`는 기존 managed event 수명주기를 따릅니다. 선택 전이 ID와 공개 engine 좌표는 허용하지만 raw query, query digest, 문서 path·본문, prompt, provider 응답과 credential을 추천 event에 추가하지 않습니다. Resolver 오류도 원본 내용을 복제하지 않습니다.

## 검증

- 선택 전이가 없는 저장소가 기존 `lexical-v1` 검색과 null 전이 ID를 유지함
- 검증된 후보 선택을 일반 검색 resolver와 managed context가 같은 engine·전이 ID로 소비함
- 등록되지 않은 후보와 선택 뒤 변경된 corpus가 baseline으로 낮아지지 않고 명시적으로 실패함
- 후보 attempt와 recommendation이 같은 선택 전이 ID를 보존하고 전이 없는 후보 attempt를 거부함
- Rollback 뒤 일반 검색이 lexical engine과 rollback 전이 ID를 기록함
- 상태 조회가 같은 resolver 검증을 통과한 경우에만 `ready`를 반환함
- 평가 실행은 운영 선택과 무관하게 `lexical-v1` baseline을 유지함
- 평가 case와 result 배열 순서가 달라도 `caseId`로 결합해 원본 관계를 검증함
