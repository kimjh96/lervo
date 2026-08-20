# ADR-0056: 검색 평가 묶음과 표본 충분성

- 상태: 채택
- 날짜: 2026-08-20

## 배경

검토된 검색 케이스를 반복 실행할 수 있어도 모든 케이스를 한꺼번에 비교하면 어떤 역할과 작업을 대표하는지 알기 어렵습니다. 비슷한 query를 여러 케이스로 복제하거나 오래된 케이스와 대체 케이스를 함께 세면 표본 수만 커지고 비교 신뢰도는 높아지지 않습니다.

반대로 표본이 적다는 이유만으로 평가 자체를 막으면 현재 baseline의 상태도 볼 수 없습니다. 실행 가능한 상태와 다른 검색 후보를 비교해도 되는 상태를 분리해야 합니다.

## 결정

### 역할·작업 유형별 작은 원본

`SearchEvaluationBundle`은 project, `roleId`, `taskType`, 최소 활성 표본 수, 활성 case ID와 대체 관계를 content-bound hash로 묶습니다. 한 project에서 같은 역할·작업 유형의 묶음은 하나만 허용합니다. 전체 묶음은 최대 32개, 한 묶음은 활성 case 64개와 대체 관계 192개가 한도입니다.

묶음은 `.lervo/search-evaluations/<bundleId>.bundle.yaml`에 하나씩 둡니다. 케이스 파일과 같은 디렉터리를 쓰되 파일명으로 종류를 분리합니다. `lervo search bundle create`는 기존 파일을 자동 덮어쓰지 않습니다. 구성 변경은 긴 이력 문서에 append하지 않고 작은 묶음 파일을 version control에서 명시적으로 교체합니다.

묶음은 query를 저장하지 않습니다. Case ID와 역할·작업 유형은 로컬 운영 metadata이며 Hub로 보내거나 실행 event로 만들지 않습니다.

### 대체 관계와 중복 표본

대체된 case는 활성 목록에 함께 둘 수 없습니다. 모든 대체 관계는 하나의 다음 case만 가리키고, 순환 없이 현재 활성 case로 끝나야 합니다. 참조한 모든 case는 같은 project의 유효한 원본이어야 합니다.

활성 case의 query digest가 같으면 서로 다른 표본으로 세지 않고 묶음 전체를 거부합니다. 이는 문장이 같다는 관측만 증명하며 의미적으로 다른 문장까지 같은 표본으로 추정하지는 않습니다.

### 실행과 비교 준비 상태 분리

`SearchEvaluationCoverage`는 묶음과 현재 case 원본에서 다시 만드는 파생 결과입니다. 활성 표본 수가 최소값 이상이면 `sampleState=sufficient`, 아니면 `insufficient`입니다. 후보 비교 준비 상태는 각각 `ready`, `insufficient_sample`로 대응합니다.

`lervo search bundle report`는 부족한 수와 상태를 보여 주고 종료 코드 1을 반환합니다. `lervo search evaluate --bundle`은 충분성과 무관하게 선언된 활성 case만 현재 `lexical-v1`으로 실행해 관측 result와 run을 남깁니다. 다만 표본이 부족하면 종료 코드 1이며 후보 검색 비교 artifact는 만들지 않습니다.

`ready`는 선언한 최소 개수를 채웠다는 뜻일 뿐 표본이 통계적으로 대표적이거나 검색 품질이 좋다는 뜻이 아닙니다. 어떤 상태도 context `selected`·`loaded`·`injected`·`used`, verification 통과나 임베딩 도입을 주장하지 않습니다. `embeddingDecision`은 계속 `not_determined`입니다.

## 실패 의미

- `invalid_evaluation_bundle`: 묶음 ID·hash·scope·정렬, case 참조, query 중복 또는 대체 관계가 계약과 다릅니다.
- `invalid_evaluation_coverage`: 파생 ID, 활성 수·부족 수 또는 상태가 묶음 원본과 다릅니다.
- `evaluation_bundle_invalid`: 파일명·YAML·project·동일 scope 유일성 또는 파일 안전 계약이 유효하지 않습니다. 일부 묶음만 사용하지 않습니다.
- `evaluation_bundle_limit_exceeded`: 묶음 파일이 32개를 넘었습니다. 일부만 골라 report하거나 실행하지 않습니다.
- `evaluation_bundle_read_failed`: 디렉터리나 파일을 안전하고 일관되게 읽지 못했습니다.
- `evaluation_bundle_write_failed`: 새 묶음을 immutable 파일로 게시하지 못했습니다. 기존 파일은 덮어쓰지 않습니다.
- `insufficient_sample`: 오류 원본이 아니라 현재 활성 표본이 선언한 최소값보다 적은 상태입니다. Baseline 관측은 가능하지만 후보 비교는 닫힙니다.

## 개인정보와 Event 경계

묶음과 coverage에는 query, 문서 본문·path, prompt, provider 응답, credential을 넣지 않습니다. Query는 기존 케이스 YAML에만 남습니다. 새 event와 Hub sync는 없으며 coverage는 원본이 아니라 언제든 재생성할 수 있는 파생 상태입니다.

## 검증

- 활성 case와 대체 관계가 정렬과 hash에 무관하게 같은 원본으로 정규화됨
- 대체 관계 순환, 없는 case 참조와 같은 query의 활성 case를 거부함
- 같은 역할·작업 유형의 묶음이 둘이면 전체 로드를 거부함
- 최소 표본 전후에 `insufficient_sample`과 `ready`를 결정적으로 계산함
- 묶음 실행이 선언된 활성 case만 평가함
- 묶음·coverage·result·run에 query가 없음
- 표본이 부족해도 임베딩 판단은 미결정으로 유지됨
