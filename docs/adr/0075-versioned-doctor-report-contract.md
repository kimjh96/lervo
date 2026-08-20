# ADR-0075: 버전이 있는 doctor report 호환성 계약

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

`lervo doctor --json`은 자동화가 소비할 수 있었지만 report 자체에 버전이 없었습니다. 필드, scope, 상태나 action code가 바뀌면 이전 consumer가 새 의미를 알아차리지 못한 채 기존 의미로 읽을 수 있었습니다. 출력에 버전 숫자만 추가해도 손상된 같은 버전과 알 수 없는 새 버전을 구분하거나, scope와 검사 목록처럼 여러 필드에 걸친 의미를 확인할 수는 없습니다.

## 결정

Doctor JSON의 원본 계약을 `@lervo/schemas`의 Draft 2020-12 `doctorReportSchema`로 정의하고 `schemaVersion: 1`을 필수로 둡니다. `DoctorReport`와 하위 타입은 이 schema에서 파생해 출력 구현과 별도 타입 목록이 어긋나지 않게 합니다.

V1 reader는 다음 두 실패를 구분합니다.

- `doctor_report_schema_unsupported`: 정수 `schemaVersion`이 1이 아닙니다. 이전 consumer는 내용을 추측하지 않습니다.
- `doctor_report_invalid`: 버전이 없거나 타입·필수 필드·controlled value가 틀렸거나, scope와 check 집합·전체 status·issue에서 파생한 recovery guidance가 서로 맞지 않습니다.

Object에 추가되는 선택 필드는 report와 하위 항목에서 허용하며 이전 reader는 해당 필드를 무시할 수 있습니다. 기존 필드 삭제, 필수 필드 추가, 필드 타입 변경과 `scope`, status, check ID, issue code, action code 같은 controlled value 추가·변경은 이전 reader가 받아들이지 못하므로 새 schema version이 필요한 변경입니다.

검증 오류는 입력값이나 JSON 원문을 메시지에 복사하지 않습니다. Reader는 읽기와 검증만 하며 파일, event, Hub 원본이나 진단 상태를 바꾸지 않습니다.

## 결과

자동화는 새 버전과 손상된 v1을 서로 다른 기계용 code로 처리하고, 알 수 없는 의미를 기존 정상 결과로 오해하지 않습니다. Schema fixture는 정상 v1, 선택 필드 추가, 필수 필드 누락과 알 수 없는 controlled value를 고정하고, diagnostics 계약 테스트는 버전과 필드 간 의미 일치까지 확인합니다.
