# ADR-0057: 공급자 중립 검색 후보 비교

- 상태: 채택
- 날짜: 2026-08-20

## 배경

표본이 충분한 평가 묶음이 있어도 후보 엔진을 현재 검색 코드에 직접 끼우면 운영 검색과 실험 결과가 섞입니다. 엔진마다 score 의미가 다른데 숫자만 비교하면 근거 없는 우열도 생깁니다. 후보가 실패한 뒤 baseline 결과만 남았을 때 이를 완료된 비교처럼 읽는 문제도 막아야 합니다.

실제 후보 구현보다 먼저, 어떤 입력과 조건을 같게 맞추고 무엇을 비교하며 어떤 상태를 만들지 고정된 계약이 필요합니다.

## 결정

### 엔진 port와 운영 경계

`SearchEvaluationEnginePort`는 engine ID·version과 `buildIndex`만 노출합니다. Index는 같은 engine 좌표와 content-bound ID를 가지고 query와 결과 한도를 받아 `SearchResponse`를 반환합니다. 동기·비동기 adapter를 모두 허용하지만 공통 실행기가 engine·index, query digest·크기, 결과 hash와 50위 조건을 다시 확인합니다.

평가 result와 run은 engine 좌표를 일반화합니다. 운영 `SearchAttempt`와 managed context recommendation은 계속 `lexical-v1`만 받습니다. 후보 평가가 운영 검색, context 선택이나 사용 증거가 되지 않습니다.

### 준비 gate와 같은 입력

로컬 조합은 묶음의 `comparisonReadiness=ready`를 확인한 뒤에만 corpus를 읽고 후보 index를 만듭니다. 준비되지 않은 묶음에서는 후보 port를 호출하지 않습니다.

준비된 비교는 등록 Markdown에서 읽은 같은 `SearchSourceInput`, 묶음의 같은 활성 case, 같은 평가 시각과 결과 50위 조건을 baseline과 후보에 공급합니다. 비교기는 실제 corpus에서 digest와 현재 `lexical-v1` index를 다시 계산해 baseline run을 검증합니다. Port 호출은 후보에 같은 입력을 전달했다는 사실만 보장하며 후보 내부 사용을 주장하지 않습니다.

### 관측과 결정 분리

Case별 비교는 동일한 기대 source·최대 순위 조건에서 통과 여부가 바뀌었는지만 봅니다. Baseline만 통과하면 `baseline_win`, 후보만 통과하면 `candidate_win`, 둘의 통과 여부가 같으면 `tie`입니다. 엔진별 score, 둘 다 통과한 순위 차이와 둘 다 실패한 실패 사유는 공통 척도로 비교하지 않습니다.

집계는 `baseline_better_observed`, `candidate_better_observed`, `mixed`, `no_difference_observed`입니다. 이는 이번 표본에서 관측한 전이일 뿐 채택 판단이 아닙니다. `candidateDecision=not_determined`, `embeddingDecision=not_determined`를 유지합니다.

### 원본 게시 순서

두 엔진의 result와 run을 기존 항목별 immutable 디렉터리에 먼저 저장합니다. 모든 원본을 다시 검증한 `SearchEvaluationComparison`만 `.lervo/state/search/evaluation-comparisons/<comparisonId>.json`에 마지막으로 저장합니다. 중간 저장 실패로 result·run이 남아도 comparison이 없으면 완료된 비교가 아닙니다.

Comparison은 bundle·coverage·corpus digest, 평가 시각, 두 engine·index·run과 case별 result ID·관측 결과만 가집니다. Query, 문서 본문·path, prompt, provider 응답과 credential은 넣지 않습니다.

## 실패 의미

- `invalid_evaluation_engine`: engine ID·version, index ID 또는 search 응답이 공통 계약과 다릅니다.
- `evaluation_comparison_not_ready`: 활성 표본이 선언한 최소 수에 못 미칩니다. Corpus와 후보 엔진을 실행하지 않습니다.
- `invalid_evaluation_comparison`: bundle·coverage·corpus, 두 실행의 project·시각·case·순위 조건 또는 집계가 다릅니다.
- `evaluation_candidate_failed`: 후보 build 또는 search가 실패했거나 잘못된 engine·index·응답을 반환했습니다. 어떤 평가·비교 원본도 새로 게시하지 않습니다.
- `observation_write_failed`: result, run 또는 comparison 게시가 실패했습니다. Comparison이 없으면 완료된 비교가 아닙니다.

## Event와 현재 제외 범위

새 event와 Hub sync는 없습니다. 비교는 verification, context `selected`·`loaded`·`injected`·`used`, 지식 검증이나 엔진 채택이 아닙니다. 실제 후보 adapter, adapter registry, CLI 선택과 managed context 엔진 교체는 포함하지 않습니다.

## 검증

- 다른 engine ID·version의 동기·비동기 port가 같은 실행 계약을 따름
- 표본 부족이면 후보 build가 한 번도 호출되지 않음
- 같은 corpus·case·시각·50위 조건이 아니면 비교를 거부함
- Candidate만 실패에서 통과로 바뀐 case만 `candidate_win`으로 계산함
- 후보 응답 계약 실패 시 baseline result·run도 게시하지 않음
- Result·run 이후 comparison을 마지막에 별도 파일로 게시함
- Comparison에 query가 없고 후보·임베딩 결정은 미결정임
