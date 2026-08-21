# ADR-0138: 대화 숙의 durable queue와 fail-closed worker

- 상태: 채택
- 날짜: 2026-08-22

## 맥락

플랫폼 중립 대화 명령은 canonical source event ID를 backend에 전달하지만 실제 durable backend는 없었습니다. Interaction inbox lease 안에서 긴 숙의를 직접 실행하면 lease 만료나 responder 재호출 때 같은 숙의가 중복 실행될 수 있습니다. Process가 실행 결과를 로컬 숙의 event에 남긴 뒤 queue 완료를 저장하기 전에 죽는 구간은 SQLite transaction만으로 외부 효과와 함께 원자화할 수 없습니다.

## 결정

`@lervo/conversation-control`에 job store port, `QueuedConversationDeliberationBackend`, 한 cycle worker와 공급자 중립 실행 port를 둡니다. Backend는 `(projectId, sourceEventId)`에서 결정적인 `dlb_` ID를 만들고 principal·policy·topic을 포함한 request hash와 함께 예약한 뒤 바로 `running`을 반환합니다. 재시도 시각은 달라질 수 있으므로 request hash에서 제외하고 최초 시각만 보존합니다.

`@lervo/conversation-deliberation-sqlite`는 `deliberations.sqlite`에 다음 원본을 저장합니다.

- project·source event·숙의 ID와 request hash
- principal의 SHA-256 hash, policy ID, 실행에 필요한 주제와 최초 요청 시각
- `queued`, `leased`, `settled`, `uncertain`, 시도 횟수와 lease 좌표
- 검증된 결과 요약 또는 allowlist failure code

DB는 mode `0600`이고 delete·identity 변경과 잘못된 상태 전이를 trigger로 막습니다. Principal 원문, 외부 platform 주소, credential과 provider 오류 원문은 넣지 않습니다. 주제는 실행에 필요한 입력이라 owner-only DB에 평문으로 보존합니다. Platform mapping DB, interaction DB와 본문 CAS는 계속 분리합니다.

허용 상태 전이는 `queued → leased → settled|uncertain`이며 같은 owner·lease ID의 만료 시각만 연장할 수 있습니다. Worker는 한 번에 job 하나를 lease하고 실행 중 lease 기간의 3분의 1마다 heartbeat로 갱신하며 `ConversationDeliberationExecutionPort`를 호출합니다. 결과의 숙의 ID, 상태별 다음 행동과 산출물 수를 확인한 뒤에만 `settled`로 저장합니다. Executor 예외나 heartbeat 실패는 원문을 버리고 `deliberation_execution_uncertain`으로 닫습니다.

만료된 lease는 자동 재실행하지 않습니다. 원래 worker가 외부 숙의를 실행했는지 증명할 수 없기 때문에 `worker_lease_expired`의 `uncertain`으로 전이하고 대화 조회에는 `unknown`을 반환합니다. 이후 전역 숙의 event와 queue를 대조하는 운영자 reconciliation은 별도 후속 범위입니다. `unknown`을 `failed`, `interrupted` 또는 완료로 추정하지 않습니다.

`apps/conversation`은 숙의 binding, 실행 port와 worker ID가 설정된 경우에 별도 SQLite store와 control을 조합하고 scheduler가 호출할 `runDeliberationWorkerCycle`을 제공합니다. Queue와 SQLite는 Codex, Claude, CLI 실행기나 Slack·Discord transport를 import하지 않습니다. 새 전역 event를 추가하지 않으며 queue 상태는 `selected`, `loaded`, `injected`, `used` 또는 숙의 완료 증거가 아닙니다.

## 결과

같은 대화 event의 재처리는 application 재시작 뒤에도 하나의 job과 숙의 ID로 수렴합니다. 아직 실행 port에 전달되지 않은 요청은 안전하게 이어지고, 실행 여부를 증명할 수 없는 중단은 중복 실행보다 보수적인 운영자 확인 상태로 남습니다. 실제 managed 숙의 실행 adapter와 `uncertain` reconciliation은 이 queue 계약 뒤에서 독립적으로 확장할 수 있습니다.
