# ADR-0141: 명시적 대화 숙의 재개와 별도 durable queue

- 상태: 채택
- 날짜: 2026-08-22

## 맥락

프로젝트 원본 대조는 승인 checkpoint 뒤에 중단된 숙의를 `interrupted`와 `resume`으로 보여 줍니다. 그러나 상태 조회가 실행을 시작해서는 안 되며, 원래 start job을 다시 `queued`로 바꾸면 최초 요청과 재개 요청의 권한·멱등성·실패 의미가 섞입니다. 재개 중 process가 멈춘 경우에도 승인 checkpoint가 남아 있다는 이유만으로 같은 재개를 반복하면 안 됩니다.

## 결정

대화에서 재개하는 유일한 문장은 `/lervo deliberate resume <deliberation-id>`입니다. 자연어, 상태 조회, reaction과 모델 판정은 재개 의도가 아닙니다. 사람 participant는 기존 시작·조회와 분리된 `deliberation.resume` 권한을 가져야 합니다.

`ConversationDeliberationPort`와 backend에 `resume`을 별도 operation으로 추가합니다. Backend는 현재 start queue 요약이 정확히 `interrupted/resume`인지 먼저 확인합니다. 그 뒤에만 canonical source event ID, project·숙의 ID, principal hash와 최초 요청 시각을 별도 resume queue에 저장합니다. 주제와 policy는 기존 checkpoint와 project 원본에서 다시 읽으므로 resume queue에 복제하지 않습니다.

Resume queue는 `deliberation-resumes.sqlite`라는 mode `0600` 파일을 사용합니다. 원래 `deliberations.sqlite`, platform credential, interaction inbox/outbox와 섞지 않습니다. `(projectId, sourceEventId)`는 같은 message 재처리의 멱등 키이고 `(projectId, deliberationId)`는 승인된 한 경계의 재개 요청을 하나로 제한합니다. 같은 message의 timestamp만 달라진 재처리는 기존 job을 반환합니다. 다른 message가 같은 숙의를 다시 재개하려 하면 `deliberation_resume_conflict`이며 기존 job을 바꾸지 않습니다.

Resume job은 start job과 같은 `queued`, `leased`, `settled`, `uncertain` 전이를 사용하지만 failure code를 분리합니다.

- `resume_worker_lease_expired`: 재개 executor를 호출한 lease가 결과 저장 전에 만료됐습니다.
- `deliberation_resume_execution_uncertain`: 재개 executor의 외부 효과나 결과 commit을 확인하지 못했습니다.

두 경우 모두 자동 재실행하지 않습니다. Queue 조회는 resume job이 있으면 그 상태를 start 요약보다 우선합니다. 따라서 재개 대기·실행 중은 `running`, 불확실한 재개는 `unknown`, 저장된 종료 결과는 `converged|no_consensus|failed`로 보입니다.

Start와 resume worker는 공통 lease·heartbeat·종료 전이 모듈을 사용합니다. Worker가 저장할 수 있는 실행 결과는 세 종료 상태뿐입니다. `running`, `unknown`, `interrupted`를 executor 성공으로 반환하면 외부 효과를 알 수 없는 것으로 닫습니다.

CLI의 내부 assigned executor는 start 요청이면 queue ID로 새 workspace를 만들고, resume 요청이면 같은 ID를 기대 project와 함께 기존 `resumeManagedDeliberationWithStorage`에 전달합니다. 두 경로 모두 storage manifest를 provider 시작 전에 확인합니다. 일반 CLI의 `--resume` 동작과 checkpoint·event·CAS·lease 재검증 규칙은 바꾸지 않습니다.

원본 대조 target에는 `operation=start|resume`을 명시합니다. Start가 불확실할 때 승인 checkpoint와 비활성 lease는 `interrupted`를 확인할 수 있습니다. 이미 resume executor를 호출한 job은 같은 checkpoint만으로 결과를 확인할 수 없으므로 계속 `unknown`이며, 일관된 `deliberation.completed` 종료 상태만 resume queue를 대조할 수 있습니다.

`apps/conversation`은 resume executor가 구성된 경우에만 resume DB와 worker cycle을 엽니다. Resume 권한이 있는데 executor가 없으면 시작 시 구성을 거부합니다. Scheduler는 start와 resume cycle을 각각 호출할 수 있지만 상태 조회·대조는 어느 cycle도 자동으로 실행하지 않습니다.

## 결과

대화 참여자는 명시적인 별도 권한으로 승인된 경계만 한 번 재개할 수 있습니다. Message 재전달과 process 재시작은 재개 provider를 중복 호출하지 않으며, 불명확한 재개 결과도 checkpoint가 남았다는 이유로 반복하지 않습니다. Start·resume 저장과 실행기는 플랫폼·Codex·Claude 계약에서 계속 분리됩니다.
