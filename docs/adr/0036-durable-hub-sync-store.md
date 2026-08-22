# ADR-0036: 응답보다 먼저 commit하는 Hub sync 저장소

- 상태: 일부 대체됨 — 비동기 command port와 증분 수락 경계는 [ADR-0038](./0038-bounded-async-hub-storage-and-trace.md)을 따름
- 기준일: 2026-08-19

## 맥락

Node worker는 Hub의 ack가 registration, project, destination과 batch 전체에 맞을 때만 local outbox를 완료합니다. 그러나 Hub 수신 측이 메모리 state를 바꾼 뒤 먼저 ack하거나 registration, event와 cursor를 따로 저장하면 그 응답은 durable acceptance를 뜻하지 않습니다. 재시작 뒤 event가 사라지거나 cursor만 앞서면 Node는 이미 local 원본의 재전송을 멈춘 상태가 됩니다.

순수 `sync-contract` reducer에 SQLite와 응답 수명주기를 넣으면 저장 방식이 domain 규칙에 섞입니다. 반대로 SQLite adapter가 batch 의미까지 다시 구현하면 중복·역순·충돌 판정이 두 군데로 갈라집니다.

## 결정

### Reducer, handler와 SQLite adapter를 분리한다

`@lervo/sync-contract`는 현재 state와 요청으로 다음 state와 응답 후보만 계산합니다. `@lervo/hub-sync`는 동기 transaction port 안에서 현재 project를 읽고 reducer를 호출한 뒤 다음 state를 저장합니다. Store의 commit이 끝난 뒤에만 handler가 registration response나 acknowledgement를 반환합니다. 비동기 callback은 transaction 밖으로 빠져나갈 수 없도록 거부합니다.

`@lervo/hub-sync-sqlite`는 Hub project, event inbox와 cursor의 schema, migration, transaction과 무결성만 소유합니다. HTTP route, Node 인증, 권한 판정과 화면 projection은 이 패키지에 넣지 않습니다. 실제 transport는 인증과 authorization을 끝낸 요청만 handler에 전달해야 하며, 이번 interface만으로 그 절차를 증명하지 않습니다.

### Project 좌표와 원본을 함께 저장한다

Project lookup과 충돌 좌표는 `(destinationId, projectId)`입니다. Registration ID만 조회 키로 쓰지 않습니다. 같은 destination과 project에 생성 identity가 다른 요청이 오면 기존 state를 reducer에 전달해 `registration_identity_conflict`로 거부합니다. 같은 identity의 이름·data policy 변경은 request 원본과 manifest hash를 갱신하며 기존 event와 cursor를 유지합니다.

`hub_projects`에는 전체 registration request, 등록·갱신 시각과 cursor를 저장합니다. `hub_events`에는 allowlist를 통과한 전체 `EventEnvelope`를 project seq 순서로 저장합니다. 조회용 registration·event ID, hash, seq와 JSON 원본은 열기와 저장 때마다 서로 대조합니다. Event row는 update/delete trigger로 append-only이고 project row는 삭제할 수 없습니다. Registration snapshot과 cursor만 transaction 안에서 갱신할 수 있습니다.

### Registration, inbox와 cursor는 한 commit이다

Registration은 project row가 commit된 뒤 응답합니다. Event batch는 현재 registration과 inbox를 읽고 reducer의 다음 state를 계산한 뒤 새 event insert와 cursor update를 `BEGIN IMMEDIATE` transaction 하나에 넣습니다. `WAL`, `synchronous=FULL`, foreign key와 schema migration을 사용합니다. 저장 직후 같은 transaction에서 다시 읽은 state가 계획과 다르면 rollback합니다.

Gap 뒤 batch는 event inbox에 commit하지만 cursor는 그대로 둡니다. 앞 batch가 오면 저장된 hash chain을 다시 확인해 cursor를 한 transaction에서 전진시킵니다. 이미 commit한 batch가 다시 오면 새 row 없이 `duplicate` ack를 반환합니다. Cursor update가 실패하면 앞서 insert한 event도 rollback하므로 재시도는 `accepted`로 시작합니다.

Store를 열 때 SQLite quick check, foreign key, append-only trigger와 모든 project state를 다시 검증합니다. 두 project는 같은 destination 아래에서도 별도 좌표와 event chain으로 유지됩니다. `listProjectCoordinates`는 다음 read model이 project를 분리해 조회할 수 있는 최소 경계이며 아직 trace 화면을 뜻하지 않습니다.

## 실패 의미와 개인정보

| code | 의미와 처분 |
|---|---|
| `closed` | 닫힌 store 호출입니다. 응답을 만들지 않습니다. |
| `nested_transaction` | 같은 connection의 중첩 transaction입니다. 내부 commit을 시작하지 않습니다. |
| `transaction_async` | Callback이 Promise를 반환했습니다. Transaction을 rollback하고 응답을 반환하지 않습니다. |
| `read_failed` | Read snapshot 시작·조회·commit 또는 rollback이 실패했습니다. 일부 조회 결과를 반환하지 않습니다. |
| `integrity_failed` | Schema metadata, trigger, row 중복 좌표, event hash chain, cursor 또는 SQLite 검사가 유효하지 않습니다. Store를 정상 개방하거나 조회하지 않습니다. |
| `state_conflict` | 기존 identity, cursor 또는 append-only event를 되돌리거나 바꾸려 했습니다. 기존 state를 유지합니다. |
| `write_failed` | Transaction 시작, insert, cursor update, commit 또는 rollback이 실패했습니다. Durable ack를 반환하지 않습니다. |

Hub DB에는 project manifest와 allowlist event 원본만 저장합니다. Repository 본문, prompt, 문서·스킬 본문, command output, authorization과 credential은 sync 계약에 없으며 오류에도 복제하지 않습니다. 오류 표면은 위 code와 고정된 설명만 사용합니다. 이번 변경은 새 event type이나 telemetry 상태를 추가하지 않습니다.

## 검증

실제 SQLite에서 registration 재시작·갱신, 같은 destination의 두 project 격리, 뒤 batch 선저장과 gap 해소, commit 뒤 같은 batch의 duplicate 응답, identity 충돌과 미등록 batch 거부를 확인했습니다. Cursor update에 실패하는 trigger를 넣은 fixture는 먼저 insert한 event까지 rollback했고, trigger 제거 뒤 같은 batch를 새로 accepted했습니다.

Node의 실제 SQLite outbox와 Hub SQLite store를 한 흐름으로 연결한 fixture에서는 Hub commit 직후 첫 응답을 유실했습니다. Hub에는 event 2개가 남고 local outbox는 pending으로 돌아갔습니다. 다음 cycle은 같은 batch를 보내 duplicate ack를 받은 뒤 local outbox 2개를 acknowledged로 전환했으며 local event 원본 수는 변하지 않았습니다.

## 결과

Durable acceptance의 근거가 reducer의 메모리 계산이 아니라 실제 commit 경계까지 이어졌습니다. SQLite adapter는 protocol이나 화면을 소유하지 않으므로 다른 durable store도 같은 `HubSyncStore` contract를 구현할 수 있습니다. Project와 run을 분리하는 조회 의미는 [ADR-0037](./0037-hub-trace-read-model.md), 인증된 실제 HTTP 수신은 [ADR-0150](./0150-authenticated-project-scoped-hub-sync-http.md)에서 이어집니다.
