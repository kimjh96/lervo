# ADR-0055: 검토된 검색 평가 케이스와 반복 측정

- 상태: 채택
- 날짜: 2026-08-20

## 배경

한 번의 검색 attempt와 assessment만으로는 검색 구현이 바뀐 뒤 같은 실패가 다시 생겼는지 알 수 없다. 그렇다고 과거 query를 모든 telemetry에 저장하거나, 빈 결과와 managed run 성공을 자동 정답으로 바꾸면 개인정보 경계와 평가 신뢰성이 무너진다.

반복 평가에는 검토한 query와 기대 원본이 필요하다. 이 원문은 사용자가 살펴보고 저장소에 둘 수 있는 평가 입력이어야 하며, 실행 telemetry와는 수명주기가 달라야 한다.

## 결정

### 검토 원본의 명시적 승격

`SearchEvaluationCase`는 검증된 `SearchAttempt`와 그 attempt의 `SearchAssessment`에서만 만듭니다. Query digest·문자 수·term 수가 attempt와 모두 같아야 하며, 평가자가 `expectedSources`로 지정했거나 수락한 `selectedSources`만 기대 원본이 될 수 있습니다. 실패 assessment에 기대 원본이 없으면 케이스를 만들지 않습니다.

케이스는 `any` 또는 `all`, 원본 attempt의 요청 한도를 넘지 않는 1~50위 허용 순위, 원본 assessment의 평가자·수락/실패·controlled 사유, 기준 index·result-set과 당시 기대 원본 순위를 결속합니다. 기준 상태는 저장된 순위에서 다시 계산합니다. Assessment의 주관적 실패 사유와 반복 평가의 결정적 순위 판정은 같은 의미로 가장하지 않습니다.

### 파일과 개인정보 경계

평가 케이스는 `.lervo/search-evaluations/<caseId>.yaml`에 한 파일씩 저장합니다. 최대 256개이며 파일은 64 KiB와 mode `0600`을 강제하고 심볼릭 링크, 계약 밖 파일, 읽는 중 변경과 ID 불일치를 거부합니다. 기존 파일을 자동 덮어쓰거나 하나의 문서에 이력을 계속 붙이지 않습니다.

이 YAML만 검토한 query 원문을 가집니다. 원문은 반복 실행에 꼭 필요하므로 사용자가 비밀정보를 제거하고 저장소 공개 범위를 결정해야 합니다. Search attempt, evaluation result, run report, event와 Hub payload에는 query를 복제하지 않습니다.

### 반복 실행과 회귀

`lervo search evaluate`는 모든 케이스와 등록 Markdown corpus를 먼저 검증하고 현재 `lexical-v1` index를 한 번 만듭니다. 각 query는 최대 50개 결과로 실행하고 기대 원본별 순위를 기록합니다. 기대 조건을 충족하면 `passed`, 아니면 `no_results`, `expected_source_missing`, `low_rank` 중 하나로 `failed`가 됩니다.

Result는 path 없는 bounded hit 좌표에서 result-set hash와 기대 원본별 순위를 다시 계산합니다. 현재 상태와 검토 당시 기준 상태를 비교해 `improved`, `unchanged`, `regressed`를 계산합니다. 이는 같은 케이스의 순위 조건 변화만 뜻하며 문서가 사용됐거나 검색이 의미적으로 충분하다는 주장이 아닙니다.

Result와 run은 `.lervo/state/search/evaluation-results`와 `evaluation-runs`에 각각 content-bound JSON 파일로 저장합니다. Result를 먼저 게시하고 모든 result를 검증한 run을 마지막에 게시합니다. 중간 저장 실패로 result가 남더라도 run이 없으면 완료된 평가로 집계하지 않습니다.

## 실패 의미

- `invalid_evaluation_case`: query, 기대 원본, 검토 좌표, 순위, ID 또는 hash가 계약과 다릅니다. 어떤 케이스도 실행하지 않습니다.
- `invalid_evaluation_result`: case·query·index·순위·상태·실패 사유·비교 또는 ID가 다릅니다. Run을 게시하지 않습니다.
- `invalid_evaluation_run`: project·시각·index, case/result 목록, 집계 또는 ID가 다릅니다. 완료된 실행으로 보존하지 않습니다.
- `evaluation_case_invalid` / `evaluation_case_read_failed`: YAML이나 디렉터리가 unsafe, 변조, 동시 변경 또는 읽기 실패입니다. 일부 케이스만 실행하지 않습니다.
- `evaluation_case_limit_exceeded`: 활성 케이스가 256개를 넘었습니다. 일부 표본만 골라 실행하지 않습니다.
- `evaluation_case_write_failed`: 케이스를 immutable 파일로 게시하지 못했습니다. 기존 파일을 덮어쓰지 않습니다.
- `evaluation_not_found`: 활성 케이스가 없습니다. 빈 평가를 성공으로 기록하지 않습니다.
- `observation_write_failed`: result 또는 run 게시가 실패했습니다. Run이 없으면 앞서 게시된 result는 고아 원본일 뿐 완료 증거가 아닙니다.

## Event와 범위

새 event는 없습니다. 케이스·result·run은 Hub sync, 실행 증거, verification, shared context와 E1~E4가 아닙니다. 평가 실패 수나 회귀만으로 임베딩 도입을 결정하지 않으며 모든 result와 run은 `embeddingDecision=not_determined`를 유지합니다. 다른 검색 엔진 비교와 표본 충분성 정책은 포함하지 않습니다.

## 검증

- 수락한 source 또는 명시한 기대 source만 케이스로 승격
- Query digest·문자 수·term 수가 다른 attempt 연결 거부
- 검토 당시 통과에서 현재 실패로 바뀌면 회귀, 실패에서 통과면 개선
- 케이스 YAML 변조 시 result와 run을 하나도 게시하지 않음
- Query는 케이스 YAML에만 있고 attempt·result·run에는 없음
- 실패와 회귀가 있어도 임베딩 판단은 미결정
