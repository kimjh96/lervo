# ADR-0053: 결정적 어휘 검색과 명시적 실패 관측

- 상태: 채택
- 날짜: 2026-08-20

## 배경

임베딩이나 RAG를 도입하려면 현재 검색이 어떤 질의에서 왜 부족한지 먼저 알아야 한다. 결과가 0개라는 사실만으로 의미 검색이 필요하다고 결론 내릴 수 없고, 결과를 클릭했다는 신호나 모델의 자체 평가만으로 관련성을 증명할 수도 없다. 검색 인덱스가 원본이 되거나 query·문서 본문이 새 텔레메트리에 복제되어서도 안 된다.

첫 baseline은 등록된 로컬 문서를 대상으로 사람이 재현할 수 있는 어휘 규칙만 사용하고, 검색 시도와 품질 판정을 분리한다.

## 결정

### 검색 원본과 파생 인덱스

`@lervo/search`는 provider, 파일 시스템과 Hub를 모르는 `lexical-v1` 엔진이다. 입력 source는 controlled kind, source ID, content hash, 선택적 project 상대 경로, title·label과 검색 중에만 쓰는 text를 가진다. 첫 로컬 조합인 `@lervo/search-local`은 document registry에 등록된 Markdown 원본만 안전하게 읽는다. 기존 단일 registry도 읽을 수 있지만 원본 migration이나 수정을 수행하지 않는다.

인덱스는 메모리에서 매 요청마다 다시 만든다. NFKC 정규화, Unicode 문자·숫자 term, title·path·label·text별 고정 정수 가중치, exact·부분 일치와 source ID tie-break만 사용한다. `indexId`는 engine version, 정렬된 source ID·path·content hash와 실제 title·label·text 투영 digest에서 결정한다. 모델, 임베딩, 외부 검색 서비스와 시각에 따른 점수는 없다.

검색 엔진 source text는 최대 131,072자이고 첫 로컬 adapter의 문서 원본은 128 KiB, 전체 corpus는 16 MiB다. Source는 최대 4,096개, query는 최대 500자·32개 term, 결과는 최대 50개다. 원본이 없거나 비어 있거나 UTF-8이 아니거나 심볼릭 링크·동시 변경·크기 한도를 통과하지 못하면 일부 corpus로 검색하지 않는다.

결과는 source 좌표·content hash, 순위, 정수 점수와 일치 field만 반환한다. 문서 본문은 결과와 관측 원본에 복제하지 않는다. 검색되었다는 사실은 context `selected`, `loaded`, `injected` 또는 `used`가 아니다.

### 검색 시도와 평가 원본

`SearchAttempt`는 실제 검색 실행 한 번의 로컬 관측 원본이다. 다음 필드를 갖는다.

- project ID, 관측 시각, 충돌 방지 nonce와 내용 결속 attempt ID
- `lexical-v1`, index ID, query digest·문자 수·term 수와 요청 limit
- result-set hash와 source kind·ID·content hash·rank·score만 있는 bounded hits

Raw query, 정규화 term, source path, title·label·본문, prompt, provider 응답과 credential은 attempt에 넣지 않는다. Query digest는 동일 질의를 구분하는 로컬 가명 좌표일 뿐 익명화가 아니며, 낮은 엔트로피의 원문을 추측할 가능성까지 없애지는 않는다. 따라서 Hub로 보내지 않고 mode `0600` 로컬 원본에만 두며 비밀정보 입력을 허용하는 근거로 쓰지 않는다. 같은 원본은 `.lervo/state/search/attempts/<attemptId>.json` 하나에 기록한다.

검색 품질은 별도 `SearchAssessment`가 있을 때만 판정한다. Assessor는 `human` 또는 독립된 `verification`이고 결과는 `accepted` 또는 `failed`다. 수락에는 실제 반환된 source 종류·ID 좌표가 필요하며 선택·기대 원본 모두 두 값을 함께 보존한다. 실패 사유는 `no_results`, `expected_source_missing`, `low_rank`, `results_not_relevant`, `insufficient_context`만 허용한다. `no_results`는 실제 hit가 0개일 때만 쓸 수 있다. 한 attempt에는 하나의 immutable assessment만 `.lervo/state/search/assessments/<attemptId>.json`으로 둔다. 결과 수, 클릭과 모델 응답만으로 assessment를 자동 생성하지 않는다.

원본을 한 파일에 append하지 않는다. Attempt와 assessment는 각각 독립된 파일이며 report는 최대 10,000개를 bounded하게 읽어 ID·hash·project·시간·결과 관계를 전부 다시 확인한다. 자동 삭제나 덮어쓰기는 하지 않으며 이 한도에 도달하면 보존·archive 정책을 정하기 전까지 보고서를 실패시킨다.

### 품질 보고와 도입 판단

`lervo search <query>`는 등록 문서를 검색하고 attempt를 기록한다. `lervo search assess`는 사람이 명시한 판정을 별도 원본으로 기록하고 `lervo search report`는 전체·평가·미평가·수락·실패 수와 사유별 실패 수만 집계한다.

Report의 근거 상태는 `insufficient_assessment`, `no_failures_observed`, `failures_observed`다. 어느 상태에서도 임베딩 도입을 자동 결정하지 않으며 `embeddingDecision=not_determined`를 유지한다. 이후 결정에는 대표 질의, 독립된 기대 원본, lexical baseline과 후보 검색기의 같은 평가 묶음이 필요하다.

이 기능은 새 실행 event를 추가하지 않고 Hub에 동기화하지 않는다. Hub 없이 검색·관측·보고가 모두 완료된다.

## 실패 의미

- `invalid_query`: query, term 수 또는 결과 limit이 계약 밖이다. Attempt를 기록하지 않는다.
- `corpus_invalid` / `corpus_limit_exceeded`: 중복·잘못된 source 좌표나 corpus 한도를 확인했다. 일부 index를 반환하지 않는다.
- `corpus_read_failed`: 등록 원본을 안전하고 완전하게 읽지 못했다. 누락 source를 숨기고 검색하지 않는다.
- `invalid_attempt` / `invalid_assessment`: ID·hash·project·시간·결과 관계가 원본과 맞지 않는다. Report에서 제외하지 않고 전체 조회를 실패시킨다.
- `observation_conflict`: 같은 attempt 또는 assessment 좌표에 다른 원본이 있거나 이미 다른 평가가 있다. 기존 원본을 유지한다.
- `observation_invalid` / `observation_read_failed` / `observation_write_failed`: 전용 경로·파일·직렬화 또는 저장을 신뢰할 수 없다. 검색 성공이나 평가 기록을 주장하지 않는다.
- `observation_limit_exceeded`: 관측 파일 수가 bounded report 한도를 넘었다. 일부 기간만 정상 전체인 것처럼 집계하지 않는다.

## 결과와 한계

현재 baseline은 등록된 문서의 raw Markdown 어휘 검색이며 verified knowledge·skill 원본, 형태소 분석, 동의어, 의미 검색과 context 자동 선택을 포함하지 않는다. Search hit는 추천 후보일 뿐 필수 문서 선택과 E2/E3를 열지 않는다. 다음 단계는 이 검색기를 managed context discovery의 명시적 추천 입력으로 연결하고 실제 평가를 축적하되, 검색 hit와 `selected` 증거를 계속 분리하는 것이다.

## 검증

- Corpus 입력 순서와 무관한 index ID·순위·result-set hash
- 한국어 title·본문·path 일치, content hash 변경과 안정된 tie-break
- Raw query·source path·본문 비저장
- 빈 결과의 미평가 유지와 명시적 수락·controlled 실패 사유
- `no_results` 허위 판정, 다른 project, 중복 평가와 변조 원본 거부
- 심볼릭 링크 문서, UTF-8·크기·경로 실패 시 부분 검색 차단
- CLI query → assessment → report 재시작 수직 슬라이스
