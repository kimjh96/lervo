# ADR-0028: 동일 공급자 역할 격리와 숙의 runtime 증거 결속

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

구조화 숙의 artifact에 context receipt ID가 있어도 그 ID가 실제 context 준비·주입 과정에서 생성됐는지는 artifact만 보고 확인할 수 없었습니다. 기존 `document.loaded` event는 E2 evidence receipt ID를 기록하지 않았고, `context.injected` event도 adapter receipt만 기록해서 artifact의 E3 evidence receipt와 직접 대조할 수 없었습니다.

같은 공급자의 제안자와 검토자를 사용하면 provider 이름만 비교해서는 두 역할이 독립 실행됐는지 알 수 없습니다. Lervo run과 session뿐 아니라 provider session, 적재한 원문과 주입 evidence를 각각 확인해야 합니다.

## 결정

### Evidence receipt를 event 원본에 결속한다

`document.loaded` payload에 `evidenceReceiptId`를 추가하고 `context.injected` payload에 `evidenceReceiptIds`를 추가합니다. 전자는 문서별 E2 evidence를, 후자는 한 envelope에서 만든 문서별 E3 evidence 목록을 가리킵니다. 기존 `receiptId`는 adapter가 반환한 주입 receipt이므로 의미를 바꾸지 않습니다.

`ManagedProviderRunResult`는 context 준비와 주입에서 실제로 만든 `ContextEvidence`의 읽기 전용 snapshot을 반환합니다. `@lervo/deliberation-runtime`은 이 snapshot을 같은 run의 SQLite event와 대조합니다. ID뿐 아니라 project/run/session, document ID, content hash, byte count, source revision, envelope, target turn, context generation과 adapter receipt도 일치해야 합니다. `run.completed`의 result artifact 좌표까지 맞아야 provider 결과를 숙의 입력으로 사용할 수 있습니다.

### 실행과 숙의 판정을 분리한다

`DeliberationRuntime`은 provider adapter를 직접 알지 않습니다. 호출자가 실행한 `ManagedProviderRunCoordinator` 결과를 받아 다음 순서만 소유합니다.

1. Policy를 검증하고 `deliberation.started`를 기록합니다.
2. 역할별 managed run 결과와 event 원본을 대조합니다.
3. Writing 평가를 실행하고 permit와 CAS 원문을 다시 검증합니다.
4. 현재 history 계약을 통과한 artifact만 `deliberation.artifact.recorded`로 기록합니다.
5. Artifact에 묶인 shared-context publication과 handoff를 한 transaction으로 기록합니다.
6. 호출자가 제시한 outcome을 전체 history로 재검증한 뒤 `deliberation.completed`를 기록합니다.

Artifact 원문을 저장소의 managed document 경로에 materialize하는 정책은 runtime core에 넣지 않습니다. 저장 경로와 document sidecar 수명주기는 이후 generated-document publisher가 맡습니다. 이번 fixture는 permit를 통과한 원문을 격리된 `.lervo/generated` 경로에 materialize하고, 다음 역할의 실제 context loader가 같은 hash를 다시 읽습니다.

### 같은 공급자에서도 session을 공유하지 않는다

역할마다 Lervo run ID, session ID, provider session ID와 E2/E3 receipt가 달라야 합니다. Runtime은 다른 역할이 이미 사용한 provider session을 재사용하면 `context_evidence_invalid/provider_session_reused`로 중단합니다. 기존 숙의 history 검증도 역할 간 run, Lervo session과 receipt 재사용을 거부합니다.

## Event 필드와 개인정보

새 필드는 다음과 같습니다.

| Event | 필드 | 의미 |
|---|---|---|
| `document.loaded` | `evidenceReceiptId` | 문서별 E2 evidence의 안정적인 좌표 |
| `context.injected` | `evidenceReceiptIds` | 해당 envelope가 만든 문서별 E3 evidence 좌표 목록 |

두 필드는 불투명 ID만 저장합니다. 문서 본문, prompt, provider 응답, tool input, credential과 내부 추론은 추가하지 않습니다. Event allowlist 밖의 원문 필드는 계속 제거됩니다.

## 실패 의미

Runtime 오류는 상위 code와 원문 없는 reason을 분리합니다.

- `runtime_state_invalid`: 시작·종료 순서나 runtime 좌표가 잘못됨
- `context_evidence_invalid`: managed run, receipt, shared context 또는 provider session 증거가 event 원본과 다름
- `artifact_publication_failed`: writing 공개, artifact history, publication 또는 handoff 계약이 맞지 않음
- `event_recording_failed`: redaction이나 event transaction이 실패함

Provider run이 완료된 뒤 숙의 artifact 검증이 실패하면 기존 `run.completed`는 원본 실행 사실로 남지만 `deliberation.artifact.recorded`는 만들지 않습니다. 호출자는 event store가 정상인 경우 명시적인 `failed` outcome으로 숙의를 닫을 수 있습니다. Event store 자체가 실패한 경우에는 정상 완료를 기록하지 못하며 성공으로 간주하지 않습니다.

## 검증

실제 filesystem CAS와 SQLite event store fixture에서 같은 Codex provider의 제안자와 검토자를 실행합니다. 두 역할은 같은 writing 계약을 각 context에 주입받고 별도 run·Lervo session·provider session을 사용합니다. 제안 원문은 shared-context publication과 handoff 뒤 검토자 session에서 다시 E2/E3가 만들어지며, 차단 반론 때문에 `no_consensus`로 종료됩니다. Receipt ID를 event에 없는 값으로 바꾼 fixture는 artifact 기록 전에 실패합니다. Event에는 제안과 검토 원문이 남지 않습니다.

## 결과

동일한 provider 이름은 역할 독립성의 증거로 사용하지 않습니다. 실제 context와 event 원본, provider session 격리, writing permit와 구조화 history가 함께 맞아야 숙의 artifact가 됩니다. 같은 runtime 포트의 Codex·Claude 교차 검토는 [ADR-0029](./0029-cross-provider-deliberation-runtime.md)에서 완료했습니다.
