# ADR-0026: 구조화된 숙의 계약과 증거 기반 수렴 판정

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

숙의 runtime보다 먼저 provider에 종속되지 않는 정책, 교환 artifact와 종료 결과를 고정해야 합니다. 자유 형식 응답이나 같은 문장에 대한 동의만으로 수렴을 주장하면 역할별 맥락 주입, 반론 해소, 실제 검증과 결정 책임자를 증명할 수 없습니다.

## 결정

`@lervo/schemas`는 `DeliberationPolicy`, 다섯 종류의 `DeliberationArtifact`, 세 종류의 `DeliberationOutcome`을 공개합니다. `@lervo/deliberation`은 schema 위에서 정책, artifact, 이력, verification 근거와 종료 결과의 의미를 각각 검증합니다. 이 패키지는 provider 실행, event 저장과 runtime 순서화를 소유하지 않습니다.

정책은 참여 역할별 책임과 fixed/allowlist provider 선택, 유일한 결정 책임자, 최대 회차, 필수 verification suite와 writing 공개 정책을 실행 전에 고정합니다. 독립 검토, 독립 session, 결정 책임자 decision, 필수 검증 통과와 미해결 차단 반론 0개는 완화할 수 없는 `true` 조건입니다.

Artifact 공통 metadata는 deliberation/project/policy 좌표, 회차, 생산 role/run/session/provider, Markdown CAS 좌표, 역할 자신의 loaded/injected receipt ID, shared context ID, 이전 artifact ID, 근거 event ID와 content-bound writing permit입니다. 원문은 metadata에 넣지 않습니다.

- `proposal`: 안정된 claim ID와 현재 claim digest
- `objection`: 승인 또는 수정 요청, 반론 digest, 대상 claim ID와 차단 여부
- `revision`: 수정한 proposal/revision, 새 claim digest와 해소한 반론 ID
- `verification`: 실제 `VerificationResult`와 result artifact 좌표, suite/status, 검증한 claim ID와 해당 버전 digest
- `decision`: 결정 책임자, 채택 claim, 실제 통과한 verification artifact와 미해결 반론

다른 역할은 같은 managed run, provider session이나 context receipt를 공유할 수 없습니다. 수정 뒤 승인은 제안자와 다른 역할이 최신 proposal/revision을 직접 참조해야 하며, verification은 현재 claim digest와 실제 canonical result artifact에 일치해야 합니다. `converged`는 최신 수정 뒤 독립 승인, 결정 책임자의 마지막 decision, 모든 필수 suite의 통과, 각 채택 claim의 현재 버전 검증과 차단 반론 0개가 모두 확인될 때만 유효합니다. `no_consensus`는 decision 없이 최대 회차, 미해결 차단 반론 또는 필수 검증 미통과 중 실제 상태와 맞는 이유를 가집니다. `failed`는 명시한 deliberation ID에 결속되며 첫 artifact 전에도 남길 수 있고 정상 합의를 뜻하지 않습니다.

## Event 계약

Runtime이 사용할 이름과 허용 payload를 미리 고정합니다. [ADR-0027](./0027-deliberation-boundary-hardening.md)에서 각 payload의 필수 필드와 상태별 규칙을 JSON Schema로 추가했고, [ADR-0028](./0028-same-provider-deliberation-runtime.md)에서 첫 영속 경로를 연결했습니다.

| event | 허용 payload |
|---|---|
| `deliberation.started` | `deliberationId`, `policyId`, `policyHash`, `participantRoleIds`, `maxRounds` |
| `deliberation.artifact.recorded` | `deliberationId`, `deliberationArtifactId`, `kind`, `round`, `producerRoleId`, `artifactId`, `contentHash`, `writingPermitId` |
| `deliberation.completed` | `deliberationId`, `outcomeId`, `status`, `lastRound`, `decisionArtifactId`, `unresolvedBlockingObjectionIds`, `failurePhase`, `failureCode` |

Raw prompt, artifact 본문, provider 응답·payload, 내부 추론, tool input, credential과 상세 진단은 허용하지 않습니다. Redaction 실패 시 event를 일부 저장하지 않고 runtime은 `telemetry` phase의 실패로 닫아야 합니다. `failed`의 phase는 `provider`, `context`, `telemetry`, `artifact`, `writing`, `verification`, `contract` 중 하나이며 code는 원문 없는 짧은 기계 식별자입니다.

## 보장하지 않는 것

Artifact에 receipt ID와 shared context ID가 있다는 사실만으로 실제 E2/E3 내용이나 publication 접근이 검증됐다고 주장하지 않습니다. `@lervo/deliberation-runtime`이 context/event 저장소의 원본과 대조해야 합니다. Schema와 의미 검증 통과도 provider 실행, event 영속, 사람 대상 공개, Hub 전송이나 지식 승격을 뜻하지 않습니다.

## 관심사 분리

- `@lervo/schemas`: 직렬화 형식과 파생 TypeScript 타입
- `@lervo/verification-contract`, `@lervo/writing-contract`: 실행·CAS 없는 canonical 근거 검증
- `@lervo/deliberation`: provider 중립 의미·무결성 판정
- `@lervo/verification`: suite/result와 canonical result artifact 검증
- `@lervo/writing`: artifact 원문의 공개 가능 여부와 permit 검증
- 이후 orchestrator: 역할 session 순서화, 실제 E2/E3·shared context·event 영속 대조

이력 검증에서 verification result 검증은 별도 모듈로 분리했습니다. 새 provider나 역할을 추가해도 artifact 종류별 책임과 provider 선택 정책만 바꾸며 종료 판정은 공유합니다.

## 검증

정상 proposal → 차단 반론 → revision → 최신본 승인 → 실제 project verification → owner decision 이력을 검증합니다. 승인 누락, 과거 claim digest 검증, 위조 result hash, 미해결 반론의 converged 위장, 이른 최대 회차 종료, 정책 밖 provider, 복사한 writing permit, 역할 간 session/receipt 재사용과 사용되지 않은 verification 근거는 실패해야 합니다. 첫 artifact 전 실패 결과는 허용합니다. Event redaction fixture는 artifact 본문과 provider 진단이 허용 payload에 남지 않는지 확인합니다.

## 결과

숙의의 수렴과 합의 실패를 provider 문장 해석이 아니라 재계산 가능한 artifact 이력으로 판정할 수 있습니다. 다음 단계는 같은 provider의 두 독립 역할을 실제 context preparation, delivery와 event 저장에 연결하는 contract fixture입니다.
