# ADR-0029: Codex·Claude 교차 검토와 역할별 공급자 강제

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

동일 공급자 두 역할 fixture는 역할마다 run, Lervo session, provider session과 E2/E3가 분리된다는 점을 검증했습니다. 하지만 실제 Codex와 Claude는 context를 전달하는 표현, provider session ID 형식, turn 완료 신호와 client 종료 방식이 다릅니다. 공통 runtime이 이 차이를 직접 분기하거나, provider 이름만 맞으면 역할 정책을 나중에 검사한다면 공급자 중립 경계가 약해집니다.

교차 검토에서는 Codex가 만든 제안 원문을 Claude가 자기 session에서 실제로 다시 읽어야 합니다. Codex의 전체 대화나 내부 상태를 Claude에게 복제해서는 안 되며, 두 adapter의 원시 payload가 공통 artifact나 event 의미에 섞여서도 안 됩니다.

## 결정

### 실제 adapter를 공통 runtime 밖에서 조합한다

`DeliberationRuntime`은 Codex나 Claude client를 생성하지 않습니다. 호출자가 역할별 `ManagedProviderRunCoordinator`에 실제 `CodexAdapter` 또는 `ClaudeAdapter`를 배치하고, runtime에는 공통 `ManagedProviderRunResult`만 넘깁니다.

Codex adapter는 managed context를 developer message item으로 만들고 app-server thread/turn을 종료합니다. Claude adapter는 같은 envelope를 context replay message로 만들고 Agent SDK session/message를 종료합니다. 이 차이는 adapter 내부에서 끝납니다. Runtime이 받는 session, E2/E3 evidence, result artifact와 event 좌표는 같은 계약을 사용합니다.

### 역할별 provider를 artifact 공개 전에 확인한다

Managed run이 끝나면 runtime은 `DeliberationPolicy`의 해당 역할이 `run.session.provider`를 허용하는지 먼저 검사합니다. 고정 provider나 allowlist에 없는 결과는 `artifact_publication_failed/provider_not_allowed`로 중단합니다. 이 검사는 writing 의미 평가, permit 생성과 숙의 artifact 기록보다 앞섭니다.

Provider 실행이 이미 끝났으므로 해당 `run.completed`는 실제 실행 원본으로 남습니다. 하지만 `deliberation.artifact.recorded`는 만들지 않으며, 그 결과를 숙의 history나 수렴 판정에 넣지 않습니다.

### 교환 단위는 provider 대화가 아니라 공개된 원문이다

Codex 제안 결과는 writing permit를 통과한 뒤 CAS artifact와 구조화된 proposal이 됩니다. 수신 역할용 managed document는 그 artifact의 content hash에 결속된 `SharedContextPublication`과 `HandoffBundle`로 발견됩니다. Claude 검토자는 자기 run과 session의 context loader로 이 문서를 다시 E2로 만들고, 자기 adapter receipt로 E3를 만듭니다.

Provider cache, prompt, 전체 대화와 내부 추론은 handoff하지 않습니다. 따라서 공급자 조합이 바뀌어도 `previousArtifactIds`, `sharedContextIds`, receipt와 evidence event가 숙의 이력을 재구성하는 기준입니다.

## Event와 개인정보

새 event type이나 payload 필드는 추가하지 않습니다. 기존 event의 의미는 다음과 같습니다.

- `adapter.started`와 `adapter.stopped`의 provider actor와 adapter/session 좌표는 실제 공급자 수명주기를 나타냅니다.
- `document.loaded`와 `context.injected`는 각 역할이 자기 session에서 만든 E2/E3 원본입니다.
- `deliberation.artifact.recorded`는 provider별 출력 형식이 아니라 공통 CAS hash와 구조화 artifact 좌표를 기록합니다.

Provider 결과 본문, context message, 원시 payload, prompt, tool input, credential과 내부 추론은 event에 넣지 않습니다. Fixture도 SQLite event 전체에 Codex 제안과 Claude 검토 원문이 없는지 확인합니다.

## 실패 의미

- `artifact_publication_failed/provider_not_allowed`: 역할에 배정되지 않은 provider가 managed run 결과를 만들었습니다. Writing 평가와 artifact 기록 전에 중단하며 정책에 맞는 새 역할 run이 필요합니다.
- 기존 context receipt, shared context, provider session 또는 history 불일치는 ADR-0028과 기존 deliberation 오류 의미를 유지합니다.
- Adapter protocol 실패는 해당 managed run의 provider 실패로 남고 숙의 artifact나 정상 수렴으로 바꾸지 않습니다.

## 검증

실제 filesystem CAS와 SQLite event store 위에서 다음을 검증합니다.

1. 실제 `CodexAdapter` 제안자는 read-only app-server session에서 결과를 만듭니다.
2. Permit를 통과한 제안 원문을 managed document로 materialize하고 hash-bound publication과 handoff를 만듭니다.
3. 실제 `ClaudeAdapter` 검토자는 별도 run, Lervo session과 UUID provider session에서 같은 제안 원문과 hash를 context replay로 다시 받습니다.
4. 두 결과는 공통 artifact event가 되고 미해결 차단 반론에 따라 `no_consensus`로 종료됩니다.
5. Event에는 두 provider 결과 원문이 없고 hash chain은 유효합니다.
6. Codex에 고정된 제안자 역할을 Claude로 실행한 경우 writing evaluator가 호출되지 않고 artifact event도 생기지 않습니다.

공통 시나리오 조립과 provider client fixture를 분리해 동일 공급자·교차 공급자 테스트가 publication, handoff와 outcome 생성 규칙을 중복 구현하지 않게 했습니다.

## 결과

Codex와 Claude의 실제 protocol 차이는 adapter 경계에 머물고, 역할 정책과 숙의 증거 의미는 공통 runtime이 강제합니다. `converged` 결과의 지식 candidate와 로컬 `trace`/`doctor` 연결은 [ADR-0030](./0030-evidence-bound-knowledge-candidates.md)에서 구현했습니다.
