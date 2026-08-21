# ADR-0137: 숙의 실행 lease와 ID 기반 진단

- 상태: 채택
- 날짜: 2026-08-21

## 맥락

승인 체크포인트가 있어도 원래 process가 검증·결정을 실행 중일 수 있습니다. Event에 다음 artifact가 아직 기록되지 않은 짧은 구간에서 다른 process가 재개하면 검증을 중복 실행할 수 있습니다. 또한 run별 trace만으로는 여러 역할 run에 걸친 숙의 전체 상태를 한 번에 보기 어렵습니다.

## 결정

승인 경계부터 종료까지 `.lervo/state/deliberations/<id>/checkpoints/active.json` owner-only lease를 둡니다. Lease는 숙의 ID, 임의 owner ID, process ID와 획득 시각만 가지며 주제·본문·credential을 넣지 않습니다. 원래 실행은 checkpoint보다 먼저 lease를 exclusive-create하고 종료 또는 관리된 실패 때 자기 lease만 제거합니다.

재개는 살아 있는 process의 lease를 만나면 `deliberation_in_progress`로 실패합니다. 죽은 process의 lease만 고유 stale 파일로 원자 이동한 뒤 새 lease를 exclusive-create합니다. 두 재개가 경쟁하면 하나만 획득합니다. Process ID 재사용처럼 생존 여부가 모호하면 실행 중으로 보아 보수적으로 차단합니다.

다음 명령은 같은 읽기 전용 진단기를 사용합니다.

- `lervo deliberate status <id>`
- `lervo trace --deliberation <id>`
- `lervo doctor --deliberation <id>`

진단기는 event chain 전체를 확인하고 시작·artifact·완료 event, checkpoint 형식과 lease 생존 상태를 대조합니다. 역할별 artifact 생산 run과 checkpoint가 직접 가리키는 evidence event의 run을 최대 1,000개 event로 묶습니다. 상태는 검토 회차, 승인 뒤 실행 중, 승인 뒤 중단 후보, 완료를 구분합니다. Lease가 없고 승인 전 이력만 남은 경우 실행 중인지 중단됐는지 알 수 없으므로 `incomplete`로 보고합니다.

`candidate`는 실제 재개 가능성의 사전 진단일 뿐 권한이 아닙니다. `--resume`이 현재 policy, event, CAS, workspace와 역할 결속을 다시 검증하고 lease를 획득해야 실행됩니다. 기존 doctor report v1과 run trace report v1은 바꾸지 않고, 숙의 ID를 명시한 별도 report v1을 반환합니다. Trace capability report에는 additive `deliberationDiagnostics` 설명을 둡니다.

## 결과

활성 실행과 중단 후보를 구분하면서도 관측할 수 없는 생존 상태를 완료나 중단으로 추정하지 않습니다. 진단 명령은 파일·event·lease를 바꾸거나 자동 재개하지 않습니다.
