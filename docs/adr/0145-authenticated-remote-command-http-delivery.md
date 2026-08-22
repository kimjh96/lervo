# ADR-0145: Node 범위에 결속된 원격 command HTTP 전달

- 상태: 채택
- 기준일: 2026-08-22

## 맥락

Hub의 durable command queue와 Node reconnect worker는 인증된 transport port로 연결되어 있었지만 실제 HTTP 구현은 없었습니다. 로컬 fixture가 queue·replay 의미를 검증해도 배포 환경에서 누가 어느 project의 lease를 받을 수 있는지, 응답 크기와 제한 시간이 지켜지는지, Hub와 Node 재시작 뒤 같은 보장이 유지되는지는 확인하지 못했습니다.

Acknowledgement 저장 port도 delivery ID만 받았습니다. HTTP route에서 project scope를 확인하더라도 저장 호출이 destination·project identity·Node와 다시 결속되지 않으면 다른 route 좌표를 붙인 acknowledgement를 application 경계 아래에서 구분하기 어렵습니다.

## 결정

### Hub는 인증과 범위를 본문보다 먼저 확인한다

`@lervo/hub`는 `POST /v1/commands/projects/:projectId/leases`와 `POST /v1/commands/projects/:projectId/acknowledgements`를 제공합니다. 두 route는 bearer 인증, `command.delivery` permission, destination·project scope와 `principalId === nodeId`를 본문보다 먼저 확인합니다. Lease 시각과 confirmation 시각은 client가 보내지 않고 Hub clock이 정합니다.

Lease body는 schema version, 1초 이상 5분 이하의 lease duration과 1~16개의 limit만 받습니다. Acknowledgement body는 기존 canonical schema를 그대로 사용합니다. 요청은 기본 256 KiB, 응답은 기본 1 MiB로 제한하며 JSON 이외의 본문, 중복·알 수 없는 query와 고정 경로 밖 요청을 거부합니다. 모든 응답은 `no-store`와 Hub identity header를 사용하고 내부 예외를 반환하지 않습니다.

Hub queue acknowledgement port는 destination ID, project ID·identity hash와 Node ID를 필수로 받습니다. SQLite repository는 현재 registration과 lease owner를 같은 transaction에서 다시 확인합니다. 이미 terminal인 같은 acknowledgement는 원래 acknowledgement hash가 같고 destination·project identity가 같은 경우에만 duplicate confirmation을 반환합니다.

### Node HTTP transport는 구성된 좌표 밖 요청을 만들지 않는다

`AuthenticatedRemoteCommandHttpTransport`는 base URL, bearer credential, expected Hub identity, destination, Node와 project target을 생성 시 고정합니다. 기본적으로 credential·query·fragment가 없는 HTTPS URL만 허용하며 평문 HTTP는 로컬 fixture option에서만 열립니다. Pull 입력이 구성 좌표와 다르면 network를 호출하지 않습니다.

Transport는 bearer와 bounded JSON으로 lease·acknowledgement를 보내고 기본 15초 뒤 요청을 중단합니다. HTTP 200, JSON content type, Hub identity header와 응답의 destination·Node·project 좌표를 모두 확인한 뒤에만 기존 reconnect worker에 body를 넘깁니다. Hub identity header는 TLS peer 검증을 대신하지 않고 HTTPS가 보호한 응답을 구성된 logical Hub에 추가 결속합니다.

Worker는 응답을 받은 뒤의 현재 시각으로 lease가 미래에서 발급되지 않았는지 확인합니다. 요청 시작 시각으로 비교해 정상적인 network 왕복을 거부하던 기존 검사는 사용하지 않습니다.

### 반복 실행은 worker와 분리된 lifecycle이다

Polling lifecycle은 한 번에 cycle 하나만 실행합니다. 빈 queue는 bounded idle interval 뒤 다시 확인하고, offline·acknowledgement pending·local deferred는 worker가 반환한 `nextAttemptAt`까지 기다립니다. 처리된 batch 뒤에는 남은 queue를 확인할 수 있도록 다음 cycle을 이어갑니다. `AbortSignal`은 새 cycle 진입과 대기를 중단합니다.

Lifecycle은 process 생성, service manager, credential loading이나 로그 저장을 소유하지 않습니다. 따라서 이번 결정은 실제 command HTTP 전달과 반복 실행 계약을 뜻하지만 설치된 Node daemon이나 production TLS termination 배포 완료를 뜻하지 않습니다.

## 개인정보와 실패 의미

Bearer token은 process memory와 Authorization header에만 있고 URL, queue, replay, 응답과 오류에 들어가지 않습니다. HTTP 응답은 기존 bounded lease, confirmation과 project·Node 좌표만 포함합니다. Raw request, provider 출력과 내부 예외는 추가로 저장하지 않습니다.

미인증은 `401`, permission·project·Node 불일치는 `403`, 등록 부재는 `404`, 잘못된 route·query·body는 `400`, identity·lease·acknowledgement 충돌은 `409`, body 상한 초과는 `413`입니다. Node는 HTTP·network·timeout을 `hub_unavailable`, Hub identity 불일치를 `transport_authentication_failed`로 처리합니다. 기존 `offline`, `idle`, `processed`, `acknowledgement_pending`, `local_deferred` 외 새 queue 상태나 event는 추가하지 않습니다.

## 검증

실제 Node.js HTTP server와 Hub·Node SQLite를 사용해 command를 lease하고 executor를 호출한 뒤 첫 acknowledgement 요청을 유실시켰습니다. 양쪽 database와 Hub server를 재시작하고 lease 만료 뒤 같은 command를 다시 받아 저장된 receipt로 복구한 결과 executor는 한 번만 호출되고 두 번째 acknowledgement만 commit됐습니다.

권한 없는 principal과 다른 Node가 oversized body를 보내도 queue source 전에 거부되는지, 허용 Node의 oversized body는 `413`인지 확인했습니다. 잘못된 Hub identity는 executor 전에 `transport_authentication_failed`가 됩니다. Polling fixture는 offline retry와 idle interval을 지키며 cycle이 겹치지 않고 중단 신호 뒤 새 cycle을 시작하지 않는지 검증합니다.

## 결과와 후속 범위

기존 provider-neutral receiver와 durable queue가 실제 인증 HTTP 경계로 연결됐습니다. 로컬 실행은 이 transport나 Hub 없이 그대로 완료됩니다. Signed command 작성·enqueue를 외부 요청에 노출하는 경계, 설치 가능한 Node daemon과 conversation service host는 별도 우선순위입니다.
