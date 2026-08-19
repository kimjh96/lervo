# ADR-0034: 프로젝트 등록과 연속 cursor 기반 event sync 계약

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

로컬 SQLite outbox는 event와 전송 대상을 같은 transaction에 넣고, lease·재시도·ack 상태를 관리합니다. 하지만 무엇을 Hub project로 등록하는지, 여러 event를 어떤 단위로 보내는지, Hub의 어떤 응답을 받은 뒤 로컬 outbox를 ack해도 되는지는 정하지 않았습니다.

Batch가 중복되거나 순서가 바뀌는 것은 정상적인 네트워크 상황입니다. Hub가 도착 순서만으로 read model을 전진시키면 중간 event가 없는 trace를 완성된 이력처럼 보여줄 수 있습니다. 반대로 로컬 run을 Hub 응답에 묶으면 Hub 장애가 local-first 실행을 막습니다.

## 결정

### Project identity와 갱신 가능한 manifest를 분리한다

등록 요청은 전체 `ProjectManifest`, project identity hash, manifest hash, destination ID, 요청 시각과 sync policy를 가집니다. Project manifest에는 저장소 본문이나 credential이 없으며 Hub에 표시할 project 이름과 data policy가 들어 있습니다. `hubSyncEnabled=true`와 `eventPayloadMode=allowlist`가 아니면 등록 요청을 만들 수 없습니다. Artifact 전송은 이번 범위에서 `none`입니다.

Project identity hash는 `schemaVersion`, `projectId`, `createdAt`에 묶입니다. Registration ID는 destination ID와 identity hash의 canonical SHA-256 전체를 사용합니다. 이름이나 data policy가 바뀌면 같은 registration의 manifest 갱신이고, 생성 시각이 다른 identity를 같은 Hub project 좌표에 넣으려 하면 충돌입니다.

등록 응답 상태는 다음과 같습니다.

- `registered`: 처음 등록했습니다.
- `updated`: identity는 같고 manifest snapshot이 바뀌었습니다.
- `unchanged`: 요청 시각을 제외한 등록 내용이 기존 원본과 같습니다.

응답은 현재 연속 event cursor도 반환합니다. v0는 한 project registration에 하나의 authoritative local event chain만 허용합니다. 같은 manifest를 복제한 두 Node가 독립적으로 event를 만든 경우 Hub는 같은 seq의 다른 hash를 충돌로 거부합니다. Worktree·clone별 Node identity와 쓰기 권한 조정은 별도 결정으로 남깁니다.

### Batch 내부는 연속이고 batch 사이는 역순일 수 있다

`OutboundEventBatch`는 하나의 registration, project와 destination에 속한 event 1개 이상 100개 이하를 가집니다. Batch 내부 event는 seq가 1씩 증가하고 각 `previousHash`가 바로 앞 event hash와 같아야 합니다. Batch에는 첫·마지막 seq, 앞 hash와 head hash를 중복 좌표로 넣고 전체 canonical 내용의 SHA-256으로 batch ID를 계산합니다.

각 event는 로컬 `EventEnvelope` schema와 event hash를 다시 통과해야 합니다. Payload를 공통 allowlist로 다시 정리했을 때 field가 제거되거나 내용이 달라지면 batch를 만들지 않습니다. CAS artifact, 문서·스킬 본문, raw prompt, provider 응답, command output과 credential은 batch 계약에 없습니다.

서로 다른 batch는 역순으로 도착할 수 있습니다. Hub 수락 의미의 참조 reducer는 `(projectId, seq)`와 `(projectId, eventId)`를 모두 대조합니다. 같은 canonical event의 재전송은 duplicate이고, 같은 좌표의 다른 event는 chain conflict입니다. 앞 구간이 없으면 event를 보관하되 cursor는 움직이지 않습니다. 빈 구간이 채워지고 hash가 연결될 때만 cursor를 가장 높은 연속 seq까지 전진시킵니다.

### Ack는 저장 완료 뒤에만 전송한다

`EventSyncAcknowledgement`의 필수 필드는 다음과 같습니다.

- registration, project, destination과 batch ID
- batch의 event ID 전체
- `accepted` 또는 `duplicate` 상태
- inserted·duplicate 개수
- 현재 연속 cursor와 gap 뒤에 보관된 event 개수
- ack 시각

Node는 batch 좌표와 event ID 전체가 일치하는 ack만 받아들입니다. Cursor가 batch 끝보다 낮아도 Hub가 gap 뒤 event를 durable하게 보관했다면 해당 batch의 outbox 항목을 ack할 수 있습니다. 누락된 앞 batch는 별도 outbox 항목으로 계속 재시도합니다.

`@lervo/sync-contract`의 reducer는 다음 state와 응답 후보를 계산하는 순수 참조 구현입니다. 파일, DB, network와 outbox를 쓰지 않습니다. 실제 Hub handler는 project registration, event inbox와 cursor를 하나의 durable transaction으로 저장한 뒤에만 등록 응답이나 ack를 보내야 합니다. Node worker도 구성된 destination의 인증된 transport에서 받은 응답을 검증한 뒤에만 outbox lease를 ack해야 합니다. 이번 계약은 transport 인증서나 서명을 대신하지 않습니다.

## 상태와 실패 의미

| code | 의미와 처분 |
|---|---|
| `project_sync_disabled` | Project data policy가 Hub sync를 허용하지 않습니다. 등록 요청과 outbox 전송을 시작하지 않습니다. |
| `invalid_registration` | Manifest, identity·manifest hash, registration ID 또는 응답 좌표가 다릅니다. 등록·갱신 완료를 주장하지 않습니다. |
| `registration_identity_conflict` | 같은 destination과 project 좌표에 다른 생성 identity가 있습니다. 기존 chain을 유지하고 자동 병합하지 않습니다. |
| `registration_required` | Batch와 일치하는 등록 원본이 없습니다. Event를 저장하거나 ack하지 않습니다. |
| `invalid_event_batch` | Event schema·allowlist·hash, batch 연속 범위 또는 batch ID가 유효하지 않습니다. 전송 성공으로 처리하지 않습니다. |
| `event_chain_conflict` | 같은 seq나 event ID에 다른 원본이 있거나 gap이 채워진 뒤 hash가 이어지지 않습니다. Cursor와 기존 event를 유지하고 수동 진단을 요구합니다. |
| `invalid_acknowledgement` | Ack가 batch의 좌표·event 전체·개수·상태를 증명하지 못합니다. 로컬 outbox lease를 ack하지 않습니다. |
| `invalid_sync_state` | Hub에 보관된 registration, event 또는 cursor 원본이 서로 맞지 않습니다. 새 응답을 만들지 않습니다. |

이번 변경은 새 local event를 추가하지 않습니다. `sync.acknowledged`를 같은 outbound 원본 chain에 추가하면 ack event 자체가 다시 동기화되는 순환이 생기므로 Node worker도 이 event를 기록하지 않습니다. 별도 local-only stream이나 sync 제외 규칙을 설계하기 전에는 outbox 상태가 local delivery receipt입니다. 전송·수신 오류 문자열에는 manifest나 event payload를 복제하지 않고 위 기계용 code만 남깁니다.

## 검증

실제 event hash를 가진 두 project fixture로 등록 격리, manifest 갱신, sync 비활성 거부를 확인했습니다. 뒤 batch를 먼저 수락하면 cursor가 0에 머물고 앞 batch 도착 뒤 4까지 전진합니다. 같은 batch 재전송은 duplicate이며, 다른 project batch, 같은 seq의 다른 event, 불연속 batch, 변조된 batch·ack와 allowlist 밖 `rawPrompt`는 모두 거부합니다.

## 결과

로컬 event 원본과 outbox 수명주기는 Hub 가용성과 계속 분리됩니다. Hub는 역순 도착을 저장할 수 있지만 연속 chain이 확인되기 전에는 trace cursor를 전진시키지 않습니다. 기존 outbox lease와 인증된 transport port의 연결은 [ADR-0035](./0035-outbound-sync-worker.md)에서 이어집니다.
