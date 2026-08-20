# ADR-0070: 쓰기 없는 검색 rollout 조치 사전 점검

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

`action apply`는 안전하게 실패하지만 운영자는 실패 뒤에야 검토 판단, 정책, operator, 현재 선택이나 품질 입력 중 무엇이 맞지 않는지 알 수 있었습니다. 반대로 사전 점검 결과를 승인이나 예약처럼 사용하면 점검과 실행 사이에 상태가 달라지는 문제가 생깁니다.

## 결정

`lervo search rollout action check <rollout-review-id>`는 action policy, 요청 조치와 operator를 모두 명시적으로 받습니다. 최신 검토나 정책을 대신 고르지 않습니다. 현재 선택·품질 입력까지 다시 확인한 뒤 `eligible` 또는 `ineligible`과 제한된 실패 사유를 반환합니다.

실제 적용과 사전 점검은 같은 코어 eligibility 판정을 사용합니다. Rollback이 eligible이면 실제 실행 함수에서 파일을 게시하기 직전까지 사용하는 엔진 정책·현재 head·fallback 후보 재현 검증도 같은 읽기 전용 경계로 수행합니다. 점검은 준비한 전이 객체를 결과로 노출하지 않습니다.

실패 사유는 요청 조치 불일치, 아직 유효하지 않은 정책·검토, 검토 정책 결속·기준·판단 불일치, action·engine operator 범위, 현재 선택 불일치와 품질 입력 변경으로 제한합니다. 원본 파일이 없거나 변조됐거나 후보 재현이 실패한 경우에는 `ineligible`로 완화하지 않고 기존 구체 오류로 점검 전체를 실패시킵니다.

## 무부작용과 정보 경계

점검 결과의 `actionSelection=not_performed`, `acknowledgement=not_recorded`, `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`는 고정입니다. 점검은 acknowledgement, 선택 전이, 정책, event와 Hub sync를 만들지 않으며 실행 슬롯이나 CAS head를 예약하지 않습니다. 실제 `apply`는 같은 조건을 다시 검사합니다.

응답은 명시한 로컬 operator ID, 정책·검토·선택 ID, 판단 종류와 입력 변경 상태만 포함합니다. Query·digest, 품질 원본 ID, nonce, 문서 좌표·본문, provider 결과, credential과 receipt는 포함하지 않습니다.

## 결과

운영자는 실패를 만들지 않고 현재 미충족 조건을 확인할 수 있습니다. Eligible 결과는 조회 시각의 설명일 뿐 실행 권한이나 이후 성공 보장이 아니며, 적용 단계의 재검증과 previous-head CAS가 계속 최종 판단을 담당합니다.
