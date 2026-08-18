# ADR-0008: Managed context gate orchestration

- 상태: 채택
- 기준일: 2026-08-18

## 맥락

Context preparation은 E1/E2를 만들고 delivery는 검증된 E3를 만들지만, 두 결과를 event store에 기록하고 첫 파일 쓰기 전에 하나의 gate로 판정하는 실행 주체가 없었습니다. 호출자가 evidence 배열을 직접 조합하면 telemetry commit 전 capability가 열리거나, Role의 쓰기 거부가 E3 성공에 덮이거나, compaction과 파일 변경 뒤 과거 receipt가 다시 사용될 수 있습니다.

## 결정

### 책임과 상태

- 새 `@lervo/orchestrator` 패키지가 provider 중립적인 managed context 상태를 소유합니다.
- 정상 상태는 `awaiting_context`, `context_prepared`, `context_injected`, `write_authorized`입니다.
- Prepare, inject와 write authorization은 run별로 직렬화합니다. Inject 중 adapter가 전달한 compaction/restart 무효화 신호는 별도로 받아 generation을 먼저 닫을 수 있습니다.
- 필수 telemetry 기록 또는 예상 payload redaction이 실패하면 `telemetry_failed`로 전환합니다. 이 상태는 같은 객체에서 복구하지 않으며 새 permit를 만들지 않습니다.
- 실제 Codex/Claude process와 compaction 신호 수집은 adapter 책임으로 남깁니다.

### 원자적 telemetry

- 모든 E1 `context.selected`와 E2 `document.loaded`는 한 transaction으로 append합니다. 선택 이유가 여러 개면 E1 event도 이유별로 유지합니다.
- 검증된 E3 뒤에는 aggregate receipt 좌표를 `context.injected`로 기록합니다.
- `capability.requested/decided`, `file.changed/context.invalidated`, reason별 snapshot invalidation 묶음도 각각 한 transaction입니다.
- Commit 뒤에만 메모리 evidence와 phase를 전진시킵니다. Append, schema/redaction 또는 저장 실패 시 transaction을 되돌리고 generation을 올려 pending E3와 permit를 폐기합니다.

### 파일 쓰기 permit

- `evaluateWriteContext`에 현재 project/run/session, context generation, plan에서 해석한 필수 문서 ID·hash·scope와 E1/E2/E3 evidence를 전달합니다.
- Role의 `filesystem.write=allow`와 모든 필수 문서 E3가 함께 성립해야 permit를 발급합니다.
- `deny`는 E3와 무관하게 거부합니다. `require_approval`은 아직 검증된 승인 원본 수명주기가 없으므로 permit 없이 그대로 반환합니다.
- Permit는 capability 결정 event ID, 현재 generation, 정규화된 대상 경로, 대상 digest와 허가 시점의 실제 before hash에 묶인 1회용 값입니다.
- 실제 변경 경로가 다르거나 generation이 바뀌면 `file.changed`를 managed 변경으로 기록하지 않습니다.
- 변경 뒤 저장소 파일을 안전하게 다시 읽어 실제 after hash를 확인합니다. Permit의 before hash나 실제 after hash와 보고가 다르면 `file_change_unverified`로 generation을 무효화하고 managed 변경 event를 만들지 않습니다.

### 무효화

- 쓰기 직전에 현재 파일/publication snapshot을 다시 검사합니다. 구체적인 context invalidation reason을 reason별 event로 남기고 generation은 한 번만 올립니다.
- `managed_file_changed`, `file_change_unverified`, `context_compacted`, `session_restarted`, `snapshot_validation_failed`를 orchestration reason으로 추가합니다.
- `context.invalidated.contextGeneration`은 무효화된 이전 generation입니다. Event commit 뒤 현재 generation을 올리고 `awaiting_context`로 돌아갑니다.
- 실제 process restart에서 같은 session을 재사용하려면 상위 runtime이 증가한 initial generation을 제공해야 합니다. M3 adapter는 restart 신호와 새 provider session 연결을 담당합니다.

### 개인정보와 실패 의미

Event에는 문서 본문, inline/CAS bytes, raw prompt, provider payload와 credential을 넣지 않습니다. 선택 이유, ID, 상대 경로, hash, byte count, scope, source revision, receipt와 generation 좌표만 저장합니다.

| 상황 | 의미 |
|---|---|
| E1/E2/E3 또는 capability telemetry 실패 | `telemetry_recording_failed`; transaction rollback, generation 증가, 쓰기 차단 |
| 현재 E3 누락·hash/scope 불일치·이전 generation | `required_context_missing`; 새 context 준비/주입 전 쓰기 차단 |
| Role `filesystem.write=deny` | `capability_denied`; E3와 무관하게 permit 없음 |
| Role `filesystem.write=require_approval` | `approval_required`; 검증된 승인 수명주기 구현 전 permit 없음 |
| 잘못된 좌표·시각·경로·hash·상태 전이 | `contract_validation_failed`; event나 파일 변경 기록 전 거부 |

파일이 이미 바뀐 뒤 `file.changed` transaction이 실패하면 변경을 되돌렸다고 주장하지 않습니다. Run을 fail-closed로 중단하고 후속 unmanaged change 탐지가 filesystem 상태를 별도로 판정합니다.

## 결과

- Event store commit과 capability 상태가 같은 순서로 전진합니다.
- E3만으로 Role 정책을 우회하거나 다른 경로에 permit를 재사용할 수 없습니다.
- 파일 변경, snapshot 변경, compaction/restart와 telemetry 실패 뒤 과거 generation이 쓰기 gate를 열지 못합니다.
- M3 adapter는 provider별 실행과 신호 수집에 집중하고 공통 gate 의미를 다시 구현하지 않습니다.
