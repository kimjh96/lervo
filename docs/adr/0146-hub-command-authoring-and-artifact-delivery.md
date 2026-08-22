# ADR-0146: Hub가 소유하는 원격 command 작성과 요청 artifact 전달

- 상태: 채택
- 기준일: 2026-08-22

후속 결정: [ADR-0147](./0147-bounded-command-artifact-lifecycle.md)은 이 결정에서 남긴 command CAS 자동 정리와 orphan 회수를 bounded claim 수명주기로 구현합니다.

## 맥락

인증된 command lease와 acknowledgement HTTP 경계는 있었지만 command는 내부 fixture가 직접 서명해 queue에 넣었습니다. Node receiver의 payload loader도 고정 byte fixture였으므로 외부 대화 플랫폼이나 자체 채팅 서비스가 공통 경계로 작업을 제출하고 실제 요청 원문을 전달하는 흐름은 완성되지 않았습니다.

클라이언트가 command 발급 시각·nonce·서명을 만들게 하면 Hub의 보안 정책과 멱등 의미가 플랫폼마다 달라집니다. Raw request를 queue나 event에 넣으면 운영 조회와 오류에서 불필요하게 원문이 퍼집니다. Artifact를 project scope만으로 내려주면 같은 project의 다른 Node가 현재 lease 없이 원문을 읽을 수도 있습니다.

## 결정

### 작성 규칙은 플랫폼 중립 application 경계다

새 `@lervo/hub-command`는 Slack, Discord, 자체 채팅이나 다른 HTTP client를 알지 않습니다. 호출자는 destination·project target, 작성 principal, idempotency key, lifetime, 역할, provider, risk, verification suite와 1~65,536 byte UTF-8 요청만 전달합니다. Provider는 특정 제품 allowlist가 아닌 기존 공급자 중립 schema를 따릅니다.

Hub clock이 `issuedAt`과 `expiresAt`을 만들고 32-byte nonce를 생성합니다. Configured signer만 canonical command를 서명합니다. HTTP client가 이 세 값이나 artifact 좌표를 보내는 필드는 없습니다. 작성자 원문은 저장하지 않고 `SHA-256(projectIdentityHash + NUL + principalId)`만 authorship metadata에 둡니다.

`POST /v1/commands/projects/:projectId/submissions`는 bearer의 `command.write`와 destination·project scope를 body보다 먼저 확인합니다. 성공 응답은 `created|duplicate`, destination·target, delivery ID, 최초 queue 시각과 signed envelope만 반환하며 raw request, artifact URI, 작성자 hash와 submission hash는 반환하지 않습니다.

### 원문과 queue commit은 분리하되 부분 상태를 노출하지 않는다

작성 service는 요청 byte의 hash·크기를 계산하고 project-scoped artifact ID를 만든 뒤 별도 artifact store에 저장하고 즉시 다시 읽어 검증합니다. 그 다음 SQLite가 authorship metadata와 command queue row를 하나의 transaction으로 commit합니다. Authorship에는 request 원문이 아니라 submission hash, 비식별 작성자 hash, artifact ID·URI·hash·크기·media type과 delivery 관계만 있습니다.

같은 destination·project·idempotency key와 같은 submission hash는 최초 signed envelope과 queue 시각을 그대로 반환합니다. 내용, 실행 옵션이나 lifetime이 달라지면 `409 conflict`이며 새 artifact를 쓰지 않습니다. 동시에 들어온 같은 요청도 SQLite transaction에서 같은 규칙을 다시 적용합니다. Artifact 저장 뒤 database commit이 실패하면 주소를 노출하지 않은 orphan CAS object가 남을 수 있지만 queue나 다운로드 경로에서는 접근할 수 없습니다.

### 요청 원문은 현재 lease를 가진 Node만 읽는다

`GET /v1/commands/projects/:projectId/artifacts/:artifactId`는 `command.delivery`, destination·project scope와 `principalId === nodeId`를 먼저 확인합니다. SQLite는 같은 transaction snapshot에서 project identity, artifact binding, command의 `leased` 상태, lease owner와 아직 지나지 않은 lease 만료 시각을 모두 확인합니다. Pending, terminal, expired lease와 다른 Node에는 artifact 존재를 구분하지 않고 `404`를 반환합니다.

Node의 `AuthenticatedRemoteCommandHttpPayloadLoader`는 credential이나 query가 없는 HTTPS base URL을 기본으로 강제합니다. Bearer를 보내고 HTTP 200, Hub identity, artifact ID, content hash, 정확한 media type과 content length를 확인합니다. 응답을 signed reference의 byte count까지만 읽고 SHA-256과 strict UTF-8을 다시 검사합니다. Receiver도 기존 검사를 반복하므로 loader 우회가 command 검증을 약화하지 않습니다.

## 개인정보와 보존

Raw request는 command, Hub SQLite, queue 조회, event, acknowledgement, receipt, 오류와 로그 payload에 넣지 않습니다. Hub command용 CAS는 `ownerOnly` mode를 사용하면 directory `0700`, object `0600`을 강제합니다. 이 mode는 암호화를 뜻하지 않으므로 disk encryption과 backup 정책은 배포 책임입니다.

현재 authorship과 command 원본은 감사 관계를 위해 append-only이며 자동 물리 삭제 scheduler는 포함하지 않습니다. 만료 뒤에는 유효한 lease가 생기지 않아 HTTP로 읽을 수 없지만 CAS byte 자체는 남습니다. 따라서 운영 배포는 command 전용 CAS를 다른 artifact와 분리하고 기존 raw artifact 기본값인 30일 이내 정리 정책을 적용해야 합니다. 자동 GC와 orphan 회수까지 구현되기 전에는 Hub raw artifact 보존 자동화가 완료됐다고 주장하지 않습니다.

## 실패 의미

Submission 인증 없음은 `401`, scope·permission 거부는 `403`, 잘못된 query·body·UTF-8·크기·lifetime은 `400`, idempotency나 project identity 충돌은 `409`, body 상한 초과는 `413`입니다. Artifact는 인증·scope 실패 `401|403`, 현재 lease binding 부재 `404`, CAS 읽기·무결성 실패 `500`입니다. 고정 오류 본문에는 request, credential, principal, URI나 내부 예외를 넣지 않습니다.

이번 결정은 새 runtime event나 queue 상태를 추가하지 않습니다. `created`와 `duplicate`는 HTTP 작성 결과일 뿐 실행, `loaded`, `injected`, `used`, acknowledgement 또는 event sync를 뜻하지 않습니다.

## 검증

실제 HTTP server, Hub SQLite, owner-only filesystem CAS와 Node replay SQLite를 연결했습니다. HTTP submission을 같은 body로 재시도하면 같은 envelope과 delivery가 돌아오고, 같은 key의 다른 request는 충돌합니다. Node가 lease를 받은 뒤 인증된 loader로 원문을 읽어 executor를 한 번 호출하며 acknowledgement 유실 뒤 Hub·Node database와 server를 재시작해도 저장된 receipt로 복구합니다.

권한 없는 principal의 oversized submission은 body 전에 `403`, 허용 writer는 `413`이 됩니다. Lease 없는 Node와 다른 principal은 artifact를 읽지 못합니다. Loader contract test는 Hub identity, 길이와 content hash drift를 각각 거부합니다. CAS test는 owner-only directory와 object mode를 확인합니다.

## 결과와 후속 범위

모든 플랫폼 integration은 `@lervo/hub-command` 작성 port를 호출할 수 있고 command core에는 Slack·Discord 조건이 들어가지 않습니다. 로컬 managed 실행은 Hub 없이 그대로 완료됩니다. 설치 가능한 Node daemon, production TLS termination, credential loading, command CAS 자동 GC와 orphan 회수는 별도 배포·수명주기 작업입니다.
