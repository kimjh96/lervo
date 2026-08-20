# ADR-0051: 증거에 결속된 전문 역할과 고위험 교차 검토

- 상태: 채택
- 기준일: 2026-08-20

## 맥락

연구자, 마케터와 디자이너를 이름과 프롬프트만 다른 페르소나로 추가하면 역할별 입력, 권한, 산출물과 검증 기준을 실행 전에 확인할 수 없습니다. 한 역할이 만든 결과를 다른 역할이 읽을 때도 같은 대화 기억을 공유했다고 가정할 수 없습니다. 특히 고위험 결과는 생산자가 자기 결과를 다시 평가하거나 공급자 이름만 다르게 배치한 것을 교차 검토로 볼 수 없어야 합니다.

## 결정

`@lervo/roles`는 RoleProfile과 `RoleEvaluationBundle`을 하나의 `RoleDefinition`으로 묶습니다. 기본 researcher는 출처 추적·인용 무결성·주장 근거를, marketer는 브랜드 준수·주장 근거를, designer는 디자인 토큰·접근성을 검사합니다. 세 역할 모두 한국어 사람 대상 writing 정책과 E3 필수 문서, 명시적인 capability, 산출물 schema, project verification suite와 evidence가 있는 handoff를 선언합니다. 역할 정의는 provider를 선택하지 않으며 Codex와 Claude는 기존 adapter와 숙의 정책 뒤에 남습니다.

평가 묶음은 역할·RoleProfile hash·산출물 schema, 정렬된 check와 `deterministic`, `separate_semantic`, `project_verification` 방법을 고정합니다. 결과는 생산 run, 평가 대상 artifact ID·content hash·byte 수·media type, bundle과 profile hash, 평가 시각, check별 상태·평가기·평가 run/role·evidence artifact 좌표에 결속됩니다. 별도 의미 검사는 생산 run과 다른 evaluator run이어야 합니다. 누락 검사는 `not_run`, 하나라도 실패하면 `failed`, 모두 실행되고 통과한 경우만 `passed`입니다.

역할 공개 경계는 schema와 파생 ID를 다시 계산하고 `passed`인 같은 artifact만 허용합니다. 실제 원문을 반환할 때는 CAS bytes를 다시 읽어 byte 수, content hash와 strict UTF-8을 확인합니다. 이 판정은 역할별 내용 검증이며 기존 `WritingPublicationPermit`를 대신하지 않습니다. 사람 대상 공개는 역할 평가와 writing 공개 gate를 각각 통과해야 합니다.

고위험 요청은 서로 다른 제안·결정 책임자, 검토자, 검증자 세 역할을 `HighRiskRoleWorkflow`에 묶습니다. Workflow는 각 RoleProfile과 평가 묶음 hash, 책임, provider 선택, 모든 역할의 project verification suite와 기존 `DeliberationPolicy`를 고정합니다. 최대 회차는 5 이하이고 독립 역할·session, 통과한 검증, 차단 반론 0개와 writing permit가 필요합니다. Provider 조합은 고정값 또는 allowlist일 수 있으며 조합 자체는 수렴 증거가 아닙니다.

## 상태와 실패 의미

역할 평가 상태는 `passed`, `failed`, `incomplete`입니다. Check 상태는 `passed`, `failed`, `not_run`이고 실행하지 않은 검사를 실패와 혼용하지 않습니다. `role_profile_invalid`는 RoleProfile 자체가 잘못된 경우, `evaluation_bundle_invalid`는 profile·schema·suite·check 결속이 다른 경우, `evaluation_result_invalid`는 생산/평가 run·evidence·상태·ID가 재계산 결과와 다른 경우입니다. `role_publication_blocked`는 평가 미통과, 다른 artifact 또는 CAS 불일치이며 원문을 반환하지 않습니다. `high_risk_workflow_invalid`는 역할 분리, hash, suite, provider 정책이나 회차 조건이 맞지 않아 숙의를 시작할 수 없다는 뜻입니다.

이번 단계는 새 전역 실행 event를 추가하지 않습니다. 평가 결과와 workflow가 존재해도 역할 실행, 다른 역할의 적재·주입, writing 공개, 숙의 시작이나 수렴을 뜻하지 않습니다. 실제 공유에는 기존 `context.published`, `handoff.created`와 수신 역할의 E2/E3가 별도로 필요합니다.

## 개인정보와 비밀정보

평가 결과에는 산출물·근거의 artifact ID와 content hash만 두고 원문, URL, raw prompt, 내부 추론, provider payload와 평가기의 오류 본문을 넣지 않습니다. `evaluatorId`와 evaluator role/run은 감사 가능한 기계용 좌표이므로 사람이 식별되는 이름이나 외부 계정 ID를 사용하지 않습니다. 원문은 로컬 CAS와 기존 보존 정책을 따르며 Hub 동기화는 자동으로 활성화되지 않습니다.

## 검증

계약 테스트는 세 역할의 capability·검사 범위가 서로 다르고 반환된 정의를 변조해도 원본이 바뀌지 않는지 확인합니다. 평가 fixture는 check 순서 정규화, 누락·실패 구분, evidence 누락, 생산 run 재사용과 결과 ID 변조를 거부합니다. 실제 filesystem CAS fixture는 같은 bytes만 공개하고 크기 변조를 차단합니다. 고위험 fixture는 세 역할과 전체 verification suite 결속을 확인하고 같은 역할 검토, 과도한 회차와 평가 묶음 hash 변조를 거부합니다.

## 결과

전문 역할은 자연어 설명이 아니라 실행 전에 검증 가능한 계약이 되었습니다. 새 역할과 평가 항목은 profile과 bundle을 추가해 확장하고, 공개·숙의 의미는 provider와 플랫폼에 관계없이 유지됩니다. 이번 구현은 역할별 실제 provider 실행을 새로 조합하거나 평가 결과를 전역 event로 영속했다고 주장하지 않습니다.
