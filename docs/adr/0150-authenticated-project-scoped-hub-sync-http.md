# ADR-0150: 프로젝트 범위에 결속된 Hub sync HTTP

- 상태: 채택
- 기준일: 2026-08-22

## 맥락

Project 등록, event batch, Node outbox worker와 Hub SQLite 저장 계약은 이미 있었지만 실제 network 경계는 `AuthenticatedHubTransport` port 뒤의 fixture뿐이었습니다. `lervo-hub`를 실행해도 Node가 등록과 event를 보낼 HTTP route가 없었습니다.

이 경계에서 인증 뒤에 본문을 읽거나 URL과 본문 좌표를 느슨하게 비교하면, 권한 없는 큰 body를 처리하거나 credential 범위와 다른 project에 쓸 수 있습니다. 반대로 HTTP 규칙을 sync core나 SQLite에 넣으면 다른 transport와 저장 adapter를 붙일 때 핵심 재시도·commit 규칙까지 바뀝니다.

## 결정

### HTTP는 인증과 요청 경계만 소유한다

`@lervo/hub`는 다음 route를 제공합니다.

- `POST /v1/sync/projects/<projectId>/registration`
- `POST /v1/sync/projects/<projectId>/event-batches`

두 route는 `destinationId`, `projectIdentityHash` query를 정확히 한 번 받습니다. 알 수 없는 query, 잘못 인코딩된 project ID와 다른 method는 저장소 호출 전에 거부합니다.

Hub는 bearer credential을 확인한 뒤 `sync.write` permission과 `(destinationId, projectId)` 범위를 검사합니다. 이 검사가 끝나기 전에는 body를 읽지 않습니다. 그 뒤 기본 4 MiB, 최대 16 MiB의 UTF-8 JSON을 읽고 schema를 검사합니다. URL, body와 `destinationId + projectIdentityHash`에서 다시 계산한 registration ID가 모두 같아야 application handler를 호출합니다.

등록·acknowledgement 시각은 Hub clock이 정합니다. 최초 등록은 `201`, 갱신과 변경 없음은 `200`, event acknowledgement는 `200`입니다. `@lervo/hub-sync`가 durable commit 뒤 결과를 반환하는 기존 계약을 그대로 사용하므로 HTTP adapter는 먼저 응답하지 않습니다.

### Node transport는 검증된 설정을 고정한다

`@lervo/sync`의 `AuthenticatedHubHttpTransport`는 운영에서 credential·query·fragment가 없는 HTTPS base URL만 허용합니다. 로컬 테스트만 명시적으로 평문 HTTP를 켤 수 있습니다. 생성할 때 bearer token, destination, project 좌표와 기대 Hub identity를 자체 값으로 복사합니다. 호출자가 넘긴 설정 객체를 나중에 바꿔도 실제 요청 좌표나 credential은 바뀌지 않습니다.

요청 body는 기본 4 MiB, 응답 body는 기본 1 MiB이고 각각 최대 16 MiB입니다. 요청 timeout은 기본 15초이며 redirect는 따르지 않습니다. Transport는 기대한 HTTP status와 `x-lervo-hub-identity`를 body보다 먼저 확인합니다. Identity가 다르면 body를 읽지 않고 `unverified` 결과를 반환합니다. Identity가 맞을 때만 content type, 선언·실제 byte 수, UTF-8과 JSON을 확인해 worker에 전달합니다.

HTTPS와 identity header는 배포한 endpoint와 구성한 peer가 맞는지 확인하는 transport 경계입니다. Identity header만으로 TLS 인증이나 서명을 대신하지 않습니다. 현재 Hub runtime은 loopback 평문만 열기 때문에 다른 장비의 Node가 접근하려면 별도 TLS 종료 계층이 필요합니다.

### Application과 저장 계약은 HTTP를 모른다

Node worker는 URL, bearer token과 HTTP status를 모르며 기존 `AuthenticatedHubTransport`만 사용합니다. Hub application handler도 authorization header와 route를 모르고 기존 `HubSyncCommandStore`만 사용합니다. SQLite adapter에는 HTTP나 credential 처리를 추가하지 않습니다. 다른 인증 transport나 durable store는 각 port의 공통 계약을 그대로 구현할 수 있습니다.

## 상태, 실패와 개인정보

새 event나 sync 상태는 추가하지 않습니다. HTTP 실패는 아래처럼 기존 worker 상태로 정규화합니다.

- network 오류, timeout, status 오류와 응답 유실: `hub_unavailable`
- Hub identity 불일치: `transport_authentication_failed`
- 등록 응답 schema·좌표 불일치: `invalid_registration_response`
- acknowledgement schema·좌표 불일치: `invalid_sync_ack`

Hub는 형식 오류를 `400 invalid_request`, 인증 실패를 `401 unauthorized`, permission·project 범위 실패를 `403 forbidden`, identity·registration·event chain 충돌을 `409 conflict`, 요청 초과를 `413 request_too_large`, 저장·내부 실패를 `500 internal_error`로 응답합니다. 상세 내부 오류, authorization과 credential은 응답이나 outbox에 넣지 않습니다.

Hub SQLite에는 기존 계약의 전체 project manifest와 allowlist event만 저장합니다. HTTP adapter는 request log나 별도 원장을 만들지 않습니다. Repository 본문, raw prompt, 문서·스킬 본문, command output과 credential은 sync payload에 추가하지 않습니다. 등록이나 HTTP 성공을 문서가 `loaded`, `injected`, `used`됐다는 증거로 해석하지 않습니다.

## 검증

실제 Node event SQLite, 실제 HTTP server와 Hub SQLite를 한 흐름으로 연결했습니다. 첫 event batch는 Hub가 commit하고 응답 body까지 만든 뒤 transport에서 응답 유실을 일으켰습니다. Node는 local outbox를 pending으로 되돌렸고, 다음 cycle에서 같은 batch를 보내 `duplicate` acknowledgement를 받은 뒤에만 local ack했습니다. Hub 전체 audit에는 event가 한 번씩만 남았습니다.

별도 fixture로 permission을 body보다 먼저 거부하는지, URL identity와 body가 다를 때 저장하지 않는지, HTTPS 기본값, 생성 뒤 설정 객체 변경, 다른 Hub identity에서 body를 읽지 않는 동작, 응답 크기 상한과 timeout을 확인했습니다. 실제 `lervo-hub` runtime에서도 같은 route로 등록한 뒤 종료·재개방한 SQLite에 project가 남는지 확인했습니다.

## 결과와 후속 범위

Node outbox와 Hub durable receiver 사이에 실제 인증 HTTP 경계가 생겼습니다. Hub가 저장한 뒤 응답만 유실되는 정상적인 network 실패도 기존 멱등 batch 계약으로 복구합니다. Hub가 없는 로컬 실행 경로는 바뀌지 않습니다.

Production TLS 종료, 인증서·credential 회전, 설치 가능한 Node daemon과 장기 reconnect scheduler는 후속 제품 작업입니다. 현재 identity header를 상호 TLS나 서명 기반 peer proof로 확대하려면 별도 계약과 migration이 필요합니다.
