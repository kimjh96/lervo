# ADR-0037: 연속 이력과 buffered event를 구분하는 Hub trace read model

- 상태: 일부 대체됨 — bounded query와 pagination 경계는 [ADR-0038](./0038-bounded-async-hub-storage-and-trace.md)을 따름
- 기준일: 2026-08-19

## 맥락

Hub SQLite에는 destination·project별 registration, allowlist event와 연속 cursor가 durable하게 저장됩니다. 하지만 저장 원본을 그대로 화면에 넘기면 project 목록에도 모든 event payload가 섞이고, gap 뒤에 먼저 도착한 event가 완성된 timeline처럼 보일 수 있습니다. Project 목록을 읽는 사이 sync commit이 들어오면 coordinate 목록과 project state가 서로 다른 시점일 수도 있습니다.

Trace 조회 결과를 별도 원본으로 누적하면 registration·event 원본과 다시 동기화해야 합니다. v0에는 검색 성능 자료가 없으므로 먼저 원본에서 결정적으로 다시 만들 수 있는 projection이 필요합니다.

## 결정

### 조회 전체를 한 read snapshot에서 만든다

`HubSyncStore`는 동기 `read` callback을 제공합니다. SQLite adapter는 `BEGIN` read transaction 안에서 coordinate와 project state를 읽고 callback이 끝난 뒤 commit합니다. Callback은 Promise를 반환할 수 없고 같은 connection에서 read/write transaction을 중첩할 수 없습니다. 다른 connection이 중간에 registration이나 batch를 commit해도 한 조회 결과는 처음 확정된 SQLite snapshot만 사용합니다.

`@lervo/hub-trace`는 이 read port에만 의존합니다. 저장, event append, cursor 갱신과 SQLite schema를 알지 않습니다. Projection은 호출할 때 durable sync 원본에서 다시 만들며 별도 index나 cache를 원본이라고 주장하지 않습니다.

### Project 목록에는 요약 좌표만 둔다

Project summary는 destination·project·registration ID, 표시 이름, identity·manifest hash, 등록·갱신 시각, cursor와 다음 count만 가집니다.

- `storedEventCount`: Hub inbox에 durable하게 저장된 전체 event 수
- `continuousEventCount`: seq 1부터 cursor까지 hash chain이 확인된 event 수
- `bufferedEventCount`: gap 뒤에 저장되어 cursor보다 큰 event 수
- `runCount`: continuous와 buffered 원본에서 발견한 서로 다른 run ID 수

Project 목록에는 event envelope, payload, session ID와 문서·검증 좌표를 넣지 않습니다. Destination과 project ID로 정렬해 storage 구현의 반환 순서가 달라도 같은 결과를 만듭니다.

### Run timeline은 상태를 숨기지 않는다

Project 상세는 run을 첫 project seq 순서로 묶고 각 run의 session ID, 첫·마지막 seq와 시각, 전체·continuous·buffered event count를 제공합니다. Run 상세만 allowlist를 통과한 `EventEnvelope` 원본을 project seq 순서로 반환합니다. 각 event에는 다음 위치를 붙입니다.

- `continuous`: event seq가 현재 cursor 이하이고 앞 hash chain이 모두 확인됐습니다.
- `buffered`: event는 durable하게 저장됐지만 앞 gap이 남아 cursor가 도달하지 않았습니다.

Buffered event도 숨기지는 않지만 완료된 trace와 같은 의미로 표시하지 않습니다. `run.completed`나 `run.failed` event가 없다는 이유로 run 상태를 임의 추론하지 않으며, 반대로 buffered terminal event만으로 완료를 주장하지 않습니다. Event payload는 변경하거나 자연어로 재해석하지 않으므로 `context.selected`의 reason과 `verification.completed`의 결과 좌표를 같은 run에서 그대로 탐색할 수 있습니다.

## 실패 의미와 개인정보

| code | 의미와 처분 |
|---|---|
| `project_not_found` | 같은 read snapshot에 요청한 destination·project 원본이 없습니다. 빈 project를 만들지 않습니다. |
| `run_not_found` | Project는 있지만 요청한 run ID의 event 원본이 없습니다. 빈 timeline을 만들지 않습니다. |
| `source_inconsistent` | Project index와 state가 같은 snapshot에 없거나 state가 sync 계약을 통과하지 못했습니다. 일부 projection을 반환하지 않습니다. |
| `read_failed` | SQLite read snapshot 시작·조회·commit·rollback이 실패했습니다. 조회 성공을 주장하지 않습니다. |

Summary에는 event payload를 복제하지 않습니다. Run 상세는 Hub에 이미 저장된 allowlist event만 반환하며 repository 본문, prompt, 문서·스킬 본문, command output, authorization과 credential을 새로 결합하지 않습니다. 이 package는 HTTP 노출, 사용자 인증, project authorization, pagination, cache와 HTML rendering을 구현하지 않습니다. 이번 변경은 새 event type이나 telemetry 상태를 추가하지 않습니다.

## 검증

같은 destination의 두 project를 ID 순서로 분리하고 한 project의 두 run과 여러 session을 안정적으로 묶었습니다. Gap 뒤 batch만 있는 project는 cursor 0, continuous 0, buffered 2로 보였고 각 run event도 `buffered`였습니다. 앞 batch가 들어오면 같은 원본이 continuous 4로 바뀌었습니다.

같은 batch의 duplicate delivery와 SQLite 재시작 전후 project projection의 canonical JSON이 같음을 확인했습니다. 한 read snapshot의 coordinate 목록을 읽은 직후 다른 connection이 project를 등록해도 첫 목록에는 섞이지 않고 다음 조회에서만 나타났습니다. 실제 `context.selected`, `document.loaded`, `verification.completed` 원본으로 선택 reason부터 검증 결과까지 한 run timeline에서 찾을 수 있음을 확인했습니다.

## 결과

Hub trace는 sync 원본과 분리된 결정적 read model이 되었고, 역순 도착을 숨기지 않으면서 완성된 chain과 구분합니다. 아직 공개 web API나 화면은 아니며 인증된 project 범위도 상위 계층이 제공해야 합니다. 다음 구현은 이 read model만 사용하는 read-only HTTP API와 최소 trace web view입니다.
