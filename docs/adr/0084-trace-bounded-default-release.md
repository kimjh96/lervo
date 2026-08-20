# ADR-0084: 0.1.0 bounded trace 기본값 전환

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

0.0.x는 기존 자동화를 보호하기 위해 옵션 없는 trace를 전체 v1로 유지하면서 deprecation을 알렸습니다. Capability report와 51-event 전환 fixture가 명시적 full consumer와 bounded page consumer를 모두 재현하므로 0.1.0에 예약한 전환을 한 release 변경으로 적용할 수 있습니다.

## 결정

0.1.0부터 `lervo trace [last|run-id]`의 기본 요청은 limit을 생략한 첫 page이며 diagnostics의 `defaultTracePageSize=50`을 사용합니다. Text와 JSON 모두 `TracePageReport` v1이고 deprecation 경고를 출력하지 않습니다. `--page-size`와 `--event-type`은 같은 첫 page 경계를 유지하며 `--cursor`는 기존 snapshot-bound 다음 page를 읽습니다.

전체 실행 집계가 필요한 consumer는 `--full`을 명시해야 합니다. 이 경로는 기존 `TraceReport` v1, run당 최대 1,000개 event와 `trace_result_too_large` 실패 의미를 유지합니다. Full과 page/filter/cursor 옵션 배타성도 바뀌지 않습니다.

Capability report v1은 `defaultMode=page`, page mode의 `explicit=false`, 명시적 `full`·`cursor` mode와 빈 `deprecations`를 반환합니다. V1 schema는 과거 capability report를 읽기 위해 `implicit_full` controlled value를 유지하지만 현재 producer와 CLI 요청에는 이 mode가 없습니다. Reader는 `explicit=false` mode가 정확히 하나이고 default와 같은지 확인합니다.

루트와 55개 private workspace package version을 함께 0.1.0으로 올립니다. Brand/package 검사는 모든 workspace version이 root와 같은지 확인해 부분 version 전환을 거부합니다. Migration 안내는 별도 문서로 두며 이전 ADR과 fixture의 역사적 0.0.x 보장은 수정해 현재 동작으로 위장하지 않습니다.

새 event나 저장 상태는 없습니다. 기본 page 실패는 기존 `trace_empty`, `trace_run_not_found`와 page/cursor 오류를 사용하고, 오류에는 새로운 개인정보·비밀정보 필드를 추가하지 않습니다.

## 결과

기본 trace의 출력과 메모리 크기는 bounded해지고 전체 보고서 의존성은 `--full`로 드러납니다. 자동화는 capability report로 현재 mode를 확인할 수 있으며 기존 full/page report reader와 event 원본은 그대로 재사용합니다.
