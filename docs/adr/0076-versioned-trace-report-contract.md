# ADR-0076: 버전이 있는 trace report 호환성 계약

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

`lervo trace --json`은 로컬 event chain을 확인한 결과를 반환했지만 출력 버전과 consumer 검증 경계가 없었습니다. 필드가 바뀌거나 report 내부의 run, status, 시각 범위와 event가 어긋나도 자동화는 이를 구분할 수 없었습니다. 특정 run의 event만 반환하므로 다른 run이 전역 chain 사이에 끼어 있으면 report 조각만으로 저장소 전체 chain을 다시 증명할 수도 없습니다.

## 결정

`@lervo/schemas`에 Draft 2020-12 `traceReportSchema`와 파생 `TraceReport` 타입을 두고 `schemaVersion: 1`을 필수로 합니다. V1 reader는 기존 event schema, event별 canonical hash, payload allowlist, 동일 project/run, 증가하는 전역 seq, 연속 seq 사이의 previous hash, status·처음/마지막 시각·session 집계와 integrity snapshot의 확인 가능한 좌표를 검증합니다.

Integrity snapshot은 producer가 전체 project event store에서 `verifyIntegrity()`를 완료했다는 결과입니다. Reader는 선택된 run event만으로 중간에 생략된 다른 run event의 hash link를 재구성했다고 주장하지 않습니다. 반환된 마지막 event가 전역 마지막 seq인 경우에만 head hash까지 직접 대조합니다.

Report와 integrity object의 새 선택 필드는 허용하지만 기존 `EventEnvelope`는 자체 schema version 계약을 따르며 알 수 없는 필드를 받지 않습니다. 기존 필드 삭제, 필수 필드 추가, 타입이나 controlled status 의미 변경은 새 report schema version이 필요합니다. 1이 아닌 정수 버전은 `trace_report_schema_unsupported`, 손상된 구조나 의미는 `trace_report_invalid`입니다. 오류 메시지에는 report 원문, payload, ID, 경로나 credential을 복사하지 않습니다.

## 결과

생성기와 외부 consumer가 같은 경계로 trace JSON을 확인하고 알 수 없는 출력 의미를 기존 실행 기록으로 오해하지 않습니다. 검증은 읽기 전용이며 event, 파일, CAS와 Hub 원본을 만들거나 바꾸지 않습니다.
