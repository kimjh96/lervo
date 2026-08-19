# ADR-0041: 서명·프로젝트 범위·로컬 정책을 순서대로 닫는 원격 command

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Hub나 채널에서 시작한 작업을 Project Node가 실행하려면 transport가 전달한 JSON을 곧바로 `lervo run`으로 바꿔서는 안 됩니다. 서명이 맞더라도 다른 프로젝트용 key나 오래된 command일 수 있고, 같은 요청이 응답 유실 때문에 다시 도착할 수 있습니다. Hub의 권한 판단도 저장소가 가진 현재 로컬 정책을 대신하지 않습니다.

요청 본문을 command와 replay 기록에 복제하면 서명·중복 방지 metadata가 원문 보존 경계까지 떠안습니다. 반대로 idempotency key만 비교하면 같은 key에 다른 내용을 붙이거나 nonce를 바꿔 재생하는 경우를 구분할 수 없습니다. 실행 전에 확인할 순서와 실패 뒤 재시도 의미를 공급자·transport 구현과 분리해 고정해야 했습니다.

## 결정

### Canonical command와 서명 envelope를 실행에서 분리한다

`@lervo/remote-command-contract`는 `managed_run` command, Ed25519 envelope와 terminal receipt의 schema·파생 ID·canonical hash를 소유합니다. Command target은 project ID와 project identity hash를 함께 사용합니다. Action은 role, provider, risk, 필수 verification suite와 요청 artifact 좌표를 가지며 raw request를 포함하지 않습니다. Artifact는 최대 64 KiB의 UTF-8이고 ID, content hash와 byte 수가 서명 대상입니다.

`commandId`는 자신을 제외한 command content의 canonical hash입니다. 서명 message는 `lervo.remote-command.v1`, algorithm, key ID와 완성된 command를 함께 canonicalize합니다. Key ID를 message에 넣어 같은 public key를 다른 trust slot으로 바꾸는 경우도 원래 서명과 같다고 보지 않습니다. Ed25519는 진위와 무결성을 확인하지만 command를 암호화하거나 transport peer를 인증하지 않습니다.

### Receiver는 실행 전 gate를 한 방향으로 통과한다

`@lervo/remote-command` receiver는 schema/파생 ID, trust key, signature, signer project scope, receiver project identity, replay, freshness, local policy 순으로 검사합니다. 완료된 같은 command는 freshness보다 먼저 terminal receipt를 반환할 수 있어 응답 유실 뒤 만료됐더라도 재실행 없이 결과를 복구합니다. 아직 완료되지 않은 command는 기본 5분, 최대 15분 lifetime과 제한된 clock skew를 통과해야 합니다.

로컬 정책이 승인된 뒤에만 replay store에 `(commandHash, idempotencyKey, nonce)`를 원자적으로 예약합니다. 정책 거부는 예약하지 않으므로 같은 command를 사람 승인 뒤 다시 평가할 수 있습니다. 예약 뒤에만 artifact loader가 bytes를 가져오고 size, SHA-256과 strict UTF-8을 검사합니다. Executor는 검증된 request string과 command를 받는 공급자 중립 port입니다.

In-memory adapter는 inspection과 insertion 사이에 비동기 양보가 없는 critical section을 사용합니다. Idempotency와 nonce index, reservation index를 따로 두어 충돌 검사와 완료가 전체 기록 수에 비례하지 않게 합니다. Capacity를 넘으면 오래된 nonce를 지우지 않고 fail-closed합니다.

### Terminal receipt와 transport 상태를 구분한다

Payload read, payload mismatch와 executor 실패는 각각 원문 없는 `payload_unavailable`, `payload_mismatch`, `execution_failed` receipt가 됩니다. 같은 command의 이후 전달은 저장된 receipt를 `deliveryStatus=duplicate`로 반환하며 다시 실행하지 않습니다. 성공은 `outcome=executed`와 유효한 run ID, 실패는 `outcome=failed`와 고정 code만 가집니다.

`processed`는 configured replay store에 terminal receipt를 완료했다는 뜻입니다. Event sync, Hub 응답 전달이나 run verification 완료를 새로 뜻하지 않습니다. Executor가 반환된 뒤 replay completion이 실패하면 실제 실행을 취소됐다고 추정하지 않고 `replay_store_failed`로 닫습니다. 이 단계에서는 새 event를 추가하지 않습니다.

## 실패 의미와 개인정보

Envelope·trust·signature·scope·target·freshness 실패는 local policy, payload loader와 executor 전에 끝납니다. Idempotency conflict, nonce replay와 in-progress는 서로 다른 안정적인 오류입니다. Policy 예외나 형식이 잘못된 판정은 거부 판정과 구분하지만 둘 다 예약하지 않습니다.

Command, receipt와 replay coordinate에는 raw request, credential, private/public key bytes, policy reason 원문, loader/executor 예외를 넣지 않습니다. Artifact ID와 hash, key ID, project 좌표는 운영 metadata로 남습니다. 현재 trust store는 구성된 public key를 process memory에 가지며 private key는 signer에만 있습니다.

## 검증

실제 생성한 Ed25519 key pair로 command를 서명하고 정상 실행 순서와 receipt를 확인했습니다. Signature 한 byte 변경, signer project scope와 receiver identity 불일치, 만료 command가 policy 전에 거부되는지 검증했습니다. Policy 거부 뒤 승인 retry는 실행되지만 payload mismatch와 executor 실패 뒤 retry는 저장된 terminal receipt만 반환합니다.

같은 idempotency key의 다른 command와 같은 nonce의 다른 idempotency key를 구분하고 둘 다 실행하지 않는지 확인했습니다. 두 policy 평가가 동시에 끝나는 경합에서도 예약은 하나만 성공하며 executor가 한 번만 호출됩니다. Command와 receipt에 request·예외 원문이 없는지도 확인했습니다.

## 결과

Node 실행 경계는 Hub, HTTP, Slack과 Codex/Claude 구현을 알지 않고도 서명과 로컬 권한, 중복 실행과 payload 무결성을 같은 순서로 적용할 수 있습니다. 현재 bounded replay store는 process-local fixture라 재시작 후 replay 방지와 offline queue를 보장하지 않습니다. 다음 작업은 durable command queue와 Node reconnect에서 만료·응답 유실·재시작을 함께 검증하는 것입니다.
