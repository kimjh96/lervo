# ADR-0011: Managed provider run 수명주기와 저장소 경계

- 상태: 채택
- 기준일: 2026-08-18

## 맥락

Codex와 Claude adapter는 같은 session, controlled context, turn과 normalized signal 계약을 구현하지만, M2의 context gate와 실제 provider process를 하나의 run으로 묶는 상위 수명주기가 없었습니다. 호출자가 단계를 임의로 조합하면 context 주입 전에 turn을 시작하거나, compaction을 놓치거나, 취소 뒤 process를 남기거나, provider가 직접 만든 변경을 검증된 `file.changed`로 오인할 수 있습니다.

현재 adapter process에는 파일마다 Roven의 1회용 write permit를 요청하고 실제 bytes를 다시 확인하는 policy bridge가 없습니다. 따라서 coordinator가 provider write를 허용하면 E3 gate가 있어도 개별 변경이 permit를 통과했다고 증명할 수 없습니다. 공통 adapter signal도 최종 답변 원문을 전달하지 않으므로, 결과를 보여주지 못하는 읽기 전용 `roven run` CLI를 먼저 공개하는 것은 유효한 제품 흐름이 아닙니다.

## 결정

### 책임 분리

- `ManagedProviderRunCoordinator`는 요청, 저장소 snapshot, adapter 시작, context 준비·주입, turn 시작, signal 소비, 중단, adapter 종료와 최종 run event의 순서만 소유합니다.
- Context 선택·E1/E2/E3와 generation 전이는 기존 `ManagedContextRun`에 위임합니다. Provider signal stream의 종료와 terminal event 판정은 별도 monitor가 맡고, adapter 계약 검증·실패 분류도 별도 모듈에 둡니다.
- 공급자별 process와 protocol은 adapter 안에 남습니다. Coordinator는 Codex나 Claude 구현을 import하지 않고 `ProviderAdapter` 포트만 받습니다.
- 같은 coordinator instance는 한 run에만 사용합니다. 입력은 함수와 `AbortSignal`을 제외하고 격리 복사하여 실행 중 외부 변경이 계약 판정에 섞이지 않게 합니다.

### 수명주기와 event

정상 순서는 다음과 같습니다.

1. `run.requested`, `run.resolved`
2. 실행 전 repository snapshot
3. adapter start와 `adapter.started`
4. context E1/E2 준비, controlled E3 주입
5. target turn 시작과 normalized signal 소비
6. adapter stop과 `adapter.stopped`
7. 실행 후 repository snapshot 비교
8. `run.completed`, 또는 `unmanaged_change.detected`와 `run.failed`

Compaction/restart signal은 terminal 결과와 별개로 즉시 기존 generation의 E3와 permit를 무효화합니다. 호출자 `AbortSignal`이 취소되면 active turn을 중단하도록 adapter를 `cancelled` 사유로 닫습니다. Signal stream이 terminal event 전에 끝나면 `provider_stream_failed`이며 정상 완료로 간주하지 않습니다.

기존 event 이름만 사용합니다. 새 event type은 추가하지 않습니다. Coordinator가 채우는 주요 필드는 다음과 같습니다.

- `run.requested`: `requestDigest`, `role`, `risk`
- `run.resolved`: `role`, `risk`, `policyVersion`
- `adapter.started`: `adapterId`, `adapterVersion`, `providerSessionId`, `capabilities`
- `tool.called`: `toolName`, `inputDigest`, `status`, `durationMs`
- `command.executed`: `commandDigest`, 저장소 상대 `cwdRelative`, `status`, `exitCode`, `outputDigest`, `durationMs`
- `unmanaged_change.detected`: 정렬된 저장소 상대 `paths`, `beforeRevision`, `afterRevision`, `detectedAt`
- `run.completed`: terminal signal로 만든 `resultDigest`, 빈 `artifactIds`, 아직 실행하지 않은 `verificationStatus`
- `run.failed`: `failureCode`, `retryable`, 단계와 code로 만든 `diagnosticDigest`

`command.executed.status`는 normalized provider signal에 이미 필수였지만 event allowlist에서 누락되어 있었습니다. 이번 결정에서 상태를 보존하도록 맞춥니다. Command, output, tool input, task와 provider 결과 원문은 event에 넣지 않습니다.

### Snapshot과 현재 write 정책

- Snapshot은 실제 repository root 아래의 일반 파일 전체 bytes를 안전하게 읽어 SHA-256으로 묶습니다. 심볼릭 링크는 따라가지 않고 link target 문자열만 hash하며, 그 밖의 항목은 고정 marker로 표시합니다.
- `.git`, `node_modules`, `.roven/state`는 제외합니다. `.roven/state`는 coordinator 자신의 SQLite/CAS 쓰기를 변경으로 오인하지 않기 위해 제외합니다. 제외 경로의 불변성은 이 snapshot이 증명하지 않습니다.
- 한 snapshot은 최대 20,000개 항목과 일반 파일 256 MiB까지 허용합니다. 제한 초과, 읽는 중 파일 변경, 안전하지 않은 root나 항목 읽기 실패는 `repository_snapshot_failed`로 run을 중단합니다.
- 현재 provider run은 읽기 전용입니다. Role의 `filesystem.write`가 `deny`가 아니면 provider 시작 전에 거부합니다. 실행 전후 revision이 다르면 adapter의 file-change capability와 관계없이 모든 변경 경로를 `unmanaged_change.detected`로 기록하고 `unmanaged_change_detected`로 실패합니다. `file.changed`는 만들지 않습니다.
- 실제 managed write는 provider가 파일별 permit를 요청하고 coordinator가 before/after bytes를 검증하는 bridge가 생긴 뒤에만 엽니다.

Claude adapter는 호출자가 tool 집합을 좁힐 수 있게 합니다. 기본 preset은 기존 adapter 계약을 유지하지만, 향후 읽기 전용 실행 진입점은 `Read`, `Glob`, `Grep`처럼 명시한 도구만 넘길 수 있습니다. Codex는 기존 read-only sandbox를 사용합니다.

### 실패와 개인정보 처리

| code | 의미와 처분 |
|---|---|
| `cancelled` | 호출자가 중단했으며 adapter를 cancelled 사유로 닫음 |
| `context_preparation_failed` / `context_injection_failed` | 현재 context E2/E3를 만들지 못해 turn 또는 변경을 진행하지 않음 |
| `provider_start_failed` / `provider_turn_failed` / `provider_stream_failed` / `provider_stop_failed` | 해당 provider 단계가 완료되지 않았으며 정상 수명주기를 주장하지 않음 |
| `repository_snapshot_failed` | 실행 전후 repository 상태를 안전하게 비교할 수 없어 fail-closed |
| `unmanaged_change_detected` | 검증된 permit 밖 변경이 남아 정상 managed 결과로 표시하지 않음 |
| `telemetry_recording_failed` | 필수 event transaction이 실패해 provider를 시작하지 않거나 실행을 중단함 |
| `contract_validation_failed` | adapter 또는 run 좌표가 공통 계약과 달라 provider 호출 전후의 해당 단계를 거부함 |

Event에는 raw task, context, provider result, command/output과 provider 오류 본문을 저장하지 않습니다. 요청과 결과, 진단은 SHA-256 digest만 남깁니다. 변경 경로는 저장소 상대 경로만 기록하며 절대 경로를 허용하지 않습니다. 원본 예외는 로컬 오류 cause로만 유지되고 event payload에는 들어가지 않습니다.

## 결과

- Codex와 Claude가 같은 lifecycle fixture에서 context 주입 뒤에만 turn을 시작하고, 취소·compaction·종료를 같은 의미로 처리합니다.
- Provider가 직접 만든 변경은 capability 보고 여부와 무관하게 검증된 `file.changed`로 승격되지 않습니다.
- Coordinator, context gate, signal monitor, contract/failure 판정과 snapshot 책임이 분리되어 provider와 정책 bridge를 독립적으로 확장할 수 있습니다.
- `roven run` 공개는 최종 결과 전달 계약과 managed write bridge가 생길 때까지 미룹니다.
