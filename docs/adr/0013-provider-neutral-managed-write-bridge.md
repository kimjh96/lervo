# ADR-0013: Provider-neutral managed write bridge

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

M2는 현재 context generation의 E3와 Role 정책을 확인해 경로별 1회용 파일 쓰기 permit를 만들 수 있었습니다. M3 provider run은 실행 전후 snapshot과 unmanaged 변경도 찾았습니다. 그러나 Codex와 Claude의 실제 파일 변경 요청을 이 permit에 연결하는 공통 경계가 없어 provider run은 읽기 전용으로만 제한했습니다.

Provider별 raw payload를 orchestrator가 직접 해석하면 정책과 공급자 protocol이 섞입니다. 반대로 adapter의 “변경 완료” 보고만 믿으면 실제 bytes와 permit의 일치를 증명할 수 없습니다. 승인 요청에 diff, 파일 원문이나 tool input을 그대로 싣는 방식도 event와 Hub 경계의 개인정보 최소화 원칙에 맞지 않습니다.

## 결정

### 책임 분리

- `ProviderAdapter`는 session에 `ProviderManagedWriteBridge`를 연결합니다. Adapter는 provider protocol을 공통 요청·결정·완료 메시지로 바꾸고, orchestrator는 Codex나 Claude payload를 알지 않습니다.
- `ManagedProviderWriteBridge`는 현재 session·turn 좌표, 시간 순서와 중복 요청을 검사한 뒤 `ManagedContextRun`에 permit 발급을 요청합니다. 완료 뒤 실제 파일 hash를 읽고 M2의 `recordFileChange`를 호출합니다.
- Context gate는 Role 정책, 예상 경로, E3 generation, target digest와 before/after hash를 계속 소유합니다. Adapter와 bridge가 이를 복제하지 않습니다.
- 실행 후 snapshot 판정은 bridge가 돌려준 변경 증거와 실행 전후 hash가 정확히 같은 경로만 managed 변경으로 제외합니다. 나머지는 unmanaged로 남깁니다.

### 실행 모드와 범위

`AdapterStartRequest`와 `AdapterSession`의 `executionMode`는 `read_only` 또는 `managed_write`입니다. Role의 `filesystem.write=deny`는 읽기 전용, `allow`는 managed write로 해석합니다. 검증된 사람 승인 원본이 없는 `require_approval`은 아직 실행하지 않습니다.

첫 수직 슬라이스는 context 준비 때 선언하고 정규화한 `expectedPaths` 중 정확히 한 파일만 변경합니다. 승인된 변경이 없거나 두 번째 변경이 필요하면 현재 run을 완료하지 않습니다. 첫 변경 뒤 context generation과 E3가 무효화되므로 여러 파일 변경은 이후 재주입 또는 단계별 run 계약으로 확장합니다.

Codex는 sandbox를 `read-only`로 유지합니다. 읽기 전용에서는 approval policy를 `never`, managed write에서는 `on-request`로 사용합니다. `item/started`의 단일 `fileChange` 제안과 `item/fileChange/requestApproval`의 thread·turn·item 좌표가 맞을 때만 bridge에 요청합니다. 여러 파일, 이동, 안전하지 않은 경로, command approval과 연결되지 않은 요청은 거부합니다. `item/completed` 뒤에만 완료를 보고합니다.

Claude는 읽기 전용에서 `plan` mode와 `Read`, `Glob`, `Grep`만 사용합니다. Managed write에서는 `default` mode와 `Read`, `Glob`, `Grep`, `Write`, `Edit`만 허용합니다. PreToolUse에서 bridge 승인을 받고 PostToolUse 또는 PostToolUseFailure에서 완료 상태를 보냅니다. Bash, Agent, Task, 외부 MCP, 자동 skill과 filesystem setting source는 열지 않습니다.

### 공통 메시지

세 메시지는 adapter schema에 포함됩니다.

| 메시지 | 필수 필드 |
|---|---|
| `managed_write_request` | 공통 좌표, `requestedAt` |
| `managed_write_decision` | 공통 좌표, `decision`, `reasonCode`, `decidedAt` |
| `managed_write_completion` | 공통 좌표, `status`, `completedAt` |

공통 좌표는 `adapterId`, project/run/session/provider session, target/provider turn, provider item, 저장소 상대 `path`, `targetDigest`, `changeKind`입니다. `changeKind`는 `created`, `modified`, `deleted`, 또는 provider가 생성과 수정을 구분하지 못할 때 쓰는 `upsert`입니다. 허용 결정은 `reasonCode=authorized`만 사용할 수 있습니다. 거부 이유는 승인 필요, bridge 부재, capability 거부, 잘못된 요청, 필수 context 부재, telemetry 기록 실패 중 하나입니다.

이 메시지는 adapter와 orchestrator 사이의 로컬 제어 메시지이며 append-only event가 아닙니다. 파일 bytes, diff, command, tool input과 provider 오류 본문을 넣지 않습니다. `targetDigest`만 원문 없는 결속값으로 전달합니다. 경로는 정규화한 저장소 상대 경로만 허용합니다.

### 완료와 실패

승인 직전에 실제 before hash를 permit에 묶습니다. 완료 보고 뒤 실제 after hash를 다시 읽어 생성·수정·삭제 종류를 확인합니다. 이 값이 맞아야 `file.changed`와 `context.invalidated`를 같은 event transaction에 기록하고 permit를 폐기합니다. 마지막 snapshot에서도 같은 before/after hash가 확인되어야 run이 완료됩니다.

새 실패 code는 `provider_write_failed`입니다. 승인된 변경이 완료되지 않음, 완료 상태가 실패 또는 거부임, 요청한 변경 종류와 실제 상태가 다름, 승인만 남음, managed write run에서 정확히 한 변경이 없음, 변경 증거와 최종 snapshot이 다름을 뜻합니다. 정상 `file.changed`와 run 완료를 만들지 않으며 자동 재시도하지 않습니다. Permit 밖의 추가 경로는 별도로 `unmanaged_change.detected`와 `unmanaged_change_detected`를 남깁니다. 여러 실패가 겹치면 기존 실패 원장에 단계와 함께 모두 보존합니다.

## 결과

- Codex와 Claude가 같은 경로·context·hash 규칙으로 실제 한 파일 변경을 완료합니다.
- Provider별 승인 protocol은 adapter 안에 남고, orchestrator의 정책과 증거 모델은 공급자에 종속되지 않습니다.
- Provider가 보고한 의도와 실제 bytes, 실행 전후 저장소 상태를 각각 대조하므로 직접 변경을 managed 작업으로 위장할 수 없습니다.
- 다음 작업은 이 실행 계약을 `roven run` CLI와 fixture repository에 연결하는 한 파일 수직 슬라이스입니다.

Turn 수락, session의 실제 capability, 종료 정리, 쓰기 계획과 adapter controller 분리는 [ADR-0014](./0014-managed-adapter-session-hardening.md)에서 보완했습니다.
