# ADR-0039: 인증과 project scope를 먼저 적용하는 trace HTTP 경계

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Hub trace read model은 project, run, event를 제한된 cursor page로 읽지만 사용자 인증과 project 권한은 알지 못했습니다. HTTP adapter가 전체 목록이나 project 원본을 읽은 뒤 응답에서 권한 없는 항목을 지우면, 권한 없는 데이터가 application memory와 query 비용에 먼저 들어옵니다. 개별 project의 존재 여부도 권한 검사 전에 드러날 수 있습니다.

Web view를 만들기 전에 인증, project authorization, 외부 cursor, 오류 본문과 응답 크기의 경계를 먼저 고정해야 합니다. 이 API는 조회 전용이며 Hub sync command route나 원격 실행 권한을 함께 열지 않습니다.

## 결정

### HTTP와 trace query 사이에 project-scoped reader를 둔다

`@lervo/hub`는 요청마다 `HubRequestAuthenticator`에서 `principalId`와 허용된 `(destinationId, projectId)` 목록을 받습니다. 인증 성공 뒤에만 `HubProjectScopedTraceReader`를 만들며 scope는 최대 256개 project입니다.

`HubTraceSource`의 모든 resolved query는 `all` 또는 명시적인 `projects` scope를 필수로 받습니다. 내부 운영용 `HubTraceReader`만 `all`을 사용합니다. HTTP adapter는 항상 `projects` scope를 사용합니다. Project 목록은 SQLite `WHERE` 조건에서 scope를 적용하고 응답 뒤 필터링을 하지 않습니다. Project 또는 run 상세가 scope 밖이면 `project_forbidden`으로 source 호출 전에 실패합니다. 따라서 403은 해당 project의 등록 여부를 뜻하지 않습니다.

### v1 route는 조회와 pagination만 제공한다

다음 GET route만 제공합니다.

- `/v1/trace/projects?limit=<n>&cursor=<token>`
- `/v1/trace/projects/<projectId>?destinationId=<id>&limit=<n>&cursor=<token>`
- `/v1/trace/projects/<projectId>/runs/<runId>?destinationId=<id>&limit=<n>&cursor=<token>`

`limit`은 기존 trace 계약의 기본 50·최대 100을 그대로 사용합니다. Cursor는 version과 종류를 포함한 canonical JSON의 base64url 표현입니다. Project, run, event cursor 종류를 서로 바꿔 쓸 수 없고 알 수 없는 필드, 중복 query parameter, 허용하지 않은 query parameter와 비정규 base64url은 400으로 거부합니다. Cursor는 암호화나 권한 증명이 아니며, 매 요청의 인증과 project scope가 별도로 적용됩니다.

응답은 `schemaVersion: 1`을 포함합니다. Project 목록, run 목록과 event 목록은 기존 bounded page만 직렬화합니다. 기본 응답 한도는 1 MiB이고 구성 가능한 상한은 16 MiB입니다. 직렬화 결과가 한도를 넘으면 일부 JSON을 보내지 않고 고정된 `response_too_large` 오류로 바꿉니다. 모든 성공·실패 응답은 `Cache-Control: no-store`와 `X-Content-Type-Options: nosniff`를 사용합니다.

### 인증 구현과 오류 본문은 제한된 주장만 한다

첫 인증 adapter는 시작 구성에 고정된 bearer credential을 사용합니다. Token은 32~4096자의 공백 없는 visible ASCII 값이며 SHA-256 digest만 process memory의 lookup key로 보관합니다. 일치하면 구성에 적힌 principal과 project scope를 반환합니다. 이는 구성된 bearer 값의 일치만 증명하며 사용자 federation, JWT 검증, 조직 역할이나 Node peer 인증을 뜻하지 않습니다. 이후 인증 방식은 같은 `HubRequestAuthenticator` 뒤에서 교체할 수 있습니다.

인증 실패는 이유를 구분하지 않는 401 `unauthorized`와 `WWW-Authenticate: Bearer`, scope 밖 접근은 403 `forbidden`입니다. 잘못된 route는 404 `not_found`, 지원하지 않는 method는 405 `method_not_allowed`, schema나 cursor가 잘못된 요청은 400 `invalid_request`입니다. 권한이 확인된 원본의 부재만 `project_not_found` 또는 `run_not_found` 404로 반환합니다. Source 불일치, 저장 read 실패와 예상하지 못한 예외는 상세 내용을 숨긴 500 `internal_error`입니다.

## 개인정보와 비밀정보

Authorization header, bearer token, token digest와 principal ID는 응답에 넣지 않습니다. 고정 오류에는 요청 값, 예외 메시지, SQL, credential과 원본 event payload를 붙이지 않습니다. Project 목록과 상세의 기존 데이터 최소화 규칙은 유지하며 run event page에는 이미 Hub sync allowlist를 통과한 event만 포함합니다.

이번 변경은 새 event나 telemetry 상태를 만들지 않습니다. HTTP 성공은 context 이해·사용, 실행 완료, 동기화 성공 또는 사람 신원 확인을 뜻하지 않습니다. API는 원본과 파생 index를 쓰지 않습니다.

## 검증

실제 Node HTTP server에서 credential 누락·오류가 query 전에 401인지, scope 밖 project가 source 호출 전에 403인지, 목록 query가 인증된 scope만 source에 전달하는지 확인했습니다. 계약을 어긴 source가 scope 밖 project를 반환해도 응답하지 않고 닫히는지 확인했습니다. Project cursor를 두 요청 사이에 왕복하고 다른 종류 cursor, 알 수 없는 query와 큰 응답이 안전한 오류가 되는지 검증했습니다. SQLite 통합 테스트는 두 등록 project 중 허용된 좌표만 SQL 결과에 들어오는지 확인합니다.

## 결과

Web view는 전체 Hub trace source를 직접 받지 않고 이 인증된 HTTP API만 사용할 수 있습니다. 인증 adapter, 요청 해석, cursor codec, 응답 정책과 trace dispatch가 분리되어 인증 방식이나 UI가 바뀌어도 project authorization과 bounded query 계약은 유지됩니다. 다음 작업은 이 API 위의 최소 read-only web view입니다.
