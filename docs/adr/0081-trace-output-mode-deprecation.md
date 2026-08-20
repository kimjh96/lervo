# ADR-0081: 기본 trace output mode 전환 계약

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

기존 `lervo trace [run]`은 완전한 `TraceReport` v1을 기본으로 반환합니다. 긴 run에는 명시적 상한과 별도 page mode가 생겼지만 기본값을 즉시 page로 바꾸면 JSON root 구조와 전체 status 의미를 기대하는 기존 자동화가 같은 명령에서 다른 계약을 받게 됩니다.

## 결정

현재 0.0.x 단계에서는 인자 없이 선택한 trace mode를 `implicit_full`로 구분하되 기존 전체 v1 stdout과 종료 코드를 유지합니다. Report 생성이 성공한 뒤 stderr에 기계용 code `trace_implicit_full_deprecated`와 고정된 한국어 안내를 한 번 출력합니다. 경고에는 project/run/event ID, payload, 경로나 credential을 넣지 않습니다.

`--full`은 전체 `TraceReport` v1을 명시적으로 요청하며 경고가 없습니다. `--full`은 `--page-size`, `--event-type`, `--cursor`와 함께 쓸 수 없고 이 모순은 project storage를 열기 전에 거부합니다. Page와 cursor mode도 deprecation 경고를 출력하지 않습니다.

Bounded page를 기본값으로 바꾸는 시점은 0.1.0으로 예약합니다. 그 변경은 이 ADR만으로 자동 적용하지 않고 별도 구현·release 변경에서 다음을 함께 수행해야 합니다.

- 인자 없는 trace를 기본 page size 50의 `TracePageReport`로 변경
- 전체 v1이 필요한 consumer를 위한 `--full` 유지
- CLI help, machine-readable capability 정보와 migration 문서 동시 갱신
- 암묵적 full stdout을 기대하는 fixture를 새 기본값과 명시적 `--full` fixture로 분리

## 결과

현재 자동화는 JSON stdout 변경 없이 경고를 감지하고 `--full`로 의도를 고정할 수 있습니다. 전환 시점과 조건이 코드 밖의 암묵적 계획이 아니며, page 기본값은 별도 검증 없이 조용히 활성화되지 않습니다.
