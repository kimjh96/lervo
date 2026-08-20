# ADR-0058: 결정적 `bm25f-v1` 검색 후보와 명시적 등록

- 상태: 채택
- 날짜: 2026-08-20

## 배경

후보 비교 계약만으로는 실제 adapter가 공통 corpus와 응답 규칙을 지키는지 알 수 없습니다. 임의 module 경로나 package 이름을 CLI에서 받아 실행하면 평가 기능이 코드 실행 통로가 되고, 후보마다 corpus 검증을 복제하면 baseline과 입력 의미가 달라집니다.

첫 후보는 외부 서비스 없이 로컬에서 반복할 수 있어야 하고, 점수 공식과 한계가 분명해야 합니다. 비교 관측을 운영 채택으로 자동 승격해서도 안 됩니다.

## 결정

### 공용 corpus와 adapter 계약

`prepareSearchCorpus`가 source 상한, 본문·path·label 안전성, source 좌표 중복, canonical 정렬과 검색 projection digest를 담당합니다. `lexical-v1`와 후보가 이 계약을 함께 사용합니다. 기존 lexical index ID는 이전과 같은 정렬된 source identity 구조로 계산해 engine version 없이 의미가 바뀌지 않게 합니다.

`verifySearchEvaluationEngineContract`는 같은 corpus와 역순 corpus로 index를 각각 만들고 index ID가 같은지 확인합니다. 같은 query를 두 index에서 반복해 engine·index·query 좌표, 50위 한도, rank·정수 score·matched field 순서, source tie-break와 result-set hash가 같은지 검증합니다. 원본 source 배열을 adapter가 바꾸지 않았는지도 확인합니다.

### `bm25f-v1` 점수

별도 `@lervo/search-adapter-bm25f` package가 `bm25f-v1` engine port를 구현합니다. Title 12, path 8, label 10, text 2의 가중 term 빈도를 합치고 문서 길이 정규화와 빈도 포화를 적용합니다. 희귀도는 전체 문서 수와 해당 term이 있는 문서 수의 비율을 1,000,000배 정수로 계산합니다.

부동소수 로그, 시각, random과 외부 상태는 사용하지 않습니다. 최종 score는 양의 안전한 정수이고 동점은 source 종류·ID 순서로 정합니다. 이 구현은 BM25F에서 필요한 field·길이·포화·문서 빈도 원리를 사용한 고정 정수 후보이며 다른 표준 BM25 library와 같은 점수를 주장하지 않습니다.

### 정적 allowlist와 CLI

`SearchEvaluationEngineRegistry`는 명시적으로 넘긴 최대 16개 후보만 보관합니다. Candidate ID와 engine ID·version은 각각 유일해야 하고 현재 `lexical-v1`은 후보로 등록할 수 없습니다.

현재 CLI registry는 `bm25f-v1` 하나만 source code에서 등록합니다. `lervo search candidates`로 공개 좌표를 확인하고 `lervo search compare <bundleId> --candidate bm25f-v1`로 준비된 묶음을 비교합니다. 미등록 문자열은 project를 읽기 전에 거부합니다. File path, package, URL이나 동적 import는 해석하지 않습니다.

## 실패 의미

- `corpus_invalid` / `corpus_limit_exceeded`: baseline과 후보가 공유하는 source 원본 또는 상한이 유효하지 않습니다. 일부 corpus로 index를 만들지 않습니다.
- `invalid_evaluation_engine`: adapter가 engine·index·query·rank·score·matched field·result hash 또는 재현성 계약을 지키지 않습니다.
- `evaluation_candidate_not_registered`: CLI allowlist에 없는 candidate ID입니다. Project와 후보 코드를 실행하지 않습니다.
- `evaluation_comparison_not_ready`: 묶음 표본이 부족합니다. Corpus와 `bm25f-v1`를 실행하지 않습니다.
- `evaluation_candidate_failed`: 등록 후보가 build·search 중 실패했습니다. 완료된 비교 원본을 게시하지 않습니다.

## 개인정보와 제외 범위

Adapter는 평가 순간 로컬 corpus와 case query를 받지만 이를 별도 저장하거나 Hub로 보내지 않습니다. CLI comparison에는 query 원문·문서 본문·path·prompt·provider 응답·credential이 없습니다. 새 event와 Hub sync도 없습니다.

`candidate_better_observed`는 채택 결정이 아닙니다. 운영 attempt와 managed context는 계속 `lexical-v1`을 사용합니다. 후보 검토·승격 결정과 실제 engine 전환은 이번 범위에 없습니다.

## 검증

- 역순 corpus와 반복 query에서 같은 index ID·응답·순위·hash
- 입력 source 배열을 변경하지 않음
- 희귀 term이 반복된 흔한 term과 분리된 fixture에서 더 큰 희귀도 신호를 가짐
- 모든 score가 양의 안전한 정수이고 query 원문이 응답에 없음
- 잘못된 corpus와 adapter 응답을 공용 계약에서 거부함
- Registry 중복·baseline·미등록 후보를 거부함
- 준비된 CLI 비교는 `bm25f-v1` 좌표를 남기고 부족한 묶음은 실행하지 않음
- 비교 뒤에도 후보·임베딩 판단과 운영 engine이 바뀌지 않음
