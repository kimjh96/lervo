# ADR-0083: trace 기본값 전환 호환성 fixture

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

암묵적 full에서 bounded page로 바꾸는 조건을 문서와 작은 2-event 테스트만으로 관리하면 두 report의 모양은 달라도 실제 page 경계와 cursor 연속성이 검증되지 않습니다. 반대로 아직 출시하지 않은 0.1.0 동작을 production flag로 미리 넣으면 현재 기본값이 두 곳에 생깁니다.

## 결정

CLI 테스트 전용 fixture가 합성 project와 51개 event의 단일 run을 만듭니다. 51은 현재 기본 page 크기 50보다 하나 많고 full 상한 1,000보다 작으므로 같은 원본에서 완전한 full report와 `50 + 1` cursor page를 구분하는 최소 경계입니다. ID, digest, 시각과 payload는 고정된 allowlist 합성 값만 사용합니다.

현재 호환성 시나리오는 다음을 함께 확인합니다.

- Capability report의 기본값이 `implicit_full`이고 `trace_implicit_full_deprecated`가 `full` 대체와 0.1.0의 `page` 전환을 가리킴
- 암묵적 JSON이 51개 event의 유효한 `TraceReport`이며 경고 code가 한 번만 나오고 run ID를 포함하지 않음
- 명시적 `--full` JSON이 암묵적 stdout과 같고 stderr가 비어 있음
- Capability의 기본 page 크기로 읽은 첫 page와 cursor 다음 page가 유효한 `TracePageReport`이고 seq 1~51을 중복·누락 없이 반환함
- Page report에 전체 run의 `status`가 없음

Fixture setup이나 reader 검증, 경고 횟수, stdout equality와 cursor continuity가 다르면 테스트 전체를 실패시킵니다. 일부 조건만 통과한 결과를 migration 준비 완료로 기록하지 않습니다. 이 fixture는 test-only이며 runtime mode, package version, schema나 사용자 project를 바꾸지 않습니다.

0.1.0 전환은 이 fixture의 기본 호출 기대값, capability default/deprecation, 명시적 full 회귀, help와 migration 문서를 같은 변경에서 갱신해야 합니다. 가짜 version switch나 두 default 구현을 미리 두지 않습니다.

## 결과

현재 consumer와 새 bounded consumer의 실제 차이가 하나의 재현 가능한 경계에 고정됩니다. 향후 기본값 변경이 stdout 형태만 조용히 바꾸거나 capability 선언과 실제 CLI가 어긋나면 release 전에 테스트가 실패합니다.
