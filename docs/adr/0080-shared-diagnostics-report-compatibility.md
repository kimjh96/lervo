# ADR-0080: 공통 diagnostics report 호환성 읽기 경계

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

Doctor report, 전체 trace report와 trace page report가 각각 같은 순서로 schema version을 확인하고 JSON Schema를 적용한 뒤 의미 검증을 수행했습니다. 중복된 분기에서 한 reader만 미지원 버전을 다르게 처리하거나 오류에 입력 내용을 포함할 위험이 생겼습니다. Trace CLI도 옵션 해석, report 생성과 텍스트 출력이 한 파일에 모이기 시작했습니다.

## 결정

`report-compatibility` 경계가 모든 diagnostics report에 대해 다음 순서를 소유합니다.

1. 정수 schema version이 지원 버전인지 확인
2. 등록한 JSON Schema로 필수 구조 검증
3. report별로 주입한 의미 검증 실행
4. 미지원 version, 구조 손상, 의미 손상을 입력값 없는 고정 메시지로 분류

Report별 error class와 기계용 code, 의미 검증기는 각 계약 모듈에 남깁니다. 공통 경계는 doctor·trace 용어, scope나 cursor 의미를 알지 않습니다.

Trace CLI는 `trace-options`, `trace-format`, `trace-command`로 분리합니다. Options는 세 요청 모드인 전체 report, 첫 page, cursor page를 서로 배타적으로 만들고 command는 storage 수명주기와 application service 호출만 조합합니다. Formatter는 이미 검증된 report의 사람용 표현만 담당합니다.

## 결과

새 diagnostics report는 같은 실패 순서와 비노출 기본값을 재사용하면서 고유 의미 검증을 독립적으로 추가할 수 있습니다. CLI 옵션이 늘어도 실행·출력 코드와 섞이지 않으며 기존 JSON과 종료 의미는 바뀌지 않습니다.
