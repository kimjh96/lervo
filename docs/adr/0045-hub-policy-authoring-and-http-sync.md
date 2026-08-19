# ADR-0045: Hub가 시각과 범위를 소유하는 정책 작성과 HTTP 동기화

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Node에는 서명 정책 bundle을 검증·저장·평가하는 경계가 있었지만 실제 Hub 작성자, durable source와 HTTP transport가 없었습니다. Fixture가 준 bundle만으로는 정책을 누가 어느 project에 발행했는지, 승인 대상 command가 Hub 원본과 같은지, Hub와 Node 재시작 뒤에도 같은 서명 원본을 받을 수 있는지 보장할 수 없었습니다.

HTTP client가 승인 시각이나 승인자 hash를 직접 정하게 두면 과거 시각을 넣거나 다른 project의 식별자를 재사용할 수 있습니다. 반대로 HTTP, signer와 SQLite를 한 모듈에 합치면 채널 승인 UI나 저장 구현을 바꿀 때 정책 의미까지 함께 바뀝니다.

## 결정

### 작성 의미와 저장을 분리한다

`@lervo/hub-policy`는 현재 snapshot, command와 approval을 읽고 signed 원본을 발행하는 `HubPolicySourceStore` port만 압니다. Snapshot은 현재 head 바로 다음으로 만들고, approval은 현재 head와 durable remote command·command signer key ID에 결속하며, revocation은 기존 approval에 결속합니다. 목적별 서명은 주입된 `HubPolicySigner`가 맡습니다.

HTTP write body는 발급·승인·철회·발행 시각을 받지 않습니다. Hub clock의 한 시각을 원본 시각과 발행 시각으로 사용합니다. Approval의 principal ID는 project identity와 NUL 구분자를 함께 hash한 subject만 저장합니다. 그래서 같은 principal도 project가 다르면 같은 subject hash가 되지 않습니다.

### Hub source는 append-only 원본과 command 관계를 보존한다

`@lervo/hub-sync-sqlite`는 기존 Hub database migration에 snapshot, approval과 revocation strict table을 추가합니다. Project registration, snapshot, remote command와 approval을 foreign key로 연결하고 세 원본의 update/delete를 trigger로 막습니다. Repository는 codec, read/audit와 write를 나눠 기존 event·trace·command 저장 책임과 섞지 않습니다.

같은 canonical 원본 재전송은 `duplicate`지만 같은 ID·sequence의 다른 원본은 충돌입니다. Approval은 현재 head와 저장된 command에만 발행하고 snapshot당 approval·revocation을 각각 64개로 제한합니다. 전체 audit는 모든 과거 snapshot chain뿐 아니라 approval의 command hash·signer key·기간·경로와 revocation 관계도 다시 확인합니다.

Bundle read는 빈 Node에는 최신 snapshot을 줍니다. 알려진 과거 cursor에는 다음 sequence 하나만 주어 Node의 연속 저장 규칙을 지킵니다. 현재 head cursor에는 같은 snapshot을 다시 주어 나중에 생긴 approval이나 revocation을 받을 수 있게 합니다. Source에 없는 cursor는 최신 상태로 덮지 않고 충돌로 닫습니다.

### HTTP는 인증, permission과 project scope를 먼저 적용한다

Bearer principal은 `trace.read`, `policy.read`, `policy.write`를 분리해 가집니다. Policy route는 body를 읽거나 source를 호출하기 전에 인증, destination/project scope와 필요한 permission을 확인합니다. Snapshot·approval·revocation POST와 bundle GET은 schema가 허용한 field만 받고, 고정 오류·`no-store`, 기본 256 KiB request와 1 MiB response 상한을 사용합니다.

Node의 `AuthenticatedPolicyHttpTransport`는 credential·query·fragment가 없는 HTTPS base URL을 기본으로 요구합니다. Bearer token으로 GET한 뒤 `x-lervo-hub-identity`, JSON content type, destination, project ID·identity hash와 bounded UTF-8 JSON을 확인합니다. 요청은 기본 15초 뒤 중단합니다. 평문 HTTP는 test option을 명시한 로컬 fixture에서만 허용합니다. 이 header는 HTTPS의 peer 보호를 대신하지 않고, 연결한 Hub가 구성된 logical identity인지 추가로 결속합니다.

## 개인정보와 실패 의미

Hub에는 signed rule, command/hash·signer 좌표, 승인 경로, project-scoped approver subject hash와 bounded 철회 code만 남습니다. Principal ID, bearer credential, 자유 형식 승인 사유, raw request, provider payload와 내부 예외는 정책 table이나 HTTP 오류에 넣지 않습니다.

미인증은 `401`, scope·permission 거부는 `403`, 등록·command·approval 부재는 `404`, 잘못된 query/body는 `400`, identity·head·capacity 충돌은 `409`, body 상한 초과는 `413`입니다. Node는 Hub identity 불일치를 `transport_authentication_failed`, 그 밖의 HTTP·network·body 실패를 `hub_unavailable`로 처리하고 현재 정책을 유지합니다. 잘못된 원본은 기존 row를 수정하지 않습니다.

이번 단계는 새 event나 실행 상태를 추가하지 않습니다. Hub의 `published`는 signed 원본이 durable source에 commit됐다는 뜻일 뿐 Node가 이를 `loaded`, `injected`, `used`했거나 command를 실행했다는 뜻이 아닙니다. Hub 없이 완료되는 로컬 allow/deny 실행 경로도 바꾸지 않습니다.

## 검증

실제 Node.js HTTP server fixture에서 writer와 reader permission을 분리하고 무권한 요청이 원본을 만들지 않는지 확인했습니다. Hub에서 snapshot과 command-bound approval을 작성한 뒤 Hub SQLite를 닫아 다시 열고, HTTPS 규칙을 test-only HTTP로 명시 해제한 Node transport를 통해 실제 Ed25519 검증과 Node SQLite 적용을 수행했습니다. 이후 revocation을 HTTP로 발행하고 같은 head를 다시 동기화했습니다.

Hub·Node 재시작, 같은 project의 destination 격리, snapshot 동시 작성 충돌과 다음 sequence 전달, 알 수 없는 cursor, request byte·시간 상한, Hub identity 불일치, client timestamp 거부, append-only trigger와 승인자 원문 비저장을 검사했습니다. Hub 전체 audit가 과거 approval과 durable command 원본 관계까지 확인하는지도 검증했습니다.

## 결과와 후속 범위

정책 작성, durable source, HTTP 권한 경계와 Node transport가 기존 provider-neutral 정책 계약 뒤에 연결됐습니다. 다음 범위는 이 application 경계를 재사용하는 Slack/Discord command gateway와 승인 UX입니다. 채널 payload나 공급자별 승인 기능을 policy core에 넣지 않습니다.
