# ADR-0140: 대화 숙의 queue와 프로젝트 원본 대조

- 상태: 채택
- 날짜: 2026-08-22

## 맥락

대화 숙의 worker가 managed 숙의를 시작한 뒤 queue 결과를 저장하기 전에 멈추면 job은 `uncertain`이 됩니다. 이 job을 다시 실행하면 이미 만든 workspace와 provider 실행을 중복할 수 있습니다. 반대로 계속 `unknown`으로만 두면 프로젝트 event에 완료 기록이 있거나 승인 checkpoint 뒤에 안전하게 중단된 사실도 대화에서 확인할 수 없습니다.

Queue DB는 숙의 완료의 원본이 아닙니다. 프로젝트의 append-only event, 승인 checkpoint와 process lease가 원본이며 queue 결과는 이를 짧게 보여 주는 배포용 요약입니다.

## 결정

`@lervo/conversation-control`에 읽기 전용 대조 조정기와 `ConversationDeliberationReconciliationSourcePort`를 둡니다. 조정기는 project ID와 숙의 ID가 같은 `uncertain` job만 원본 source에 전달합니다. Source가 반환한 종료 또는 재개 후보 요약의 좌표와 상태를 검증한 뒤, job의 project·숙의·request hash가 여전히 같을 때만 `uncertain → settled` compare-and-set을 수행합니다.

공통 계약은 최대 64자의 제한된 `sourceKind`와 SHA-256 evidence hash만 요구합니다. 특정 CLI나 provider 이름을 고정하지 않으므로 다른 실행기도 독립적인 원본 검사기를 붙일 수 있습니다. 현재 CLI source인 `managed_deliberation_inspection_v1`은 구성된 project와 절대 repository root를 일대일로 연결하고 다음 원본을 검사합니다.

- 전체 project event hash chain과 해당 숙의의 시작·산출물·완료 관계
- 승인 checkpoint의 읽기 가능 여부
- 현재 process lease의 활성·부재·만료 상태
- queue project와 실제 manifest project의 일치

완료 event가 일관되면 `converged`, `no_consensus` 또는 `failed` 요약을 복구합니다. 완료 event가 없어도 승인 checkpoint가 읽히고 활성 lease가 없으면 `interrupted`와 `resume`을 복구합니다. 이는 재개 가능 후보라는 뜻일 뿐 대조기가 숙의를 재개하지는 않습니다.

다음 경우에는 job을 바꾸지 않고 `not_confirmed`로 반환합니다.

- 활성 lease가 있어 다른 process의 실행이 끝나지 않은 경우: `active_execution`
- 승인 전 중단처럼 완료 여부를 증명하지 못하는 경우: `history_incomplete`
- event chain, checkpoint, project 좌표가 일치하지 않는 경우: `source_inconsistent`
- 해당 숙의 원본이 없는 경우: `source_not_found`

SQLite schema v2는 기존 v1 job을 그대로 보존하면서 `reconciliation_json`을 추가합니다. 대조가 성공하면 source kind, 원본 검사 report의 canonical hash, 이전 failure code, 불확실 상태 시각과 대조 시각만 저장합니다. 원본 event, checkpoint, 주제, provider 응답과 내부 오류를 이 필드에 복제하지 않습니다. 같은 종료 요약에 대한 동시 대조는 먼저 commit한 결과를 유지하며 안전하게 끝납니다. 다른 결론으로 덮거나 대조 기록을 삭제할 수 없습니다.

`settled`는 queue 요약 저장이 끝났다는 뜻입니다. 전역 `deliberation.completed` event를 대신하지 않으며 `interrupted` 요약도 실제 숙의 완료로 해석하지 않습니다. `apps/conversation`은 대조 source가 명시적으로 구성된 경우에만 대조 함수를 노출하고 자동 schedule, 자동 재실행과 자동 재개를 만들지 않습니다.

## 결과

응답 유실이나 worker 중단 뒤에도 원본이 증명하는 상태만 대화 queue에 복구할 수 있습니다. 승인 전 불완전 이력과 현재 실행 중인 작업은 계속 `unknown`으로 남습니다. 다른 실행기는 공통 queue나 SQLite가 CLI 구현을 import하지 않은 채 자기 source adapter를 추가할 수 있습니다.
