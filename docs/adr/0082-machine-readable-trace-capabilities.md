# ADR-0082: 기계가 읽는 trace capability report

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

암묵적 전체 trace 출력의 전환 계획은 stderr 경고와 help에 드러나지만 자동화가 한국어 문장을 파싱하면 문구 수정이 곧 계약 변경이 됩니다. 실제 report version과 page·full·cursor 상한도 여러 구현 상수에 있으므로 외부 consumer가 추측해서는 안 됩니다.

## 결정

`lervo trace --capabilities`는 저장소 위치와 무관하게 `TraceCapabilitiesReport` v1 JSON만 출력합니다. Project manifest, event store와 CAS를 열지 않고 event나 파일을 만들지 않습니다. `--json`은 허용하되 출력은 같고, run ID·root·full·page-size·event-type·cursor와 함께 지정하면 storage open 전에 거부합니다.

Report는 현재 기본 mode와 각 지원 mode의 명시성, full/page report 종류와 schema version, event type filter·cursor continuation 지원 여부를 가집니다. Limits는 기본·최대 page 크기, 전체 report 최대 event 수와 cursor 최대 byte 수를 실제 diagnostics 상수에서 가져옵니다. Deprecation은 code, 대상·대체 mode, 변경 예정 version과 다음 기본 mode만 가지며 사람용 경고 문장을 포함하지 않습니다. 현재 값은 `implicit_full`에서 `full`로 명시하라는 `trace_implicit_full_deprecated`와 0.1.0의 `page` 기본 전환입니다.

JSON Schema와 파생 타입은 `@lervo/schemas`, 생성기와 compatibility reader는 `@lervo/diagnostics`, 옵션 배타성과 stdout 조합은 CLI가 맡습니다. Reader는 version과 구조 뒤에 default/deprecation mode 참조, mode·deprecation code 중복과 page 상한 관계를 확인합니다. 선택 필드 추가는 허용하지만 필수 필드 삭제나 의미 변경은 새 schema version이 필요합니다.

미지원 version은 `trace_capabilities_report_schema_unsupported`, 구조나 관계 손상은 `trace_capabilities_report_invalid`입니다. 오류에는 입력 report, project/run/event ID, 경로, payload와 credential을 넣지 않습니다. 새 실행 event나 저장 상태는 추가하지 않습니다.

## 결과

자동화는 help와 stderr를 해석하지 않고 현재 trace 계약과 migration 시점을 확인할 수 있습니다. Capability 조회는 실제 기본 mode를 바꾸거나 0.1.0 전환을 앞당기지 않으며, 다음 전환 fixture와 release 변경이 이 report 값을 함께 검증할 수 있습니다.
