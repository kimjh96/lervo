# ADR-0027: 숙의 runtime 전 계약 경계 정리

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

구조화 숙의 계약은 동작하지만 다음 runtime을 같은 형태로 추가하면 이력 검증기 하나가 역할 격리, artifact 전이, 실제 verification과 종료 판정을 모두 소유하게 됩니다. 숙의 패키지가 permit ID와 result 검증을 위해 writing·verification 실행 패키지 전체를 의존해 CAS, storage, core와 YAML까지 끌어오는 문제도 있었습니다.

숙의 event는 type별 allowlist만 있었고 필수 필드나 `converged`·`failed` 상태별 null 규칙을 강제하지 않았습니다. 이 상태에서는 필드가 빠진 완료 event도 일반 event envelope를 통과할 수 있습니다.

## 결정

### 순수 계약과 실행을 분리한다

`@lervo/writing-contract`는 writing policy/evaluation/permit의 canonical hash와 ID만 소유합니다. `@lervo/verification-contract`는 suite/result hash, suite 의미 검증, result 의미 검증과 result artifact 좌표 타입을 소유합니다. 두 패키지는 schema와 canonical JSON 계약만 의존하며 CAS, storage, command 실행이나 evaluator를 알지 않습니다.

기존 `@lervo/writing`과 `@lervo/verification`은 공개 API 호환성을 위해 순수 함수를 다시 export하되 각각 의미 평가·공개와 명령 실행·CAS 저장을 계속 소유합니다. `@lervo/deliberation`은 두 contract 패키지만 의존합니다.

### 숙의 이력을 작은 전이로 계산한다

숙의 이력 검증은 다음 책임으로 나눕니다.

- `history-coordinates`: artifact 순서, 이전 artifact, 역할별 run/session/receipt 격리
- `history-state`: 주장, 반론, 검증, 최신 검토와 decision 상태
- `artifact-transitions`: 닫힌 artifact union의 종류별 전이
- `history-validation`: 검증 순서와 최종 분석 조립
- `outcome-validation`: 종료 상태와 convergence 판정

Artifact 종류는 영속 프로토콜이므로 임의 plugin registry로 열지 않습니다. `switch`의 exhaustive 판정을 유지하며 새 종류는 schema version, 역할 책임, 전이와 fixture를 함께 변경해야 합니다.

### 오류 처분과 원인을 구분한다

`DeliberationError.code`는 `artifact_contract_invalid`, `history_contract_invalid` 같은 상위 처분을 유지합니다. `reason`은 `provider_not_allowed`, `cross_role_session_reuse`, `stale_claim_verification`, `independent_review_missing`처럼 원문 없는 안정적인 원인을 가집니다. 이후 runtime event에는 허용된 짧은 reason만 실패 code로 투영하며 예외 본문은 기록하지 않습니다.

### 숙의 event payload를 schema로 검증한다

`deliberation.started`, `deliberation.artifact.recorded`, `deliberation.completed`는 각각 별도 JSON Schema와 파생 TypeScript 타입을 가집니다. Redaction은 allowlist 적용 뒤 해당 schema를 검증합니다. 필수 필드 누락, 잘못된 ID·회차·artifact 종류, 상태와 decision/failure 필드의 불일치는 `invalid_payload`로 거부합니다. 추가 필드와 원문은 기존처럼 제거합니다.

### 테스트 oracle을 실행 로직과 분리한다

실제 verification result와 writing permit를 만드는 fixture는 시나리오 테스트에서 분리합니다. Outcome fixture는 반론과 통과 검증을 production과 같은 방식으로 재계산하지 않고 테스트가 예상 ID 목록을 명시합니다. 오류 테스트는 상위 code와 세부 reason을 함께 확인합니다.

### Workspace build는 의존성 그래프를 따른다

루트 build는 패키지 이름을 수동 열거하지 않고 pnpm workspace의 topological 순서로 모든 build script를 실행합니다. 새 패키지는 workspace dependency만 정확히 선언하면 자동으로 빌드 대상이 됩니다.

## 개인정보와 실패 의미

새 event payload schema는 원문을 추가하지 않습니다. Redaction 단계의 `invalid_payload`는 상위 `redaction_failed` 처분으로 매핑해 event를 일부 저장하지 않으며 runtime은 telemetry 실패로 닫아야 합니다. 세부 `reason`도 prompt, document body, provider 응답, tool input과 credential을 포함할 수 없는 enum입니다.

## 결과

숙의 의미 계층이 실행기와 저장 구현에서 분리됐고, orchestrator가 의존해도 writing/verification 실행 패키지를 역으로 끌어오지 않습니다. 이력 검증의 종류별 변경 범위와 실패 진단이 작아졌으며, event 영속 전 필수 좌표를 검증할 수 있습니다. 이 경계를 사용하는 단일 provider 두 역할 runtime contract fixture는 [ADR-0028](./0028-same-provider-deliberation-runtime.md)에서 완료했습니다.
