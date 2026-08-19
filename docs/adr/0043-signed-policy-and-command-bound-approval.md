# ADR-0043: 로컬 제한을 완화하지 않는 서명 정책과 command-bound 승인

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Role capability는 `allow`, `deny`, `require_approval`을 구분했지만 검증된 승인 원본이 없어 `require_approval`을 항상 차단했습니다. 원격 command receiver도 로컬 정책 거부 뒤 replay reservation을 만들지 않아 재평가할 수는 있었지만, 어떤 정책 snapshot과 사람 승인이 같은 command를 열었는지 검증할 계약이 없었습니다.

Hub 정책이 로컬 보호를 완화하거나, 한 command의 승인을 다른 command·capability에 재사용하거나, 만료·철회된 승인이 Node 재시작 뒤 살아나는 것을 막아야 합니다. 동시에 Hub가 없어도 기존 로컬 실행이 계속되는 local-first 원칙과 정책 원본을 provider·transport에서 분리해야 했습니다.

## 결정

### Snapshot, 승인과 철회는 서로 다른 서명 원본이다

`@lervo/policy-contract`가 세 canonical 원본과 목적별 Ed25519 signing domain을 소유합니다.

- `PolicySnapshot`: project ID·identity hash, sequence, 이전 snapshot ID, 발급·만료 시각과 role·risk·capability별 rule
- `PolicyApproval`: 현재 snapshot ID/hash, command ID/hash, command signer key ID, capability, 승인 저장소 상대 경로, 승인자 subject hash와 발급·만료 시각
- `PolicyApprovalRevocation`: approval ID, 철회 시각과 bounded reason code

각 ID는 자신을 제외한 canonical 원본에서 계산합니다. Snapshot rule 좌표와 ID는 중복할 수 없습니다. Approval 만료는 snapshot과 command 만료보다 늦을 수 없습니다. Snapshot, approval과 revocation signature는 `snapshot`, `approval`, `revocation` purpose가 허용된 project-scoped trust key로 각각 검증합니다. 한 purpose의 signature를 다른 purpose에 재사용할 수 없습니다.

### Node는 인증된 bounded bundle만 원자적으로 적용한다

`@lervo/policy` sync 경계는 실제 TLS나 이에 준하는 인증 뒤의 transport port만 사용합니다. Destination과 Hub peer identity가 구성과 같은지 확인한 후 snapshot 하나, approval 최대 64개, revocation 최대 64개를 검증합니다. Signature와 모든 원본 관계를 먼저 확인하고 `PolicyStateStore.applyVerifiedBundle`을 한 번 호출하므로 잘못된 항목이 있는 bundle을 부분 적용하지 않습니다.

`@lervo/policy-sqlite`는 database를 project ID와 identity hash에 고정합니다. Snapshot, approval과 revocation signed envelope은 별도 append-only table에 저장합니다. 새 snapshot은 현재 sequence 바로 다음이고 이전 snapshot ID가 현재 ID여야 합니다. 비어 있는 Node는 현재 서명 snapshot으로 시작할 수 있지만, 그 뒤 과거 또는 gap snapshot을 적용할 수 없습니다. 동일 원본 재전송은 no-op이고 같은 ID의 다른 원본은 무결성 실패입니다.

### Hub는 로컬 정책을 완화할 수 없다

원격 command 평가기는 로컬 capability 결정과 일치하는 현재 Hub rule을 `deny > require_approval > allow` 순서로 병합합니다. Hub `allow`는 로컬 `deny`와 `require_approval`을 바꾸지 못합니다. Hub rule이 없으면 로컬 결정을 유지하고, 설치된 snapshot이 현재 시각에 유효하지 않으면 Hub 원격 command를 보수적으로 닫습니다.

`require_approval`은 현재 snapshot과 정확한 command ID/hash·signer key ID·capability에 묶인 승인만 통과시킵니다. 발급 전, 만료 후 또는 철회 시각 이후 승인은 사용할 수 없습니다. SQLite에서 읽은 signed envelope은 평가 시 trust store로 다시 검증합니다. 구조나 signature가 손상된 원본을 단순한 승인 부재로 낮추지 않고 정책 평가 실패로 닫습니다.

승인 대기에서는 remote replay reservation을 만들지 않고 Hub terminal rejection도 보내지 않습니다. Reconnect worker는 `local_deferred/approval_required`로 lease 만료를 기다립니다. 유효한 승인을 동기화한 뒤 같은 signed command가 다시 오면 정책을 재평가하고, executor에는 재검증할 command와 signer, policy snapshot·approval 좌표를 전달합니다.

## 개인정보와 실패 의미

Policy SQLite에는 signed rule metadata, command/hash 좌표와 승인자 subject hash만 저장합니다. Raw command request, 승인자 ID·이메일 원문, 승인 사유, credential, provider payload와 예외 본문은 저장하지 않습니다. Reason은 철회 처분에 필요한 세 개의 고정 code뿐입니다.

잘못된 bundle, signer, project scope, purpose 또는 signature는 어떤 새 원본도 저장하지 않습니다. Snapshot rollback·gap, 같은 ID의 다른 원본, capacity와 transaction 실패는 현재 상태를 유지하고 `policy_store_failed`로 상위 실행을 닫습니다. 승인 만료·철회는 삭제가 아니라 현재 시각의 판정 근거입니다.

이번 단계는 새 event를 추가하지 않습니다. SQLite 정책 원본과 remote executor에 전달한 ID는 `capability.decided`, 파일 쓰기 permit, executor 완료 또는 `run.completed`를 대신하지 않습니다.

## 검증

인증된 transport fixture에서 snapshot을 설치한 뒤 `require_approval` command가 payload와 executor 전에 `approval_required`로 멈추는지 확인했습니다. 같은 command에 묶인 승인을 동기화하고 Node policy database를 닫아 다시 연 뒤 한 번 실행하며, executor 입력에 snapshot·approval ID가 전달되는지 확인했습니다. Terminal replay는 두 번째 실행을 열지 않습니다.

승인 철회와 만료, Hub allow보다 강한 local deny, 잘못된 signing purpose, snapshot rollback, Hub offline과 peer 불일치를 검사했습니다. SQLite signed 원본에는 fixture raw request와 승인자 식별 원문이 없음을 확인했습니다. Contract test는 중복 rule, 끊긴 snapshot metadata, command hash 변조와 signing domain 재사용을 거부합니다.

## 결과와 후속 범위

정책 배포와 승인 수명주기의 공급자·transport 중립 Node 수직 슬라이스가 생겼습니다. Managed provider coordinator 연결은 [ADR-0044](./0044-signed-approval-managed-write-permit.md), 실제 Hub 정책 작성·durable source·HTTP endpoint는 [ADR-0045](./0045-hub-policy-authoring-and-http-sync.md)에서 완료했습니다.
