# ADR-0003: 로컬 event store, outbox와 CAS

상태: `accepted`  
기준일: 2026-08-18

## 맥락

Roven의 실행 증거는 Hub가 없어도 로컬에서 완결되어야 한다. Event 순서와 연결 관계를 재시작 뒤에도 복구해야 하며, raw prompt와 문서 본문 같은 큰 원문은 event metadata와 분리해야 한다. 같은 event의 재전송은 중복 기록을 만들지 않아야 하고, 이미 기록한 event를 조용히 수정하거나 삭제할 수 없어야 한다.

Node 22.13부터 별도 실행 플래그 없이 사용할 수 있는 내장 `node:sqlite`를 선택한다. v0는 별도 네이티브 addon보다 Node 런타임과 함께 배포되는 동기 API로 로컬 단일 writer 경계를 단순하게 유지한다. `node:sqlite`의 안정도와 API 변화는 Node 버전 상향 시 다시 검토한다.

## 결정

### SQLite event store

- 기본 경로는 `.roven/state/events.sqlite`이며 database metadata에 project id와 storage schema version을 기록한다.
- `seq`는 run별이 아니라 project 전체에서 1부터 증가한다.
- 첫 event의 `previousHash`는 `null`이고 이후 event는 직전 project event의 hash를 가리킨다.
- Event hash와 canonical JSON은 저장 구현이 아닌 공통 event 계약에 둔다. `eventHash`를 제외한 전체 envelope를 key 정렬 canonical JSON으로 직렬화한 SHA-256이며 배열 순서는 유지한다.
- Raw payload는 저장 transaction 전에 type별 allowlist와 민감 키 제거를 통과한다.
- 저장소는 동기 `transact` callback을 제공한다. 각 append는 이 경계 안에서 tail 조회, seq/hash 계산, schema 검증과 insert를 끝내며 callback 실패 시 그 안의 작업을 모두 되돌린다. 비동기와 중첩 callback은 거부한다.
- Schema 변경은 `PRAGMA user_version` 기반의 순차 migration으로 적용한다. Version 2는 기존 event를 유지하면서 outbox table과 준비 항목 index를 추가한다.
- Event id는 전체 store에서 고유하다. 같은 id와 같은 정리된 내용은 기존 event를 반환하고 다른 내용은 `event_id_conflict`로 거부한다.
- `events` table의 update와 delete는 trigger로 차단한다.
- SQLite는 WAL, `synchronous=FULL`, foreign key, 5초 busy timeout을 사용하며 extension loading을 허용하지 않는다.
- Store를 열 때 SQLite `quick_check`와 전체 event의 schema, seq, previous hash, event hash를 검사한다.
- Store를 열 때 외래 키와 outbox 식별자, 정규화된 시각, lease/실패 좌표도 검사한다.

### Transactional outbox

- Event append와 outbox enqueue는 같은 동기 transaction에서 commit하거나 함께 rollback한다. Hub가 비활성화된 로컬 실행은 event만 기록한다.
- 멱등 키는 `(event_id, destination_id)`다. 같은 event를 여러 destination에 보낼 수 있고 같은 조합의 중복 enqueue는 첫 schedule을 유지한다.
- 상태는 `pending`, `leased`, `acknowledged`다. Lease owner, 시작 시각과 만료 시각은 항상 함께 존재하며 ack된 항목에는 lease가 없다.
- Claim은 `available_at`, `enqueued_at`, event id, destination id 순서로 준비된 항목을 가져온다. `BEGIN IMMEDIATE` 경계 안에서 lease와 attempt count를 갱신한다.
- 유효한 lease는 다른 worker가 가져갈 수 없다. 만료된 lease는 회수하며 attempt count를 증가시킨다.
- Ack와 재시도 예약은 현재 유효한 lease 소유자만 할 수 있다. Ack는 멱등적이며 실패 시 lease를 놓고 다음 시각을 예약한다.
- 전송 실패는 64자 이하의 소문자 code와 시각만 저장한다. 예외 메시지, 응답 본문, authorization 값과 provider payload는 저장하지 않는다.
- Ack 보존 정리는 기준 시각 전의 acknowledged row만 제한된 수로 삭제한다. Event와 pending/leased row는 삭제하지 않는다.

### Event store 오류 의미

| code | 의미와 처분 |
|---|---|
| `closed` | 닫힌 connection 사용 오류이며 다시 열기 전에는 기록하지 않는다. |
| `invalid_event` | 최종 event schema가 유효하지 않아 transaction을 되돌리고 `contract_validation_failed`로 처리한다. |
| `project_mismatch` | 다른 project의 database 또는 event이므로 열기나 기록을 거부한다. |
| `event_id_conflict` | 기존 id와 정리된 내용이 달라 재전송으로 볼 수 없으므로 기록하지 않는다. |
| `integrity_failed` | SQLite 검사나 hash chain이 일치하지 않는다. `telemetry_recording_failed`로 처리하고 변경 capability를 닫는다. |
| `nested_transaction` | 이미 열린 transaction 안에서 다시 transaction을 시작했으므로 전체 작업을 되돌린다. |
| `transaction_async` | 동기 저장 경계에 비동기 callback을 전달했으므로 commit하지 않고 되돌린다. |
| `invalid_outbox_request` | 식별자, 시각, lease 기간, limit 또는 실패 code가 계약에 맞지 않아 transaction을 되돌린다. |
| `outbox_not_found` | 대상 event나 배송 좌표가 없으므로 enqueue/ack/retry를 수행하지 않는다. |
| `outbox_lease_conflict` | 다른 worker의 lease 또는 만료된 lease이므로 ack/retry를 거부하고 현재 상태를 유지한다. |

오류 event에는 raw payload나 SQLite row를 복제하지 않는다. Error code, event id가 필요하면 digest, project/run 좌표만 allowlist에 따라 기록한다.

### 파일 CAS

- 기본 root는 `.roven/state/cas`다.
- Object 주소는 원문 bytes의 SHA-256이며 URI는 `roven-cas://sha256/<64 hex>`다.
- 파일 경로는 `sha256/<앞 2자리>/<나머지>`로 나눠 한 디렉터리에 object가 몰리지 않게 한다.
- 입력 청크를 임시 파일에 쓰면서 SHA-256과 byte count를 계산한다. 생산자가 실패하면 임시 파일을 제거하며 전체 bytes를 메모리에 모으지 않는다.
- 임시 파일을 `fsync`한 뒤 같은 파일 시스템의 hard link로 대상 이름을 원자적으로 확정한다.
- 이미 대상이 있으면 새로 덮어쓰지 않고 실제 bytes의 hash를 다시 검사한다.
- 읽을 때도 URI의 hash와 실제 bytes를 비교하며 심볼릭 링크나 일반 파일이 아닌 object를 거부한다.
- 원문은 CAS에만 있고 event payload에는 URI, content hash, byte count 같은 허용 metadata만 둔다.

CAS의 `not_found`, `corrupt_object`, `unsafe_path`, `invalid_uri`는 상위 실행에서 `artifact_storage_failed`로 처리한다. `has`는 `not_found`일 때만 `false`를 반환하고 hash 불일치는 `corrupt_object`로 전달한다. 필수 artifact를 저장하거나 확인할 수 없으면 그 artifact에 의존하는 변경을 중단한다. 실패 기록에는 원문 대신 code와 digest만 남긴다.

## 결과

- Hub 연결 없이 project event를 순서대로 기록하고 재시작 뒤 복구할 수 있다.
- Hash chain은 변조 방지 장치가 아니라 변조 징후 검출 장치다.
- WAL file은 database와 함께 보존해야 하며 실행 중 database 파일만 따로 복사하지 않는다.
- CAS object는 내용으로 중복 제거되고 event metadata와 원문 보존 기간을 분리할 수 있다.
- Hub 장애와 worker 종료 뒤에도 pending outbox와 event 원본을 독립적으로 복구할 수 있다.
- Ack된 outbox 운영 상태는 event 원본을 보존하면서 별도 보존 정책으로 정리할 수 있다.

## 참고

- [Node.js SQLite API](https://nodejs.org/download/release/v26.2.0/docs/api/sqlite.html)
- [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
