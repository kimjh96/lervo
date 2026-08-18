# ADR-0009: Codex app-server managed adapter

- 상태: 채택
- 기준일: 2026-08-18

## 맥락

M2는 provider-neutral context envelope와 쓰기 gate를 만들었지만 실제 Codex process가 어떤 문서를 받았는지, 어느 turn을 실행했는지, compaction이 언제 일어났는지는 관측하지 못했습니다. 기존 adapter의 `normalized_event.type`도 append-only Roven event 이름을 그대로 사용해, provider가 보고한 file change가 실제 bytes까지 검증된 `file.changed`처럼 보일 위험이 있었습니다. 공통 adapter에는 raw task를 provider turn으로 시작하는 메서드도 없었습니다.

Codex CLI의 안정적인 `exec --json`은 JSONL 실행 event를 제공하지만 현재 context compaction lifecycle을 직접 구분하지 못합니다. App-server는 명령 자체가 experimental이지만 experimental API capability를 켜지 않은 surface에서도 thread 시작, model-visible item 주입, turn 시작·중단, item lifecycle과 `contextCompaction` item을 제공합니다. Roven의 E3와 generation 전이를 만들려면 이 구조화된 경계가 필요합니다.

## 결정

### Process와 session 경계

- `@roven/adapter-codex`는 managed session마다 `codex app-server --stdio` process 하나를 시작합니다.
- 연결 직후 `initialize` 요청과 `initialized` notification을 완료한 뒤 `thread/start` 응답의 thread ID를 provider session ID로 고정합니다.
- 기본 sandbox는 `read-only`, approval policy는 `never`입니다. 상위 정책 연결 없이 승인이나 client tool 요청을 대신 승인하지 않습니다.
- Adapter stop이 취소 사유이고 turn이 실행 중이면 `turn/interrupt`를 먼저 호출합니다. 그 뒤 `thread/unsubscribe`와 process 종료를 모두 완료해야 stop result를 반환합니다.
- 공통 계약에 `turn_request`와 `turn`을 추가합니다. 같은 target turn에 controlled context를 주입한 기록이 있어야 `turn/start`를 호출하며 target turn은 한 번만 시작합니다.

### Controlled context injection

- Inline 원문은 UTF-8 bytes로 다시 만들고, CAS 원문은 caller가 제공한 좁은 resolver로 읽습니다.
- 모든 문서의 byte count와 SHA-256을 envelope와 대조합니다. UTF-8로 손실 없이 왕복되지 않거나 한 문서라도 다르면 아무 item도 주입하지 않습니다.
- 문서마다 Role ID, writing policy ID와 문서 ID·path·hash·scope·원문을 가진 developer message를 만듭니다. `thread/inject_items` 성공 응답 전에는 receipt를 만들지 않습니다.
- Receipt는 provider가 입력을 이해하거나 따랐다는 주장이 아닙니다. 검증한 bytes를 model-visible history에 넣으라는 요청을 app-server가 수락했다는 E3 후보입니다.

### Provider signal과 원본 event 분리

- Adapter normalized signal은 `provider.*` namespace를 사용하며 append-only event type과 분리합니다.
- Command, output, tool arguments, diff와 provider error 원문은 signal payload에 저장하지 않습니다. Digest, provider item/turn ID, 상태, token count와 저장소 상대 경로만 허용합니다.
- Codex file change item은 `provider.file_change.reported`입니다. Orchestrator의 permit와 실제 before/after bytes 검증 없이는 `file.changed`가 될 수 없습니다.
- 완료된 `contextCompaction` item은 `provider.context.compacted`입니다. Deprecated `thread/compacted`는 호환 입력으로만 받습니다.
- Orchestrator는 adapter session과 signal의 project/run/session/provider session 좌표를 확인합니다. 일치한 compaction/restart만 기존 `context.invalidated` event와 generation 증가로 바꿉니다.
- 첫 슬라이스는 provider session resume을 실행하지 않으므로 `sessionResume=unsupported`입니다. Tool, command, file report, compaction과 usage는 app-server item/notification에서 직접 관측하므로 `supported`입니다.

### 실패와 개인정보 처리

| 상황 | 의미와 처분 |
|---|---|
| 잘못된 adapter/session/turn 좌표 | `invalid_request` 또는 `session_mismatch`; provider 호출 전 거부 |
| 문서 byte count/hash/UTF-8 또는 CAS 읽기 실패 | `context_materialization_failed`; receipt와 turn을 만들지 않음 |
| JSONL handshake, response 또는 schema 오류 | `provider_protocol_failed`; managed stream을 실패시키고 변경 capability를 열지 않음 |
| Process 예외 종료 또는 안전한 stop 실패 | `provider_process_failed`; 정상 종료를 주장하지 않음 |
| 알 수 없는 server request | JSON-RPC 오류로 fail-closed; 승인이나 도구 실행을 추정하지 않음 |
| 다른 provider session의 compaction/restart | `contract_validation_failed`; generation과 event store를 변경하지 않음 |

Raw task instructions, context 원문과 credential은 adapter process 입력에만 존재하며 normalized signal이나 append-only event에 복제하지 않습니다. Stderr와 provider 오류 본문도 저장하지 않고 기계용 code와 diagnostic digest만 사용합니다.

## 결과

- Codex session, context와 turn이 같은 provider thread에 묶이고, 문서 변조나 turn 선행 실행이 fail-closed로 막힙니다.
- Provider가 보고한 상태와 Roven이 검증한 원본 event를 이름만으로 구분할 수 있습니다.
- 실제 compaction 신호가 과거 E3 generation을 닫지만 중복 신호는 generation을 반복 증가시키지 않습니다.
- Claude adapter는 같은 turn과 provider signal 계약을 구현하되 얻을 수 없는 telemetry를 그대로 `unknown/unsupported`로 표시할 수 있습니다.
