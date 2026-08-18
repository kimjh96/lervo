# ADR-0014: Managed adapter session 경계 강화

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

한 파일 managed write가 동작한 뒤에도 공통 계약과 실제 실행 사이에는 세 가지 빈틈이 남았습니다. Adapter가 `startTurn`을 반환하기 전에 provider가 도구를 요청하면 orchestrator는 아직 provider turn ID를 알지 못했습니다. Descriptor의 최대 기능과 실행 모드에서 실제로 열린 기능을 같은 capability matrix로 기록해 읽기 전용 session이 파일 변경을 지원하는 것처럼 보일 수 있었습니다. 종료에 실패한 session state와 provider 결과 원문도 registry에 남을 수 있었습니다.

Provider별 승인 처리까지 adapter 본체에 섞여 있어 protocol 변경이 session 수명주기와 event 정규화에 함께 영향을 주었습니다. 한 파일이라는 현재 제한도 bridge의 조건문으로 흩어져 다음 다중 파일 단계에서 정책을 교체하기 어려웠습니다.

## 결정

### Turn 수락과 session 기능

`ProviderAdapter.startTurn`은 반환값과 별도로 동기 `accepted(turn)` callback을 받습니다. Adapter는 provider가 현재 turn의 도구를 실행할 수 있게 하기 전에 schema-valid turn을 이 callback으로 알립니다. Orchestrator는 callback에서 session, target turn과 provider turn 좌표를 확인하고 현재 turn을 공개합니다. Callback이 없거나 두 번 호출되거나 반환한 turn과 다르면 `contract_validation_failed`입니다.

`AdapterSession`은 `executionMode`와 `effectiveCapabilities`를 필수로 가집니다. Descriptor의 `capabilities`는 adapter 구현이 제공할 수 있는 최대 범위이고, session의 값은 현재 permission, sandbox와 tool 구성으로 실제 열린 범위입니다. Session은 descriptor가 지원하지 않는 기능을 `supported`로 넓힐 수 없습니다. `read_only`의 `fileChanges`는 지원으로 기록할 수 없고 `managed_write`는 지원이어야 합니다.

`adapter.started.capabilities`에는 descriptor가 아니라 session의 `effectiveCapabilities`를 기록합니다. 이 필드는 비밀정보가 아닌 기계용 기능 상태만 포함하며 prompt, tool input, 파일 원문과 provider 설정 원문을 포함하지 않습니다. 누락, schema 위반, descriptor보다 넓은 값과 실행 모드 불일치는 `contract_validation_failed`이며 provider 실행을 정상 관리 상태로 인정하지 않습니다.

### 쓰기 계획과 provider별 경계

Orchestrator는 `ManagedWritePlan`을 한 번 만들고 bridge에 전달합니다. 계획은 실행 모드, 정규화된 허용 경로, 최소·최대 검증 변경 수와 변경 뒤 context 처분을 가집니다. 현재 `read_only`는 `0..0`, `managed_write`는 `1..1`이며 변경 뒤 context를 무효화합니다. Bridge는 요청 경로와 완료 수를 계획으로 판정하므로 이후 여러 파일 단계는 provider adapter를 바꾸지 않고 계획 생성 규칙을 확장할 수 있습니다.

Codex와 Claude adapter는 승인 상태와 provider 메시지 해석을 각각 `ManagedWriteController`에 맡깁니다. Claude SDK의 Pre/PostToolUse 연결도 별도 hook 모듈로 둡니다. Adapter 본체는 session, context, turn, event와 종료 순서만 소유합니다. Managed write 요청·결정·완료의 schema, 좌표와 시간 결속은 `@lervo/adapter-contract`의 공통 contract suite로 두 adapter가 함께 검증합니다.

승인 뒤 완료가 없거나 실패 상태, 중복 요청·완료, 허용 경로 밖 요청과 실제 변경 종류 불일치는 실패합니다. 쓰기 bridge에서 시작된 실패는 `provider_write` phase를 보존합니다. 대표 실패 우선순위는 telemetry, artifact, provider stop, provider write, unmanaged change 순이므로 실제 쓰기 검증 실패가 뒤의 snapshot 결과에 가려지지 않습니다. 관련 실패 목록에는 두 사실을 모두 남깁니다.

### Session 종료와 원문 수명

Adapter stop은 interrupt, unsubscribe와 provider close를 시도한 뒤 성공 여부와 관계없이 registry state를 해제합니다. 주입·시작 turn ID, 승인 대기, 결과 원문과 active turn 참조를 비우고 session entry를 삭제합니다. 이후 같은 session을 사용하면 `session_not_found`입니다. Provider close가 실패하면 정리가 끝난 뒤 `provider_process_failed`를 반환하고 orchestrator는 이를 `provider_stop_failed`로 분류합니다.

종료 결과와 오류 event에는 새 개인정보 필드를 추가하지 않습니다. Provider 결과 원문은 검증과 CAS 저장에 필요한 동안만 adapter session state에 있고 종료 시 제거합니다. 직접 실행되어 관측할 수 없는 provider 작업은 이 경계를 통과한 것으로 간주하지 않으며 계속 `unmanaged`입니다.

## 결과

- Provider 도구 요청은 orchestrator가 검증한 현재 turn과 결속됩니다.
- Trace의 capability matrix가 구현의 최대치가 아니라 해당 session에서 실제 열린 기능을 나타냅니다.
- 종료 실패 뒤에도 오래된 승인과 결과 원문을 가진 session을 다시 사용할 수 없습니다.
- 쓰기 수량 정책, provider protocol과 session 수명주기가 분리되어 다음 다중 파일 단계의 변경 범위가 좁아집니다.
- Adapter schema는 공통 session/context, managed write, provider 관측 event와 원시 규격 파일로 나뉘며 공개 계약은 기존 package export를 유지합니다.
