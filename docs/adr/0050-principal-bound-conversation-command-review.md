# ADR-0050: principal에 결속된 대화 command 검토와 별도 승인

- 상태: 채택
- 기준일: 2026-08-20

## 맥락

대화에서 원격 command 상태를 확인할 수 있어도 메시지, reaction 또는 모델의 자연어 해석을 승인으로 사용하면 안 됩니다. Slack, Discord와 자체 채팅에서 같은 의미를 유지해야 하며, 대화 참여자와 Hub bearer 사용자가 다른 경우에도 검토 링크가 열려서는 안 됩니다. 반대로 이 UX 때문에 기존 signed approval 원본이나 로컬 단독 실행 경로를 바꿀 이유는 없습니다.

## 결정

`@lervo/conversation-control`은 message artifact의 bytes·hash·크기와 UTF-8을 다시 확인한 뒤 정확히 `/lervo command <delivery-id>` 또는 `/lervo approval <delivery-id>`인 메시지만 해석합니다. 자연어 승인 요청, reaction과 비슷한 문자열은 command로 추정하지 않습니다. 응답은 기존 interaction responder 계약을 구현하며 `chat` writing 의미 평가와 공개 permit를 통과한 Markdown artifact만 반환합니다. Adapter로 직접 전송하거나 정책 원본을 작성하지 않습니다.

대화 participant binding은 project·participant, Hub principal, destination과 `command.read`·`approval.review`를 명시합니다. 승인 검토 링크를 만들 때 `@lervo/hub-control`이 principal·destination·project·delivery·만료 시각을 HMAC-SHA256 grant에 결속합니다. Grant는 principal 원문을 포함하지 않고 기본 10분, 최대 1시간 뒤 만료됩니다. 링크의 fragment에는 네 좌표와 grant만 두며 browser가 읽자마자 주소 표시줄에서 제거합니다. Grant secret은 conversation deployment와 Hub가 공유하는 구성 비밀이며 DB, event, 응답 또는 URL에 넣지 않습니다.

Hub의 `GET /v1/control/projects/<projectId>/commands/<deliveryId>?destinationId=...`는 bearer의 project scope와 `command.read`, `x-lervo-control-review` grant가 같은 bearer principal에 결속됐는지를 모두 확인한 뒤 read model을 만듭니다. Read model은 delivery 상태·시각, role·provider·risk·verification suite, 현재 policy snapshot과 capability·repository path별 승인 상태만 포함합니다. Request artifact, command hash·서명, 승인자 subject hash와 내부 오류는 반환하지 않습니다.

`/control`은 데이터 없는 고정 shell입니다. Token은 현재 탭의 JavaScript 메모리에만 있고 URL, cookie, local storage와 session storage에 두지 않습니다. 각 범위 버튼은 기존 `POST /v1/policy/.../approvals`를 호출합니다. 따라서 grant는 조회할 command와 principal만 결속하며 승인 권한이 아닙니다. 실제 signed approval은 별도로 재인증한 bearer가 project scope와 `approval.write` 또는 기존 `policy.write`를 가질 때만 기존 Hub policy authoring 경계에서 만들어집니다.

## 파생 상태와 실패 의미

Command review의 approval 상태는 `unavailable`, `denied`, `not_required`, `approval_required`, `partially_approved`, `approved`입니다. 이는 현재 command, snapshot, approval과 revocation 원본에서 매번 계산하는 파생 view이며 새 저장 상태나 실행 event가 아닙니다. `hadRevokedApproval`도 현재 bundle에 철회된 command approval이 있었음을 뜻할 뿐 철회 사유나 승인자를 공개하지 않습니다.

잘못된 명령은 `control_command_invalid`, binding·권한 거부는 `control_access_denied`, Hub 조회 실패는 `control_source_failed`, 본문 CAS 불일치는 `message_artifact_invalid`, writing 공개 실패는 `writing_publication_blocked`입니다. HTTP는 잘못된 좌표를 `400`, 인증 없음을 `401`, scope·permission·principal/grant 불일치를 `403`, command 부재를 `404`, source 불일치를 `500`으로 닫습니다. 고정 오류 본문에는 token, grant, principal, command 원본과 내부 예외를 넣지 않습니다.

## 개인정보와 비밀정보

대화 응답에는 Hub principal ID, project identity hash, request artifact와 approval ID를 넣지 않습니다. Fragment의 grant는 만료 시각과 MAC만 가지며 bearer token과 principal 원문을 포함하지 않습니다. Browser는 fragment를 서버 요청에 보내지 않고 즉시 지웁니다. Hub approval 원본에는 기존 계약대로 project-scoped subject hash만 남습니다. 새 전역 event는 추가하지 않습니다.

## 검증

계약 테스트는 자연어 승인 문장이 command로 해석되지 않고, 대화 응답이 writing permit를 가지며 승인 생성 부재를 명시하는지 확인합니다. Grant fixture는 다른 principal·command와 만료 뒤 재사용을 거부합니다. 실제 Hub SQLite·HTTP fixture는 grant 조회 전 approval 0개, read-only bearer의 승인 거부, 각 범위 승인에 따른 `approval_required → partially_approved → approved`, 철회 뒤 `partially_approved`와 민감 필드 비노출을 확인합니다. Web fixture는 데이터 없는 shell, fragment 제거, memory-only token과 안전한 DOM 작성을 검사합니다.

## 결과

같은 conversation responder/outbox 경계를 거치므로 Slack, Discord와 자체 채팅이 별도 승인 의미를 만들지 않습니다. Hub가 없어도 기존 로컬 실행은 계속 완료됩니다. 이 구현은 Discord Gateway driver나 platform별 interactive button을 완료했다고 주장하지 않습니다.
