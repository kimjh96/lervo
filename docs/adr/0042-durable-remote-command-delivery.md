# ADR-0042: 재시작과 응답 유실을 견디는 durable command delivery

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

서명된 command receiver는 한 process 안에서 위변조, project scope, freshness, local policy와 중복 실행을 막았지만 Node가 오프라인일 때 command를 기다리게 하거나 재시작 뒤 terminal receipt를 복구하지 못했습니다. Hub acknowledgement가 유실되면 Hub는 완료 여부를 모르고 같은 command를 다시 보낼 수 있습니다. Process-local replay만으로는 이 재전송과 Node 재시작이 겹칠 때 executor를 한 번만 열었다는 보장을 유지할 수 없습니다.

Event outbox와 remote command는 방향과 처분이 다릅니다. Event는 Node 원본을 Hub로 append하지만 command는 Hub 원본을 Node가 lease하고 실행 결과 또는 거부를 돌려줍니다. 두 상태를 한 table이나 같은 acknowledgement 의미로 합치지 않으면서도 project registration과 durable Hub transaction은 재사용해야 했습니다.

## 결정

### Hub queue는 event inbox와 다른 원본 상태를 가진다

`@lervo/hub-sync`에 remote command enqueue, lease, acknowledgement application port를 추가하고 `@lervo/hub-sync-sqlite`가 같은 Hub database의 별도 table과 repository로 구현합니다. Queue command는 등록된 destination, project ID와 identity hash가 정확히 같아야 저장됩니다. Delivery ID는 destination과 signed envelope 전체의 canonical hash이므로 같은 command ID에 다른 envelope을 조용히 합치지 않습니다.

Queue 상태는 다음 다섯 가지입니다.

- `pending`: 저장됐지만 유효한 Node lease가 없습니다.
- `leased`: 한 Node ID에 제한된 시간 동안 전달됐습니다.
- `completed`: Node가 terminal execution receipt를 보냈고 Hub commit이 끝났습니다.
- `rejected`: Node가 서명·scope·freshness·replay의 terminal 오류를 확인했고 Hub commit이 끝났습니다.
- `expired`: Node에 lease하기 전에 command 만료 시각이 지났습니다.

Lease가 만료되면 terminal 원본이 없는 `leased`만 `pending`으로 돌아갑니다. 발급 시각 전에는 lease하지 않고 만료된 pending command는 executor에 전달하지 않은 채 `expired`로 바꿉니다. 시간 비교는 서명된 문자열의 사전식 순서가 아니라 UTC epoch millisecond로 합니다. Command identity, envelope, 최초 queue 시각과 만료 좌표는 update trigger로 불변이고 terminal row는 자동 삭제하지 않습니다.

### Delivery acknowledgement는 lease와 receipt에 결속한다

Lease는 delivery ID, 무작위 lease ID, Node ID, lease 시작·만료 시각과 signed envelope을 가집니다. Node acknowledgement는 delivery·lease·command ID/hash와 시각을 포함하고 `completed` receipt 또는 고정된 `rejected` code 중 하나입니다. Acknowledgement 시각은 lease 구간 안이어야 합니다.

Hub confirmation은 acknowledgement hash, disposition, `accepted` 또는 같은 원본의 `duplicate`와 commit 시각을 가집니다. Hub store는 현재 lease와 모든 좌표, completed receipt의 command 결속을 transaction 안에서 다시 확인한 뒤 terminal 상태를 commit합니다. Response가 commit 뒤 유실되어도 Hub 상태는 terminal이며, commit 전에 유실되면 lease expiry 뒤 다시 전달합니다.

### Node replay는 project-bound SQLite 원본이다

`@lervo/remote-command-sqlite`는 database를 project ID와 project identity hash에 고정합니다. 저장하는 값은 command hash, idempotency key, nonce, reservation ID와 terminal receipt뿐입니다. Signed envelope, raw request와 loader/executor 오류는 저장하지 않습니다. 기본 1,024개, 최대 100,000개의 명시적 capacity에서 eviction하지 않고 fail-closed합니다.

Reservation과 coordinate unique index는 원자적으로 commit됩니다. Receipt가 있는 동일 command는 재시작 뒤 `duplicate`로 복구합니다. Receipt 없이 reservation만 남으면 실제 executor 호출 여부를 추정할 수 없으므로 `in_progress`를 유지합니다. 자동 재실행보다 운영자 확인을 요구하는 편을 선택합니다.

### Reconnect worker는 transport와 실행을 연결만 한다

`@lervo/remote-command` reconnect worker는 Hub peer identity와 destination을 검증한 transport port에서 lease를 pull합니다. Node ID, project target, lease 시각을 다시 확인한 뒤 기존 receiver를 호출하고 completed 또는 rejected acknowledgement를 보냅니다. Hub 연결 실패는 `offline`, terminal 처리 뒤 acknowledgement 실패는 `acknowledgement_pending`, 정책·로컬 저장 장애는 `local_deferred`, 빈 queue는 `idle`, acknowledgement가 commit된 cycle은 `processed`입니다.

`processed` 안에서도 `executedCount`, `failedCount`, `duplicateCount`, `rejectedCount`를 분리합니다. Payload나 executor 실패 receipt를 실행 성공으로 세지 않습니다. 이 worker는 poll 주기나 daemon 수명주기를 소유하지 않으며 실제 HTTP/TLS 구현은 인증된 transport port 뒤에 둡니다.

## 개인정보와 실패 의미

Hub queue는 signed envelope을 원본으로 저장하지만 envelope에는 raw request 대신 bounded artifact 좌표만 있습니다. Hub 상태 조회는 envelope을 반환하지 않고 delivery·command hash, project target, 상태, 시각과 시도 횟수만 제공합니다. Node replay database에는 envelope과 artifact 좌표도 저장하지 않습니다. Confirmation, rejection과 worker 결과에는 credential, 정책 사유 원문과 provider 예외가 없습니다.

등록 부재와 identity 불일치, 같은 command 좌표의 다른 envelope, 현재 lease와 다른 acknowledgement는 각각 안정적인 저장 오류로 실패합니다. 잘못된 Hub peer, lease와 confirmation은 executor 완료로 간주하지 않습니다. 실행 뒤 Node receipt commit 자체가 실패한 경우에는 acknowledgement를 보내지 않습니다.

이번 단계는 새 event를 추가하지 않습니다. Queue 상태와 delivery acknowledgement는 Hub command 원본이며 `run.completed`, event sync, 사람이 결과를 읽음 또는 provider verification 통과를 대신하지 않습니다.

## 검증

Hub가 오프라인인 동안 command가 SQLite `pending`으로 남고 executor가 호출되지 않는지 확인했습니다. Hub가 복구된 뒤 Node가 한 번 실행하고 acknowledgement가 commit되기 전에 유실되는 fixture를 만들었습니다. Hub와 Node database를 모두 닫아 다시 연 뒤 lease가 재발급되고, Node의 terminal receipt가 `duplicate`로 복구되어 executor가 두 번째로 호출되지 않는지 확인했습니다.

대기 중 만료된 command는 lease 없이 `expired`가 되고, signature를 변조한 schema-valid envelope은 executor 전에 `rejected`가 됩니다. Node replay의 incomplete reservation, idempotency conflict, nonce replay, capacity와 다른 project identity 재사용을 검사했습니다. Hub와 Node SQLite 원본에 fixture raw request가 없고 Node replay table에 command/envelope column이 없는지도 확인했습니다. 기존 outbound event response-loss SQLite 통합 fixture도 유지합니다.

## 결과

M6 로컬 fixture는 outbound event와 inbound command 양쪽에서 오프라인과 응답 유실을 durable 원본으로 복구합니다. 이는 transport port를 사용한 로컬 통합 검증이며 공개 command HTTP route, 실제 TLS peer 인증, daemon scheduling이나 multi-node 운영을 뜻하지 않습니다. 다음 범위는 Hub 정책 배포와 `require_approval` 승인 수명주기입니다.
