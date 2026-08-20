# ADR-0054: 검색 추천과 managed context 선택 경계

- 상태: 채택
- 날짜: 2026-08-20

## 배경

어휘 검색 결과를 곧바로 모델 입력으로 넣으면 `recommended`, `selected`, `loaded`, `injected`가 한 단계처럼 보인다. 검색 순위는 문서를 살펴볼 후보를 제안할 뿐이며, 실제 선택 정책과 현재 원본 적재, provider 전달을 대신할 수 없다. 반대로 검색 결과와 managed run을 연결하지 않으면 어떤 추천이 실제 context 선택에 영향을 주었는지 재구성할 수 없다.

첫 연결은 검색 시도의 bounded hit와 선택 정책을 하나의 검증 가능한 묶음으로 만들고, context preparation이 이 묶음을 별도 입력으로 받게 한다.

## 결정

### 검색 추천 묶음

`@lervo/search`의 `SearchRecommendationBatch`는 원본 `SearchAttempt`, 추천 한도와 `top_ranked-v1` 선택 정책을 결속한다. 첫 정책은 검색 결과 중 document source만 최대 5개 추천하고 순위가 앞선 최대 3개를 선택한다. Skill과 verified knowledge hit는 해당 원본을 context loader가 안전하게 읽는 계약이 생기기 전까지 추천 묶음에서 제외한다.

각 추천은 결정적 recommendation ID와 batch ID, search attempt·engine·index·result-set 좌표, document ID·검색 당시 content hash·rank·score를 가진다. Raw query, 정규화 term, 문서 경로·제목·label·본문은 넣지 않는다. 묶음 검증은 attempt ID와 hash, 추천 순서, 선택 정책과 선택 ID를 모두 다시 계산한다. 호출자가 추천이나 선택 ID를 바꾸면 context 입력으로 사용할 수 없다.

### Context 상태 분리

`@lervo/context`는 최대 8개 batch와 전체 50개 추천만 받는다. 모든 추천 문서는 E0 discovery와 별도 `recommended` evidence를 얻는다. 정책이 선택한 recommendation ID만 `reasonCode=search_recommendation`과 `ruleId=search_recommendation:<recommendationId>`로 E1이 된다. 선택되지 않은 추천은 plan의 필수 문서, E2와 E3가 되지 않는다.

선택된 문서는 검색 당시 content hash를 기대값으로 가진다. 실제 파일을 읽었을 때 hash가 달라졌다면 다른 선택 이유가 함께 있더라도 부분 context를 만들지 않고 검색부터 다시 수행한다. E2는 현재 원본 bytes를 실제로 읽은 뒤, E3는 provider adapter receipt를 검증한 뒤에만 기존 계약으로 생긴다. 어느 단계도 문서가 모델에 의해 이해되거나 사용됐다고 주장하지 않는다.

### Managed run 조합

로컬 `lervo run`은 provider를 시작하기 전에 작업 문장을 NFKC 문자·숫자 단어 최대 32개·500자로 결정적으로 투영해 등록 문서를 검색한다. 작업 문장에 검색 가능한 단어가 없을 때만 예상 경로를 같은 방식으로 사용한다. Search attempt의 digest와 크기는 이 bounded 투영 질의를 뜻하며 전체 작업 문장을 복제하지 않는다. Attempt는 기존 mode `0600` 항목별 로컬 원본에 기록하고 추천 묶음을 managed context input port에 전달한다. 결과가 없으면 빈 attempt만 남기고 기존 경로·역할·지침 선택으로 실행을 계속한다.

실행 결과는 attempt ID, 추천·선택 수와 선택된 document ID를 보여준다. 사용자는 이 좌표로 기존 `lervo search assess`를 명시적으로 실행할 수 있다. 추천 수, 자동 선택, E2/E3와 run 성공만으로 검색 품질 assessment를 만들지 않는다.

## Event와 개인정보

새 `context.recommended` event의 필수 payload는 다음과 같다.

- `recommendationId`, `batchId`, `sourceAttemptId`
- `engineId`, `engineVersion`, `indexId`, `resultSetHash`
- `documentId`, `sourceContentHash`, `rank`, `score`
- `selectionPolicyId`, `selectionPolicyVersion`, `selectionMaximum`

Event에는 raw query·query digest, 문서 path·title·label·본문, prompt, provider 응답과 credential을 넣지 않는다. Search attempt 원본은 Hub에 보내지 않는다. `context.recommended`는 managed run의 로컬 append-only 실행 원본이므로 Hub가 구성된 프로젝트에서는 다른 allowlist 실행 event와 같은 sync 경계를 따르지만, 추천되었다는 사실만 전달한다. `context.selected`, `document.loaded`, `context.injected`는 각각 별도 event로 남는다.

## 실패 의미

- `invalid_recommendation`: 추천 묶음의 attempt·ID·순위·정책·선택 관계가 다르다. Context plan과 추천 event를 만들지 않는다.
- `invalid_search_recommendation`: batch 수·전체 추천 수, project·시각, registry 문서 또는 중복 좌표가 현재 context와 맞지 않는다. 일부 추천만 선택하지 않는다.
- `content_hash_mismatch`: 선택된 추천의 검색 당시 hash와 현재 파일 bytes가 다르다. E2/E3와 provider 실행을 시작하지 않고 새 검색을 요구한다.
- `corpus_read_failed` / `observation_write_failed`: managed run 검색 원본을 완전하게 읽거나 attempt를 기록하지 못했다. Provider를 시작하지 않으며 검색 연결을 생략한 정상 run으로 위장하지 않는다.

## 결과와 한계

첫 정책은 어휘 순위 상위 문서를 bounded하게 선택하는 로컬 기본값이다. 역할별 검색 정책, 사용자별 opt-out, skill·verified knowledge loader와 의미 검색 비교는 포함하지 않는다. 자동 선택이 검색 품질의 수락을 뜻하지 않으므로 실제 assessment가 쌓이기 전에는 정책 확대나 임베딩 도입을 결정하지 않는다.

## 검증

- Search attempt에서 recommendation·batch ID와 top-ranked 선택을 결정적으로 재계산
- 추천 2개 중 선택 1개만 E1/E2가 되고 나머지는 `recommended`에 머무름
- 선택 후 원본 hash 변경 시 부분 context 없이 실패
- `context.recommended` payload에서 query·path·본문 제거와 필수 좌표 검증
- Codex·Claude managed run에서 local attempt → recommendation → selected → loaded → injected 수직 흐름
- 실행 결과의 attempt ID로 별도 assessment가 가능하되 자동 assessment는 생성하지 않음
