# ADR-0019: 공급자 중립 숙의와 명시적 수렴

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

고위험 설계, 보안 검토, 원인 진단과 문서 migration처럼 한 에이전트의 초안만으로 결정하기 어려운 작업이 있습니다. Codex와 Claude를 서로 검토하게 할 수 있지만, 두 모델의 자유 형식 대화를 이어 붙이는 것만으로는 어떤 근거를 각자가 읽었는지, 반론이 해소됐는지, 검증이 통과했는지 재구성할 수 없습니다.

한 provider session의 전체 대화나 내부 추론을 다른 참여자에게 넘기면 Lervo의 shared context 경계와 개인정보 원칙도 깨집니다. 공급자 조합과 관계없이 같은 실행·증거 계약으로 수렴과 합의 실패를 판정해야 합니다.

## 결정

### 숙의는 orchestrator workflow다

숙의는 Codex 또는 Claude adapter 안에 구현하지 않습니다. Run Orchestrator가 제안자, 검토자, 검증자와 결정 책임자의 독립 RoleProfile·managed session을 `DeliberationPolicy`에 따라 순서화합니다. 역할별 provider는 다르게 선택할 수 있지만 동일 provider의 여러 역할도 같은 계약을 사용합니다.

각 참여자는 프로젝트 문서와 앞 단계 산출물을 shared context로 발견하고 자기 session에서 현재 원문 hash의 E2/E3를 다시 만듭니다. 다른 역할의 E2/E3, 전체 대화, 내부 추론과 provider cache는 상속하지 않습니다.

### 구조화된 산출물만 교환한다

회차 사이에 교환하는 종류는 `proposal`, `objection`, `revision`, `verification`, `decision`입니다. 원문은 CAS artifact에 두고 metadata에는 다음 좌표를 둡니다.

- deliberation/run/session/role ID와 round
- artifact 종류·ID·content hash와 근거 event ID
- 이전 artifact와 대상 주장 ID
- 반론의 차단 여부·해소 상태
- verification suite와 상태
- decision owner, 채택 주장과 미해결 반론 ID

Raw prompt, 내부 추론, 전체 대화, tool input과 provider payload는 artifact metadata, event와 handoff에 복제하지 않습니다. 사람 대상 artifact는 기존 writing 정책과 공개 gate를 그대로 적용합니다.

### 종료 조건을 실행 전에 고정한다

`DeliberationPolicy`는 참여 역할, 역할별 provider 선택 규칙, 결정 책임자, 최대 회차, 필수 verification suite, 차단 반론 해소 규칙과 공개 조건을 포함합니다. 실행 중 provider 응답에 따라 이 조건을 조용히 완화하지 않습니다.

종료 상태는 다음 셋입니다.

- `converged`: Schema-valid decision, 결정 책임자, 필수 verification 통과와 차단 반론 0개를 모두 증명합니다.
- `no_consensus`: 최대 회차에 도달했거나 차단 반론이 남았습니다. 마지막 round, 미해결 반론 ID와 종료 사유를 남기며 결론을 선택하거나 지식으로 승격하지 않습니다.
- `failed`: Provider, telemetry, schema 또는 artifact 저장 실패입니다. 실패 phase/code와 마지막 확정 artifact 좌표를 남기며 정상 합의를 만들지 않습니다.

동일 결론에 문장상 동의했다는 사실이나 두 provider가 같은 답을 냈다는 사실만으로 `converged`가 되지 않습니다. 결정적 검증이 가능한 주장은 verification result를 우선하며, 사람 결정이 필요한 항목은 지정한 decision owner의 명시적 decision이 필요합니다.

### 구현 순서

M5에서 다음 순서로 구현합니다.

1. Project verification command와 provider-neutral result artifact
2. Writing verification과 공개 gate
3. Deliberation artifact와 policy schema
4. 동일 provider의 두 역할 contract fixture
5. Codex·Claude 교차 검토 fixture
6. Knowledge candidate와 trace/doctor 연결

숙의 runtime event 이름과 type별 payload allowlist는 3단계 schema ADR에서 확정합니다. 그 전에는 자유 형식 provider 결과를 기존 `run.completed`에 넣어 합의로 표시하지 않습니다.

## 결과

- Codex와 Claude를 역할별로 조합해도 core workflow와 증거 규격은 공급자 중립으로 유지됩니다.
- 참여자마다 어떤 원문을 실제로 적재·주입했는지 따로 추적할 수 있습니다.
- 내부 추론을 공유하지 않고도 주장, 반론, 검증과 결정을 재구성할 수 있습니다.
- 제한 회차 안에 수렴하지 않으면 임의의 승자 대신 명시적 합의 실패가 남습니다.
- Verification이 없는 다수결이나 모델 간 동의를 verified 지식으로 오인하지 않습니다.
