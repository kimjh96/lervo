# ADR-0035: 인증된 peer와 lease에 결속된 outbound sync worker

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Hub sync 계약과 SQLite outbox는 각각 batch의 의미와 재시도 상태를 정의했지만 실제 전달 순서는 연결하지 않았습니다. 특히 Hub가 event를 저장한 뒤 응답만 유실하면 Node는 저장 여부를 알 수 없습니다. 이때 로컬 ack를 추정하면 event가 빠지고, 재전송을 막으면 복구할 수 없습니다.

Worker가 network, peer 인증, batch 검증과 SQLite 상태 전이를 한 구현에 섞으면 실제 HTTP transport나 다른 저장소를 붙일 때 핵심 규칙도 함께 바뀝니다. 또한 Hub 응답을 받았다는 이유로 `sync.acknowledged` event를 같은 원본 chain에 추가하면 그 event 자체가 다시 sync 대상이 되는 순환이 생깁니다.

## 결정

### 등록한 뒤 lease를 가져간다

`@lervo/sync`는 한 번의 outbound cycle을 실행합니다. 매 cycle은 현재 `ProjectManifest`로 registration 요청을 만들고, 구성된 destination과 peer identity가 인증된 응답인지 확인한 뒤 registration 응답 계약을 검증합니다. 등록이 실패하면 outbox를 claim하지 않고 `registration_deferred`와 안전한 failure code, 다음 시도 시각을 반환합니다.

등록 성공 뒤에만 해당 destination의 pending outbox를 최대 100개 claim합니다. Worker는 반환된 항목이 모두 자신의 유효한 lease인지 다시 확인합니다. Event는 seq로 정렬하고 hash chain이 이어지는 구간별로 나눕니다. 따라서 seq 1과 3만 lease에 있으면 각각 유효한 batch로 보낼 수 있고, Hub는 seq 3을 durable buffer에 둔 채 cursor를 1에 유지할 수 있습니다.

### Transport는 인증을 수행하고 worker는 좌표를 다시 확인한다

`AuthenticatedHubTransport`는 registration과 event batch 전송만 담당하는 port입니다. 실제 구현은 TLS, 서명 또는 동등한 방식으로 peer를 인증한 뒤 `status=verified`, destination ID와 peer identity hash를 반환해야 합니다. Interface의 객체만으로 암호학적 인증을 증명하지는 않습니다.

Worker는 응답 body를 읽기 전에 destination과 구성된 peer identity hash가 정확히 같은지 확인합니다. 그 뒤 registration 또는 ack schema와 요청 좌표를 다시 검증합니다. Ack의 batch·registration·project·destination·event ID 전체와 inserted/duplicate 개수가 맞아야 해당 batch의 lease를 ack합니다.

### Local outbox 전이는 batch 단위 transaction이다

유효한 durable ack를 받은 batch의 outbox 항목은 한 SQLite transaction에서 모두 `acknowledged`로 바꿉니다. Hub의 `acknowledgedAt`은 Hub 저장 시각이고, local outbox에는 worker clock의 실제 local 전이 시각을 기록합니다. 일부 항목만 바뀌면 완료를 반환하지 않습니다.

전송 실패, peer 불일치 또는 잘못된 ack가 생기면 아직 local ack하지 않은 lease 전체를 한 transaction에서 `pending`으로 돌리고 공통 `availableAt`을 정합니다. Hub에 이미 저장됐지만 응답이 유실된 경우에도 같은 canonical batch ID로 재전송합니다. Hub의 `duplicate` ack가 요청 전체와 맞으면 그때 local ack합니다. 앞 batch가 성공하고 뒤 batch가 실패했다면 앞 batch의 ack는 유지하고 뒤쪽만 재시도합니다.

Worker는 `sync.acknowledged` event를 만들지 않습니다. Outbox 상태가 local delivery receipt이며, 같은 sync 대상 chain에 ack event를 추가해 무한한 후속 배송을 만들지 않습니다. 이 event가 필요하다면 local-only stream이나 sync 제외 규칙을 먼저 별도 설계해야 합니다.

## 상태와 실패 의미

Cycle 결과는 원문 오류 대신 다음 상태와 count를 가집니다.

- `registration_deferred`: outbox를 claim하지 않았고 `failureCode`, `nextAttemptAt`만으로 등록 재시도를 예약할 수 있습니다.
- `idle`: 등록은 확인했지만 claim할 항목이 없습니다.
- `synchronized`: claim한 항목을 모두 local ack했습니다.
- `retry_scheduled`: `acknowledgedCount`는 이미 완료된 앞 batch, `rescheduledCount`는 다시 pending이 된 나머지 항목입니다.

| code | 의미와 처분 |
|---|---|
| `hub_unavailable` | Transport가 응답을 완료하지 못했습니다. 저장 여부를 추정하지 않고 같은 lease를 재시도합니다. |
| `transport_authentication_failed` | 인증 결과가 없거나 destination·peer identity가 다릅니다. Body를 신뢰하거나 local ack하지 않습니다. |
| `invalid_registration_response` | 등록 응답 schema 또는 요청 좌표가 다릅니다. Outbox를 claim하지 않습니다. |
| `invalid_sync_ack` | Ack가 보낸 batch 전체를 증명하지 못합니다. 현재와 아직 처리하지 않은 lease를 재시도합니다. |
| `local_batch_invalid` | Lease event로 유효한 연속 batch를 만들 수 없습니다. 전송 완료를 주장하지 않고 재시도 상태로 남깁니다. |
| `invalid_worker_configuration` | Manifest, clock, worker ID, peer hash 또는 실행 한도가 잘못된 호출 계약입니다. 자동 전송을 시작하지 않습니다. |
| `outbox_update_failed` | Claim 결과의 소유권이 다르거나 ack/reschedule transaction이 실패했습니다. 일부 성공을 반환하지 않고 운영자 진단이 필요합니다. |

Outbox에는 위 retry code와 시각만 남깁니다. Transport 예외, HTTP body, manifest, event payload, authorization과 credential은 failure 상태나 cycle 결과에 복제하지 않습니다. 이번 변경은 새 event type을 추가하지 않습니다.

## 검증

실제 SQLite fixture에서 연속 batch 성공과 idle 재실행, registration 실패 전 attempt 0 유지, gap을 둘로 나눈 역순 buffer, 다른 peer 응답과 변조 ack 거부를 확인했습니다. Hub state를 먼저 갱신하고 첫 응답만 유실한 fixture는 local outbox를 재예약했습니다. 다음 cycle은 같은 batch ID를 보내 duplicate ack를 받고 outbox를 완료했습니다. 이 과정에서 원본 event 수는 늘지 않았습니다.

## 결과

Core worker는 저장소, transport와 clock port만 사용하며 실제 protocol과 스케줄러를 소유하지 않습니다. Local run은 Hub 가용성과 계속 분리되고, reconnect는 추정이 아니라 deterministic batch와 duplicate ack로 복구됩니다. 다음 구현은 Hub 쪽 registration·event inbox·cursor를 실제 durable transaction에 저장하는 adapter입니다.
