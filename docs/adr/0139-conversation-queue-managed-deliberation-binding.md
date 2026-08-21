# ADR-0139: 대화 queue와 managed 숙의 실행 결속

- 상태: 채택
- 날짜: 2026-08-22

## 맥락

대화 숙의 queue는 responder 재시도 전에 안정적인 숙의 ID를 반환해야 합니다. 기존 managed 숙의 실행기는 실행을 시작하면서 임의 ID를 만들었으므로 그대로 연결하면 대화가 받은 ID와 workspace·event의 ID가 달라집니다. 반대로 일반 CLI 사용자가 임의 ID를 주입하게 하면 기존 workspace를 가리키거나 다른 project의 queue job을 실행할 수 있습니다.

## 결정

기존 `ExecuteManagedDeliberation`과 별도로 내부 전용 `ExecuteAssignedManagedDeliberation`을 둡니다. 이 함수만 다음 좌표를 받습니다.

- queue가 할당한 유효한 `deliberationId`
- queue job의 `expectedProjectId`
- repository root, 저장된 policy ID와 주제를 가진 시작 요청

일반 `lervo deliberate` parser와 executor signature는 바꾸지 않으며 사용자가 숙의 ID를 지정할 수 없습니다. Assigned executor는 project storage를 연 직후 manifest project를 기대값과 비교합니다. 다르면 `deliberation_project_mismatch`로 닫고 execution plan, workspace, runtime과 provider를 시작하지 않습니다. 일치하면 기존 workspace·runtime·checkpoint·verification 경로를 그대로 사용하되 첫 ID 생성만 할당값으로 대체합니다. 기존 workspace가 있으면 새 실행으로 덮지 않고 exclusive create 실패를 유지합니다.

`createManagedConversationDeliberationExecutionAdapter`는 project ID와 절대 repository root의 중복 없는 binding을 구성합니다. `leased` queue job만 저장 policy 요청으로 변환하고 assigned executor에 project·숙의 ID를 함께 전달합니다. 결과 ID가 job과 다르거나 산출물 수가 범위를 벗어나면 queue 완료로 저장하지 않습니다.

Managed 성공 결과에서는 `converged` 또는 `no_consensus`, 숙의 ID와 산출물 수만 `ConversationDeliberationSummary`로 반환합니다. 최종 본문, 참여자 목록, provider 결과와 내부 오류 원문은 queue DB에 복제하지 않습니다. Queue와 conversation app은 계속 managed executor 구현을 import하지 않고 공급자 중립 execution port만 봅니다.

## 결과

대화에 먼저 반환한 ID로 실제 다중 역할 workspace와 append-only 숙의 event를 조회할 수 있습니다. 잘못된 project binding은 provider 실행 전에 실패하며 CLI 공개 입력은 넓어지지 않습니다. 실행 중단과 queue 완료 commit 사이의 불확실성은 ADR-0138의 `uncertain` 처분을 그대로 사용하고, 자동 재실행하지 않습니다.
