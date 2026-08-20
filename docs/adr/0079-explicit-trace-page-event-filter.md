# ADR-0079: 조건이 드러나는 trace page event type filter

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

큰 run을 page로 읽을 수 있어도 운영자가 특정 종류의 기록만 찾으려면 모든 page를 직접 걸러야 했습니다. 필터를 출력에 남기지 않거나 cursor와 분리하면 일부 event를 전체 page로 오해하거나 다음 page에서 조건이 달라질 수 있습니다.

## 결정

Event type filter는 전체 `TraceReport`가 아니라 bounded `TracePageReport`에만 적용합니다. CLI는 반복 가능한 `--event-type`을 받고 기존 event type allowlist의 중복 없는 값만 허용합니다. Page의 `filter.eventTypes`는 정렬된 실제 조건을 기록하고 텍스트에도 표시합니다.

필터 조건은 다음 cursor payload와 checksum에 포함합니다. 다음 page는 cursor의 조건만 사용하며 event type을 다시 지정할 수 없습니다. Reader는 반환된 모든 event가 조건에 포함되고 report와 cursor의 정렬된 조건이 같은지 확인합니다.

저장소 조회는 최대 1,000개 batch를 반복해 일치 event를 page 상한+1개까지만 모읍니다. 일치 결과가 없지만 run은 존재하면 `trace_filter_empty`, run 자체가 없으면 `trace_run_not_found`로 구분합니다. 빈 필터 결과를 run 부재나 전체 event 부재로 표현하지 않습니다.

## 결과

자동화와 사람이 실제 조회 조건을 report에서 확인하고 cursor page 전체에서 같은 조건을 유지합니다. 필터는 event를 삭제하거나 원본 상태를 변경하지 않으며 전체 run 상태를 주장하지 않습니다.
