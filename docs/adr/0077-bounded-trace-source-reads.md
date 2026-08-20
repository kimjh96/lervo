# ADR-0077: 잘림을 숨기지 않는 bounded trace 원본 조회

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

Event store의 `list()` 기본 상한은 100개인데 기존 trace 생성기는 인자 없는 결과를 project 전체 event로 취급했습니다. 100개를 넘으면 `last`가 실제 head가 아닌 100번째 event의 run을 고르고, 명시한 run도 일부 event만으로 완전한 report를 만들 수 있었습니다. 전체 chain 검사도 모든 row를 배열로 만든 뒤 확인해 project 이력이 커질수록 메모리가 함께 증가했습니다.

## 결정

Event store 계약에 project 전역 마지막 event 하나만 읽는 `latest()`를 추가합니다. SQLite 구현은 `seq DESC LIMIT 1`을 사용하고 trace의 `last` 선택은 이 경계만 사용합니다.

전체 integrity 검사는 정렬된 SQLite iterator를 한 row씩 읽으며 seq, previous hash와 canonical event hash를 확인합니다. 전체 event 배열을 만들지 않습니다.

기존 완전한 `TraceReport`는 run당 최대 1,000개 event만 허용합니다. 정확히 1,000개를 읽은 경우 다음 event 하나를 별도로 확인하고 더 있으면 일부 report를 반환하지 않고 `trace_result_too_large`로 실패합니다. 이 상한은 완전한 report가 일부 page를 전체인 것처럼 보이는 일을 막기 위한 호환 경계이며 cursor page 자체는 다음 단계에서 별도 계약으로 제공합니다.

## 결과

100개 기본 page 때문에 최신 run이나 완료 상태가 조용히 바뀌지 않습니다. Integrity 검사의 메모리는 event 수와 함께 커지지 않고, 큰 단일 run은 잘린 성공 대신 명시적 실패가 됩니다. 조회는 event나 다른 원본을 변경하지 않습니다.
