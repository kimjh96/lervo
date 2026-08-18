# ADR-0012: Provider-neutral 결과 artifact

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Normalized provider event는 실행 사실을 추적하기 위한 개인정보 최소화 경계라서 최종 답변 원문을 포함하지 않습니다. 그러나 원문을 전혀 전달하지 않으면 managed run이 성공해도 사용자가 결과를 읽을 수 없고, 다른 역할이 결과를 공유 맥락으로 발행하거나 writing 검증을 수행할 원본도 없습니다.

Provider 결과를 terminal event payload에 넣으면 event store와 Hub outbox에 원문이 복제됩니다. 반대로 adapter가 임의 파일을 직접 만들게 하면 저장 위치, hash, run/turn 좌표와 무결성을 공통 계약으로 검증할 수 없습니다.

## 결정

### 별도 결과 계약

- `ProviderAdapter.getTurnResult(session, turn)`은 terminal 완료 뒤 `AdapterTurnResult`를 반환합니다. Normalized event stream과 분리된 로컬 호출입니다.
- 결과는 session/turn 좌표, 고정 media type `text/markdown; charset=utf-8`, 원문, SHA-256, UTF-8 byte count와 생산 시각을 가집니다.
- 공통 계약은 좌표, schema, 손실 없는 UTF-8 왕복, turn 수락 이후 시각, 최대 4 MiB와 실제 bytes의 hash·크기를 검사합니다.
- Codex는 같은 turn의 마지막 완료 `agentMessage.text`를, Claude는 성공 `result.result`를 수집합니다. 결과가 없거나 다른 turn/session에 묶이면 정상 완료를 만들지 않습니다.

### Artifact 저장과 event

- Orchestrator는 terminal 뒤 결과를 메모리에서 검증하지만 adapter 종료와 실행 후 snapshot이 모두 성공하기 전에는 완료 artifact로 저장하지 않습니다.
- 결과 저장소는 `put` 뒤 같은 URI를 다시 `get`하여 URI, hash, byte count와 bytes를 모두 대조해야 합니다. 기본 구현은 로컬 CAS이며 URI는 `roven-cas://sha256/<digest>`입니다.
- Artifact ID는 같은 content hash에서 `art_<digest>`로 결정적으로 만듭니다. `ManagedProviderRunResult`는 ID, URI, media type, hash와 byte count만 공개합니다. 원문은 호출자가 허가된 local artifact store에서 읽습니다.
- `run.completed.resultDigest`는 결과 content hash이고 `artifactIds`에는 결과 artifact ID 하나가 들어갑니다. Event에는 URI와 원문을 넣지 않습니다.
- Provider 종료, telemetry 또는 unmanaged 변경이 실패하면 결과를 `run.completed` artifact로 공개하지 않습니다. CAS 저장 뒤 완료 event 기록이 실패해 남은 content-addressed object는 완료 증거로 간주하지 않으며 후속 정리 대상입니다.

### 실패와 개인정보 처리

| code | 의미와 처분 |
|---|---|
| `provider_result_failed` | 완료 signal 뒤 provider 결과를 얻지 못했습니다. 정상 run 결과를 만들지 않습니다. |
| `contract_validation_failed` | 결과 schema, 좌표, 시각, UTF-8, 크기 또는 hash 계약이 다릅니다. 원문을 저장하지 않습니다. |
| `artifact_storage_failed` | CAS 쓰기나 다시 읽기 검증이 실패했습니다. `run.completed`를 기록하지 않습니다. |

Result 원문은 local adapter와 artifact store 사이에서만 이동합니다. Normalized signal, `run.completed`, `run.failed`, diagnostic digest와 provider 오류에는 복제하지 않습니다. Artifact 보존·Hub 업로드·역할 간 공개는 별도 정책을 통과해야 합니다. 이 artifact가 존재한다는 사실만으로 writing 정책, 의미 품질, 인용 또는 E4가 검증된 것은 아닙니다.

## 결과

- Codex와 Claude가 같은 결과 schema와 CAS 무결성 검사를 통과합니다.
- 실행 telemetry의 원문 비저장 원칙을 유지하면서 사용자가 읽을 수 있는 로컬 결과 원본을 얻습니다.
- Writing 검증, shared context 발행과 CLI 출력이 provider별 raw payload 대신 같은 artifact 좌표를 사용할 수 있습니다.
- `roven run` 공개에는 아직 경로별 managed write bridge와 공개 정책 연결이 필요합니다.
