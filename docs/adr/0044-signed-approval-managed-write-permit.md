# ADR-0044: 서명 승인 원본을 managed write permit에 결속

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

원격 command 정책 경계는 현재 snapshot과 command에 묶인 승인을 검증했지만 executor에는 식별 좌표만 넘겼고, managed provider coordinator는 `filesystem.write=require_approval`을 항상 차단했습니다. 이 둘을 단순 boolean으로 연결하면 실행이 시작된 뒤 승인 만료·철회나 정책 snapshot 교체를 놓치고, 승인하지 않은 경로에 기존 승인을 재사용할 수 있습니다.

로컬 `allow` 실행은 Hub 없이 계속 동작해야 하며, Codex와 Claude가 서로 다른 승인 기능을 제공하더라도 최종 쓰기 권한은 공급자 중립 계약에서 결정해야 합니다.

## 결정

### 승인 handoff는 판정 결과가 아니라 재검증 입력이다

`ManagedRunApprovalAuthorization`은 검증된 remote command 원본, command signer key ID, policy snapshot ID와 사용한 approval ID를 전달합니다. Raw request 본문, credential, 승인자 식별 원문과 승인 사유는 포함하지 않습니다. Receiver가 이 값을 executor에 넘겼다는 사실만으로 파일 쓰기를 허용하지 않습니다.

`PolicyApproval`은 1개 이상 16개 이하의 정규화된 저장소 상대 경로를 추가로 고정합니다. 해당 snapshot에 같은 role·risk·capability rule의 경로 제한이 있으면 승인 경로는 그 범위를 넓힐 수 없습니다.

### Coordinator와 write gate가 같은 원본을 두 번 확인한다

공급자 시작 전 preflight는 project/run/session/role, provider, risk, request digest, verification suite와 전체 예상 경로를 authorization의 command 및 현재 project-bound policy store와 대조합니다. 현재 snapshot, approval, revocation의 schema와 purpose별 signature를 다시 검증하고 발급·만료·철회 시각을 적용합니다. 확인할 수 없으면 `approval_required`로 provider를 시작하지 않습니다.

Preflight가 통과한 `require_approval` run만 adapter를 `managed_write`로 시작합니다. 실제 provider 파일 요청 직전에는 같은 verifier를 현재 시각과 정규화된 요청 경로로 다시 호출합니다. 그 사이 snapshot이 바뀌거나 승인이 만료·철회됐으면 `capability.decided=require_approval`을 기록하고 쓰기 결정을 거부합니다.

E3, 예상 경로와 실제 before hash 검사는 기존 gate가 별도로 수행합니다. 두 검사가 모두 통과할 때만 기존 1회용 permit를 발급하며 permit에 approval ID와 policy snapshot ID를 함께 묶습니다. `capability.decided`에는 실제 approval ID와 `policyRuleId=managed_context_e3+signed_approval`을 기록합니다. Permit는 한 변경 완료 뒤 context와 함께 무효화됩니다.

### 경계는 공급자와 저장 구현에 의존하지 않는다

Orchestrator는 좁은 `ManagedCapabilityApprovalVerifier` port만 알고 SQLite나 Ed25519 구현을 직접 참조하지 않습니다. `@lervo/policy`가 현재 signed 원본을 재검증하는 구현을 제공하고 `@lervo/policy-sqlite`는 기존 append-only 원본을 그대로 제공합니다. Codex와 Claude adapter는 공통 managed write bridge의 allow/deny 결과만 따릅니다.

로컬 role이 `allow` 또는 `deny`인 run은 authorization을 받지 않으며 기존 local-first 경로를 유지합니다. 직접 실행되어 authorization handoff와 provider write bridge를 거치지 않은 외부 에이전트 작업은 계속 `unmanaged`입니다.

## 개인정보와 실패 의미

Authorization과 permit는 실행 중 메모리 계약입니다. Event에는 approval ID만 남고 remote command, snapshot·approval envelope, 승인자 subject hash와 signature를 복제하지 않습니다. Approval ID는 project-bound policy SQLite의 원본으로 역추적할 수 있습니다.

Preflight의 승인 부재·불일치·만료·철회·snapshot 교체·원본 검증 실패는 `approval_required`이며 adapter를 시작하지 않습니다. 쓰기 직전 정상적인 재평가 거부는 `capability.decided=require_approval`이고 permit를 만들지 않습니다. Store 또는 signature 검증 예외도 허용으로 낮추지 않으며 managed provider run은 `provider_write_failed`로 닫힙니다.

## 검증

실제 signed snapshot·approval을 SQLite에 저장한 뒤 올바른 run·경로는 통과하고 승인 밖 경로는 거부되는지 확인했습니다. 같은 store에 revocation을 적용한 뒤 같은 authorization 재검증이 실패하는지도 검사했습니다.

Provider coordinator fixture는 preflight와 실제 쓰기 직전 verifier가 각각 호출되고, 허용 시 `managed_write`, approval ID telemetry와 한 건의 검증된 변경이 생기는지 확인합니다. 두 번째 호출에서 승인이 사라지면 provider의 파일 적용 함수가 호출되지 않고 run이 실패하는지도 검증합니다. 기존 local allow/deny 및 Codex·Claude 공통 adapter suite는 그대로 유지합니다.

## 결과와 후속 범위

`require_approval`은 더 이상 미구현 상태를 뜻하지 않습니다. 검증 가능한 remote-command authorization이 있고 현재 E3·경로·파일 상태가 모두 맞을 때만 한 번의 managed write를 엽니다. 실제 Hub 정책 작성 API, durable Hub source와 HTTP transport는 [ADR-0045](./0045-hub-policy-authoring-and-http-sync.md)에서 연결했습니다. 사람용 정책 관리 UI와 채널 승인 UX는 후속 범위입니다.
