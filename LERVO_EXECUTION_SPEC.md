# Lervo 실행 및 증거 규격

상태: `0.1-draft`  
기준일: 2026-08-20

## 목적

이 문서는 “DD 기능 개발”, “DD 기능 개발 중 발생한 버그 수정” 같은 요청이 Lervo에서 어떻게 실행되고, 문서 읽기와 스킬 사용을 어디까지 보장하는지 정의합니다.

## 로컬 프로젝트 초기화

`lervo init`은 실행 상태 저장소를 만들기 전에 project identity를 고정합니다. `--dry-run`과 실제 적용은 같은 `InitPlan` 형식을 사용합니다. 계획에는 각 경로가 새로 생성되는지, 그대로 유지되는지, 충돌 때문에 적용할 수 없는지가 표시됩니다. 새 파일은 전체 본문을 diff 형태로 보여줍니다.

첫 슬라이스가 관리하는 경로는 다음과 같습니다.

- `.lervo/project.yaml`: stable project id, 생성 시각과 로컬 우선 데이터 기본값
- `.lervo/documents/`: document ID별 sidecar manifest를 둘 빈 디렉터리
- `.lervo/verifications/`: suite ID별 project 검증 명령을 둘 빈 디렉터리
- `.lervo/search-evaluations/`: 검토한 검색 query와 기대 원본을 케이스별로 둘 빈 디렉터리
- `.lervo/search-engine-policies/`: 검색 엔진 활성화 정책을 정책별로 둘 빈 디렉터리
- `.lervo/search-rollout-policies/`: 검색 rollout 검토 정책을 정책별로 둘 빈 디렉터리
- `.lervo/search-rollout-action-policies/`: 검색 rollout 조치 정책을 정책별로 둘 빈 디렉터리
- `.lervo/.gitignore`: `state/` 제외 규칙
- `.lervo/generated/`, `.lervo/state/`, `.lervo/knowledge/`: 이후 단계가 사용할 로컬 디렉터리

기존 project/document 설정은 YAML 구문과 현재 JSON Schema를 통과할 때만 그대로 사용합니다. 새 형식은 `.lervo/documents/<documentId>.yaml`을 각각 최대 64 KiB로 읽고 파일명과 ID, 대상 경로 소유권과 문서 관계를 검증합니다. 기존 `.lervo/documents.yaml`이 단독으로 있으면 byte를 유지하고 읽기 호환만 제공하며 새 디렉터리와 함께 있으면 충돌로 중단합니다. 일반 파일이 아닌 항목과 심볼릭 링크는 따라가지 않습니다. 충돌이 하나라도 있거나 계획을 만든 뒤 대상이 바뀌면 아무 파일도 만들기 전에 적용을 중단합니다. `README.md`, `AGENTS.md`, `CLAUDE.md`를 포함한 사용자 파일은 이 단계에서 수정하지 않습니다.

저장소 root에 이전 실험 버전의 `.roven` 경로가 있으면 `lervo init`은 `.lervo` 생성 계획을 `blocked`로 반환합니다. 이전 경로의 종류나 내용과 관계없이 자동 이동·수정·삭제하지 않으며 두 관리 경로를 함께 활성화하지 않습니다. 전환에는 event hash chain과 CAS 주소의 원본성을 보존하는 별도 명칭 migration이 필요합니다.

## 로컬 storage 개방

실행 진입점은 저장소 root에서 계산한 공통 경로로 event/outbox와 CAS를 함께 엽니다. 순서는 다음과 같습니다.

1. 저장소 root가 실제 디렉터리인지 확인하고 심볼릭 링크를 거부합니다.
2. `.lervo/project.yaml`을 읽어 현재 schema로 검증합니다.
3. `.lervo`와 `.lervo/state`, 이미 존재하는 CAS 구성 경로가 실제 디렉터리인지 확인하고 심볼릭 링크를 거부합니다.
4. Manifest의 project id로 `.lervo/state/events.sqlite`를 엽니다. 이미 다른 project에 묶인 database는 거부합니다.
5. `.lervo/state/cas`를 엽니다.

Manifest가 유효하지 않으면 backend를 열지 않습니다. CAS를 여는 중 실패하면 앞서 연 event store를 닫고 실행 시작을 중단합니다. 정리까지 실패한 경우에는 원래 개방 실패와 정리 실패를 함께 원인으로 보존하며, 닫혔다고 기록하지 않습니다. 정상 handle의 `close`는 반복 호출해도 각 backend를 한 번만 닫습니다.

Bootstrap 오류의 의미는 다음과 같습니다.

| code | 의미와 처분 |
|---|---|
| `storage_layout_invalid` | 관리 경로가 없거나 실제 디렉터리가 아니거나 심볼릭 링크입니다. Backend를 열지 않고 `contract_validation_failed`로 run 시작을 막습니다. 경로를 고친 뒤 새로 검증하며 자동 재시도하지 않습니다. |
| `cleanup_failed` | 일부 backend를 연 뒤 다음 단계와 자원 정리가 모두 실패했습니다. Run 시작을 중단하고 수동 진단이 필요합니다. 자원 종료 성공을 주장하지 않습니다. |

이 오류는 새 실행 event나 상태를 추가하지 않습니다. 진단 문자열에는 관리 경로와 기계용 code만 허용하며 prompt, 문서 본문, credential이나 provider payload를 넣지 않습니다. Hub가 비활성인 경우에도 로컬 event와 artifact 저장은 그대로 사용할 수 있고, bootstrap이 outbox 항목을 자동으로 만들지 않습니다.

## 실행 상태 머신

```text
requested
  -> resolved
  -> context_prepared
  -> agent_started
  -> executing <-> awaiting_approval
  -> verifying
  -> distilling
  -> completed | failed | cancelled
```

파일 변경 capability는 `context_injected`와 현재 필수 E3 판정 이전에 열리지 않습니다. 필수 context receipt가 무효화되면 다시 준비 상태로 돌아갑니다.

M2 managed context gate의 세부 상태는 다음과 같습니다.

```text
awaiting_context
  -> context_prepared
  -> context_injected
  -> write_authorized
  -> awaiting_context

any telemetry failure -> telemetry_failed
```

`write_authorized`는 실제 파일 변경이 아닙니다. 현재 generation, 정규화된 대상 상대 경로, 대상 digest, 허가 시점의 실제 before hash와 optional approval/snapshot ID에 묶인 1회용 permit가 발급된 상태입니다. 다른 경로, 다른 generation 또는 이미 소비한 permit로 `file.changed`를 기록할 수 없습니다. 변경 뒤 저장소 파일을 안전하게 다시 읽은 실제 after hash도 일치해야 합니다. Role의 `filesystem.write`가 `deny`면 `capability.decided=deny`입니다. `require_approval`은 현재 signed 원본을 provider 시작 전과 파일 요청 직전에 모두 검증한 경우만 `allow`와 permit를 만들며, 그 외에는 `capability.decided=require_approval`입니다.

## 예시 1: “DD 기능 개발 구현”

1. **요청 해석**: 프로젝트, 목표, 제약, 완료 조건, 역할(`developer`)과 위험도를 구조화합니다.
2. **저장소 탐색**: 관련 코드 경로, 테스트, 소유권, 하위 지침 파일, 최근 결정 기록을 찾습니다.
3. **컨텍스트 계획**: `AGENTS.md`, 해당 경로의 지침, 관련 설계/도메인 문서, 사용 예정 스킬과 사람 대상 산출물의 writing 정책을 선택하고 각각의 이유를 기록합니다.
4. **실제 적재**: 파일을 열어 현재 바이트의 SHA-256을 계산하고, 공급자용 context envelope에 본문 또는 손실 없는 참조를 포함합니다.
5. **주입 확인**: 어댑터가 해당 envelope를 모델 turn 이전에 전달했다는 receipt를 기록합니다. 필수 문서나 선택한 writing 정책 문서가 누락되면 쓰기를 차단합니다.
6. **계획 및 구현**: 에이전트가 파일을 수정합니다. 도구 호출, 명령, 변경 파일, 승인 내역이 정규화된 이벤트로 남습니다.
7. **검증**: 관련 테스트, 타입 검사, 린트, 정책 검사를 실행하고 결과/로그 hash를 기록합니다. 사람이 읽는 산출물은 결정적 writing 검사와 별도 의미 검사를 모두 통과해야 공개할 수 있습니다.
8. **지식화**: 반복 가능한 새 사실이나 결정이 있으면 지식 candidate를 만들고 관련 코드 경로와 run을 연결합니다.
9. **완료**: 변경 요약, 검증, 남은 위험, 읽은 근거, 사용 스킬의 고정 버전을 trace로 반환합니다.

## 예시 2: “DD 기능 개발 간 발생한 버그 수정”

진행 중 run의 하위 작업으로 연결합니다.

1. 원래 기능 run, 실패한 검증, 변경 diff를 우선 근거로 선택합니다.
2. 문제를 재현하고 재현 명령과 실패 출력을 evidence로 저장합니다.
3. 원인 가설을 observation으로 남기되 검증 전에는 fact로 승격하지 않습니다.
4. 수정 범위가 기존 계획을 벗어나면 재계획 또는 승인을 요청합니다.
5. 회귀 테스트를 추가하고 원래 완료 조건과 버그 재현 조건을 모두 검증합니다.
6. 원인이 재사용 가능한 시스템 사실이면 runbook/pattern candidate로 생성합니다.

새 대화에서 독립적으로 요청된 버그라면 관련 기능 run을 id, branch, issue, 변경 경로를 통해 탐색하되 연결 근거가 불충분하면 별도 run으로 유지합니다.

## 전문 역할 평가와 공개

Researcher, marketer와 designer는 이름만 다른 prompt가 아니라 RoleProfile과 역할별 `RoleEvaluationBundle`의 조합입니다. Profile은 입력 schema, 필수 E3 문서, 모든 capability, 산출물 schema와 경로, 한국어 writing 정책, project verification suite와 handoff 규칙을 선언합니다. Bundle은 profile hash와 output schema를 다시 묶고 각 check의 category, 방법, 요구 문장, verification suite 좌표와 evidence 필수 여부를 고정합니다.

평가 방법은 `deterministic`, `separate_semantic`, `project_verification`입니다. 역할 평가 결과의 필수 필드는 result/bundle/role ID, bundle/profile hash, 생산 run ID, 대상 artifact ID·content hash·byte 수·media type, 평가 시각, check별 method·상태·평가기 ID·평가 run/role·evidence artifact 좌표와 전체 상태입니다. 별도 의미 검사는 생산 run과 다른 evaluator run과 role 좌표를 가져야 하고 다른 두 방법은 이 좌표가 `null`이어야 합니다. Check를 실행했으면 evidence가 하나 이상 필요하고 `not_run`이면 evidence를 넣지 않습니다.

전체 상태는 실패 check가 하나라도 있으면 `failed`, 실패는 없지만 `not_run`이 있으면 `incomplete`, 모든 필수 check가 실행되고 통과했을 때만 `passed`입니다. 공개 판정은 profile·bundle·result ID와 상태를 다시 계산하고 같은 artifact ID/content hash만 허용합니다. 원문 반환 직전 local CAS bytes의 크기, hash와 strict UTF-8도 다시 확인합니다. 이 역할 평가는 내용·형식의 역할별 조건을 판정할 뿐 기존 writing 평가와 `WritingPublicationPermit`를 대체하지 않습니다.

고위험 workflow는 서로 다른 제안·결정 책임자, 검토자와 검증자 세 역할을 요구합니다. 각 role binding은 profile hash, evaluation bundle ID/hash와 숙의 책임을 포함하고, 내장된 기존 `DeliberationPolicy`는 역할별 provider 선택, 전체 verification suite, 독립 reviewer/session, 최대 5회, 통과 검증, 차단 반론 0개와 writing 공개 조건을 고정합니다. Codex와 Claude를 교차 배치하거나 같은 provider의 독립 session을 사용할 수 있지만 provider 조합만으로 수렴을 주장하지 않습니다.

역할 평가 결과에는 산출물·근거 원문, URL, raw prompt, 내부 추론, provider payload와 평가기 오류 본문을 넣지 않습니다. 평가기 ID와 역할/run은 사람이 식별되는 외부 계정 대신 기계용 좌표를 사용합니다. 새 전역 event는 추가하지 않으므로 결과나 workflow만으로 실행, 공유, E2/E3, writing 공개, 숙의 시작 또는 수렴을 주장하지 않습니다. 상세 결정은 [ADR-0051](./docs/adr/0051-evidence-bound-multi-discipline-roles.md)에 정의합니다.

## 역할 간 공유 맥락과 handoff

전문 에이전트가 다른 역할에 넘길 내용은 먼저 등록된 문서 원본으로 발행합니다. `SharedContextPublication`은 원문을 복제하지 않고 다음 좌표를 가집니다.

- `sharedContextId`, `projectId`, 맥락 종류
- `documentId`, `contentHash`, `sourceRevision`
- 생산 주체와, 에이전트가 생산했다면 `roleId`, `runId`, `sessionId`
- `audience`: 프로젝트 전체 또는 허용 역할 목록
- `sensitivity`: 일반 또는 제한
- 근거 event ID, 발행 시각, 만료 시각, 대체한 shared context ID

일반 맥락은 `audience.mode=project`로 발행해 프로젝트의 모든 역할이 발견하고 읽을 수 있습니다. 제한 맥락은 `audience.mode=roles`와 허용 역할 목록이 필요합니다. `restricted`를 프로젝트 전체에 공개하는 publication은 계약 오류입니다. 발행된 결과는 지식 후보일 수 있지만 발행만으로 검증된 지식이 되지 않습니다.

역할을 넘길 때 `HandoffBundle`은 보내는 역할/run/session/context generation, 받는 역할, 요청 digest, shared context ID와 evidence event ID를 포함합니다. Raw 요청, 문서 본문, 내부 추론은 bundle에 넣지 않습니다. 보내는 Role이 수신 Role을 허용하지 않았거나, 다른 project의 맥락, 수신 Role이 읽을 수 없는 맥락, 존재하지 않는 맥락을 포함하면 `contract_validation_failed`로 handoff를 거부합니다. 아직 발행 시각이 되지 않았거나 만료·대체된 맥락은 `required_context_missing`으로 처리하고 현재 publication을 요구합니다.

유효한 handoff도 읽기 증거를 양도하지 않습니다. 수신 에이전트는 각 shared context가 가리키는 문서를 `reasonCode=handoff`로 선택하고, 자기 run/session에서 현재 bytes를 읽어 E2를 만든 뒤, 자기 provider session에 전달해 E3를 만들어야 합니다. 생산 에이전트의 receipt를 복사하면 쓰기 게이트가 열리지 않습니다. 원문 hash가 바뀌거나 context가 압축·재시작되면 일반 문서와 같은 규칙으로 receipt를 무효화합니다.

## 역할·공급자 간 숙의

숙의 run은 하나의 provider session을 길게 공유하지 않습니다. 제안자, 검토자, 검증자와 결정 책임자는 각각 RoleProfile과 managed provider session을 가지며, 동일한 필수 자료와 앞 단계 산출물도 자기 session에서 E2/E3를 다시 만듭니다. Provider는 역할별로 선택할 수 있어 Codex 제안과 Claude 검토 또는 그 반대 구성이 가능하지만, orchestrator와 artifact 계약은 provider 이름을 분기 기준으로 사용하지 않습니다.

각 회차는 `proposal`, `objection`, `revision`, `verification`, `decision` 중 정책이 허용한 구조화된 artifact만 다음 역할에 공개합니다. Artifact metadata의 필수 좌표는 `deliberationId`, project/policy ID와 hash, `round`, 생산 role/run/session/provider, Markdown CAS 좌표, 역할 자신의 loaded/injected receipt ID, shared context ID, 근거 event ID, 이전 artifact ID와 content-bound writing permit입니다. 반론은 차단 여부와 대상 주장 ID를, verification은 실제 result artifact·suite·상태와 현재 claim ID/digest를, decision은 채택한 주장 ID와 실제 통과한 verification artifact 및 미해결 반론 ID를 추가로 가집니다. 원문은 CAS에 두고 event와 handoff에는 raw prompt, 내부 추론, 전체 대화, tool input과 provider payload를 넣지 않습니다.

`DeliberationPolicy`는 참여 역할과 provider 선택 규칙, 결정 책임자, 최대 회차, 필수 verification suite, 차단 반론 해소 규칙과 공개 조건을 run 전에 고정합니다. 종료 상태의 의미와 필수 정보는 다음과 같습니다.

| 상태 | 필수 정보와 의미 |
|---|---|
| `converged` | 최신 revision을 직접 참조한 독립 승인, 결정 책임자의 마지막 decision, 각 채택 claim의 현재 digest에 대한 모든 필수 verification 통과와 차단 반론 0개. 이 조건을 모두 만족할 때만 공개 후보가 됩니다. |
| `no_consensus` | 마지막 round, 미해결 반론 ID와 종료 사유. 최대 회차나 합의 기준 미충족이며 결론을 선택하거나 지식으로 승격하지 않습니다. |
| `failed` | 실패 phase와 기계용 code, 마지막으로 확정된 artifact 좌표. Provider, telemetry, schema 또는 artifact 저장 실패이며 정상 합의로 표시하지 않습니다. |

숙의 event는 `deliberation.started`, `deliberation.artifact.recorded`, `deliberation.completed`입니다. Started는 policy hash·참여 role·최대 회차, recorded는 artifact 종류·회차·생산 role·CAS hash·writing permit ID, completed는 outcome/status·마지막 회차·decision·미해결 차단 반론과 실패 phase/code만 허용합니다. Raw prompt, artifact 본문, provider 응답·payload, 내부 추론, tool input, credential과 상세 진단은 allowlist에 없습니다. Redaction 뒤 type별 payload schema가 필수 필드·ID·회차와 상태별 decision/failure null 규칙을 검사하며 실패하면 `invalid_payload`로 event 전체를 거부합니다. Runtime은 이 세 event를 SQLite에 기록하지만 기존 `run.completed`나 공급자 자유 형식 출력만으로 합의를 주장하지 않습니다.

`@lervo/deliberation`은 schema-valid metadata를 실제 verification result artifact와 대조하고 역할 간 managed run/session/context receipt 재사용, 최신 수정 승인 누락, 과거 claim digest 검증과 outcome 위장을 거부합니다. `@lervo/deliberation-runtime`은 `ManagedProviderRunResult`의 E2/E3 evidence를 같은 run의 event 원본과 대조하고 역할 간 provider session 재사용도 거부합니다. `document.loaded.evidenceReceiptId`는 문서별 E2를, `context.injected.evidenceReceiptIds`는 envelope에서 만든 문서별 E3를 뜻하며 기존 `context.injected.receiptId`는 adapter receipt 의미를 유지합니다. Runtime은 역할별 provider 정책을 managed run 직후 확인하며, 허용되지 않은 provider면 writing 평가 전에 `artifact_publication_failed/provider_not_allowed`로 중단합니다. 허용된 결과도 writing 평가와 permit 재검증, 이전 artifact의 shared-context 재적재, 현재 history 검증을 통과한 경우에만 artifact event를 기록합니다. Codex의 developer message 주입과 Claude의 context replay처럼 provider별 표현은 adapter 내부에만 남고 공통 receipt·artifact·event 의미는 바뀌지 않습니다. 상세 결정은 [ADR-0019](./docs/adr/0019-provider-neutral-deliberation.md), [ADR-0026](./docs/adr/0026-structured-deliberation-contracts.md), [ADR-0027](./docs/adr/0027-deliberation-boundary-hardening.md), [ADR-0028](./docs/adr/0028-same-provider-deliberation-runtime.md)과 [ADR-0029](./docs/adr/0029-cross-provider-deliberation-runtime.md)에 정의합니다.

## Context preparation 첫 슬라이스

Context preparation은 E1 계획과 E2 적재를 분리합니다. 입력은 project/run/session/Role 좌표, document registry, 예상 변경 경로, Role rule별 문서 ID, shared context publication과 handoff, 정책 version과 source revision입니다. 이 단계는 provider를 실행하지 않으며 E3를 만들지 않습니다.

선택 순서는 다음과 같습니다.

1. 예상 변경 경로를 저장소 상대 경로로 정규화합니다. 절대 경로, `..`, NUL 문자를 거부합니다.
2. Root `AGENTS.md`와 예상 경로의 상위 디렉터리에 있는 `AGENTS.md`를 root에서 가까운 순서로 발견합니다. 관련 없는 형제 디렉터리의 지침은 선택하지 않습니다.
3. Document registry의 `connectedPaths`를 Node `path.matchesGlob` 규칙으로 예상 변경 경로와 비교합니다.
4. Role의 `requiredDocumentRuleIds`를 built-in instruction rule 또는 호출자가 제공한 document rule map으로 해석합니다. 하나라도 해석할 수 없으면 중단합니다.
5. 현재 project와 Role이 읽을 수 있는 shared context는 E0로 발견합니다. Handoff가 명시한 shared context만 `reasonCode=handoff`로 E1 필수 문서가 됩니다.

같은 문서가 여러 규칙에 걸리면 문서는 한 번만 읽되 E1 선택 이유는 각각 보존합니다. 첫 슬라이스는 선택한 범위를 모두 `full`로 취급합니다. Registry에 없는 `AGENTS.md`는 정규화한 경로 hash로 안정된 document ID를 만들며, 일반 registry 문서와 shared context 원문은 등록된 ID를 사용합니다. 중복 문서 경로, shared context ID와 handoff ID는 계약 오류입니다.

E1에는 선택 이유, rule ID, 필수 여부, scope와 정책 version만 있습니다. E2 loader는 plan이 현재 project/run/session의 discovery·recommendation·E1만 포함하고 모든 문서·선택 이유와 대응하는지 먼저 확인합니다. 다른 run의 receipt나 이미 만들어진 E2/E3를 넣은 plan은 `invalid_context_plan`으로 거부합니다. 그 뒤 각 파일을 전체 bytes로 읽고 SHA-256, byte count, source revision을 기록합니다. Handoff 문서는 publication의 hash와 현재 bytes가 일치해야 합니다. 한 문서라도 없거나 안전하지 않거나 읽는 중 바뀌거나 예상 hash와 다르면 적재 결과와 E2 묶음을 반환하지 않습니다. 사용자 문서를 수정하거나 timestamp를 갱신하지 않습니다.

적재 뒤 snapshot 검사는 다음 사유를 `context.invalidated`의 reason으로 사용할 수 있습니다.

| reason | 의미 |
|---|---|
| `content_changed` | 현재 파일 bytes의 hash가 E2와 다릅니다. |
| `document_missing` | E2 원문 파일이 없어졌습니다. |
| `document_unsafe` | 경로에 심볼릭 링크나 일반 파일이 아닌 항목이 생겼습니다. |
| `publication_missing` | Handoff가 사용한 publication을 찾을 수 없습니다. |
| `publication_not_yet_published` | 검사 시각에 아직 유효한 publication이 아닙니다. |
| `publication_expired` | Publication 유효 기간이 끝났습니다. |
| `publication_superseded` | 더 새 publication이 기존 ID를 대체했습니다. |
| `publication_access_revoked` | 현재 Role이 더 이상 publication을 읽을 수 없습니다. |
| `publication_document_changed` | 같은 publication ID가 다른 document ID를 가리킵니다. |
| `publication_content_changed` | Publication의 content hash가 E2와 다릅니다. |

Orchestrator 상태 전이는 다음 runtime reason을 추가합니다.

| reason | 의미 |
|---|---|
| `managed_file_changed` | 허가된 파일 변경을 기록해 현재 E3와 permit를 소비했습니다. |
| `file_change_unverified` | Permit의 before hash, 보고된 after hash와 실제 저장소 상태를 일치시킬 수 없습니다. |
| `context_compacted` | Provider가 현재 context를 압축했다는 관리 신호를 받았습니다. |
| `session_restarted` | Managed provider session이 재시작되어 이전 주입을 재사용할 수 없습니다. |
| `snapshot_validation_failed` | 쓰기 직전 snapshot을 안전하게 판정하지 못해 전체 필수 문서를 보수적으로 무효화했습니다. |

이 슬라이스는 새 event type을 추가하지 않습니다. E1은 기존 `context.selected`, E2는 `document.loaded`, 위 사유는 `context.invalidated`에 대응합니다. Event payload에는 문서 본문을 넣지 않고 ID, hash, byte count, scope, source revision과 기계용 reason만 저장합니다.

잘못된 path/rule, 중복 ID·경로, 다른 수신 Role의 handoff, 등록되지 않은 shared 문서와 유효하지 않은 evidence는 `contract_validation_failed`입니다. 문서 부재·안전하지 않은 경로·읽기 중 변경·handoff hash 불일치와 snapshot 무효화는 `required_context_missing`으로 쓰기 전에 다시 준비합니다. 오류와 event에는 원문 bytes, raw prompt, credential이나 provider payload를 넣지 않습니다.

## 문서 보장 수준

Lervo는 아래 상태를 분리합니다.

| 수준 | 상태 | 증거 | 의미 |
|---|---|---|---|
| E0 | discovered | 경로와 metadata | 문서의 존재를 발견함 |
| 보조 | recommended | 검색 attempt·index·순위·정책 좌표 | 선택 후보로 추천됐지만 아직 E1은 아님 |
| E1 | selected | reason code, rule/policy version | 이번 작업에 필요하다고 판정함 |
| E2 | loaded | content hash, byte count, timestamp | 현재 원문 바이트를 실제로 읽음 |
| E3 | injected | adapter receipt, target turn/session | 모델 입력 컨텍스트에 전달함 |
| E4 | referenced | output/tool decision의 citation | 결과나 결정이 문서를 명시적으로 참조함 |

“읽기 보장”의 실행 게이트는 필수 문서가 E3에 도달했다는 뜻입니다. E3는 모델이 내용을 인간처럼 이해하거나 따랐음을 증명하지 않습니다. 준수 여부는 결과 검증과 E4, 가드레일 테스트로 별도 평가합니다.

### Receipt 유효성

다음 조건을 모두 만족할 때만 유효합니다.

- 동일 project/run/provider session에 속함
- 현재 문서 content hash와 일치함
- 해당 모델 turn 또는 마지막 context compaction/restart 이후 생성됨
- 선택 정책이 요구한 최소 범위(전체 파일 또는 명시된 section)를 충족함
- 어댑터가 통제된 입력 경로로 전달했음
- 세션의 role/writing policy ID가 envelope와 같고, 선택된 writing 정책 문서가 envelope와 receipt의 문서 목록에 포함됨

문서가 변경되거나 context가 압축/재시작되면 관련 E2/E3 receipt는 무효가 되고 재적재합니다.

### Provider-neutral envelope와 E3 생성

`@lervo/context`의 무결성 판정은 `LoadedContext`의 plan, 원문 bytes, E0~E2 evidence를 대조합니다. Plan 밖 문서, 변경된 bytes/hash/byte count/scope/source revision, 중복 문서·receipt ID, 다른 project/run/session의 evidence, 이미 들어 있는 E3/E4는 계약 위반입니다. Delivery는 이 판정을 재사용하며 내부 plan 구조를 별도로 해석하지 않습니다.

Session의 project/run/session/role 좌표는 E2와 같아야 합니다. Writing policy가 있으면 resolved binding의 policy ID, document ID와 E2 content hash가 모두 일치해야 합니다. 해당 문서 bytes는 UTF-8 JSON이어야 하고 `WritingContract` schema 및 문서 내부 policy ID가 session과 같아야 합니다. Envelope 생성 시각은 E2 적재와 session 시작 이후여야 합니다.

기본 delivery policy는 64 KiB 이하이며 UTF-8 decode/encode가 원래 bytes와 같은 문서만 inline으로 둡니다. 문서 ID·byte count·inline 가능 여부를 받는 policy 함수로 선택 규칙을 교체할 수 있습니다. CAS 경로는 `put/get`만 노출하는 artifact port를 사용하며, port가 없으면 `artifact_storage_failed`로 거부합니다. `put`이 반환한 URI·hash·byte count와 같은 URI를 다시 읽은 bytes를 모두 검증합니다. Envelope scope와 CAS 입력 bytes는 E2 객체와 공유하지 않고 복사합니다.

파일과 shared publication snapshot은 envelope 조립 전, adapter 호출 직전과 receipt 수신 뒤에 검사합니다. Context generation도 envelope 조립 전, adapter 호출 전, receipt 수신 뒤에 확인합니다. Adapter에는 managed session/envelope의 격리된 복사본을 전달하고 검증용 snapshot을 별도로 보존합니다. `@lervo/adapter-contract`의 공통 의미 판정이 이 snapshot과 receipt의 현재 generation, 좌표와 시간, 대상 turn, role/writing policy ID, provider session과 정확한 문서 ID·hash·scope 집합을 확인합니다. Delivery와 Codex/Claude contract suite는 같은 판정 함수를 사용합니다. 모두 통과하고 `controlledInput=true`일 때만 문서별 E3를 만듭니다.

이 슬라이스는 새 event type을 추가하지 않습니다. 기존 `context.injected` payload의 `receiptId`는 문서 묶음에 대한 adapter receipt ID이며, `envelopeId`, `documentIds`, `targetTurnId`, `contextGeneration`과 함께 기록합니다. 이후 숙의 runtime의 원본 대조를 위해 문서별 E3 evidence의 `receiptId` 목록을 `evidenceReceiptIds`로 추가했습니다. 문서별 E3 evidence는 자기 `receiptId`와 이 묶음의 `adapterReceiptId`를 별도로 유지합니다. 원문, inline content, CAS bytes와 provider 원본 응답은 event에 넣지 않습니다.

| delivery code | 상위 실패 의미 |
|---|---|
| `invalid_loaded_context`, `invalid_session`, `invalid_delivery_request`, `invalid_inline_content`, `invalid_context_receipt`, `invalid_context_evidence`, `receipt_id_conflict`, `writing_policy_document_invalid` | `contract_validation_failed` |
| `context_snapshot_invalid`, `writing_policy_document_missing`, `context_receipt_mismatch`, `stale_context_generation`, `injection_failed` | `required_context_missing` |
| `artifact_store_required`, `artifact_storage_failed` | `artifact_storage_failed` |

오류에는 문서 ID와 기계용 reason만 포함하며 원문 bytes와 provider payload는 포함하지 않습니다. Adapter 호출 자체가 실패하면 원본 예외를 오류 cause로 보존하지 않고 `required_context_missing`으로 재주입이 필요한 상태를 나타냅니다. Capability matrix가 controlled injection을 `unsupported`로 선언한 경우는 이 포트를 호출하기 전에 orchestrator가 `provider_capability_unsupported`로 차단합니다. 어느 실패에서도 부분 E3 evidence를 반환하지 않습니다.

### Managed context telemetry와 쓰기 gate

Orchestrator는 준비가 성공하면 모든 검색 추천 `context.recommended`, E1 `context.selected`와 E2 `document.loaded`를 한 transaction에 기록합니다. E3는 검증된 aggregate adapter receipt를 받은 뒤 `context.injected`로 기록합니다. 이 기록이 commit된 뒤에만 메모리 evidence를 전진시킵니다.

| event | 이 슬라이스의 필수 payload |
|---|---|
| `context.recommended` | recommendation·batch·attempt·engine·nullable selection transition·index·result-set·document·content hash·rank·score·selection policy 좌표 |
| `context.selected` | `documentId`, `reasonCode`, `ruleId`, `required`, `scope` |
| `document.loaded` | `evidenceReceiptId`, `documentId`, `contentHash`, `byteCount`, `scope`, `sourceRevision` |
| `context.injected` | `receiptId`, `evidenceReceiptIds`, `envelopeId`, `documentIds`, `targetTurnId`, `contextGeneration` |
| `capability.requested` | `capability=filesystem.write`, `targetDigest`, `risk` |
| `capability.decided` | `capability`, `decision`, `policyRuleId=managed_context_e3\|managed_context_e3+signed_approval`, `approvalId` |
| `file.changed` | Permit와 실제 저장소 상태로 확인한 `path`, `beforeHash`, `afterHash`, `changeKind` |
| `context.invalidated` | `documentIds`, 기계용 `reason`, 무효화된 `contextGeneration` |

E1 하나에 선택 이유가 여러 개면 `context.selected`를 이유별로 보존합니다. `context.invalidated.contextGeneration`은 증가하기 전의 무효화 대상 generation이며, event commit 뒤 메모리 generation을 하나 올립니다. Snapshot invalidation reason이 여러 개면 reason별 event를 같은 transaction에 기록하고 generation은 한 번만 올립니다.

Capability 요청과 결정, `file.changed`와 뒤따르는 `context.invalidated`도 각각 한 transaction입니다. 일부 append, event payload redaction 또는 저장 실패가 발생하면 transaction 전체를 되돌리고 `telemetry_failed`로 전환합니다. 이 상태에서는 새 permit를 발급하지 않으며 pending permit와 과거 E3를 사용할 수 없도록 generation을 올립니다. Hub/outbox는 이 로컬 gate의 선행 조건이 아닙니다.

이 event에는 지침 본문, inline context, raw prompt, provider 응답과 credential을 저장하지 않습니다. 상대 경로, ID, hash, byte count, scope, 기계용 reason과 receipt 좌표만 원본 telemetry로 남깁니다. 파일 변경 기록 실패가 이미 일어난 filesystem mutation을 되돌렸다고 주장하지 않으며, run을 중단하고 이후 unmanaged change 탐지 대상이 되게 합니다.

### 중앙 화면의 표현

각 문서를 다음과 같이 보여줍니다.

- 문서명과 revision/content hash
- 선택 이유: 경로 일치, 역할 필수, 상위 지침, 명시 링크, 역할 handoff, 검색 추천
- E0~E4와 별도 recommended 상태·시각
- 누락/무효화 원인
- 이 문서가 보호하는 capability와 관련 변경 파일

커버리지는 하나의 모호한 숫자 대신 `필수 문서 E3 비율`, `선택 문서 E2 비율`, `결과 E4 비율`, `가드레일 통과율`로 나눕니다.

## Codex와 Claude 일관성

두 어댑터는 동일한 contract suite를 통과해야 합니다.

- 같은 fixture 저장소와 변경 경로에서 같은 필수 문서를 선택
- 같은 Role과 writing 정책 원문을 주입하고 정책 문서 hash를 receipt로 확인
- 필수 E3 없이 쓰기 요청을 거부
- 도구/파일/명령/압축/완료 이벤트를 공통 schema로 변환
- context hash 변경 후 이전 receipt를 재사용하지 않음
- 사용한 model/provider/session과 skill version을 기록
- 중단과 재개 후 이벤트 순서 및 idempotency 유지
- 사람이 읽는 같은 산출물에 동일한 writing 공개 게이트 적용

공급자별로 얻을 수 있는 telemetry가 다르면 capability matrix에 공개합니다. 지원하지 않는 증거를 추정해서 채우지 않습니다.

### Codex app-server 첫 슬라이스

Codex adapter는 session마다 app-server stdio process 하나를 시작합니다. `initialize`와 `initialized` handshake 뒤 `thread/start` 응답의 thread ID를 provider session ID로 사용합니다. Context envelope의 inline/CAS bytes를 다시 읽어 byte count와 SHA-256을 확인하고, UTF-8로 손실 없이 변환되는 문서만 `thread/inject_items`의 developer message로 전달합니다. App-server가 성공 응답을 보낸 뒤에만 `controlledInput=true` receipt를 만들며, 같은 target turn의 receipt 후보가 없으면 `turn/start`를 호출하지 않습니다.

Adapter normalized signal은 Lervo append-only event가 아닙니다. 이름과 필수 payload는 다음과 같습니다.

| signal | 필수 payload |
|---|---|
| `provider.session.started` | `adapterVersion` |
| `provider.session.restarted` | `reason` |
| `provider.session.stopped` | `status`이며 원인을 알 수 없으면 `unknown` |
| `provider.context.compacted` | `providerTurnId`, `providerItemId` |
| `provider.turn.started` | `providerTurnId` |
| `provider.turn.completed` | `providerTurnId`, `status`, `durationMs` |
| `provider.turn.failed` | `providerTurnId`, `failureCode`, `diagnosticDigest` |
| `provider.tool.called` | `providerItemId`, `toolName`, `inputDigest`, `status`, `durationMs` |
| `provider.command.executed` | `providerItemId`, `commandDigest`, 저장소 상대 `cwdRelative`, `status`, `exitCode`, `outputDigest`, `durationMs` |
| `provider.file_change.reported` | `providerItemId`, 저장소 상대 `paths`, `changeKinds`, `status`, `diffDigest` |
| `provider.usage.updated` | `providerTurnId`, token count들과 `contextWindow` |
| `provider.error` | `failureCode`, `diagnosticDigest`, `retryable` |

`provider.context.compacted`와 `provider.session.restarted`만 현재 generation 무효화 입력입니다. Orchestrator는 project/run/session/provider session 좌표를 확인하고, 처리 시각으로 `context.invalidated`를 기록한 뒤 generation을 올립니다. 이미 `awaiting_context`가 된 동일 신호는 다시 generation을 올리지 않습니다. `provider.file_change.reported`는 변경 후보일 뿐이며, 기존 permit와 실제 before/after bytes를 확인하는 별도 경로를 통과해야 `file.changed`가 됩니다.

Raw task instructions와 context 원문은 로컬 app-server 입력에만 존재합니다. Normalized signal과 event store에는 raw prompt, 문서 본문, command, output, tool arguments, diff, 절대 경로와 provider 오류 본문을 넣지 않습니다. Protocol 오류는 `provider_protocol_failed`, process 종료는 `provider_process_failed`, 문서 bytes/hash/UTF-8 불일치는 `context_materialization_failed`로 adapter 호출을 실패시킵니다. 읽기 전용은 `read-only` sandbox와 `never` approval을, managed write는 같은 sandbox와 `on-request` approval을 사용합니다. Managed write에서는 `item/started`의 단일 `fileChange`와 `item/fileChange/requestApproval`의 thread·turn·item 좌표를 연결해 bridge에 요청합니다. 명령 승인, 여러 파일, 이동과 저장소 밖 경로는 거부합니다. Session resume은 `unsupported`입니다.

### Claude Agent SDK 첫 슬라이스

Claude adapter는 `startup`으로 session process와 initialize handshake를 먼저 완료하고 호출자가 만든 UUID를 provider session ID로 사용합니다. 읽기 전용은 `plan` mode와 `Read`, `Glob`, `Grep`만 사용합니다. Managed write는 `default` mode에서 이 읽기 도구와 `Write`, `Edit`만 제공하며, PreToolUse와 PostToolUse 계열 hook을 공통 bridge에 연결합니다. Filesystem setting source, 자동 skill과 외부 MCP 설정을 불러오지 않고 Bash와 내부 Agent/Task를 차단합니다. 여러 전문 에이전트가 필요하면 각각 managed session을 만들고 Role, writing policy와 현재 generation에 맞는 envelope를 주입합니다.

Inline/CAS bytes 검증은 Codex와 같은 공통 materializer를 사용합니다. 검증된 문서 묶음을 `shouldQuery=false` synthetic user message로 보내고, 같은 session ID·message UUID·원문을 가진 SDK replay와 init을 확인한 뒤에만 receipt를 만듭니다. 실제 task는 `shouldQuery=true` message로 보내며 그 UUID가 provider turn ID입니다. Init과 replay를 받지 못하거나 replay 원문이 다르면 `provider_protocol_failed`로 중단합니다.

SDK `compact_boundary`는 `provider.context.compacted`로 바꿉니다. 일반 tool은 tool use/result ID를 연결한 뒤 `provider.tool.called`로 바꾸고 input과 result 원문은 저장하지 않습니다. Claude result가 공통 usage payload의 reasoning token을 제공하지 않으므로 `usage=unknown`이며 usage signal을 만들지 않습니다. Write/Edit도 file change signal을 추정하지 않습니다. 실행 전 요청과 실행 후 실제 hash를 bridge가 검증해 공통 `file.changed`를 만듭니다. Session resume은 `unsupported`입니다.

Provider가 다른 session ID를 보내거나 tool result와 turn result를 기존 ID에 연결할 수 없으면 정상 signal로 바꾸지 않습니다. SDK startup/stream/interrupt/close 실패는 `provider_process_failed`입니다. Raw task, context, model result와 provider 오류 본문은 normalized signal이나 event store에 복제하지 않습니다.

## Managed provider run 수명주기

`ManagedProviderRunCoordinator`는 provider-neutral adapter 하나를 받아 다음 단계를 직렬화합니다.

1. `run.requested`와 `run.resolved` 기록
2. 실행 전 repository snapshot
3. adapter session 시작과 `adapter.started`
4. 현재 snapshot revision을 기준으로 E1/E2 준비와 controlled E3 주입
5. managed write bridge 연결
6. 같은 target turn 시작, 중단 가능한 normalized signal 소비
7. 완료·실패·취소 사유로 adapter 종료와 `adapter.stopped`
8. 실행 후 snapshot 비교와 provider 결과 CAS 검증
9. 요청한 project verification suite 실행과 결과 CAS 재검증
10. `run.completed` 또는 `run.failed`

Signal consumer는 context 상태 머신과 독립적으로 stream 종료와 terminal event를 판정합니다. `provider.context.compacted` 또는 session restart는 같은 좌표인지 확인한 뒤 즉시 현재 generation을 무효화합니다. Terminal event 전 stream 종료는 `provider_stream_failed`입니다. 호출자 취소는 `cancelled`이며 adapter에 active turn 중단과 process 종료를 요청합니다. 종료가 제한 시간 안에 확인되지 않으면 정상 종료를 주장하지 않고 `provider_stop_failed`도 함께 남깁니다.

Coordinator가 만드는 `start_request`와 adapter가 돌려주는 `session`은 같은 `executionMode`를 가져야 합니다. Role의 `filesystem.write=deny`는 `read_only`, `allow`는 `managed_write`가 되며, 검증된 승인 원본이 없는 `require_approval`은 시작 전에 거부합니다. Adapter는 Codex sandbox·approval과 Claude permission·tool 구성이 해당 모드의 허용 집합을 넓히지 않는지 확인합니다. Session의 필수 `effectiveCapabilities`는 현재 구성에서 실제 열린 기능이며 descriptor의 최대 기능보다 넓을 수 없습니다. 읽기 전용의 `fileChanges`는 `unsupported`, managed write는 `supported`여야 합니다. 값이 없거나 좌표·기능이 다르면 `contract_validation_failed`, 경계를 넓히는 provider 구성은 provider 호출 전에 `invalid_request`로 거부합니다. 실행 모드와 기능 상태는 비밀정보가 아닌 정책 좌표이며 `adapter.started`에 기록합니다.

`startTurn`은 adapter가 provider 도구 실행 전에 호출하는 동기 수락 callback과 최종 반환값을 모두 사용합니다. Orchestrator는 callback의 turn schema, session·target turn 좌표를 확인한 뒤에만 현재 turn으로 공개합니다. Callback 누락·중복, callback과 반환값 불일치는 `contract_validation_failed`입니다.

Managed write bridge는 `managed_write_request`, `managed_write_decision`, `managed_write_completion` 세 메시지를 사용합니다. 공통 좌표는 `adapterId`, project/run/session/provider session, target/provider turn, provider item, 저장소 상대 `path`, `targetDigest`, `changeKind`입니다. 요청에는 `requestedAt`, 결정에는 `decision`, `reasonCode`, `decidedAt`, 완료에는 `status`, `completedAt`이 추가됩니다. 메시지는 schema와 현재 session·turn·시간 순서를 모두 통과해야 합니다. `targetDigest`는 provider 제안이나 tool input의 원문 없는 결속값이며, 파일 bytes·diff·tool input·절대 경로는 이 메시지나 event에 넣지 않습니다. 승인된 요청이 실패하거나 완료되지 않거나 실제 파일 상태가 요청 종류와 다르면 `provider_write_failed`입니다.

Coordinator가 만드는 event payload는 기존 allowlist를 사용합니다. `run.requested`는 `requestDigest`, `role`, `risk`, `run.resolved`는 `role`, `risk`, `policyVersion`을 필수로 가집니다. `adapter.started`는 adapter ID/version, provider session ID, `executionMode`와 capability matrix를, `adapter.stopped`는 adapter ID, provider session ID와 종료 `status`를 가집니다. `tool.called`는 tool 이름, input digest, status와 duration만 남깁니다. `command.executed`는 command/output digest, 저장소 상대 cwd, `status`, exit code와 duration만 남기며 command와 output 원문은 허용하지 않습니다. `run.completed`는 provider 결과 digest, provider·verification artifact ID와 `passed`, `failed`, `not_run` 중 하나인 검증 상태를 가집니다. `run.failed`는 진단 digest를 사용합니다. 두 event 모두 raw task나 provider 결과를 저장하지 않습니다.

실행 전후 snapshot은 실제 repository root의 일반 파일 bytes와 symlink target을 SHA-256으로 묶습니다. 기본 정책은 `.git`, `node_modules`, `.lervo/state`를 제외하고 20,000개 항목, 일반 파일 256 MiB로 제한합니다. 저장소별 정책으로 제외 경로와 한도를 바꿀 수 있지만, 제외한 경로의 불변성은 증명하지 않습니다. Root가 실제 디렉터리가 아니거나 정책이 유효하지 않거나 제한 초과, 읽는 중 변경과 안전한 읽기 실패는 `repository_snapshot_failed`입니다.

Coordinator는 부작용 없는 snapshot 대기와 중단 경계가 있는 실행 단계에만 제한 시간을 둡니다. 기본값은 snapshot 30초, provider turn 10분, signal stream 정리 5초, adapter 종료 10초이며 호출자는 양의 정수 millisecond로 좁힐 수 있습니다. Adapter 시작·context 주입·turn 시작의 transport 제한은 실제 요청을 취소하거나 process를 닫을 수 있는 각 adapter가 책임집니다. 단순히 `Promise.race`로 상태 변경 작업을 버려 두고 종료됐다고 주장하지 않습니다. Coordinator 제한 시간도 대기를 끝내는 경계일 뿐이므로 stream abort와 adapter stop을 별도로 시도하고 확인하지 못한 종료는 실패로 남깁니다.

실패는 마지막 오류로 덮어쓰지 않고 단계와 함께 모두 모읍니다. `run.failed.failureCode`는 개인정보 없는 결정적 우선순위인 telemetry, artifact 저장, provider stop, provider write, unmanaged change, project verification, contract, snapshot, context, provider 실행, cancellation 순으로 대표 실패를 고릅니다. Bridge에서 시작된 실패는 이후 snapshot 단계에서도 `provider_write` phase를 유지합니다. `diagnosticDigest`는 모든 `{code, phase, retryable}` 묶음으로 만들고 원문 예외는 저장하지 않습니다. 호출자 오류에는 같은 안전한 관련 실패와 정렬된 unmanaged 경로를 제공하므로 쓰기 실패, 종료 실패와 저장소 변경을 동시에 잃지 않습니다.

첫 managed write 수직 슬라이스는 context 준비 때 정규화한 `expectedPaths` 중 정확히 한 파일만 바꿀 수 있습니다. Orchestrator의 `ManagedWritePlan`은 읽기 전용에서 검증 변경 `0..0`, managed write에서 `1..1`, 허용 경로와 변경 뒤 context 무효화를 선언합니다. Bridge는 계획과 현재 E3 generation, Role 정책을 확인하고 경로·target digest·실제 before hash에 묶인 1회용 permit를 발급합니다. 완료 뒤 파일을 다시 읽어 실제 after hash와 생성·수정·삭제 종류를 확인한 후에만 `file.changed`와 `context.invalidated`를 같은 transaction에 기록합니다. 그 즉시 permit와 E3가 무효화됩니다. 실행 후 snapshot에서 before/after hash가 증거와 정확히 맞는 경로만 managed 변경으로 제외합니다. 완료 누락, 추가·중복 변경, 허용 경로 밖 요청, permit 우회와 hash 불일치는 `contract_validation_failed`, `unmanaged_change_detected` 또는 `provider_write_failed`로 run을 실패시키며 provider 보고만으로 `file.changed`를 만들지 않습니다.

Adapter 종료는 interrupt와 provider close를 시도한 뒤 성공 여부와 관계없이 session registry를 해제합니다. 주입·turn ID, 승인 대기, active turn과 결과 원문을 제거하며 이후 같은 session은 `session_not_found`입니다. Close 실패는 state를 남기는 대신 `provider_process_failed`로 adapter 호출을 실패시키고 상위에서 `provider_stop_failed`로 기록합니다. 새 event나 원문 payload는 추가하지 않습니다.

공통 adapter suite는 descriptor/session 기능 범위와 turn 수락 순서를 검증합니다. 별도 managed write suite는 요청·결정·완료의 schema, session/turn/item/path 좌표, 시간 순서, 허용 결정 사유와 원문 비포함을 두 provider에 같은 방식으로 적용합니다. 자세한 결정은 [ADR-0014](./docs/adr/0014-managed-adapter-session-hardening.md)에 정의합니다.

### Provider 결과 artifact

Terminal 완료 signal은 실행 상태만 나타내며 결과 원문을 포함하지 않습니다. Coordinator는 같은 session과 turn으로 `getTurnResult`를 호출해 별도의 `AdapterTurnResult`를 받습니다. 필수 필드는 `adapterId`, project/run/session/provider session, target/provider turn ID, `mediaType=text/markdown; charset=utf-8`, `content`, `contentHash`, `byteCount`, `producedAt`입니다. 결과는 손실 없이 UTF-8로 왕복되어야 하고 1 byte 이상 4 MiB 이하여야 하며, 생산 시각은 turn 수락보다 빠를 수 없습니다. 실제 bytes의 SHA-256과 크기가 선언값과 다르면 `contract_validation_failed`입니다.

Codex adapter는 같은 turn의 마지막 완료 `agentMessage.text`를 사용하고 Claude adapter는 성공 result message의 `result`를 사용합니다. 이 원문은 normalized signal로 바꾸지 않습니다. Terminal 뒤 결과가 없으면 `provider_result_failed`이며 adapter를 실패 사유로 종료하고 정상 결과를 만들지 않습니다.

Provider 종료와 실행 후 snapshot까지 성공하면 coordinator가 결과 bytes를 local artifact store에 씁니다. `put` 결과의 URI는 content hash에 해당하는 `lervo-cas://sha256/<digest>`여야 하며 같은 URI를 다시 읽어 hash, byte count와 전체 bytes를 확인합니다. 실패는 `artifact_storage_failed`입니다. Artifact ID는 `art_<digest>`이고 `run.completed.resultDigest`에는 provider 결과 content hash, `artifactIds`에는 provider 결과와 완료된 project verification 결과 ID를 기록합니다. Event에는 결과 원문과 URI를 넣지 않습니다. `ManagedProviderRunResult`의 URI는 호출자가 허가된 로컬 저장소에서 결과를 읽기 위한 좌표입니다.

결과 artifact는 writing 정책, 의미 품질, 인용이나 E4 통과를 뜻하지 않습니다. 공개, Hub 업로드와 shared context 발행은 별도 정책과 검증이 필요합니다. `lervo run` 사용자 명령은 이 provider run 계약과 local storage bootstrap을 연결해 로컬 결과를 표시합니다. 자세한 결정은 [ADR-0011](./docs/adr/0011-managed-provider-run-lifecycle.md), [ADR-0012](./docs/adr/0012-provider-result-artifacts.md), [ADR-0013](./docs/adr/0013-provider-neutral-managed-write-bridge.md)에 정의합니다.

### `lervo run` CLI 첫 슬라이스

`lervo run`은 초기화된 저장소에서 다음 입력만 받습니다.

- `--provider`: `codex` 또는 `claude`
- `--path`: 변경할 저장소 상대 경로 하나
- `--verification`: 실행할 suite ID. 한 개 이상, 최대 16개이며 중복할 수 없음
- 위치 인자: 비어 있지 않은 작업 문장
- 선택 입력: 추가 suite, skill, repository root, 위험도와 JSON 출력

경로는 storage와 provider를 열기 전에 공통 상대 경로 계약으로 정규화합니다. Application service는 project storage를 열고 manifest와 document registry를 검증한 뒤, 같은 artifact store를 context delivery, adapter CAS resolver와 provider result 저장에 사용합니다. 현재 고정 `developer` Role은 root `AGENTS.md`의 E3를 요구하고 한 파일 managed write만 허용합니다. Project policy schema가 아직 없으므로 이 Role을 사용자 설정에서 읽었다고 기록하지 않습니다.

CLI는 요청한 suite 원본을 provider 시작 전에 모두 읽고, provider가 끝난 뒤 같은 artifact store를 쓰는 검증 실행기를 coordinator에 주입합니다. 필수 suite가 모두 `passed`여야 정상 run과 종료 코드 0의 후보가 됩니다. 실패한 suite ID는 안전한 오류 문장에 포함하지만 command, arguments와 output은 출력하지 않습니다. Provider 결과는 같은 CAS의 writing 공개 경계가 결정적 검사와 별도 의미 평가를 실행하고 content-bound permit를 만든 경우에만 stdout 또는 JSON에 포함합니다. 의미 평가기가 없거나 실패하면 검증된 변경과 `run.completed`는 유지하지만 결과 원문은 `null`로 두고 종료 코드 1을 반환합니다. Raw 작업 문장과 결과, 검증 output, 의미 평가기의 오류 본문은 event에 복제하지 않으며 writing 통과는 E4를 뜻하지 않습니다.

성공과 실패 모두 adapter 수명주기가 끝난 뒤 project storage를 닫습니다. 실행 실패와 storage 정리 실패가 겹치면 CLI는 `cleanup_failed`를 반환하고 두 로컬 원인을 cause로만 보존합니다. 자세한 결정은 [ADR-0015](./docs/adr/0015-lervo-run-cli-vertical-slice.md)와 [ADR-0032](./docs/adr/0032-managed-run-project-verification.md)에 정의합니다.

## 별도로 실행한 코딩 에이전트

별도 Codex/Claude 프로세스가 파일을 수정하는 것 자체를 금지하지 않습니다. 다만 `lervo run` 또는 등록된 hook/plugin을 거치지 않으면 Lervo는 그 프로세스의 컨텍스트 주입과 도구 호출을 증명할 수 없습니다.

이 경우 Lervo는 다음만 할 수 있습니다.

- Git/파일 시스템 변경을 감지해 `unmanaged_change.detected` 기록
- 작성자와 원인 run을 `unknown`으로 표시
- 사후 테스트와 문서 영향 검사를 제안
- 사용자가 선택하면 변경을 새 managed run으로 가져와 검증

따라서 강한 일관성이 필요한 자동화와 중앙 작업은 관리 실행 경로를 사용합니다.

## 이벤트 최소 규격

모든 이벤트 envelope:

```json
{
  "eventId": "evt_...",
  "projectId": "prj_...",
  "runId": "run_...",
  "sessionId": "ses_...",
  "seq": 42,
  "type": "document.loaded",
  "occurredAt": "2026-08-18T00:00:00Z",
  "actor": { "kind": "agent", "provider": "codex" },
  "schemaVersion": 1,
  "policyVersion": "sha256:...",
  "payload": {},
  "previousHash": "sha256:...",
  "eventHash": "sha256:..."
}
```

초기 event type:

- `run.requested`, `run.resolved`, `run.completed`, `run.failed`
- `context.recommended`, `context.selected`, `document.loaded`, `context.injected`, `context.invalidated`
- `context.published`, `handoff.created`
- `adapter.started`, `adapter.stopped`
- `capability.requested`, `capability.decided`
- `tool.called`, `command.executed`, `file.changed`
- `skill.resolved`, `skill.invoked`, `skill.completed`
- `verification.started`, `verification.completed`
- `knowledge.candidate.created`, `knowledge.candidate.reviewed`, `knowledge.verified`, `knowledge.stale.detected`, `document.stale.detected`
- `document.migration.applied`
- `unmanaged_change.detected`, `sync.acknowledged`

M0 구현에서 모든 event payload는 type별 allowlist를 통과합니다. 키는 Unicode 호환 정규화 후 구분 기호와 대소문자를 제거해 검사하므로 `rawPrompt`, `access_token`, 전각 문자 변형도 같은 민감 키로 취급합니다. raw prompt, 문서 본문, authorization/cookie/credential/password/secret/token/API key/tool input 같은 민감 키는 중첩 객체에서도 event에 보존하지 않습니다. 순환 참조, 유한하지 않은 숫자, 일반 JSON 객체가 아닌 값은 정리된 것처럼 저장하지 않고 `redaction_failed`로 기록을 중단합니다. Type별 schema가 있는 payload의 `invalid_payload`도 같은 상위 처분으로 매핑해 event를 저장하지 않습니다. 파일 경로와 작업 디렉터리는 저장소 상대 경로만 허용합니다. 원문이 필요한 실행 경로는 event payload와 분리된 로컬 context envelope/CAS를 사용합니다.

`context.published`에는 shared context/document ID, content hash, 생산 역할, 공개 방식과 허용 역할, 만료 시각만 저장합니다. `handoff.created`에는 handoff ID, 보내고 받는 역할, shared context/evidence event ID와 요청 digest만 저장합니다. 두 event 모두 문서 본문, raw prompt, 내부 추론과 provider payload를 허용하지 않습니다. 이 event를 기록하지 못하면 역할 간 공유가 성립했다고 주장하지 않고 `telemetry_recording_failed`로 실행을 중단합니다. `context.published`는 다른 역할이 읽었다는 뜻이 아니며, 수신 역할의 `document.loaded`와 `context.injected`가 별도로 필요합니다.

`document.migration.applied`에는 plan/approval ID, 승인 digest, 적용 전후 layout hash, 생성한 document ID/content hash와 적용 시각만 저장합니다. Metadata-only 적용은 source/candidate artifact hash를, legacy 구조 전환은 `migrationKind=legacy_registry_structural`, source registry·entry artifact·archive content hash를 추가합니다. 승인자, source/document/archive path, manifest와 문서 본문은 허용하지 않습니다. 이 event는 sidecar 생성 시도나 승인만 뜻하지 않고, 모든 파일 공개와 snapshot 재검증이 끝났음을 뜻합니다. Recorder가 event를 durable하게 기록하지 못하면 적용기가 이번 작업의 변경을 되돌리므로 event와 receipt 어느 쪽도 성공으로 만들지 않습니다.

## 로컬 event store, outbox와 CAS

로컬 event store는 `.lervo/state/events.sqlite`를 기본 경로로 사용하며 하나의 project id에 묶입니다. Event를 추가할 때 raw payload를 먼저 type별 allowlist와 민감 키 제거 규칙으로 정리합니다. 그 뒤 project 전체의 다음 `seq`, 직전 event hash, 현재 event hash를 한 SQLite transaction에서 계산하고 저장합니다. Schema는 `PRAGMA user_version` 기반 migration으로 올립니다. 공통 `transact` 경계는 동기 callback만 허용하고 실패 시 callback 안의 기록을 모두 되돌립니다. Outbox는 이 transaction을 확장해 event insert와 enqueue를 같은 commit에 넣습니다.

Event hash는 `eventHash`를 제외한 envelope 전체를 대상으로 합니다. 객체 key를 정렬하고 배열 순서를 유지하는 결정적 JSON 직렬화를 사용합니다. 첫 event는 `seq=1`, `previousHash=null`이며 이후 event는 바로 앞 project event의 hash를 가리킵니다. 같은 event id가 다시 오면 정리된 내용이 같을 때만 기존 event를 반환합니다. 내용이 다르면 `event_id_conflict`로 거부합니다.

SQLite는 WAL과 `synchronous=FULL`을 사용합니다. `UPDATE`와 `DELETE`는 trigger로 막습니다. Store를 열 때 database `quick_check`, schema, 연속된 seq, previous hash와 event hash를 다시 검증합니다. Event schema 위반, project 불일치, event id 충돌 또는 무결성 실패는 commit 전에 transaction을 되돌립니다. Event 기록이나 무결성 확인 실패는 상위 실행에서 `telemetry_recording_failed`로 처리하므로 변경 capability가 열리지 않습니다.

Outbox는 변경 가능한 전송 상태이며 실행 증거 원본을 대신하지 않습니다. 필수 좌표는 `eventId`, `destinationId`, `enqueuedAt`, `availableAt`, `attemptCount`입니다. 모든 입력 시각은 timezone을 명시해야 하며 SQLite에는 UTC ISO 8601 형식으로 정규화해 저장합니다. 상태 의미는 다음과 같습니다.

- `pending`: ack되지 않았고 현재 lease가 없습니다. `availableAt` 이후 가져갈 수 있습니다.
- `leased`: `workerId`, `claimedAt`, `expiresAt`이 함께 있으며 해당 worker만 lease 유효 구간 안에서 ack 또는 재시도를 예약할 수 있습니다.
- `acknowledged`: `acknowledgedAt`이 있으며 다시 배송하지 않습니다. 같은 ack 요청은 성공한 상태를 유지하는 no-op입니다.

멱등 키는 `(eventId, destinationId)`입니다. 한 event를 여러 destination에 독립적으로 보낼 수 있지만 같은 destination에는 한 항목만 둡니다. Claim할 때 `attemptCount`가 증가하며, 만료된 lease는 다른 worker가 회수할 수 있습니다. 실패한 전송은 lease를 놓고 `lastFailureCode`, `lastFailedAt`, 새 `availableAt`만 기록합니다. Failure code는 64자 이하의 소문자 기계용 코드로 제한하며 HTTP 응답 본문, 예외 메시지, authorization 값과 provider payload는 저장하지 않습니다. 배송할 event는 이미 allowlist와 redaction을 통과한 envelope입니다.

Event append와 enqueue, 한 batch의 여러 ack 또는 여러 reschedule은 각각 같은 동기 transaction에 넣을 수 있습니다. 일부 항목만 바뀌면 transaction 전체를 되돌립니다. Hub가 없거나 전송만 실패한 경우 기존 event 원본은 유지하고 로컬 run을 계속합니다. `invalid_outbox_request`는 호출 계약 위반, `outbox_not_found`는 존재하지 않는 event 또는 배송 좌표, `outbox_lease_conflict`는 다른 worker의 lease나 만료된 lease 사용을 뜻합니다. 이 세 오류의 상세 문자열은 event에 복제하지 않습니다. Outbox 무결성이나 외래 키 검사가 실패하면 store를 열지 않고 `telemetry_recording_failed`로 처리합니다.

Ack된 outbox 행은 보존 정책의 기준 시각보다 오래된 항목만 제한된 개수로 삭제할 수 있습니다. 이 정리는 event와 hash chain을 삭제하지 않으며, pending 또는 leased 항목을 건드리지 않습니다.

### Outbound sync worker

Worker는 cycle마다 project registration을 먼저 검증합니다. 등록 transport 실패, peer 불일치 또는 좌표가 다른 응답에서는 outbox를 claim하지 않습니다. 등록 성공 뒤에는 구성된 destination에서 현재 `workerId`가 lease한 항목만 최대 100개 가져옵니다. Lease event는 seq로 정렬하고 이전 hash가 이어지는 구간별로 batch를 만듭니다. Gap 뒤 event도 별도 batch로 보낼 수 있지만 Hub cursor는 앞 구간이 채워질 때까지 전진하지 않습니다.

Transport port는 실제 TLS·서명 등으로 인증한 peer의 `destinationId`와 `peerIdentityHash`를 반환합니다. Worker는 body를 읽기 전에 두 좌표가 구성과 같은지 확인하고, registration 또는 ack schema와 요청 좌표를 다시 검증합니다. `EventSyncAcknowledgement`의 batch·registration·project·destination·event ID 전체, inserted/duplicate 개수가 맞아야 해당 batch lease를 한 transaction에서 ack합니다. Local `acknowledgedAt`은 Hub 응답 시각을 복사하지 않고 실제 local 전이 시각을 사용합니다.

Hub가 저장한 뒤 응답만 유실된 경우 worker는 저장 여부를 추정하지 않습니다. 아직 local ack하지 않은 lease를 `pending`으로 되돌리고 같은 canonical batch ID로 재전송합니다. Hub의 `duplicate` ack가 요청 전체와 맞으면 local ack할 수 있습니다. 앞 batch만 완료된 뒤 실패하면 완료된 ack는 유지하고 현재와 뒤 batch만 재예약합니다.

Cycle 상태는 `registration_deferred`, `idle`, `synchronized`, `retry_scheduled`입니다. 공통 count는 claim, local ack, reschedule과 local ack한 batch 개수를 뜻합니다. 등록 지연과 재시도 결과에는 `nextAttemptAt`이 필요합니다. Retry failure code는 `hub_unavailable`, `transport_authentication_failed`, `invalid_registration_response`, `invalid_sync_ack`, `local_batch_invalid`입니다. 호출 계약 오류 `invalid_worker_configuration`과 local transaction 오류 `outbox_update_failed`는 정상 cycle 결과로 낮추지 않습니다. Failure 상태에는 transport 예외·HTTP body·manifest·event payload·authorization·credential을 넣지 않습니다.

Worker는 `sync.acknowledged` event를 만들지 않습니다. 같은 outbound 원본 chain에 delivery ack event를 추가하면 그 event가 다시 배송 대상이 되는 순환이 생깁니다. 별도 local-only stream 또는 sync 제외 규칙이 생기기 전에는 outbox row가 local delivery receipt이고, 이번 worker는 새 event나 이해·사용 주장을 추가하지 않습니다.

### Hub sync durable receiver

Hub handler는 schema-valid registration 또는 batch의 복사본을 비동기 command port에 전달합니다. Port는 `(destinationId, projectId)` registration 또는 event batch를 durable하게 commit한 뒤에만 response 또는 acknowledgement로 resolve해야 합니다. 공개 계약에는 transaction callback과 전체 `ProjectSyncState` 읽기·쓰기가 없습니다. `sync-contract`의 전체 state reducer는 중복·역순·cursor 의미를 검증하는 참조 구현으로 남고 운영 adapter는 같은 결과를 증분 저장으로 만들 수 있습니다.

SQLite adapter의 `hub_projects`는 전체 registration request, 등록·갱신 시각과 cursor를 저장합니다. `hub_events`는 allowlist를 통과한 전체 event envelope와 중복 확인용 seq·ID·hash를 저장합니다. Event row는 update/delete할 수 없고 project row도 삭제할 수 없습니다. Manifest snapshot과 cursor 갱신, 새 event insert 및 파생 run/session index 갱신은 한 `BEGIN IMMEDIATE` transaction에 있으며 `WAL`, `synchronous=FULL`과 foreign key를 사용합니다. Registration은 저장한 head를 같은 transaction에서 다시 확인하고 batch는 unique 좌표·인접 hash·최종 ack 계약을 모두 확인하며, 하나라도 실패하면 rollback합니다.

Batch 수락은 최대 100개 event 각각의 seq·ID 좌표와 저장된 바로 앞뒤 hash만 읽습니다. Gap 뒤 event는 durable inbox에 남지만 cursor는 index query가 찾은 첫 gap 전까지만 전진합니다. 같은 batch 재전송은 저장된 event 원본 전체가 같을 때만 `duplicate`이고, cursor update 실패는 같은 transaction의 event insert도 되돌립니다. Store 개방과 `checkIntegrity`는 schema metadata, foreign key 강제 설정, append-only trigger와 transaction에서 유지한 global count만 확인합니다. SQLite quick check·foreign key 원본 검사와 project별 전체 event/cursor·파생 index 검증은 요청 경로 밖의 명시적 `auditIntegrity`가 담당합니다.

Store 오류 code는 `closed`, `nested_transaction`, `transaction_async`, `read_failed`, `integrity_failed`, `write_failed`입니다. `transaction_async`는 SQLite 내부 runner의 방어 오류이며 공개 callback 계약이 아닙니다. 어느 오류도 registration 완료나 durable ack로 낮추지 않습니다. DB와 오류에는 sync 계약의 manifest와 allowlist event만 허용하며 repository 본문, prompt, 문서·스킬 본문, command output, authorization과 credential을 추가하지 않습니다. 이번 receiver는 HTTP, Node 인증·권한과 새 telemetry event를 구현하지 않습니다.

### Hub trace read model

Trace reader는 저장 구현을 모르는 `HubTraceSource`를 사용합니다. Project 목록, project의 run 목록과 run event는 기본 50개, 최대 100개의 cursor page입니다. Source는 project summary와 해당 page를 한 read transaction에서 만들며 다른 connection의 중간 commit을 한 결과에 섞지 않습니다. Project/run count와 run/session 요약은 event 원본과 같은 commit에서 갱신하고 full audit로 다시 대조할 수 있는 파생 read index입니다. Project 목록은 destination·project·registration ID, project 이름, identity·manifest hash, 등록 시각, cursor, stored·continuous·buffered event count와 run count만 반환합니다. Event envelope와 payload, session ID는 project 목록에 넣지 않습니다.

Project 상세는 run을 첫 seq 순서로 묶고 첫 등장 순서의 session ID 최대 16개, 전체 session count와 truncation 여부, 첫·마지막 seq와 시각, 전체·continuous·buffered count를 반환합니다. Run 상세만 요청 page 안의 allowlist `EventEnvelope` 원본을 포함합니다. `seq <= cursor.seq`는 `continuous`, 그보다 큰 durable inbox event는 `buffered`입니다. Buffered event를 숨기거나 완료된 chain으로 표시하지 않으며 terminal event가 없거나 buffered라는 사실만으로 run 완료 여부를 추정하지 않습니다.

Project cursor는 destination·project ID, run cursor는 첫 seq·run ID, event cursor는 마지막 seq입니다. 잘못된 limit·cursor·좌표는 `invalid_query`, scope 밖 좌표는 `project_forbidden`, 원본 부재는 `project_not_found`와 `run_not_found`, source 불일치는 `source_inconsistent`, store read 실패는 `read_failed`입니다. Not found를 빈 원본으로 바꾸지 않고 inconsistent snapshot의 일부 결과도 반환하지 않습니다. `HubTraceSource`의 resolved query에는 `all` 또는 최대 256개 좌표의 `projects` scope가 필요합니다. Project-scoped reader는 scope 밖 상세를 source 호출 전에 거부하고 SQLite 목록 query는 scope를 SQL 조건으로 적용합니다. Projection은 저장 원본을 바꾸거나 별도 event를 만들지 않습니다. 결정은 [ADR-0038](./docs/adr/0038-bounded-async-hub-storage-and-trace.md)과 [ADR-0039](./docs/adr/0039-authenticated-project-scoped-trace-http.md)에 기록합니다.

명시적 지식 그래프도 같은 source와 scope 경계를 사용한다. `@lervo/knowledge-graph`는 allowlist event에 있는 ID와 project 상대 경로만 controlled node·relation으로 투영한다. 각 relation은 `schemaVersion`, 결정적 `relationId`, `projectId`, type, from/to node와 이를 증명하는 event ID·type·run ID·seq를 필수로 가진다. 같은 canonical 관계가 반복되면 가장 이른 seq를 증거로 유지하며 문서 `selected`, `loaded`, `injected` 관계를 합치거나 `used`를 추정하지 않는다.

SQLite 관계 테이블은 event와 같은 transaction에서 갱신하는 파생 인덱스다. Version 1 인덱스가 없으면 전체 event를 순서대로 읽어 한 transaction에서 다시 만들고, 명시적 전체 audit는 완전한 재투영 결과와 저장 관계를 대조한다. 관계 투영 실패는 event batch 전체를 rollback한다. Graph query는 하나의 focus node에 직접 닿는 관계를 relation ID 순서로 기본 50·최대 100개 반환한다. Cursor는 마지막 relation ID다. 관계가 없는 focus는 빈 page이고 focus 원본의 존재를 증명하지 않는다. 세부 결정은 [ADR-0052](./docs/adr/0052-rebuildable-explicit-knowledge-graph.md)에 기록한다.

### Hub trace read-only HTTP

HTTP adapter는 `GET /v1/trace/projects`, `GET /v1/trace/projects/<projectId>`, `GET /v1/trace/projects/<projectId>/runs/<runId>`와 `GET /v1/trace/projects/<projectId>/graph`를 제공합니다. 상세 route는 `destinationId`가 필수이고 공통으로 선택적인 `limit`과 종류별 `cursor`를 받습니다. Graph의 `focusKind`와 `focusId`는 함께 쓰거나 모두 생략해야 하며 생략하면 project node를 focus로 사용합니다. 중복·알 수 없는 query parameter, 잘못된 ID·limit·cursor와 body가 있는 GET은 query 전에 `invalid_request`로 거부합니다. Cursor는 version과 `project`·`run`·`event`·`graph` 종류를 가진 canonical JSON의 base64url 표현이며 인증 수단이 아닙니다.

`HubRequestAuthenticator`는 authorization 값에서 principal과 허용 project 좌표를 반환합니다. 첫 adapter는 시작 구성의 32~4096자 visible ASCII bearer token digest를 process memory에서 대조합니다. Token 원문, digest와 principal ID는 응답에 넣지 않습니다. 이는 구성값 일치만 뜻하며 사용자 federation, JWT, 조직 역할이나 Node peer 인증을 주장하지 않습니다. 인증 실패는 이유를 나누지 않는 `unauthorized` 401, scope 밖은 project 존재 여부와 무관한 `forbidden` 403입니다. 권한 확인 뒤의 실제 부재만 `project_not_found`·`run_not_found` 404이며 저장 오류와 내부 예외는 상세를 숨긴 `internal_error` 500입니다.

성공과 실패 JSON은 `schemaVersion: 1`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`를 사용합니다. 응답 기본 한도는 1 MiB, 구성 상한은 16 MiB이며 초과한 원본은 일부 전송하지 않고 `response_too_large`로 바꿉니다. 이 API는 read-only이고 새 event나 telemetry를 만들지 않으며 인증 성공을 context 이해·사용, 실행·sync 완료로 확대 해석하지 않습니다.

### Hub trace read-only web view

`GET /trace`는 project와 event가 없는 HTML shell이고 `/assets/`의 고정 JavaScript·CSS만 직접 제공합니다. Shell과 asset은 authenticator와 trace source를 호출하지 않습니다. 모든 web response는 no-store, same-origin resource policy, no-referrer, frame·MIME 차단과 same-origin script/style/connect만 허용하는 CSP를 사용합니다. Asset은 시작 시 고정 경로에서 각 256 KiB 이하인지 확인합니다. Query가 붙은 화면·asset과 body가 있는 GET은 400, 다른 method는 405입니다.

사용자가 입력한 bearer token은 현재 page의 변수에서만 API header를 만드는 데 사용합니다. 입력 element는 요청 전에 비우고 URL, fragment, HTML, local/session storage와 cookie에 저장하지 않습니다. Fetch는 same-origin `/v1/trace`만 호출하고 cookie credential과 redirect를 허용하지 않습니다. 연결 해제, 401과 page 종료 때 token 참조와 화면을 비웁니다. Public shell에는 principal, project scope, source와 credential이 없습니다.

Project, run과 event는 각각 20개짜리 현재 page 하나만 DOM에 표시합니다. 다음 page는 기존 목록을 교체하고 이전 이동용 cursor만 탭 메모리에 둡니다. Project page 변경은 run/event 선택을, run page 변경은 event 선택을 비웁니다. 이전 선택의 늦은 응답은 현재 pager와 다르면 반영하지 않으며 page 실패는 현재 cursor를 유지합니다. Event의 `continuous`는 `연속 이력`, `buffered`는 `연결 대기`로 문구와 색을 함께 표시합니다. Hub 문자열은 HTML이 아니라 text node로만 추가합니다. 결정은 [ADR-0040](./docs/adr/0040-bounded-trace-web-view.md)에 기록합니다.

관계 화면은 선택한 project 또는 run을 focus로 삼아 20개짜리 현재 relation page만 SVG와 접근 가능한 목록에 표시한다. 이웃 node를 선택하면 해당 node를 새 focus로 조회하고 다음·이전 page는 기존 node와 relation DOM을 교체한다. 관계의 ID와 경로는 text node로만 추가하며 문서·artifact 본문, content hash, prompt, provider 응답과 내부 추론은 API와 화면에 포함하지 않는다. 그래프 상태와 cursor도 탭 메모리에만 둔다. 결정은 [ADR-0052](./docs/adr/0052-rebuildable-explicit-knowledge-graph.md)에 기록한다.

CAS는 원문 bytes의 SHA-256으로 주소를 정합니다. 반환 형식은 `lervo-cas://sha256/<64 hex>`이며 원문은 `.lervo/state/cas` 아래에만 둡니다. 큰 입력은 청크를 임시 파일에 쓰는 동안 hash와 byte count를 계산합니다. 생산자가 중간에 실패하면 임시 파일을 제거하고 object를 공개하지 않습니다. 새 object는 쓰기와 동기화를 끝낸 뒤 원자적인 hard link로 확정합니다. 같은 bytes는 기존 object를 재사용하고, 저장하거나 읽을 때 주소와 실제 bytes의 hash를 비교합니다. 유효한 주소가 없으면 `not_found`, bytes가 주소와 다르면 `corrupt_object`, 경로가 안전하지 않으면 `unsafe_path`입니다. `has`는 `not_found`만 `false`로 바꾸며 변조를 숨기지 않습니다. 세 경우 모두 상위 실행에서는 `artifact_storage_failed`로 처리합니다. 이 실패가 난 artifact에 의존하는 변경은 중단하며, 원문이나 비밀 값은 실패 event에 넣지 않고 digest와 오류 code만 기록합니다.

## M0 직렬화 계약

현재 구현은 다음 계약을 JSON Schema Draft 2020-12와 동일 원본에서 파생된 TypeScript 타입으로 제공합니다.

- project manifest: stable project id, schema version, 생성 시각, 명시적 데이터 정책
- event envelope: 단조 증가 seq, actor/provider, 정책 version, previous/event hash
- project registration과 outbound sync: 전체 manifest identity, 연속 event batch, durable ack와 연속 cursor
- deliberation event payload: started/recorded/completed별 필수 hash 좌표와 상태별 decision/failure 규칙
- context evidence: E0~E4별 필수 필드와 controlled E3 receipt
- adapter message: descriptor, start/session, context envelope/receipt, normalized event, stop/result
- conversation adapter: integration identity hash, 세부 capability와 플랫폼 중립 target
- conversation inbound: hash-only source identity, actor·mention·thread·automation depth, 본문 artifact 좌표
- conversation participation: 역할별 scope·mode·actor·signal·cooldown·rate·depth policy와 `observe`/`respond` decision
- conversation outbound/delivery: `chat` writing permit에 결속된 reply artifact와 hash-only delivery receipt
- role profile: 요청 유형, 필수 입력 schema, E3 context policy, 전체 capability matrix, 산출물·검증·handoff 계약
- shared context publication: 등록 문서와 hash, 생산 역할/run/session, 접근 범위, 민감도, 근거와 만료
- handoff bundle: 보내고 받는 역할, 생산 context generation, 요청 digest, shared context와 evidence 좌표
- skill manifest: 출처·publisher·version/hash, 역할, provider/runtime/tool 호환성, capability, 입출력 schema, trust와 enabled scope
- document manifest/legacy registry: 상대 경로, 책임자, 연결 경로, 검증 revision/date, review interval, 사용자/managed block/Lervo 생성 파일 소유권과 분할 정책
- document migration candidate/artifact: source path/hash, importer ID/version, 형식·소유권 판정, 제안 sidecar 좌표, confidence와 warning, 분리 artifact hash
- document migration plan: read-only 상수, source/candidate/target snapshot, review/conflict 결과와 승인 전 상태
- document migration approval: approver 좌표, plan/candidate artifact hash와 candidate별 skip 또는 최종 manifest 결정
- document migration applied payload: 승인 digest, source/candidate artifact hash, 적용 전후 layout hash와 생성 sidecar hash
- document migration apply receipt: 생성 sidecar 상대 경로, 건너뛴 candidate와 성공 event payload
- legacy registry entry artifact: source registry hash, document ID와 축약하지 않은 기존 document record
- legacy registry structural plan/apply: 원본 보존·비활성화 처분, archive·manifest directory·sidecar target과 참조 문서 snapshot, 항목별 승인, hash-only 완료 event와 local receipt
- managed block patch candidate/artifact: source·기존 content·replacement·output hash, 원본/결과 byte range, review-only 처분과 byte 보존 검증 상수
- document staleness result: 문서별 검증·현재 revision, 검토 기한, 경로·managed input 신호, `current`/`stale`/`unknown` 상태와 기계용 사유
- verification suite/result: shell 없는 명령·인자·상대 cwd·실행 한도와 suite/repository snapshot에 결속된 명령별 상태·CAS output 좌표
- writing policy: 독자와 surface, 정보 순서, 문장·문단·용어·행동·근거 규칙, 필수 결정적/의미 검사
- writing evaluation: artifact/content hash, 검사자와 별도 의미 검사 단계, 검사별 상태, 전체 공개 가능 상태
- writing publication permit: 공개 surface, policy ID/hash, artifact ID/content hash와 evaluation ID/hash
- deliberation policy: 참여 역할별 책임/provider 규칙, 결정 책임자, 최대 회차, 필수 verification suite와 writing 공개 조건
- deliberation artifact: proposal/objection/revision/verification/decision의 CAS·role/session/context·writing permit와 종류별 증거 좌표
- deliberation outcome: 실제 artifact 이력에 결속된 `converged`, `no_consensus`, `failed` 종료 상태

E3 쓰기 게이트는 `selected`, 같은 hash의 `loaded`, 같은 context generation의 controlled `injected`가 모두 있어야 통과합니다. receipt 하나가 다른 단계를 대신할 수 없습니다. 구체적인 기본값은 [ADR-0001](./docs/adr/0001-m0-contracts-and-data-defaults.md)에 정의합니다.

Role의 `sensitive` 입력 필드는 입력값이 아니라 redaction 필요 여부만 선언합니다. Skill의 source URI, publisher/reviewer id와 document의 responsible party/path는 로컬 registry metadata이며 기본 event payload나 Hub 전송 대상이 아닙니다. Hub 동기화는 project policy에서 명시적으로 활성화하고 허용 필드를 정해야 합니다.

## 프로젝트 검증

Project verification은 provider가 작업 과정에서 보고한 `command.executed`와 별도입니다. Provider telemetry는 명령 실행을 관측했다는 뜻이고, 검증 통과는 프로젝트가 미리 정한 suite의 모든 명령을 현재 repository snapshot에서 실행했다는 뜻입니다.

Suite 원본은 `.lervo/verifications/<suiteId>.yaml`에 하나씩 둡니다. 파일마다 최대 32개 명령을 순서대로 선언하고 각 명령은 command ID, executable, arguments, 저장소 상대 cwd, timeout, stdout·stderr 합산 한도와 전달할 환경 변수 이름을 가집니다. 자식 process에는 실행 파일 탐색용 `PATH`/`Path`와 명시한 변수만 전달하고 값은 결과에 기록하지 않습니다. Shell 문자열은 지원하지 않습니다. `stopOnFailure=true`만 허용하며 첫 실패, timeout, output 한도 초과, 실행 오류 또는 취소 뒤의 명령은 실행하지 않고 `not_run`으로 기록합니다.

실행기는 시작 전에 저장소 root와 모든 cwd가 실제 디렉터리인지 확인하고 저장소 내부 symbolic link 우회를 거부합니다. 같은 snapshot port로 요청한 repository revision을 실행 직전 다시 확인하며 모든 명령 뒤에도 revision이 같아야 합니다. 시작 전 불일치는 명령을 실행하지 않고, 실행 중 변경은 output CAS가 남더라도 정상 result를 만들지 않습니다. 명령별 stdout와 stderr는 각각 local CAS에 저장한 뒤 다시 읽어 hash와 bytes를 확인합니다. `VerificationResult`에는 command text, argument, output과 환경 변수 값을 넣지 않고 command digest, exit code, 상태, 시간과 output artifact 좌표만 둡니다. 전체 결과는 suite ID/hash와 실행 대상 repository snapshot SHA-256에 묶고 canonical JSON으로 다시 CAS에 저장합니다.

전체 상태는 모든 명령이 exit code 0이면 `passed`, 명령 실패가 있으면 `failed`, 실행 전이나 중간에 취소되면 `cancelled`입니다. 의미 검증기는 suite hash, 명령 순서와 digest, 상태별 exit code·실패 사유, 시간 범위, artifact ID·URI와 result ID를 다시 계산합니다. 실패 결과의 최상위 상태만 `passed`로 바꾸거나 실행하지 않은 명령에 실행 증거를 붙이면 `result_contract_invalid`로 거부합니다.

`lervo run`은 요청한 suite를 provider 종료와 실행 후 snapshot 이후, `run.completed` 이전에 실행합니다. `verification.started`는 suite ID/hash와 repository revision을, `verification.completed`는 verification/suite ID, suite/repository/result hash, 상태, result artifact ID와 통과하지 못한 command ID만 기록합니다. Command text, arguments, output, 환경 변수와 절대 경로는 event에 넣지 않습니다. 완료 event의 artifact ID는 result content hash에서 다시 계산해 일치해야 합니다.

모든 suite가 통과하면 `run.completed.verificationStatus=passed`입니다. 필수 suite가 `failed`이면 `verification.completed` 뒤 `run.failed.failureCode=verification_failed`를 기록하며 `run.completed`는 만들지 않습니다. 취소는 `cancelled`로 끝납니다. 검증 port가 예외를 내거나 schema·suite·revision·canonical result CAS가 다르면 정상 완료 event 없이 `verification_failed`입니다. 내부 coordinator를 검증 suite 없이 호출하는 호환 경로만 `not_run`을 유지하며 공개 CLI는 이 경로를 허용하지 않습니다. Result artifact만 존재하는 상태는 run 완료, writing 공개, E4 또는 verified 지식을 뜻하지 않습니다. 상세 결정은 [ADR-0024](./docs/adr/0024-provider-neutral-project-verification.md)와 [ADR-0032](./docs/adr/0032-managed-run-project-verification.md)에 정의합니다.

## 사람 대상 writing 계약

사람이 읽는 산출물은 기계용 식별자와 설명 문장을 섞지 않습니다. 식별자는 원형을 보존하고, 본문은 목적이나 결론부터 시작합니다. 그 뒤에 이유, 결과와 영향, 다음 행동, 근거, 필요한 기술 세부사항을 산출물에 맞는 순서로 적습니다.

기본 한국어 정책은 완전한 문장과 이어지는 문단을 요구합니다. 한 문장에는 주요 사실 하나를 담고, 번역투와 명사 조각 나열을 피합니다. 내부 용어는 처음 나올 때 뜻을 설명하고, 추상적인 주체에게 확인이나 판단을 떠넘기는 표현 대신 대상과 행동을 직접 적습니다.

검증은 두 층으로 나뉩니다.

- 결정적 검사: 금지된 문장 부호, 추상적인 행동 주체, 빈 Markdown 섹션, 정책이 정한 모호한 용어를 검사합니다.
- 의미 검사: 한국어가 자연스러운지, 문단 맥락이 이어지는지, 독자가 이해할 말인지, 결과와 다음 행동이 구체적인지를 생성과 분리된 모델 또는 사람이 평가합니다.

결정적 검사는 자연스러움을 증명하지 않습니다. 의미 검사가 실행되지 않은 상태도 통과로 보지 않습니다. 정책 ID, artifact ID, content hash, locale가 평가 대상과 다르거나 필수 검사 하나라도 실패하면 `writing_verification_failed`로 공개를 막습니다. 평가 기록에는 원문을 복제하지 않고 hash, 상태, 위반 수와 evidence digest만 저장합니다.

`@lervo/writing`의 공개 판정 순서는 다음과 같습니다.

1. Provider 결과 CAS bytes를 다시 읽고 media type, artifact ID·URI, content hash, byte count와 손실 없는 UTF-8을 확인합니다.
2. 결정적 검사가 모두 통과한 경우에만 별도 `WritingSemanticEvaluator` port에 원문과 필수 의미 검사 요구를 전달합니다.
3. 의미 평가기가 없거나 호출 실패, 중복·누락 검사, 모순된 상태를 반환하면 의미 검사 결과를 `not_run`으로 만들고 공개를 차단합니다. 평가기 예외 원문은 기록하지 않습니다.
4. `WritingEvaluation`의 필수 검사 집합, 검사자 단계, 파생 전체 상태와 content-addressed evaluation ID를 검증하고 canonical JSON을 CAS에 저장한 뒤 다시 읽습니다.
5. 모든 검사가 통과했을 때만 surface, policy ID/hash, artifact ID/content hash와 evaluation ID/hash에 결속된 `WritingPublicationPermit`를 만듭니다.
6. 실제 원문을 읽는 경계는 permit, 현재 policy, 평가 JSON과 두 CAS artifact를 다시 검증합니다. 다른 surface·정책·평가·내용에는 permit를 재사용할 수 없습니다.

공개 판정 상태는 `allowed`와 `blocked`입니다. 의미 평가 시도 상태는 `completed`, `not_run`, `failed`, `invalid`로 따로 남겨 실행하지 않은 검사를 실패 응답과 혼용하지 않습니다. `blocked`는 `failure=writing_verification_failed`, `permit=null`, `content=null`, 누락·실패한 check ID와 좌표 불일치 여부를 가집니다. `allowed`만 원문과 permit를 가집니다.

평가 artifact에는 policy/artifact 좌표, 검사자 ID, 검사별 상태·위반 수·evidence digest와 시각만 저장합니다. 원문, prompt, provider payload와 의미 평가기의 오류 본문은 넣지 않습니다. 이번 단계는 새 event를 추가하지 않습니다. 따라서 평가 CAS나 permit가 존재해도 Hub 전송, shared context 발행, 다른 역할의 적재·주입 또는 E4를 뜻하지 않습니다. CLI는 이 공개 경계를 사용하지만 고정 `developer` Role의 `writingPolicy=null`은 그대로이므로, 생성 전에 정책 원문을 provider에게 주입했다고 주장하지 않습니다. 세부 결정은 [ADR-0025](./docs/adr/0025-writing-publication-gate.md)에 정의합니다.

## 스킬 해석과 사용 기록

실행 전 registry는 동일 id의 후보를 다음 순서로 해석합니다.

1. 프로젝트에서 고정한 버전
2. 프로젝트 로컬 스킬
3. 사용자 전역 스킬
4. 조직/외부 registry 스킬

정확한 우선순위는 정책으로 바꿀 수 있지만 결과는 lock과 `skill.resolved`에 기록됩니다. 호환성은 provider 이름만 보지 않고 필요한 도구, filesystem/network 권한, 입력/출력 schema, 최소 runtime version으로 판정합니다.

M4 첫 구현은 요청한 ID를 프로젝트 `.agents/skills`와 사용자 `~/.agents/skills`에서만 찾습니다. `pinned project`, `project`, `user` 순서로 고르고 같은 단계에서는 가장 높은 semantic version을 사용합니다. 같은 단계와 version의 hash가 충돌하면 선택하지 않습니다. Enabled scope, provider, Role, 최소 runtime version, platform, 알려진 도구와 Role이 `allow`한 capability를 모두 확인하며 알 수 없는 값이나 `require_approval`은 호환으로 올리지 않습니다. Input/output schema reference의 실제 조회는 invocation 구현 전까지 지원한다고 표시하지 않습니다.

패키지 content hash는 최상위 `lervo-skill.json`을 제외한 모든 일반 파일의 상대 경로, byte 수와 본문으로 계산합니다. 심볼릭 링크, 읽는 중 변경, 256개 파일 또는 16 MiB 초과는 `unsafe_skill_package`로 실행 전에 거부합니다. 원본 manifest와 본문은 수정하지 않습니다.

`.lervo/skills.lock`에는 실행 환경, 선택 항목, 탈락 항목과 사유 코드를 저장합니다. 기존 lock이 schema-invalid이거나 일반 파일이 아니면 덮어쓰지 않습니다. 같은 의미의 lock은 기존 생성 시각과 byte를 유지합니다. Lock은 해석 결과인 파생 상태이며 실행 증거가 아닙니다. 선택 항목의 `skill.resolved`는 `run.requested`, `run.resolved`와 같은 transaction에 기록되고 실패하면 provider를 시작하지 않습니다. Event에는 source kind만 넣고 URI, publisher/reviewer와 본문은 넣지 않습니다. 현재 스킬 호출 지점은 구현하지 않았으므로 `skill.invoked`와 `skill.completed`도 기록하지 않습니다.

기록 내용:

- 선택/탈락 후보와 이유
- source, version, content hash, trust status
- 부여된 capability와 승인
- 호출 시각, 입력의 비밀 제거 digest, 출력 artifact
- 성공/실패와 검증 결과

스킬의 프롬프트 전체나 비밀 입력을 Hub로 기본 전송하지 않습니다.

Discovery와 lock의 실패 코드는 `invalid_skill_request`, `invalid_skill_manifest`, `content_hash_mismatch`, `unsafe_skill_package`, `skill_not_found`, `no_compatible_skill`, `ambiguous_skill_selection`, `invalid_skill_lock`, `skill_lock_write_failed`, `unsupported_runtime_platform`입니다. 상세 오류나 event에는 절대 경로, 원문, publisher 정보와 비밀 입력을 복제하지 않습니다. 전체 결정은 [ADR-0016](./docs/adr/0016-local-skill-resolution-and-lock.md)에 기록합니다.

## 문서 생성과 노후화

### 기존 문서 도입과 migration

기존 저장소 문서는 managed block compiler보다 먼저 읽기 전용 import 절차를 거칩니다. Scanner는 사용자가 지정하거나 정책에 등록한 root만 탐색하고 source path, format, content hash, byte count를 확정합니다. 그 byte를 형식별 `DocumentImportAdapter`에 전달해 소유권, document ID, profile, 관계와 managed marker 후보를 얻습니다. Adapter는 원본 경로나 쓰기 port를 받지 않으며 탐색 결과의 신뢰도와 경고를 반드시 반환합니다.

`MigrationCandidate`의 필수 필드는 source path/format/hash, 탐지한 소유권, 제안 document ID/profile/relations, confidence와 warnings입니다. Candidate는 source 문서별 artifact로 저장하고 `MigrationPlan`은 candidate artifact ID/hash, 대상 sidecar 경로, 예상 대상 부재 또는 hash, 승인 상태와 생성 시각을 가집니다. 본문과 절대 경로는 event payload에 넣지 않습니다. 여러 후보를 하나의 계속 커지는 Markdown/YAML 문서에 append하지 않습니다.

기본 적용은 승인된 plan으로 새 sidecar를 만드는 metadata-only 작업입니다. Source byte와 위치, 사용자 front matter, 기존 marker는 유지합니다. Source hash나 target layout이 dry-run 이후 바뀌거나 ID·경로 소유권이 충돌하면 plan 전체를 `stale` 또는 `conflict`로 거부하고 일부만 적용하지 않습니다. 알 수 없는 형식과 낮은 신뢰도 후보는 `observed/review_required`로 남깁니다. 본문 이동·변환·marker 삽입은 별도 structural patch이며 명시적 승인과 byte 보존 검증 없이는 실행하지 않습니다.

Dry-run은 파일이나 event를 쓰지 않습니다. Scanner가 stable source bytes/hash를 소유하고 adapter ID/version, 형식 판정과 경고를 candidate artifact에 남깁니다. Plan은 source snapshot, candidate artifact hash와 sidecar target의 missing/file/unsafe snapshot을 결속하며 `writesAllowed=false`, `approvalStatus=not_requested`가 schema 상수입니다.

Metadata-only apply 승인은 모든 candidate를 중복 없이 다루고, 승인된 항목마다 사람이 검토한 최종 manifest를 포함합니다. Apply는 plan ID, candidate artifact canonical bytes, source·target과 현재 manifest 집합을 다시 검증합니다. Sidecar를 staging에서 동기화하고 transaction marker로 부분 layout의 loader 사용을 차단한 뒤 전체를 공개합니다. 공개 뒤 snapshot이 승인 내용과 같을 때만 필수 `document.migration.applied` recorder를 호출합니다. Recorder가 commit 없이 실패하면 생성 파일을 hash로 확인해 되돌립니다. Event commit 뒤 marker 제거 실패 또는 안전한 rollback 실패는 정상 receipt를 만들지 않습니다. 기존 단일 `documents.yaml`이 있는 layout은 sidecar와 혼용하지 않고 별도 structural migration 전까지 `migration_conflict`로 거부합니다. 세부 결정은 [ADR-0018](./docs/adr/0018-existing-document-adoption.md)에 정의합니다.

Legacy registry structural dry-run은 기존 `documents.yaml` bytes와 각 `DocumentRecord`를 서로 다른 증거로 보존합니다. Registry 원본은 source hash 기반 archive target 하나에 대응하고, record는 document별 canonical JSON artifact가 됩니다. Plan은 `archive_then_remove` 처분, archive와 manifest directory snapshot, 모든 sidecar target, 참조 문서의 path/hash 또는 missing/unsafe 상태를 결속합니다. 기존 sidecar layout, archive bytes, 중복 document path, 비정규 legacy path와 안전하게 snapshot할 수 없는 참조 문서는 conflict입니다. Missing 참조 문서와 parser로 확인하지 않은 managed/generated ownership은 review warning입니다. Dry-run은 쓰기와 event를 만들지 않으며 현재 source bytes가 migration되었다고 주장하지 않습니다.

Structural 승인은 plan의 모든 entry artifact를 정확히 한 번 다룹니다. `approve_sidecar`는 원래 `DocumentRecord`를 그대로 가진 최종 manifest를 요구하고 `skip`은 기계용 제외 사유를 요구합니다. Apply는 승인 시각과 plan·artifact hash, registry·참조 문서·archive·모든 target snapshot을 다시 검증합니다. Archive와 sidecar는 staging에서 먼저 동기화하고, `.lervo/.document-migration.lock`으로 loader를 닫은 뒤 sidecar directory 공개와 legacy 원본 비활성화를 수행합니다. 공개 snapshot이 승인과 같을 때만 hash-only `document.migration.applied`를 기록합니다. Event 이전 어느 단계든 실패하면 legacy bytes를 복원하고 이번 apply가 만든 archive·sidecar를 제거합니다. Rollback 대상이 외부에서 바뀌어 안전성을 확인할 수 없으면 marker를 남기고 `rollback_failed`, event 뒤 정리가 실패하면 `migration_finalization_failed`로 끝냅니다. 두 경우 모두 정상 receipt를 반환하지 않습니다.

Lervo는 문서를 세 유형으로 다룹니다.

- `canonical`: 사람이 검토하는 원본
- `generated`: canonical policy에서 생성되는 provider 호환 문서/블록
- `observed`: Lervo가 소유하지 않지만 수명주기를 점검하는 기존 문서

`AGENTS.md`를 공통 canonical 진입점으로 쓰고 `CLAUDE.md`에는 해당 지침을 연결하는 얇은 호환 블록을 둘 수 있습니다. 프로젝트가 반대 방향을 선택해도 manifest에 명시하면 됩니다.

새 문서 metadata는 `.lervo/documents/<documentId>.yaml` sidecar에 저장하고 Markdown 본문에는 front matter를 강제하지 않습니다. 이력은 `separate_documents`, 분할은 `topic_documents`만 허용합니다. 사용자 문서는 Lervo가 수정하지 않고 32 KiB부터 분할을 권고합니다. Managed block은 표준 begin/end marker와 8 KiB 한도를 사용하며 넘으면 새 문서와 링크로 나눕니다. Lervo 전용 문서는 64 KiB와 최상위 section 12개가 한도입니다. Markdown parser는 CommonMark HTML comment만 marker로 인정하고 code 안의 예시는 제외합니다. 성공할 때만 UTF-8 byte 단위 block/사용자 범위를 반환하며 중첩·중복·불완전·혼합 marker에서는 `invalid`로 닫힙니다. 이전 제품 marker는 migration 입력으로만 읽고 새 출력에 사용하지 않습니다. MDX는 아직 구조를 확정하지 않습니다.

Managed block patch candidate는 source path/hash/byte count, parser version, 표준 block ID와 원본 content range/hash, replacement hash/크기, 전체 output hash/크기/range를 결속합니다. 생성기는 target content range만 교체한 뒤 결과를 다시 parse하고 block topology, 모든 marker bytes, 대상 앞뒤 bytes와 replacement 일치를 확인합니다. Candidate는 `review_required`, `writesAllowed=false`이며 원문과 replacement는 JSON이나 event에 넣지 않습니다. 전체 결과 bytes는 별도 로컬 검토 payload로 반환합니다. 생성 단계는 파일·CAS·event를 쓰지 않고 승인이나 적용을 주장하지 않습니다. 상세 계약은 [ADR-0017](./docs/adr/0017-sharded-document-manifests.md), [ADR-0018](./docs/adr/0018-existing-document-adoption.md), [ADR-0021](./docs/adr/0021-commonmark-managed-block-parser.md)과 [ADR-0022](./docs/adr/0022-byte-preserving-managed-block-patch-candidate.md)에 정의합니다.

노후화 판정 신호:

- `verifiedRevision` 이후 연결된 `paths` 변경
- `reviewIntervalDays` 초과
- 문서가 언급한 명령/파일/스킬/정책 target 부재
- managed block의 입력 hash 불일치
- 실행 실패나 반복 질문으로 드러난 지침 누락

현재 stale detector는 앞의 신호 중 repository snapshot으로 증명할 수 있는 문서 경로·연결 경로 변경, 검토 주기와 manifest에 고정된 managed/generated input hash를 계산합니다. 입력은 `DocumentManifest`, 판정 시각, 현재 snapshot, 선택적인 검증 revision snapshot과 managed input 관측입니다. 현재 revision이 manifest의 `verifiedRevision`과 다를 때 일치하는 검증 snapshot이 없으면 경로 신호를 `unknown`으로 남깁니다. 연결 범위가 두 snapshot 모두에서 비어 있거나 필요한 input 관측이 없을 때도 `current`로 올리지 않습니다. 전체 상태는 stale 근거가 하나라도 있으면 `stale`, stale 없이 불확실한 신호가 있으면 `unknown`, 나머지만 `current`입니다.

`DocumentStalenessResult`는 document/result ID, 판정 시각, 검증·현재 revision, 전체 상태, 검토 기한과 신호별 상태, 변경·부재·미관측 경로/source ID, 기계용 사유를 갖는 문서별 파생 artifact 계약입니다. Result ID는 나머지 결과의 canonical hash로 결정합니다. 판정기는 원본 문서, manifest, CAS와 event를 쓰지 않고 patch·승인·검증 완료를 주장하지 않습니다. 상대 경로와 source ID는 로컬 진단 정보이며 문서 본문, 입력 원문, 절대 경로와 비밀정보는 결과에 넣지 않습니다. 상세 결정은 [ADR-0023](./docs/adr/0023-evidence-based-document-staleness.md)에 정의합니다.

자동 수정은 patch/candidate로 생성하고, managed block 이외의 변경에는 사용자 또는 정책상 승인된 reviewer가 필요합니다.

## 검색 baseline과 실패 관측

`@lervo/search`의 `lexical-v1`은 provider·파일 시스템·Hub를 모르는 결정적 검색기입니다. Source는 controlled kind, source ID, content hash, 선택적인 저장소 상대 경로와 검색 중에만 쓰는 title·label·text를 가집니다. 첫 `@lervo/search-local` 조합은 document registry에 등록된 Markdown만 읽고 NFKC Unicode term, field별 고정 정수 가중치와 source ID tie-break로 매 요청의 메모리 index를 다시 만듭니다. Index ID는 engine version, 정렬된 source ID·path·content hash와 title·label·text 투영 digest에 결속됩니다.

로컬 corpus는 최대 4,096개 문서, 문서당 128 KiB, 전체 16 MiB입니다. Query는 최대 500자·32개 term이고 결과는 최대 50개입니다. 등록 원본 하나라도 missing, unsafe, 동시 변경, invalid UTF-8, empty 또는 크기 초과이면 일부 문서만으로 검색하지 않습니다. 결과에는 source 좌표·hash, rank·score와 일치 field만 있고 본문은 없습니다. Search hit는 추천 후보이며 context `selected`, `loaded`, `injected`, `used`와 검증된 지식이 아닙니다.

`SearchAttempt`는 project ID, 관측 시각·nonce, 실제 engine·index ID, nullable 선택 전이 ID, raw query 대신 digest·문자 수·term 수, 요청 limit, result-set hash와 path 없는 bounded hit 좌표를 갖습니다. 후보 engine attempt에는 선택 전이 ID가 필수이며, 전이가 없는 기본 baseline은 null이고 rollback으로 선택된 baseline은 해당 전이 ID를 가집니다. 이 ID는 어떤 선택에서 응답이 나왔는지를 증명할 뿐 모델이 결과를 이해하거나 사용했다는 뜻이 아닙니다. `SearchAssessment`는 같은 project와 attempt에 결속된 사람 또는 독립 verification의 명시적 판정입니다. `accepted`는 실제 반환된 source 종류·ID 좌표가 하나 이상 필요하고 `failed`는 `no_results`, `expected_source_missing`, `low_rank`, `results_not_relevant`, `insufficient_context` 중 하나를 필수로 가집니다. 실제 결과가 있으면 `no_results`를 쓸 수 없습니다. 선택·기대 원본은 종류와 ID를 함께 저장해 서로 다른 원본 종류의 같은 ID를 혼동하지 않습니다. 결과 수, 클릭이나 모델 자체 판단으로 assessment를 만들지 않습니다.

Attempt와 assessment는 `.lervo/state/search/attempts/<attemptId>.json`, `.lervo/state/search/assessments/<attemptId>.json`의 독립된 mode `0600` 원본입니다. 같은 ID를 덮어쓰거나 한 파일에 append하지 않습니다. Report는 최대 10,000개 원본의 ID·hash·project·시간·결과 관계를 모두 다시 확인하고 전체·평가·미평가·수락·실패 및 사유별 수를 반환합니다. 상태는 `insufficient_assessment`, `no_failures_observed`, `failures_observed`이고 임베딩 판단은 항상 `not_determined`입니다.

신규 `SearchSelectionQualityReport` v2는 같은 검증 결과를 attempt의 nullable 선택 전이 ID별로 다시 나눕니다. 전이 없는 lexical 시도는 `implicit_baseline`, 후보 activation·refresh는 `candidate`, baseline을 선택한 rollback은 `recorded_baseline`입니다. 로컬 조합은 최대 256개 선택 chain을 정책·review·comparison 원본과 함께 검증하고 candidate build ID를 v2 review에서 다시 찾습니다. Legacy v1 review의 후보는 `legacy_unbound`, 신규 v2는 `bound`, baseline은 `not_applicable`로 구분합니다. Attempt와 assessment에는 build ID나 verification receipt를 새로 넣지 않습니다. 선택 전이가 없거나 engine이 다르거나 chain 원본을 검증할 수 없으면 일부 slice를 반환하지 않고 report 전체를 실패시킵니다.

각 slice는 전체·평가·미평가·수락·실패와 controlled 실패 사유를 독립적으로 집계합니다. 미평가 시도는 수락이나 실패로 추정하지 않고, `no_failures_observed`도 rollout 성공을 뜻하지 않습니다. Report의 `rolloutDecision`, `rollbackDecision`, `embeddingDecision`은 표본 수와 결과에 관계없이 모두 `not_determined`입니다. Report는 파생 조회이며 선택 전이·정책·문서·attempt·assessment를 수정하거나 자동 rollback을 만들지 않습니다. Query·digest·문서 path·본문·prompt·provider 응답·credential은 출력 slice에 추가하지 않습니다. 새 event와 Hub sync는 없습니다. 결정은 [ADR-0053](./docs/adr/0053-deterministic-lexical-search-observations.md)과 [ADR-0064](./docs/adr/0064-selection-bound-operational-search-quality.md)에 기록합니다.

`lervo search rollout review <selection-transition-id> --decision <keep|rollback|more-assessments> --reviewer <reviewer-id> [--policy <policy-id>]`는 현재 선택 head가 같은 build-bound 후보이고 해당 전이 attempt가 하나 이상 있을 때만 사람 검토 원본을 만듭니다. `keep`, `rollback`, `more-assessments`는 각각 `keep_candidate`, `rollback_recommended`, `more_assessments_required`로 기록합니다. 전체 선택 chain·정책·후보 review·comparison과 attempt·assessment 관계를 먼저 검증하며 과거 전이, baseline, legacy-unbound 후보와 시각 뒤 원본에서는 fail-closed합니다.

`SearchRolloutQualitySnapshot`은 검토 시점의 대상 attempt·assessment ID를 각각 정렬한 목록의 canonical hash, 관측 종료 시각, 전체·평가·미평가·수락·실패와 실패 사유별 수를 내용 기반 ID에 묶습니다. ID 목록 자체와 query 좌표는 복제하지 않습니다. `SearchRolloutReview`는 이 snapshot, project, 선택 전이, candidate·engine·adapter build·후보 review, reviewer·시각과 명시적 판단을 별도 내용 기반 ID에 묶습니다. 정책 없는 v1은 `thresholdPolicyState=not_defined`, 정책에 결속된 v2는 `thresholdPolicyState=bound`이며 둘 다 `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`, `embeddingDecision=not_determined`를 유지합니다.

원본은 `.lervo/state/search/rollout-reviews/<rolloutReviewId>.json`에 최대 256개를 항목별 mode `0600` immutable 파일로 저장합니다. 이후 품질 원본이 추가돼도 기존 파일을 수정하지 않습니다. Raw query·digest, nonce, index·result-set hash, source 좌표·본문, prompt, provider 응답, credential과 verification receipt는 저장하지 않고 새 event와 Hub sync도 만들지 않습니다. 계약·snapshot 불일치는 `invalid_rollout_review`, 현재 후보·attempt·build 자격 부족은 `rollout_review_not_eligible`, 저장 실패는 기존 `observation_*`로 전체 작업을 실패시킵니다. 결정은 [ADR-0065](./docs/adr/0065-human-search-rollout-review.md)에 기록합니다.

`lervo search rollout policy create`는 허용 reviewer·candidate, 후보 유지의 최소 평가·최대 실패 수와 롤백 권고의 최소 평가·최소 실패 수를 `SearchRolloutReviewPolicy`에 고정합니다. 작성자는 허용 reviewer여야 하고 유지 최대 실패 수는 롤백 최소 실패 수보다 작아야 합니다. 정책은 검토보다 먼저 만들어져야 하며 `.lervo/search-rollout-policies/<policyId>.yaml`에 최대 64 KiB, 전체 최대 32개, mode `0600` 불변 파일로 저장합니다.

정책을 명시한 검토는 exact policy ID, project, reviewer, candidate와 사람이 고른 판단의 수치 기준을 파일 게시 전에 확인합니다. 미충족이면 `rollout_review_not_eligible`로 실패하며 판단을 바꾸거나 검토 파일을 만들지 않습니다. 기존 v1은 `legacy_unbound`, 다른 정책에 결속된 v2는 `different_policy`입니다. `lervo search rollout policy check <rollout-review-id> --policy <policy-id>`는 저장된 snapshot의 정책 충족 여부만 반환하고 이후 품질 입력 변경은 계산하지 않습니다. 결과의 `decisionSelection=not_performed`, `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`는 고정입니다.

정책에는 project·reviewer·candidate·author ID, 기준과 시각만 허용합니다. Query·digest, 문서 좌표·본문, provider 결과, credential과 receipt는 넣지 않고 event나 Hub 원본을 만들지 않습니다. 정책 계약 오류는 `invalid_rollout_policy`, 로컬 형식·없음·읽기·쓰기는 `rollout_policy_invalid`, `rollout_policy_not_found`, `rollout_policy_read_failed`, `rollout_policy_write_failed`입니다. 판정 사유와 소급 금지 규칙은 [ADR-0067](./docs/adr/0067-policy-bound-search-rollout-review.md)에 기록합니다.

`lervo search rollout action policy create`는 exact 검토 정책, `keep` 또는 `rollback` 한 조치와 허용 operator를 별도 `SearchRolloutActionPolicy`로 만듭니다. Rollback 조치만 exact engine policy가 필수이며 action operator는 그 정책의 허용 범위를 넓힐 수 없습니다. 정책은 `.lervo/search-rollout-action-policies/<actionPolicyId>.yaml`에 최대 64 KiB, 전체 최대 32개, mode `0600` 불변 파일로 둡니다.

`lervo search rollout action apply <rollout-review-id> --action <keep|rollback> --policy <action-policy-id> --operator <operator-id>`는 명시한 검토만 사용합니다. 검토가 정책에 결속된 v2이고 판단 기준을 충족하는지, action policy·operator·판단 종류가 맞는지, 검토 대상 전이가 현재 head인지, 조치 시각의 quality input digest가 검토 snapshot과 같은지를 모두 다시 확인합니다. `more_assessments_required`, 과거 선택, 변경된 입력과 허용되지 않은 operator는 `rollout_action_not_eligible`로 실패합니다.

`keep`은 `.lervo/state/search/rollout-acknowledgements/<acknowledgementId>.json`에 최대 256개의 항목별 mode `0600` 원본을 만들고 `acknowledgement_recorded`만 주장합니다. 선택 변경·rollback·approval은 각각 `not_applied`, `not_executed`, `not_granted`입니다. `rollback`은 별도 receipt를 만들지 않고 action·review policy, rollout review와 조치 시각의 snapshot·input digest를 schema v3 engine rollback 전이에 함께 넣어 previous-head CAS로 한 번만 게시합니다.

운영 resolver는 schema v3를 읽을 때 엔진·조치·검토 정책과 review, candidate review, 검토·조치 시각의 attempt·assessment를 다시 확인합니다. 근거가 없거나 snapshot·digest가 다르면 `engine_selection_unavailable`이며 baseline으로 대체하지 않습니다. 조치 정책 계약·acknowledgement 계약은 `invalid_rollout_action_policy`, `invalid_rollout_action`, 로컬 정책 형식·없음·읽기·쓰기는 `rollout_action_policy_invalid`, `rollout_action_policy_not_found`, `rollout_action_policy_read_failed`, `rollout_action_policy_write_failed`입니다. 원본에는 ID·digest·로컬 operator·시각만 두고 query·문서 좌표·provider 결과·credential을 넣거나 event·Hub sync를 만들지 않습니다. 결정은 [ADR-0068](./docs/adr/0068-explicit-search-rollout-actions.md)에 기록합니다.

`lervo search rollout action status [--limit <1-50>] [--cursor <action-id>]`는 keep acknowledgement와 schema v3 rollback을 조치 시각·ID 역순으로 함께 조회합니다. 기본 limit은 20, 최대는 50이며 cursor는 현재 페이지 마지막 acknowledgement ID 또는 rollback activation ID입니다. 일반 schema v1·v2 rollback은 action policy에 결속된 조치가 아니므로 목록에 넣지 않습니다.

조회기는 pagination 전에 최대 256개 acknowledgement와 최대 256개 선택 전이 전체를 검증합니다. Keep은 action·review policy, rollout review, candidate review, 조치 당시의 선택 head와 attempt·assessment snapshot을 다시 만들고 acknowledgement의 snapshot ID·input digest와 대조합니다. Schema v3 rollback은 선택 chain 검증 과정에서 같은 원본을 다시 확인합니다. 한 항목이라도 없거나 변조되면 요청 page 밖의 항목이어도 전체 조회를 실패시키며 일부 목록을 반환하지 않습니다.

각 항목의 `reviewSelectionRelation`은 검토 대상이 현재 선택인지 과거 선택인지, `actionTransitionRelation`은 rollback 전이가 현재 선택인지 과거 선택인지를 나타냅니다. Keep에는 별도 전이가 없으므로 `not_applicable`입니다. 조회 시각에 다시 만든 품질 입력 digest가 조치 당시 digest와 같으면 `unchanged`, 다르면 `changed`입니다. 응답의 `actionSelection=not_performed`, `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`는 이 조회 자체가 아무 조치도 실행하지 않았다는 뜻입니다.

입력·limit·cursor·조합 관계 오류는 `invalid_rollout_action_status`이고 원본 실패는 기존 정책·검토·선택·관측 오류로 전체 page를 닫습니다. 응답에는 로컬 operator·reviewer ID와 품질 집계가 포함될 수 있지만 query·digest, nonce, index·result-set hash, 문서 좌표·본문, prompt, provider 결과, credential과 receipt는 포함하지 않습니다. 파일·event·Hub 원본을 만들지 않습니다. 결정은 [ADR-0069](./docs/adr/0069-bounded-search-rollout-action-status.md)에 기록합니다.

`lervo search rollout action check <rollout-review-id> --action <keep|rollback> --policy <action-policy-id> --operator <operator-id>`는 명시한 조합의 현재 실행 가능 조건을 쓰기 없이 점검합니다. Action policy와 exact review·engine policy 원본을 재생성해 결속을 확인하고, 검토 시각의 품질 원본과 조회 시각의 현재 snapshot을 다시 만듭니다. 최신 검토·정책·조치를 대신 고르지 않습니다.

`failureReasons`는 `requested_action_mismatch`, `action_policy_not_active`, `review_not_active`, `review_policy_not_bound`, `review_policy_mismatch`, `review_decision_mismatch`, `review_policy_not_eligible`, `operator_not_allowed`, `engine_operator_not_allowed`, `selection_not_current`, `quality_input_changed`만 허용하며 이 순서로 반환합니다. 하나라도 있으면 `ineligible`, 없으면 `eligible`입니다. Rollback이 eligible이면 실제 적용과 같은 읽기 전용 준비 경계가 현재 engine policy, previous head와 fallback 후보 원본·현재 adapter build 재현까지 확인합니다.

`eligible`은 `checkedAt` 시점의 설명이며 승인, 예약이나 실행 보장이 아닙니다. 실제 `apply`는 current head와 품질 입력을 다시 확인하고 previous-head CAS를 사용합니다. 점검 결과는 `actionSelection=not_performed`, `acknowledgement=not_recorded`, `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`를 유지하며 파일·event·Hub 원본을 만들지 않습니다.

점검 입력 계약 오류는 `invalid_rollout_action_preflight`입니다. 정책·검토·선택·품질·후보 재현 원본이 없거나 변조된 경우에는 `ineligible`로 숨기지 않고 기존 구체 오류로 전체 점검을 실패시킵니다. 응답은 로컬 operator와 정책·검토·선택 ID를 포함하지만 query·digest, snapshot·attempt·assessment ID, nonce, 문서 좌표·본문, provider 결과, credential과 receipt는 포함하지 않습니다. 결정은 [ADR-0070](./docs/adr/0070-read-only-search-rollout-action-preflight.md)에 기록합니다.

`lervo search rollout status [--limit <1-50>] [--cursor <rollout-review-id>]`는 현재 선택과 저장된 rollout 검토를 검토 시각·ID 역순으로 조회합니다. 기본 limit은 20, 최대는 50이며 다음 cursor는 현재 페이지 마지막 review ID입니다. Cursor가 현재 검증된 원본에 없으면 다른 위치로 추정하지 않고 실패합니다. 전체 검토 원본은 기존 최대 256개 경계 안에서만 읽습니다.

각 검토는 선택 chain의 전이·candidate·engine·adapter build·후보 review와 project를 다시 확인합니다. 정책에 결속된 v2는 정책 원본의 존재와 project 좌표도 확인하지만 기준 충족 여부는 상태 조회에서 다시 계산하지 않습니다. 검토 시각 이하의 대상 attempt·assessment로 기존 검토를 재생성하고, 조회 시각 이하의 전체 대상 입력으로 현재 품질 snapshot을 파생합니다. `qualityInputState`는 시각 때문에 달라질 수 있는 snapshot ID가 아니라 입력 ID 목록의 canonical digest가 같으면 `unchanged`, 다르면 `changed`입니다. 현재 전이와 같으면 `current_selection`, rollback·refresh 등으로 head가 바뀌었으면 `historical_selection`으로 표시합니다.

상태 응답은 `reviewDecisionSelection=not_performed`, `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`를 유지합니다. 조회는 최신 검토를 선택하거나 정책 eligibility·새 판단을 계산하지 않습니다. Reviewer ID와 digest를 포함하므로 로컬 CLI에서만 반환하며 raw query·nonce, index·result-set hash, source 좌표·본문, prompt, provider 응답, credential과 receipt는 포함하지 않습니다. 파일·event·Hub 원본을 만들지 않습니다. 형식·limit·cursor 관계는 `invalid_rollout_status`, 원본 관계 실패는 기존 `observation_invalid`·`invalid_rollout_review`로 전체 페이지를 닫습니다. 결정은 [ADR-0066](./docs/adr/0066-bounded-search-rollout-review-status.md)에 기록합니다.

## 검색 추천과 managed context 연결

`SearchRecommendationBatch`는 검증된 `SearchAttempt`, 추천 한도와 `top_ranked-v1` 정책을 하나의 content-bound ID로 묶습니다. 첫 정책은 document hit만 최대 5개 추천하고 순위가 앞선 최대 3개를 선택합니다. 각 추천은 attempt·engine·index·result-set, document ID·검색 당시 content hash·rank·score에 결속됩니다. Skill과 verified knowledge는 해당 원본의 E2 loader 계약이 생기기 전까지 제외합니다. Batch를 다시 검증할 때 추천 순서나 선택 ID가 하나라도 달라지면 전체를 거부합니다.

Context preparation은 최대 8개 batch·전체 50개 추천을 별도 입력으로 받습니다. 모든 추천에 `state=recommended` evidence를 만들고, policy의 `selectedRecommendationIds`에 있는 항목만 `reasonCode=search_recommendation`, `ruleId=search_recommendation:<recommendationId>` E1으로 만듭니다. 선택되지 않은 추천은 plan의 필수 문서가 아니며 E2·E3를 만들지 않습니다. 선택된 문서의 현재 bytes가 검색 당시 content hash와 다르면 다른 선택 이유가 함께 있어도 부분 context를 반환하지 않습니다.

Managed `lervo run`은 provider 시작 전에 작업 문장을 NFKC 문자·숫자 단어 최대 32개·500자로 투영해 등록 문서를 검색하고 attempt를 mode `0600` 로컬 원본에 기록합니다. 검색 가능한 작업 단어가 없을 때만 예상 경로를 보조 질의로 사용합니다. Attempt query digest와 크기는 전체 작업 원문이 아니라 이 bounded 투영을 뜻합니다. 결과가 없으면 빈 attempt를 남긴 채 기존 지침·path·role 선택으로 계속합니다. 실행 결과에는 assessment에 쓸 attempt ID, 추천·선택 수와 선택된 document ID를 표시합니다. 자동 선택, E2/E3, provider 실행과 검증 성공은 검색 품질의 `accepted` assessment가 아니며 기존 명시적 `lervo search assess`만 품질 집계에 들어갑니다.

새 `context.recommended` event의 필수 payload는 recommendation·batch·source attempt ID, engine ID/version, nullable 선택 전이 ID, index ID, result-set hash, document ID·source content hash, rank·score, selection policy ID/version·maximum입니다. Raw query와 digest, document path·title·label·본문, prompt, provider 응답과 credential은 허용하지 않습니다. Search attempt 파일은 Hub sync 대상이 아니지만 `context.recommended`는 managed run의 append-only 실행 원본이므로 Hub가 활성화된 프로젝트에서 다른 allowlist event와 같은 sync 경계를 따릅니다. 이 event는 `context.selected`, `document.loaded`, `context.injected` 또는 `used`를 뜻하지 않습니다. 결정은 [ADR-0054](./docs/adr/0054-search-recommendation-managed-context-boundary.md)와 [ADR-0061](./docs/adr/0061-fail-closed-operational-search-engine-resolution.md)에 기록합니다.

## 검토된 검색 평가 케이스와 반복 측정

`lervo search case`는 이미 저장된 attempt와 하나의 사람 또는 독립 verification assessment를 다시 검증한 뒤에만 재사용 케이스를 만듭니다. Query는 digest·문자 수·term 수가 attempt와 모두 같아야 합니다. CLI는 standalone query를 먼저 대조하고, 다르면 같은 managed 작업 투영을 한 번 대조합니다. 기대 원본은 assessment의 `expectedSources`, 그것이 없으면 수락된 `selectedSources`에서만 가져옵니다. 실패 assessment에 기대 원본이 없으면 결과 수나 모델 판단으로 정답을 만들지 않고 거부합니다.

`SearchEvaluationCase`는 project·query 좌표, `any` 또는 `all`, 원본 attempt의 요청 한도를 넘지 않는 허용 최대 순위, 기대 source 종류·ID, 원본 attempt·assessment ID와 평가자·수락/실패·controlled 사유, 기준 index·result-set과 당시 기대 source 순위를 content-bound case ID로 묶습니다. `.lervo/search-evaluations/<caseId>.yaml`에 최대 256개를 케이스별 mode `0600` 파일로 보존합니다. 이 YAML은 반복 검색에 필요한 검토 query 원문을 의도적으로 가지므로 사용자가 비밀정보가 없는지 확인하고 저장소 공개 범위를 정해야 합니다. 자동 생성 event, telemetry 또는 Hub payload에는 복제하지 않습니다.

`lervo search evaluate`는 등록된 Markdown corpus를 한 번 완전하게 읽고 현재 `lexical-v1` index에서 각 케이스를 최대 50개 결과로 실행합니다. Result는 path 없는 bounded hit 좌표와 result-set hash, 기대 source별 현재 rank, `passed`/`failed`, `no_results`·`expected_source_missing`·`low_rank`, 검토 시점 기준 대비 `improved`·`unchanged`·`regressed`를 기록합니다. Run은 같은 evaluated 시각·project·index에 속한 최대 256개 case/result ID와 통과·실패·개선·회귀 수만 집계합니다. 결과는 `.lervo/state/search/evaluation-results/<resultId>.json`, 실행은 `evaluation-runs/<runId>.json`에 각각 immutable mode `0600` 파일로 저장하고 query를 넣지 않습니다. Result를 먼저 게시하고 마지막에 run을 게시하므로 저장 실패 시 고아 result가 남을 수 있지만 완성된 run으로 보이지 않습니다.

케이스·결과·run은 ID, canonical hash, project·시각·engine·index, 정렬 순서와 집계를 다시 계산합니다. 케이스 하나라도 unsafe·변조·다른 project이면 corpus를 평가하거나 일부 run을 게시하지 않습니다. 현재 실행이 실패를 관측해도 `embeddingDecision=not_determined`를 유지하며 다른 검색 엔진, context 선택, `selected`·`loaded`·`injected`·`used`, verification 통과와 임베딩 필요성을 만들지 않습니다. 이번 단계에는 새 event와 Hub sync가 없습니다. 결정은 [ADR-0055](./docs/adr/0055-reviewed-search-evaluation-cases.md)에 기록합니다.

## 검색 평가 묶음과 표본 충분성

`SearchEvaluationBundle`은 하나의 project와 `roleId`·`taskType` 범위, 최소 활성 표본 1~64개, 정렬된 활성 case ID와 최대 192개의 대체 관계를 묶습니다. 같은 project에서 같은 역할·작업 유형의 묶음은 하나만 허용하며 전체 묶음은 최대 32개입니다. 대체된 case는 활성 목록에 함께 둘 수 없고, 모든 대체 경로는 순환 없이 현재 활성 case로 끝나야 합니다. 활성 case의 query digest가 같으면 같은 표본을 늘려 센 것으로 보고 전체 묶음을 거부합니다.

원본은 `.lervo/search-evaluations/<bundleId>.bundle.yaml`에 묶음별로 둡니다. `lervo search bundle create`는 기존 파일을 자동 덮어쓰지 않으며 CLI가 새로 게시한 파일은 mode `0600`입니다. 케이스와 묶음은 같은 디렉터리를 쓰지만 파일명 계약으로 구분하고, 알 수 없는 파일·심볼릭 링크·읽는 중 변경·project 불일치·같은 범위의 중복 묶음이 하나라도 있으면 일부만 읽지 않습니다. 묶음을 고칠 때에는 하나의 긴 이력 파일에 내용을 덧붙이지 않고 작은 YAML을 version control에서 명시적으로 교체합니다.

`SearchEvaluationCoverage`는 묶음 원본과 현재 케이스에서 매번 만드는 query 없는 파생 결과입니다. 활성 표본 수가 최소값 이상이면 `sampleState=sufficient`, `comparisonReadiness=ready`이고 부족하면 `sampleState=insufficient`, `comparisonReadiness=insufficient_sample`입니다. `lervo search bundle report`는 부족한 묶음을 정상적으로 표시하되 종료 코드 1을 반환합니다. `lervo search evaluate --bundle <id>`는 그 묶음의 활성 케이스만 현재 `lexical-v1`으로 실행합니다. 표본이 부족해도 현재 상태를 관측할 result와 run은 보존하지만 종료 코드 1을 반환하며, 후보 엔진 비교는 아직 실행하지 않습니다.

핵심 오류 `invalid_evaluation_bundle`은 묶음 좌표·hash·정렬·참조·대체 관계·표본 중복이 유효하지 않다는 뜻이고 `invalid_evaluation_coverage`는 파생 ID·집계·상태가 원본과 다르다는 뜻입니다. 로컬 오류 `evaluation_bundle_invalid`, `evaluation_bundle_limit_exceeded`, `evaluation_bundle_read_failed`, `evaluation_bundle_write_failed`는 각각 파일 계약 위반, 개수 상한, 안전한 읽기 실패, immutable 게시 실패를 뜻합니다. 표본 부족은 파일 오류가 아니며 검색 실패, 임베딩 필요 또는 품질 판정으로 승격하지 않습니다. 묶음과 coverage에는 query·문서 본문·path·prompt·provider 응답·credential을 넣지 않고 `embeddingDecision=not_determined`를 유지합니다. 새 event와 Hub sync는 없습니다. 결정은 [ADR-0056](./docs/adr/0056-search-evaluation-sample-bundles.md)에 기록합니다.

## 공급자 중립 검색 후보 비교

`SearchEnginePort`는 64자 이하의 안정된 engine ID, 양의 정수 version, content-bound `adapterBuildId`와 `buildIndex(sources)`를 제공하고 평가와 운영 조합이 같은 공급자 중립 계약을 사용합니다. Build ID는 adapter release manifest가 소유하며 실행 동작이나 의존성이 달라지면 새 ID를 게시해야 합니다. Lervo는 이 선언만으로 module bytes나 공급망 동일성을 주장하지 않습니다. 만들어진 index는 같은 engine 좌표와 content-bound `sidx_` ID를 가지며 `search(query, 50)` 응답도 그 좌표를 유지해야 합니다. 공통 평가 실행기는 1~256개 케이스에 같은 평가 시각과 50위 조건을 적용하고 응답의 query digest·크기, index·engine과 결과 hash를 케이스별로 다시 확인합니다. 후보 결과는 정책에 결속된 선택 전이 없이 운영 attempt로 만들 수 없습니다.

로컬 비교 조합은 먼저 케이스·묶음·coverage를 읽습니다. `comparisonReadiness`가 `ready`가 아니면 corpus를 읽거나 후보 `buildIndex`를 호출하지 않고 `evaluation_comparison_not_ready`로 종료합니다. 준비된 경우 등록 Markdown corpus를 한 번 읽어 현재 `lexical-v1`과 후보 port에 같은 source 입력을 공급합니다. 후보에게 같은 입력을 제공했다는 port 호출은 증명하지만 후보 내부에서 실제로 어떻게 사용했는지는 추정하지 않습니다. Candidate가 baseline과 같은 engine 좌표를 쓰거나 index·응답 계약을 어기거나 실행에 실패하면 `evaluation_candidate_failed`이며 비교 원본을 만들지 않습니다.

신규 `SearchEvaluationComparison` v2는 bundle·coverage, 실제 corpus에서 다시 계산한 digest, 같은 시각의 baseline·candidate engine/index/run, candidate adapter build ID와 case별 result ID를 결속합니다. 기존 v1 비교는 content ID를 고치지 않고 읽지만 새 review나 활성화의 build 증거로 승격하지 않습니다. 같은 case에서 baseline 실패·candidate 통과면 `candidate_win`, 반대면 `baseline_win`, 둘의 통과 여부가 같으면 `tie`입니다. Score 크기, 같은 통과 안의 순위 차이와 서로 다른 실패 사유는 엔진 간 공통 척도로 가정하지 않습니다. 집계 상태는 `candidate_better_observed`, `baseline_better_observed`, `mixed`, `no_difference_observed`이고 어느 상태도 채택 결정이 아닙니다. `candidateDecision`과 `embeddingDecision`은 모두 `not_determined`입니다.

두 엔진의 result·run은 기존 immutable 디렉터리에 먼저 게시하고 비교는 `.lervo/state/search/evaluation-comparisons/<comparisonId>.json`에 마지막으로 게시합니다. 저장 실패로 result나 run만 남으면 완료된 비교가 아닙니다. 비교 원본에는 query·문서 본문·path·prompt·provider 응답·credential을 넣지 않습니다. `invalid_evaluation_engine`은 engine·index·응답 좌표 위반, `invalid_evaluation_comparison`은 corpus·bundle·coverage·실행·집계 불일치입니다. 새 event와 Hub sync는 없고 실제 후보 adapter와 CLI 명령도 이번 범위에 포함하지 않습니다. 결정은 [ADR-0057](./docs/adr/0057-provider-neutral-search-candidate-comparison.md)에 기록합니다.

## 결정적 `bm25f-v1` 후보와 명시적 등록

`prepareSearchCorpus`는 baseline과 후보가 공유하는 최대 4,096개 source·각 131,072자·전체 16 MiB 문자 상한, source·path·label·본문 안전성, 중복 좌표 거부, source 좌표 정렬과 검색 projection digest를 소유합니다. 현재 `lexical-v1` index ID 계산은 기존 source identity 구조를 유지하므로 이 추출만으로 engine version이나 과거 index 의미를 바꾸지 않습니다.

`verifySearchEvaluationEngineContract`는 adapter가 선언한 engine 좌표, 원본 입력 비변경, 역순 corpus의 같은 index ID, 같은 query의 반복 응답, query 좌표·50위 한도·rank·정수 score·matched field·source tie-break·result-set hash를 검사합니다. 검사는 query digest만 report하고 query를 원본으로 저장하지 않습니다. Adapter가 이 공통 계약을 통과해도 검색 품질이 좋거나 운영 채택 조건을 통과했다는 뜻은 아닙니다.

`@lervo/search-adapter-bm25f`의 `bm25f-v1`은 title 12, path 8, label 10, text 2의 field 가중 term 빈도에 문서 길이 정규화와 빈도 포화를 적용합니다. Term 희귀도는 `(전체 문서 수 + 1) / (해당 term 문서 수 + 1)`을 1,000,000배 한 고정 정수로 계산합니다. 최종 score도 양의 안전한 정수이며 같은 score는 source 종류·ID로 정렬합니다. 이 방식은 외부 서비스·전문 검색 DB·임베딩을 사용하지 않으며 표준 BM25 구현과 동일하다고 주장하지 않습니다.

`SearchEvaluationEngineRegistry`는 최대 16개의 명시적 `{candidateId, engine}`만 받고 후보 ID, engine ID·version, adapter build ID 중복과 현재 `lexical-v1` 등록을 거부합니다. 현재 CLI 조합은 `bm25f-v1` 하나만 코드 allowlist에 둡니다. `lervo search candidates`는 이 공개 좌표와 build ID를 반환하고 `lervo search compare <bundleId> --candidate bm25f-v1`가 기존 준비 gate와 로컬 비교 조합을 실행합니다. 등록되지 않은 값은 project 원본을 읽기 전에 `evaluation_candidate_not_registered`로 거부하며 경로·package·URL을 해석하거나 동적 코드를 로드하지 않습니다.

CLI JSON은 comparison과 두 run만 반환하고 result의 query digest 외에 query 원문을 추가하지 않습니다. Text 출력도 case별 query·문서 path·score를 표시하지 않습니다. 비교 완료는 종료 코드 0이지만 `candidate_better_observed`도 채택 성공이 아닙니다. 이 비교 단계만으로 운영 attempt·managed context를 바꾸지 않으며 `candidateDecision=not_determined`, `embeddingDecision=not_determined`를 유지합니다. 새 event와 Hub sync는 없습니다. 결정은 [ADR-0058](./docs/adr/0058-deterministic-bm25f-search-candidate.md)에 기록합니다.

## 재현 검증을 거치는 검색 후보 검토

`lervo search review <comparisonId> --decision <adopt|reject|more-samples> --reviewer <reviewerId>`는 저장된 비교를 운영 전환과 분리해 검토합니다. CLI는 비교에 기록된 engine 좌표를 정적 allowlist에서 해석합니다. 경로·package·URL과 동적 코드는 받지 않습니다.

검토기는 먼저 지정한 comparison ID와 content-bound 내용을 확인합니다. 이어서 현재 case·bundle·coverage·등록 문서 corpus, baseline과 candidate run, run이 참조한 모든 result를 읽어 같은 project·bundle hash·coverage·corpus digest·case·평가 시각·engine·index·집계인지 다시 계산합니다. 원본 하나라도 없거나 현재 bundle·corpus가 비교 시점과 달라졌으면 검토를 만들지 않습니다.

비교가 유효하면 현재 registry의 adapter build ID가 비교 v2와 같은지 먼저 확인하고, 현재 등록 후보를 비교 당시 corpus·활성 case·평가 시각으로 한 번 재실행합니다. ID가 없거나 다르면 후보를 호출하지 않고 `evaluation_candidate_build_mismatch`로 중단합니다. 재실행 run ID가 기존 candidate run ID와 정확히 같아야 `candidateReplay=matched`입니다. 단순히 engine ID가 같거나 실행이 성공했다는 이유로 재현되었다고 표시하지 않습니다. 후보 승리가 하나 이상이고 baseline 승리가 0인 비교만 `adopt_candidate`를 허용하며, `reject_candidate`와 `more_samples_required`는 관측 결과와 별개의 사람 결정으로 남길 수 있습니다.

신규 `SearchCandidateReview` v2는 comparison·bundle·coverage·corpus, candidate ID·engine·adapter build ID·원본 run과 replay run, reviewer·시각·결정, 전체 case와 승·패·동률, 확인 상태를 content-bound ID로 묶습니다. 기존 v1 검토는 원본 ID를 바꾸지 않고 읽고 이미 기록된 legacy 선택 검증에만 사용하며 새 활성화·refresh에는 v2가 필요합니다. 결과는 `.lervo/state/search/evaluation-reviews/<reviewId>.json`에 mode `0600` 항목별 immutable 파일로 저장합니다. 같은 비교의 후속 검토도 기존 파일에 덧붙이거나 덮어쓰지 않습니다. Reviewer ID는 이 로컬 원본에만 두며 query·문서 본문·path·prompt·provider 응답·credential은 넣지 않습니다.

`eligible_for_activation_review`는 다음 운영 활성화 검토에 올릴 수 있다는 뜻일 뿐 활성화가 아닙니다. 모든 검토는 `activationState=not_applied`, `embeddingDecision=not_determined`를 유지하며 검토만으로 운영 attempt·managed context를 바꾸지 않습니다. 새 event와 Hub sync는 없습니다. `evaluation_comparison_not_found`는 안전하게 읽을 지정 비교가 없다는 뜻이고, `invalid_candidate_review`는 검토 좌표·합계·재현 실행·content ID가 다르다는 뜻입니다. `candidate_review_not_eligible`은 후보 승리가 없거나 baseline 회귀가 있어 채택 검토 조건을 충족하지 못했다는 뜻입니다. `evaluation_candidate_build_mismatch`는 비교·검토와 현재 registry의 build ID가 없거나 다르므로 후보를 호출하지 않았다는 뜻입니다. 후보 등록·실행 실패는 기존 `evaluation_candidate_not_registered`, `evaluation_candidate_failed` 의미를 따릅니다. 결정은 [ADR-0059](./docs/adr/0059-replayed-search-candidate-review.md)와 [ADR-0063](./docs/adr/0063-search-adapter-build-identity-and-replay-receipt.md)에 기록합니다.

## 정책에 결속된 검색 엔진 선택과 rollback

`lervo search engine policy create`는 project, 허용 reviewer·operator·candidate, 최소 후보 승리 1~64개와 baseline 승리 허용값 0을 content-bound 정책으로 만듭니다. 작성자는 허용 operator에 포함되어야 합니다. 후보는 CLI 정적 allowlist에 등록된 ID만 받을 수 있습니다. 정책은 `.lervo/search-engine-policies/<policyId>.yaml`에 mode `0600` 파일로 하나씩 저장하며 최대 32개입니다. 이 디렉터리는 project 설정 원본이므로 Git 검토 대상입니다. Reviewer·operator ID도 파일에 남으므로 credential이나 개인 비밀값을 ID로 쓰지 않고 저장소 공개 범위에 맞는 식별자를 사용해야 합니다.

`lervo search engine activate <reviewId> --policy <policyId> --operator <operatorId>`는 정책과 검토 원본만 보고 선택을 만들지 않습니다. 현재 bundle·coverage·case·corpus, comparison의 두 run·result와 v2 adapter build ID를 다시 확인하고 정적 registry의 후보를 비교 당시 시각·입력으로 재실행합니다. 같은 review ID가 다시 만들어져야 하며, review가 `adopt_candidate`, 허용 reviewer·candidate, 최소 후보 승리와 baseline 무회귀를 모두 만족해야 합니다. Operator도 정책 allowlist에 있어야 합니다.

`SearchEngineActivation`은 연속 sequence, 이전 activation, 이전·새 선택, policy·operator·시각과 rollback 좌표를 content-bound ID로 묶습니다. V2 전이는 다음 rollback에 사용할 `fallbackSelection`과 그 activation 좌표를 명시해 action별 nullable 필드 추론을 줄입니다. Rollout 조치가 아닌 활성화·refresh·rollback은 v2이고, 검토에 결속된 rollback만 같은 fallback 계약에 rollout 근거를 더한 v3입니다. 후보 선택은 review·comparison 좌표를 포함하고 baseline 선택에는 이 좌표를 넣지 않습니다. Reader는 기존 `applicationState=not_connected` v1과 직전 `recordState=selection_recorded` v1을 ID나 파일을 고치지 않고 읽습니다. 첫 전이는 `.lervo/state/search/engine-selections/baseline.json`, 다음 전이는 `<previousActivationId>.json`에 게시합니다. 파일명이 이전 head를 열쇠로 사용하므로 같은 head에서 동시에 다른 전이를 게시하면 하나만 성공합니다. 최대 256개 전이를 읽어 단일 chain인지 모두 확인하며 한 파일에 이력을 누적하지 않습니다.

`lervo search engine refresh <reviewId> --policy <policyId> --operator <operatorId>`는 현재 선택이 후보일 때만 사용할 수 있습니다. 새 review와 comparison을 현재 corpus에서 다시 재현하고 정책을 확인한 뒤, 같은 candidate ID와 engine에 새 증거 좌표를 연결하는 `refresh_candidate` 전이를 만듭니다. 다른 후보로 바꾸거나 같은 review·comparison을 반복하는 요청은 거부합니다. 일반 `activate_candidate`도 현재와 같은 후보의 새 증거를 받지 않으며 명시적인 refresh를 요구합니다. Refresh 전이의 fallback은 baseline과 null activation 좌표로 고정합니다. 갱신 실패는 현재 선택을 고치거나 baseline으로 자동 전환하지 않습니다.

`lervo search engine rollback`은 현재 전이에 명시된 `fallbackSelection`과 `fallbackActivationId`로 돌아가는 새 전이를 만듭니다. 대상이 이전 후보면 그 후보의 review·comparison과 현재 corpus를 다시 확인하고 replay도 다시 맞춰야 합니다. 대상이 baseline이면 후보 원본을 요구하지 않습니다. 따라서 refresh 뒤에는 갱신 전의 오래된 후보 증거를 다시 실행하지 않고 baseline으로 복구합니다. 정책이 허용하지 않는 operator나 후보로는 rollback하지 않습니다. 기존 정책·검토·비교·전이 파일을 수정하거나 삭제하지 않습니다.

`engine activate`와 `engine refresh`는 선택 전이를 기록한다는 뜻이며 검색이 실제 실행됐다는 뜻이 아닙니다. 모든 전이는 `recordState=selection_recorded`, `embeddingDecision=not_determined`만 보존합니다. Query·문서 본문·path·prompt·provider 응답·credential은 정책과 전이에 넣지 않습니다. Operator ID는 gitignore 대상 로컬 전이에만 있고 새 event와 Hub sync는 없습니다.

`invalid_engine_activation_policy`는 정책 ID·허용 목록·작성자·시각·한도가 유효하지 않다는 뜻입니다. `engine_policy_not_found`, `engine_policy_invalid`, `engine_policy_read_failed`, `engine_policy_write_failed`는 각각 정책 부재, 파일 계약 위반, 안전한 읽기 실패, immutable 게시 실패입니다. `candidate_review_not_found`는 지정한 검토 원본이 없다는 뜻입니다. `engine_activation_not_eligible`은 reviewer·operator·candidate·표본 기준·재현, 현재 선택 또는 refresh 대상이 정책과 맞지 않는다는 뜻이고 `invalid_engine_activation`은 전이·refresh·rollback·chain 좌표가 잘못됐다는 뜻입니다. `engine_activation_conflict`는 같은 이전 head에서 다른 전이가 먼저 게시됐다는 뜻이며 새 head를 읽어 다시 검토해야 합니다. `engine_activation_not_found`는 rollback할 현재 선택이나 refresh할 현재 후보가 없다는 뜻입니다. 결정은 [ADR-0060](./docs/adr/0060-policy-bound-search-engine-selection.md)과 [ADR-0062](./docs/adr/0062-selected-search-candidate-evidence-refresh.md)에 기록합니다.

## 검증된 운영 검색 엔진 resolver

일반 `lervo search`, managed context 준비와 `engine status`는 `@lervo/search-local`의 같은 resolver·inspection 경계를 사용합니다. 선택 전이가 없으면 현재 등록 corpus로 `lexical-v1` index를 만듭니다. 전이가 있으면 최대 256개 chain을 순서대로 읽고 schema version별 구조·hash·연결 관계와 저장된 정책·review·comparison을 확인합니다. 현재 생성 함수를 과거 전이에 다시 적용하지 않습니다. 현재 선택이 후보면 좁은 candidate resolver port로 engine을 해석하고 v2 원본의 adapter build ID를 현재 registry와 먼저 맞춘 뒤 현재 corpus와 review replay를 다시 검증합니다. Build가 다르면 `buildIndex`를 호출하지 않습니다. Replay에 사용한 index가 비교에 기록된 candidate index ID와 같을 때 그 동일 인스턴스를 운영 검색에 사용합니다. 후보가 등록되지 않았거나 정책·원본·adapter build·현재 corpus·replay·index 중 하나라도 다르면 baseline으로 낮추지 않습니다.

현재 선택이 baseline인 rollback 전이는 과거 후보의 현재 replay를 요구하지 않습니다. 따라서 후보 adapter나 현재 corpus가 달라져 후보를 쓸 수 없어도 명시적 rollback 뒤에는 현재 corpus의 baseline으로 복구할 수 있습니다. Evaluation 실행과 candidate comparison의 baseline은 운영 선택을 읽지 않고 계속 `lexical-v1`을 사용합니다.

Resolver가 반환한 engine·index 응답은 공통 `SearchResponse` 계약으로 다시 검증합니다. v2 후보 replay가 맞으면 project·candidate·engine·adapter build·comparison·review·corpus·run·index 좌표에서 content-bound `SearchCandidateVerificationReceipt`를 매번 다시 만듭니다. Receipt는 별도 파일·event·Hub 원본으로 저장하지 않으며 같은 원본에서 같은 ID로 재생성됩니다. 일반 검색 결과와 `engine status`에는 nullable receipt ID를 표시하지만, 이는 resolver replay 검증 좌표일 뿐 검색 실행, 결과의 `selected`, `loaded`, `injected`, `used`나 품질을 뜻하지 않습니다. 일반 검색과 managed context attempt는 실제 engine과 선택 전이 ID를 기록하고 recommendation과 `context.recommended`가 같은 nullable ID를 이어받습니다. 전이가 없는 baseline은 null, rollback으로 선택된 baseline은 rollback 전이 ID입니다. `engine status`는 기록된 선택을 `resolverState`와 분리해 반환합니다. `ready`는 선택 chain과 현재 index 검증 완료, `unavailable`은 controlled `failureCode`와 함께 현재 소비 불가를 뜻합니다.

과거 `context.recommended` event에는 선택 전이 ID가 없습니다. Event reader와 sync validator는 이 payload를 그대로 허용하며 null을 삽입하거나 event hash를 다시 계산하지 않습니다. 신규 managed recommendation evidence는 `selectionTransitionId`를 필수로 만들고 writer가 그대로 event에 복제합니다. 이 하위 호환 경계는 legacy event를 신규 telemetry로 위장하지 않습니다.

`engine_selection_unavailable`은 전이가 있는 선택의 정책·chain·review·comparison·registry·현재 corpus·replay·index·응답을 안전하게 검증하거나 실행하지 못했다는 뜻입니다. 일반 검색은 attempt를 만들지 않고 managed context는 recommendation·context event와 provider 시작 전에 중단합니다. 전이가 없는 baseline의 corpus 읽기 오류는 기존 `corpus_read_failed`를 유지합니다. 오류와 attempt·recommendation·event에는 raw query, 문서 path·본문, prompt, provider 응답과 credential을 추가하지 않습니다. 결정은 [ADR-0061](./docs/adr/0061-fail-closed-operational-search-engine-resolution.md)에 기록합니다.

## 지식 승격 규칙

지식 candidate는 최소한 다음을 포함합니다.

- 주장 또는 결정
- 생성한 run과 evidence links
- 영향을 받는 paths
- 검증 방법과 revision
- 유효 기간 또는 review interval
- 중복/충돌 후보

에이전트의 한 번의 진술만으로 verified가 되지 않습니다. 코드/테스트로 결정적으로 확인되거나 정해진 reviewer/evaluation을 통과해야 합니다.

현재 `@lervo/knowledge`의 숙의 기반 candidate는 채택 claim 하나마다 별도 JSON 원본을 만듭니다. 필수 좌표는 candidate/project ID, 현재 claim ID/digest, converged outcome과 decision artifact/content CAS, 영향 path, 실제 완료·decision·verification event ID, verification artifact/result ID·hash와 하나의 repository revision, review interval, 충돌 candidate ID와 생성 시각입니다. 전체 숙의 history와 verification 근거를 다시 검증하고 decision CAS bytes를 확인한 뒤 candidate canonical JSON을 CAS에 저장하고 다시 읽습니다. `no_consensus`, `failed`, 서로 다른 verification revision, 누락된 path/event/CAS 원본은 후보를 만들지 않습니다.

`knowledge.candidate.created`의 필수 payload는 `candidateId`, `claimDigest`, `paths`, `evidenceIds`, `sourceOutcomeId`, `decisionArtifactId`, `verificationArtifactIds`, `verifiedRevision`, `candidateArtifactId`, `candidateContentHash`입니다. Candidate 원문, claim/decision 본문, prompt, provider 응답, tool input과 credential은 event allowlist에 없습니다. Candidate artifact ID는 content hash에서 다시 계산하며 불일치 payload는 `invalid_payload`로 event 전체를 거부합니다. Candidate CAS 저장 뒤 event transaction이 실패하면 CAS object는 주소 기반 고아로 남을 수 있지만 생성 완료를 반환하지 않습니다.

`KnowledgePromotionPolicy`는 허용된 사람 reviewer ID와 충돌 해소 요구를 정하며, version은 version 필드를 뺀 canonical policy snapshot의 hash여야 합니다. `KnowledgeReviewApproval`은 candidate ID·hash, `approved` 또는 `rejected`, reviewer, 당시 policy snapshot, 검토 revision, 해소한 conflict candidate ID와 검토 시각을 가진 별도 CAS 원본입니다. Candidate CAS·생성 event·evidence event·decision CAS를 다시 확인하고 정책상 허용된 reviewer만 review 원본을 만들 수 있습니다. 검토 revision은 candidate의 검증 revision과 같아야 합니다.

`knowledge.candidate.reviewed`의 필수 payload는 `candidateId`, `candidateContentHash`, `approvalId`, `approvalArtifactId`, `approvalContentHash`, `decision`, `policyId`, `policyVersion`, `repositoryRevision`, `resolvedConflictCandidateIds`입니다. Reviewer ID와 검토 원문은 event에 넣지 않습니다. 거절된 review는 reviewed 원본이지만 verified 근거가 아닙니다.

Verified 승격은 승인 결정, 현재 정책, candidate·approval·현재 snapshot의 같은 revision, 충돌 해소와 모든 영향 path 존재를 다시 확인합니다. `VerifiedKnowledge`는 candidate와 approval CAS 좌표, claim, path별 기준 content hash, evidence event, verified revision, review interval과 verified 시각을 가진 항목별 CAS 원본입니다. `knowledge.verified`의 필수 payload는 `knowledgeId`, candidate/approval ID·hash, `claimDigest`, `paths`, `verifiedRevision`, knowledge artifact ID·hash입니다. Reviewer, claim/decision 본문과 파일 내용은 event에 넣지 않습니다.

지식 stale 판정은 verified path의 기준 hash와 현재 전체 repository snapshot을 비교하고 review due 시각을 계산합니다. 전체 revision이 달라도 연결 path가 같으면 current입니다. 연결 path 변경·부재 또는 review interval 만료가 있으면 stale입니다. 결과의 상태, review/path 신호와 `review_interval_elapsed`, `linked_path_changed`, `linked_path_missing` 사유는 서로 일치해야 합니다. Current 결과는 event로 누적하지 않습니다. Stale 결과만 별도 CAS에 저장하고 `knowledge.stale.detected`에 knowledge/result ID, 검증·현재 revision, 사유, 변경·부재 path와 result artifact ID·hash를 기록합니다.

`lervo trace [last|run-id]`는 SQLite hash chain을 확인한 뒤 해당 run의 allowlist event만 순서대로 텍스트 또는 JSON으로 반환합니다. Trace JSON은 `schemaVersion=1`, project/run ID, `completed|failed|incomplete` 상태, 전체 저장소 integrity snapshot, 처음·마지막 시각, session ID와 event 배열을 필수로 가집니다. Reader는 event schema·payload allowlist·canonical hash, 동일 project/run, 증가하는 전역 seq와 연속 seq의 hash link, 파생 상태·시각·session을 확인합니다. 선택된 run 사이에 다른 run event가 생략될 수 있으므로 report 조각만으로 전체 chain을 재검증했다고 주장하지 않으며, 전체 chain 통과는 producer의 integrity snapshot입니다.

Trace report와 integrity의 새 선택 필드는 v1 reader가 허용하지만 event envelope는 자체 schema 계약을 그대로 따릅니다. 기존 필드 삭제·필수 필드 추가·타입 또는 status 의미 변경은 새 report version이 필요합니다. 미지원 정수 버전은 `trace_report_schema_unsupported`, 구조·hash·allowlist·집계 불일치는 `trace_report_invalid`로 거부하며 오류에 입력 JSON이나 payload를 복사하지 않습니다. 결정은 [ADR-0076](./docs/adr/0076-versioned-trace-report-contract.md)에 기록합니다. `lervo doctor`는 project storage와 event chain을 열고 candidate, review, verified와 stale CAS schema/hash/ID 및 각 event 연결을 읽기 전용으로 역검증합니다. 이어서 문서 registry와 등록 원본, 프로젝트·사용자 스킬 package와 실행별 lock, Codex와 Claude 실행 파일, 검색 엔진 선택·rollout 정책·검토·조치를 서로 다른 항목으로 검사합니다.

검색 진단 ID는 `search_engine_selection`, `search_rollout_policies`, `search_rollout_reviews`, `search_rollout_actions`입니다. 선택은 운영 resolver와 같은 전체 chain 검증을 사용하고, 정책은 engine·rollout review·action policy의 project 좌표와 결속을 확인합니다. 검토와 조치는 기존 bounded 상태 조회기의 전체 원본 검증을 사용합니다. 정상적으로 비어 있는 범위는 관측 수 0의 `healthy`입니다.

선택이나 정책이 `unhealthy`이면 검토는 `search_rollout_review_unavailable`의 `unknown`이고 조치도 `search_rollout_action_unavailable`의 `unknown`입니다. 검토가 `unhealthy`이면 조치는 `unknown`입니다. 직접 확인한 선택·정책·검토·조치 손상은 각각 `search_engine_selection_invalid`, `search_rollout_policy_invalid`, `search_rollout_review_invalid`, `search_rollout_action_invalid`의 `unhealthy`입니다. 진단은 상태 조회·사전 점검·승인·조치 실행을 대신하지 않고 검색 파일, event와 Hub 원본을 만들지 않습니다.

각 검사는 `healthy`, `unhealthy`, `unknown` 중 하나입니다. 계약을 끝까지 확인한 항목만 `healthy`이고, 손상·누락·stale 원본을 직접 확인하면 `unhealthy`입니다. 선행 원본이나 실행 환경이 없거나 안전한 probe가 끝나지 않으면 `unknown`입니다. 전체 판정은 `unhealthy`, `unknown`, `healthy` 순서로 우선하며 모든 항목이 `healthy`일 때만 종료 코드 0입니다.

`lervo doctor [--scope <all|knowledge|documents|skills|providers|search>]`의 기본 범위는 `all`입니다. 제한 범위는 전체 실행 뒤 결과를 필터링하지 않고 다음 검사만 실행합니다. `knowledge`는 event chain·candidate·review·verified·staleness, `documents`는 registry·source, `skills`는 package·lock, `providers`는 Codex·Claude runtime, `search`는 engine selection·rollout policy·review·action입니다.

`knowledge`는 project storage와 CAS만 열고 환경 검사 application service를 호출하지 않습니다. 다른 제한 범위는 project manifest만 먼저 확인하고 event store와 CAS를 열지 않습니다. Documents는 등록 문서, skills는 프로젝트·사용자 스킬과 lock, providers는 두 version probe, search는 검색 정책·상태와 등록 corpus만 추가로 읽습니다. 검색 corpus 검증에 필요한 등록 문서 읽기는 검색 검사 내부 계약이며 documents check를 결과에 추가하지 않습니다. Scope별 허용 검사 ID가 누락·중복되거나 다른 범위 결과가 섞이면 report를 만들지 않습니다.

`DoctorReport.scope`는 선택한 여섯 범위 중 하나이고 JSON에 항상 포함됩니다. 모든 제한 범위 텍스트는 프로젝트 전체 상태가 아니라는 설명을 함께 출력합니다. 종료 코드 0은 선택한 범위의 검사가 모두 `healthy`라는 의미만 가지며 제외한 항목을 정상으로 주장하지 않습니다. 지원하지 않는 scope는 project 원본을 열기 전에 실패합니다. 최초 검색 범위 결정은 [ADR-0072](./docs/adr/0072-explicitly-scoped-doctor.md), 전체 실행 계획은 [ADR-0074](./docs/adr/0074-doctor-scope-execution-plans.md)에 기록합니다.

Doctor JSON은 `schemaVersion=1`, `projectId`, `scope`, `status`, `checks`, `issues`, `recoveryGuidance`를 필수로 가집니다. Draft 2020-12 schema가 각 하위 항목의 필수 필드와 controlled value를 검사하고 diagnostics reader가 scope별 정확한 check 집합, 중복 없는 check ID, check에서 계산한 전체 status와 issue에서 투영한 recovery guidance가 일치하는지 추가로 확인합니다. Schema와 정적 `DoctorReport` 타입은 같은 원본에서 파생합니다.

V1 object와 각 하위 object의 새 선택 필드는 허용합니다. 기존 필드 삭제, 필수 필드 추가, 타입 변경, `scope`·status·check ID·issue code·action code 같은 controlled value 추가나 의미 변경은 v1 호환 변경이 아니며 새 schema version이 필요합니다. Reader는 1이 아닌 정수 버전을 `doctor_report_schema_unsupported`, 버전 누락·잘못된 구조·필드 간 의미 불일치를 `doctor_report_invalid`로 실패시킵니다. 오류에는 입력 JSON, issue 문장, ID, 경로, provider 원문이나 credential을 복사하지 않습니다. 결정은 [ADR-0075](./docs/adr/0075-versioned-doctor-report-contract.md)에 기록합니다.

`DoctorReport.recoveryGuidance`는 issue가 없으면 빈 배열이고, 있으면 서로 다른 issue code마다 첫 등장 순서의 안내를 하나씩 가집니다. 각 안내의 필수 필드는 `issueCode`, controlled `actionCode`, 고정된 한국어 `message`, `actionState=not_performed`입니다. 같은 issue code가 여러 event에서 반복되어도 안내를 누적하지 않으며 서로 다른 issue code를 action code 하나로 합쳐 원인을 숨기지 않습니다.

안내는 issue message나 event ID를 입력으로 사용하지 않는 compile-time 전체 매핑에서만 파생합니다. 새 issue code는 안내 매핑 없이는 타입 검사를 통과하지 못합니다. Project·원본 ID, digest, 절대·상대 경로, 문서·스킬 본문, provider 원문, credential과 내부 오류는 안내에 포함하지 않습니다. 텍스트와 JSON 모두 자동 수정·명령 실행·승인·상태 변경을 주장하지 않으며 파일·event·Hub 원본을 만들지 않습니다. 결정은 [ADR-0073](./docs/adr/0073-bounded-doctor-recovery-guidance.md)에 기록합니다.

Provider probe는 adapter가 정한 실행 파일에 shell 없이 `--version`만 호출합니다. 5초와 16 KiB로 제한하고 첫 ASCII 문장 최대 200자만 version으로 남깁니다. 이 성공은 인증, 네트워크, 모델 접근이나 실제 session 성공을 증명하지 않습니다. Issue에는 절대 경로, 문서·스킬 본문, 검색 query·digest·원본 ID, publisher, credential, 환경 변수와 raw provider output을 넣지 않으며 doctor는 event를 만들지 않습니다. 상세 결정은 [ADR-0030](./docs/adr/0030-evidence-bound-knowledge-candidates.md), [ADR-0031](./docs/adr/0031-reviewed-verified-knowledge-lifecycle.md), [ADR-0033](./docs/adr/0033-bounded-environment-doctor.md)과 [ADR-0071](./docs/adr/0071-search-rollout-operational-doctor.md)에 기록합니다.

## Hub 등록과 outbound event sync

Project registration은 전체 `ProjectManifest`, `schemaVersion`·project ID·생성 시각에 결속된 identity hash, manifest hash, destination ID와 요청 시각을 가집니다. Manifest의 `hubSyncEnabled`가 true이고 event payload mode가 `allowlist`인 경우에만 만들 수 있습니다. 등록 상태는 `registered`, `updated`, `unchanged`이며 이름과 data policy 변경은 같은 identity의 갱신입니다. 같은 destination과 project 좌표에 다른 생성 identity를 자동 병합하지 않습니다.

`OutboundEventBatch`는 하나의 registration·project·destination에 속한 event 1~100개를 seq와 hash chain 순서로 가집니다. 첫·마지막 seq, 앞 hash, head hash와 canonical batch ID를 중복 검증합니다. Event는 local schema와 hash를 다시 계산하고 payload allowlist가 어떤 field도 제거하지 않는 경우에만 포함합니다. Artifact와 원문은 이번 sync 계약에 포함하지 않습니다.

Hub는 같은 canonical event 재전송을 duplicate로 수락할 수 있고 gap 뒤 event를 먼저 보관할 수 있습니다. Cursor는 `{seq: 0, eventHash: null}`에서 시작해 seq와 previous hash가 연속된 구간까지만 전진합니다. Ack는 batch의 event ID 전체, inserted·duplicate 개수, `accepted` 또는 `duplicate` 상태, 현재 cursor와 buffered event 개수를 포함합니다.

공통 reducer는 Hub가 저장할 다음 state와 응답 후보만 계산하며 durable 저장이나 network 성공을 주장하지 않습니다. Hub handler는 registration·event inbox·cursor를 하나의 transaction으로 저장한 뒤 응답해야 합니다. Node는 구성된 destination의 인증된 transport 응답과 batch 좌표 전체를 검증한 뒤 현재 outbox lease를 ack합니다. 이 연결 전에는 `sync.acknowledged` event를 만들지 않습니다. 상세 상태, 개인정보 경계와 실패 의미는 [ADR-0034](./docs/adr/0034-project-registration-and-event-sync-contract.md)에 기록합니다.

## 서명된 원격 command

`RemoteCommand`는 `schemaVersion`, 파생 `commandId`, `idempotencyKey`, 32-byte base64url `nonce`, `issuedAt`, `expiresAt`, 대상 `projectId`·`projectIdentityHash`와 action을 필수로 가집니다. v0 action은 `managed_run` 하나이며 `roleId`, 공급자 중립 `provider`, `risk`, 1~16개의 중복 없는 `verificationSuiteIds`와 요청 artifact 좌표를 포함합니다. 요청 좌표는 `artifactId`, SHA-256 `contentHash`, 1~65,536의 `byteCount`, 고정 UTF-8 media type만 가지며 raw request는 command, receipt와 replay store에 넣지 않습니다.

`commandId`는 자신을 제외한 command 전체의 canonical hash이고 `commandHash`는 완성된 command 전체의 SHA-256입니다. `SignedRemoteCommand`는 command와 `algorithm=ed25519`, `keyId`, 64-byte signature의 canonical base64url만 가집니다. 서명 message는 `lervo.remote-command.v1` domain, algorithm, key ID와 canonical command를 함께 포함합니다. 이 계약은 transport 인증이나 암호화를 대신하지 않으며 Hub HTTP route를 열지 않습니다.

Node receiver는 다음 순서를 바꾸지 않습니다.

1. Envelope schema, 파생 command ID와 발급·만료 관계를 확인합니다.
2. 구성된 trust store에서 key를 찾고 서명을 확인합니다.
3. Signer에게 허용된 project ID·identity hash와 현재 receiver target이 command target과 정확히 같은지 확인합니다.
4. Idempotency key와 nonce의 replay 상태를 조회합니다. 이미 terminal인 같은 command만 저장된 receipt로 복구합니다.
5. 기본 5분, 구성 상한 15분의 command lifetime과 기본 30초, 상한 60초의 clock skew를 적용합니다.
6. 로컬·Hub 정책 병합 결과가 승인되고 필요한 command-bound approval이 유효한 경우에만 replay reservation을 원자적으로 만듭니다.
7. 예약 뒤 artifact bytes를 읽고 byte 수, content hash와 strict UTF-8을 확인한 뒤 공급자 중립 executor를 호출합니다.
8. Terminal receipt를 replay store에 완료한 뒤에만 `deliveryStatus=processed`를 반환합니다.

정책 거부는 reservation을 만들지 않아 같은 서명 command를 승인 뒤 다시 평가할 수 있습니다. Reservation 뒤 payload를 읽을 수 없거나 bytes가 다르거나 executor가 실패하면 각각 `payload_unavailable`, `payload_mismatch`, `execution_failed` receipt를 저장합니다. 이 receipt는 terminal이므로 동일 command 재전송은 `deliveryStatus=duplicate`로 같은 receipt를 반환하고 payload를 다시 읽거나 실행하지 않습니다. 성공 receipt만 `outcome=executed`와 `runId`를 가지며 실패 receipt는 `outcome=failed`와 고정 failure code만 가집니다. 두 receipt 모두 command ID/hash, idempotency key와 처리 시각을 가집니다.

Replay 내부 판정은 `available`, `in_progress`, `duplicate`, `idempotency_conflict`, `nonce_replay`를 구분합니다. 외부 처리 결과는 `processed`와 `duplicate`만 반환합니다. In-progress, 충돌, 만료, scope·signature·policy 거부와 저장 장애는 terminal receipt로 위장하지 않고 안정적인 runtime 오류가 됩니다. 특히 executor 뒤 receipt 저장이 실패하면 실행 여부를 되돌려 추정하지 않고 `replay_store_failed`로 닫습니다.

안정적인 사전 실행 오류는 `invalid_command`, `trust_store_failed`, `unknown_signer`, `invalid_signature`, `signer_scope_denied`, `target_mismatch`, `command_not_yet_valid`, `command_expired`, `command_lifetime_exceeded`, `idempotency_conflict`, `nonce_replay`, `command_in_progress`, `policy_denied`, `approval_required`, `policy_evaluation_failed`, `replay_store_failed`입니다. 오류와 receipt에는 request, credential, key bytes, policy reason 원문, loader/executor 예외를 넣지 않습니다. `keyId`, project 좌표, artifact 좌표와 hash는 계약 metadata이고 command transport·보존 정책의 적용을 받습니다.

In-memory replay store는 단위 fixture에 남아 있고 실제 reconnect fixture는 project-bound SQLite adapter를 사용합니다. SQLite는 기본 1,024개, 구성상 최대 100,000개의 replay record를 보존하며 capacity에서 eviction하지 않고 fail-closed합니다. 이번 단계는 새 event를 추가하지 않으며 receipt는 `run.completed`, event sync 또는 Hub 전달 완료를 대신하지 않습니다. Receiver 결정은 [ADR-0041](./docs/adr/0041-signed-scoped-remote-command.md), durable delivery 결정은 [ADR-0042](./docs/adr/0042-durable-remote-command-delivery.md)에 기록합니다.

## Durable remote command delivery

Hub queue는 project registration을 선행 조건으로 하며 destination, project ID와 identity hash가 같은 signed envelope만 받습니다. Delivery ID는 destination과 envelope 전체의 canonical hash입니다. 같은 delivery 재등록은 현재 queue 상태와 최초 queue 시각을 반환하지만, 같은 command ID에 다른 envelope이 있으면 conflict로 거부합니다. Hub queue 원본 상태는 `pending`, `leased`, `completed`, `rejected`, `expired`입니다.

`RemoteCommandLease`의 필수 필드는 schema version, delivery·lease ID, 대상 Node ID, lease 시작·만료 시각과 signed envelope입니다. Lease duration은 1초 이상 5분 이하이고 한 pull은 기본 1개, 최대 16개입니다. Hub는 발급 시각이 오지 않은 pending command를 기다리고, 만료 시각을 지난 command는 `expired`로 바꾼 뒤 lease하지 않습니다. Offset이 있는 timestamp도 문자열로 비교하지 않고 epoch millisecond로 비교합니다. 만료된 lease는 terminal acknowledgement가 없을 때만 pending으로 돌아갑니다.

`RemoteCommandDeliveryAcknowledgement`는 delivery·lease·command ID/hash, lease 안의 acknowledgement 시각과 다음 disposition 중 하나를 가집니다.

- `completed`: 기존 `RemoteCommandExecutionReceipt` 전체를 포함합니다. Receipt의 command 좌표를 다시 검증합니다.
- `rejected`: `invalid_command`, `unknown_signer`, `invalid_signature`, `signer_scope_denied`, `target_mismatch`, `command_expired`, `command_lifetime_exceeded`, `idempotency_conflict`, `nonce_replay` 중 하나만 가집니다.

Hub는 현재 lease와 acknowledgement를 같은 transaction에서 확인하고 `completed` 또는 `rejected`로 commit한 뒤 confirmation을 반환합니다. Confirmation은 delivery·command ID, acknowledgement hash, disposition, `accepted|duplicate`와 commit 시각을 필수로 가집니다. Confirmation 시각은 acknowledgement보다 이르지 않아야 합니다. Terminal queue row의 identity, envelope, acknowledgement와 시각은 자동 삭제하지 않습니다.

Node의 SQLite replay database는 open 시 project ID와 identity hash에 고정합니다. `commandHash`, `idempotencyKey`, `nonce`, 무작위 reservation ID와 optional terminal receipt만 저장합니다. Raw request, signed envelope, artifact reference와 provider 오류는 column이나 receipt에 넣지 않습니다. Terminal receipt가 있으면 재시작 뒤 같은 command를 `duplicate`로 반환합니다. Receipt 없는 durable reservation은 실행 여부를 추정하지 않고 계속 `in_progress`로 남깁니다.

Reconnect worker는 transport가 실제 peer 인증 뒤 반환한 destination과 Hub identity hash를 구성값과 다시 비교합니다. Lease의 Node ID, project target과 유효 시각도 receiver 전에 확인합니다. Cycle 상태는 다음과 같습니다.

- `offline`: pull 또는 Hub peer 검증이 끝나지 않았고 lease·executor를 시작하지 않았습니다.
- `idle`: 인증된 pull이 완료됐지만 lease가 없습니다.
- `processed`: 모든 lease의 terminal acknowledgement가 Hub에서 확인됐습니다. `executedCount`, `failedCount`, `duplicateCount`, `rejectedCount`를 별도로 셉니다.
- `acknowledgement_pending`: Node terminal receipt 또는 rejection은 있지만 Hub confirmation을 받지 못했습니다. Lease 만료 뒤 같은 command가 다시 올 수 있습니다.
- `local_deferred`: local policy, trust/replay 저장 또는 in-progress 상태 때문에 terminal acknowledgement를 만들지 않았습니다.

Hub acknowledgement 전 연결이 끊기면 Node terminal receipt는 먼저 durable합니다. Lease 만료와 Hub·Node 재시작 뒤 같은 command를 받으면 receiver는 저장된 receipt를 반환하고 executor를 다시 호출하지 않습니다. Hub commit 뒤 response만 유실된 경우 Hub row는 이미 terminal이므로 다시 lease하지 않습니다. 이 fixture는 인증된 transport port의 계약을 검증하며 실제 HTTP/TLS endpoint나 daemon scheduler를 구현하지 않습니다.

Hub queue의 envelope에는 raw request가 없고 상태 query는 envelope 자체를 반환하지 않습니다. Node replay에는 envelope도 없습니다. Queue/reconnect 성공은 event sync, provider verification, writing 공개나 사람이 결과를 읽었다는 뜻이 아닙니다. 상세 상태와 장애 처분은 [ADR-0042](./docs/adr/0042-durable-remote-command-delivery.md)에 기록합니다.

## 서명된 정책 배포와 승인 수명주기

`PolicySnapshot`은 project ID·identity hash, sequence, 이전 snapshot ID, 발급·만료 시각과 1~256개의 rule을 가집니다. Rule 좌표는 role, risk, capability 조합이며 한 snapshot 안에서 중복할 수 없습니다. Decision은 `allow`, `deny`, `require_approval`입니다. Snapshot ID는 자신을 제외한 canonical 원본의 hash이고 snapshot hash는 완성 원본의 SHA-256입니다.

`PolicyApproval`은 현재 snapshot ID/hash, command ID/hash, command signer key ID, capability, 1~16개의 저장소 상대 경로, 승인자 subject hash, 발급·만료 시각에 결속됩니다. Snapshot rule에 같은 role·risk·capability의 경로 범위가 있으면 승인이 그 범위를 넓힐 수 없습니다. 승인 만료는 snapshot과 command 만료보다 늦을 수 없습니다. `PolicyApprovalRevocation`은 approval ID, 철회 시각과 `cancelled`, `superseded`, `security_policy_changed` 중 하나의 짧은 reason code만 가집니다. Snapshot, approval과 revocation은 각각 `lervo.policy.snapshot.v1`, `lervo.policy.approval.v1`, `lervo.policy.revocation.v1` domain으로 Ed25519 서명하며 trust key는 project scope와 허용 purpose를 함께 가져야 합니다.

인증된 policy transport는 destination과 Hub peer identity를 먼저 확인합니다. 한 bundle은 snapshot 하나, approval 최대 64개와 revocation 최대 64개입니다. 모든 schema, canonical ID/hash, project scope, purpose와 signature를 저장 전에 검증합니다. Node SQLite는 project identity에 고정되며 snapshot·approval·revocation signed envelope을 서로 다른 append-only table에 보존합니다. 새 snapshot은 현재 sequence 바로 다음이며 `previousSnapshotId`가 현재 ID여야 합니다. 처음 연결한 비어 있는 Node는 서명된 현재 snapshot을 bootstrap할 수 있지만, 하나를 저장한 뒤에는 과거·gap snapshot으로 되돌아가지 않습니다. Bundle 전체는 한 transaction이므로 잘못된 승인 하나 때문에 snapshot만 부분 적용되지 않습니다.

원격 command 평가 시 로컬 capability 결정과 일치하는 Hub rule 중 더 제한적인 결정을 사용합니다. 제한도는 `deny > require_approval > allow`입니다. 따라서 Hub 정책은 로컬 제한을 완화할 수 없고, 로컬 `deny`는 승인으로 우회할 수 없습니다. `require_approval`은 현재 snapshot과 정확한 command·capability에 묶인 승인이 평가 시각에 유효하고 아직 철회되지 않았을 때만 통과합니다. 저장 후 평가에서도 snapshot·approval·revocation signature를 trust store로 다시 확인합니다.

승인 대기와 정책 거부는 replay reservation을 만들지 않습니다. `approval_required`는 terminal Hub rejection이 아니라 reconnect worker의 `local_deferred`이며 lease 만료 뒤 같은 signed command를 다시 평가할 수 있습니다. 승인되면 executor 입력에 검증된 command 원본, signer key ID, policy snapshot ID와 정렬된 approval ID를 `ManagedRunApprovalAuthorization`으로 전달합니다. 이 값은 재검증 입력이며 executor 실행, `run.completed`, E3나 파일 쓰기 permit를 대신하지 않습니다.

Policy SQLite 원본에는 rule metadata, 서명 envelope, command/hash 좌표, 승인 경로와 승인자 subject hash만 있습니다. Raw request, 승인자 식별 원문, 승인 사유, credential, provider payload와 오류 본문은 저장하지 않습니다. 이 단계는 새 event를 추가하지 않습니다. Node 검증과 평가 결정은 [ADR-0043](./docs/adr/0043-signed-policy-and-command-bound-approval.md)에 기록합니다.

## Hub 정책 작성과 HTTP 동기화

`@lervo/hub-policy`는 HTTP와 SQLite를 모르는 작성 service입니다. Snapshot 작성은 durable source의 현재 head 다음 sequence와 이전 ID를 사용합니다. Approval 작성은 현재 head와 같은 Hub database의 remote command 원본·signer key ID를 사용해 command/hash·capability·경로를 결속합니다. Revocation은 저장된 approval 원본을 기준으로 만듭니다. 세 원본은 configured policy signer가 목적별로 서명한 뒤에만 source port로 발행합니다.

Hub HTTP route는 다음과 같습니다.

- `GET /v1/policy/projects/<projectId>/bundle`: `destinationId`, `projectIdentityHash`, 선택적인 `currentSnapshotId`를 받습니다.
- `POST /v1/policy/projects/<projectId>/snapshots`: `schemaVersion`, `rules`, `expiresAt`을 받습니다.
- `POST /v1/policy/projects/<projectId>/approvals`: `schemaVersion`, `commandId`, `capability`, `repositoryPaths`, `expiresAt`을 받습니다.
- `POST /v1/policy/projects/<projectId>/revocations`: `schemaVersion`, `approvalId`, `reasonCode`를 받습니다.

Bearer principal은 하나 이상의 `trace.read`, `policy.read`, `policy.write` permission과 최대 256개 destination/project scope를 가집니다. Route와 method를 확인한 뒤 인증·scope·permission을 body parsing과 policy source 호출보다 먼저 적용합니다. Write request가 `issuedAt`, `grantedAt`, `revokedAt`, `publishedAt`을 보내면 알 수 없는 필드로 거부합니다. Hub clock이 만든 같은 시각이 해당 원본 시각과 `publishedAt`이며 만료된 snapshot·approval은 새로 발행하지 않습니다. 승인자 principal ID는 `SHA-256(projectIdentityHash + NUL + principalId)`로 바꾸며 원문은 request body나 policy table에 넣지 않습니다.

Hub SQLite migration은 snapshot, approval과 revocation을 별도 strict table로 추가합니다. Project registration, snapshot, remote command, approval 사이를 foreign key로 연결하고 세 원본의 update/delete를 trigger로 거부합니다. Snapshot ID 또는 sequence 충돌은 기존 원본을 덮어쓰지 않습니다. 같은 canonical 원본 재전송만 `duplicate`이고, approval은 현재 head와 기존 command에만 만들 수 있습니다. Source는 처음 연결한 Node에 최신 snapshot을, 알려진 과거 cursor에는 다음 sequence 하나를, 현재 head cursor에는 같은 snapshot의 최신 approval·revocation 묶음을 반환합니다. 알 수 없는 cursor는 자동 bootstrap하지 않습니다. 한 snapshot의 approval과 revocation은 각각 최대 64개입니다.

모든 policy HTTP 응답은 `no-store`, 고정 오류 본문과 `x-lervo-hub-identity`를 사용합니다. Write body는 기본 256 KiB, 응답과 Node read는 기본 1 MiB이며 둘 다 상한을 둡니다. Node transport는 HTTPS URL만 기본 허용하고 URL credential·query·fragment를 거부합니다. Bearer 인증 뒤 status, Hub identity header, JSON content type, destination/project 좌표와 bounded UTF-8 JSON을 확인하며 기본 15초 뒤 요청을 중단합니다. HTTP와 내부 예외는 기존 `hub_unavailable`, identity 불일치는 `transport_authentication_failed`로 처리하여 현재 Node policy를 유지합니다. 평문 HTTP 허용 option은 test fixture 전용입니다.

정책 HTTP 오류는 인증 없음 `401`, scope·permission 거부 `403`, 등록·command·approval 부재 `404`, schema·query 오류 `400`, 현재 head·identity·capacity 충돌 `409`, request 상한 초과 `413`입니다. 응답에는 credential, principal, 서명 key, request 원문이나 내부 예외를 넣지 않습니다. Hub 전체 audit는 모든 snapshot chain과 과거 approval-command-signer 관계, revocation 관계를 다시 검사합니다. 이 기능은 새 실행 event를 만들지 않으며 Hub 정책 작성 성공이 Node의 `loaded`, `injected`, `used` 또는 실행을 뜻하지 않습니다. 결정은 [ADR-0045](./docs/adr/0045-hub-policy-authoring-and-http-sync.md)에 기록합니다.

## 플랫폼 중립 대화와 능동 참여

Conversation adapter는 Slack, Discord, 자체 채팅과 이후 플랫폼을 같은 내부 계약으로 바꿉니다. Descriptor 필수 필드는 schema version, integration ID, adapter kind, instance identity hash와 capability 집합입니다. Capability는 message 수신·전송, thread, 수정·삭제, reaction, streaming, typing, presence와 interactive action을 독립적으로 선언합니다.

Inbound 필수 필드는 canonical event ID, source event key hash, integration·project·conversation·thread target, kind, Lervo participant·role actor, 본문 artifact ID/hash/byte count/media type, mention, reply event ID, signal code, automation depth와 발생 시각입니다. Message는 signal code가 없고 signal은 code가 있어야 합니다. 외부 message ID는 adapter 안에서 hash하며 본문과 외부 사용자 ID는 interaction DB에 넣지 않습니다.

Participation policy는 project·role, 명시적인 conversation 목록, `mention_only`·`relevant`·`proactive`·`silent`, 허용 actor, 구독 signal, cooldown, 시간당 최대 응답 수, automation depth와 생성 시각을 가집니다. Decision은 source event·policy·role 좌표, `observe` 또는 `respond`, 제한된 reason, relevance 상태와 시각을 가집니다. 직접 mention, 확정된 relevance와 구독 signal만 응답할 수 있습니다. 관련성 평가가 없거나 실패하면 `unknown`과 `relevance_unavailable`로 관찰합니다.

Responder가 만든 reply는 artifact 참조와 `chat` surface의 `WritingPublicationPermit`를 함께 가져야 합니다. Permit의 artifact ID와 content hash가 reply와 다르면 outbox를 만들지 않습니다. 따라서 adapter와 모델이 달라도 한국어 자연스러움, 문단 연결과 독자 이해 가능성을 포함한 기존 writing 공개 gate를 우회할 수 없습니다.

Durable 처리 단위는 source event ID와 role ID의 조합이며 처음 claim한 participation policy ID를 원본에 고정합니다. 여러 역할은 같은 message에 각각 decision과 outbound를 가질 수 있고 한 역할의 완료가 다른 역할을 막지 않습니다. 완료 뒤 정책이 바뀌어도 같은 역할이 과거 message를 다시 처리하지 않으며, 완료 전 policy가 바뀐 retry는 기존 policy로 재개하도록 충돌로 닫습니다. Inbox 상태는 `pending`, `leased`, `completed`, outbox는 `pending`, `leased`, `delivered`입니다. Worker ID, lease ID·만료, attempt count, available time, 짧은 failure code와 failed time이 변경 가능한 전달 필드입니다. Decision과 outbound 생성은 inbox 완료와 한 transaction으로 commit합니다. `completed`와 `delivered`는 종단 상태이며 원본·결정·종단 상태의 update/delete는 trigger로 막습니다. 전체 audit는 canonical ID, 중복 좌표, decision/outbound 관계, receipt hash와 전달 시각을 다시 확인합니다.

응답 생성 실패는 `response_generation_failed`, writing 검증 실패는 `publication_verification_failed`, adapter 예외는 `adapter_delivery_failed`, receipt 계약 불일치는 `invalid_delivery_receipt`로 재예약합니다. 저장 실패는 `interaction_store_failed`로 완료를 주장하지 않습니다. Relevance 실패는 시스템 실패가 아니라 응답하지 않는 결정입니다. Delivery receipt에는 외부 delivery key의 hash와 전달 시각만 남습니다.

이 상태는 전역 실행 event나 shared context receipt가 아닙니다. 메시지를 관찰하거나 답해도 그 역할의 `loaded`, `injected`, `used`는 생기지 않습니다. 실제 responder가 Codex나 Claude를 실행하려면 message artifact와 필요한 공유 원본을 그 역할의 독립 session에서 E2/E3로 만들고, 재사용할 결과는 별도 shared context로 발행해야 합니다. 결정은 [ADR-0046](./docs/adr/0046-platform-neutral-conversation-participation.md)에 기록합니다.

### Managed conversation responder

`@lervo/conversation-responder`는 inbound 본문을 content hash에서 계산한 CAS URI로 읽고 byte count, SHA-256과 UTF-8을 다시 확인합니다. 본문은 문서 context evidence로 승격하지 않습니다. 대신 event ID, participation policy·decision ID, role ID와 message content hash로 `requestDigest`를 만들고 동일한 값의 `run.requested` 원본이 있는지 확인합니다.

응답 RoleProfile은 `filesystem.write=deny`, `external.message=deny`, human 또는 mixed presentation과 `chat` surface writing policy를 가져야 합니다. 매 응답은 새 managed provider session에서 실행합니다. Provider-session claim port는 `(provider, providerSessionId)` 중복을 거부하며 기본 구현은 단일 process용입니다. 여러 runner는 같은 계약의 durable indexed 구현을 주입해야 합니다. Provider 결과를 공개하기 전에 session·turn·role 좌표, 저장소 before/after revision 동일성, 변경 0건, 각 공유 원본의 E2/E3 receipt와 `document.loaded`·`context.injected`·`run.completed` 원본을 다시 검증합니다. 이 공통 검증은 숙의와 대화가 함께 사용하며 도메인별 이력 검사는 각 runtime이 추가합니다.

Reply candidate는 본문 좌표와 permit뿐 아니라 writing evaluation 및 evaluation artifact 좌표를 함께 가집니다. 독립 publication verifier는 현재 conversation 정책에서 해석한 writing contract로 CAS 원문·평가 artifact·permit를 다시 읽고 확인합니다. 최대 65,536 bytes를 넘거나 `chat` writing 평가가 막힌 결과는 reply가 되지 않습니다. 변조·누락·정책 불일치는 `publication_verification_failed`로 inbox를 재예약하고 outbox를 만들지 않습니다.

새 event type은 추가하지 않습니다. 기존 managed run event에는 원문 message, prompt, provider 응답, 외부 사용자·message ID와 내부 오류를 넣지 않습니다. Message 원문은 CAS, provider 결과와 writing 평가는 CAS, 실행 증거는 기존 run/context event, 전달 대기는 interaction DB가 각각 원본입니다. 결정은 [ADR-0047](./docs/adr/0047-managed-conversation-responder.md)에 기록합니다.

### Slack·Discord 인증 adapter

Slack ingress는 body를 JSON으로 바꾸기 전에 기본 256 KiB, 최대 4 MiB 상한을 적용하고 raw bytes로 `v0:{timestamp}:{body}` HMAC-SHA256을 계산합니다. `X-Slack-Signature`는 constant-time으로 비교하며 local clock과 300초 넘게 차이 나는 요청을 거부합니다. 서명 뒤 `api_app_id`와 허용 team을 확인하고 새 message·app mention만 정규화합니다. `url_verification` challenge도 같은 서명을 통과해야 합니다. 공식 계약은 [Slack request verification](https://api.slack.com/docs/verifying-requests-from-slack)과 [Events API](https://api.slack.com/apis/connections/events-api)를 기준으로 합니다.

Discord 일반 채팅 수신은 interaction endpoint 서명으로 대체하지 않습니다. Gateway transport port가 bot token으로 Identify한 뒤 Ready 또는 유효한 Resume 상태, heartbeat와 dispatch sequence를 확인합니다. Adapter는 이 port가 인증한 opcode 0 `MESSAGE_CREATE`만 처리하고 구성된 guild 또는 DM scope를 다시 확인합니다. Resume로 같은 message가 재전달돼도 guild·message ID에서 만든 canonical event ID가 같아 interaction inbox에서 중복 처리되지 않습니다. 공식 계약은 [Discord Gateway](https://docs.discord.com/developers/events/gateway)와 [Gateway events](https://docs.discord.com/developers/events/gateway-events)를 기준으로 합니다.

두 adapter는 인증과 scope 확인 전에 identity mapping이나 CAS 저장을 호출하지 않습니다. Identity port만 외부 tenant·channel·participant 키를 보고 내부 project·conversation·thread·participant·role·automation 좌표를 반환합니다. Interaction DB와 normalized event에는 외부 ID 원문이 없으며 source identity는 hash뿐입니다. Mapping 저장소는 accepted inbound를 반환하기 전에 외부 message 주소와 canonical event를, receipt 반환 전에 outbound·source event·외부 message·automation depth를 durable·idempotent하게 기록합니다. Slack message 주소는 timestamp만 쓰지 않고 integration·team·channel과 함께 식별합니다. Agent로 매핑됐지만 Lervo outbound correlation이 없는 외부 message는 automation depth를 최대값 8로 두어 자동 응답하지 않습니다.

`@lervo/conversation-platform-sqlite`는 raw 외부 주소와 participant mapping, thread reverse mapping, message correlation과 delivery replay를 mode `0600`인 별도 DB에 둡니다. Delivery replay 필수 필드는 platform, integration ID, outbound ID, request hash, 상태, 시도 시각이며 성공 뒤에만 외부 message key와 전달 시각이 생깁니다. 상태는 `sending`, `unknown`, `rejected`, `delivered`입니다. 재시작 뒤 남은 `sending`은 의미상 `unknown`으로 읽습니다. HTTP 또는 플랫폼 응답이 전송을 명시적으로 거부하면 `rejected`, 응답 자체를 신뢰할 수 없으면 `unknown`입니다. Request hash 충돌은 기존 값을 덮어쓰지 않습니다. 이 상태는 전역 event나 interaction outbox 상태가 아닙니다.

Delivery port는 Slack OAuth 또는 Discord bot token을 소유합니다. API 호출 전에 replay reservation을 쓰고 응답과 외부 message ID를 확인한 뒤에만 완료합니다. 성공한 같은 `outboundId`는 저장된 결과를 반환합니다. 요청이 전송됐을 수 있지만 응답을 확인하지 못하면 `unknown`으로 남겨 자동 재전송과 중복 메시지를 막습니다. 현재는 운영자 reconciliation 명령이 없으므로 해당 outbound는 성공으로 추정하지 않습니다. Slack 요청은 `<`, `>`, `&`를 escape하고 mrkdwn을 끈 plain text로 보냅니다. Discord 요청은 2,000자 상한, 빈 `allowed_mentions.parse`, reply mention 비활성화와 outbound에서 계산한 enforced nonce를 사용합니다. 공식 계약은 [Slack `chat.postMessage`](https://api.slack.com/methods/chat.postMessage)와 [Discord Message resource](https://docs.discord.com/developers/resources/message)를 기준으로 합니다.

`apps/conversation`은 CAS, mapping/replay SQLite, Slack signed ingress·OAuth delivery와 Discord Gateway authentication port·bot-token delivery를 application 경계에서 조합합니다. Discord Gateway WebSocket의 Identify, Resume, heartbeat와 reconnect driver 자체는 아직 제공하지 않으며 인증 port 주입이 필요합니다. 인증·scope·payload 실패는 각각 `platform_authentication_failed`, `invalid_platform_payload`, `unsupported_platform_event`, mapping·CAS·전송 실패는 `identity_mapping_failed`, `artifact_storage_failed`, `platform_delivery_failed`로 fail-closed합니다. `unknown` delivery도 `platform_delivery_failed`이며 receipt와 `delivered` 상태를 만들지 않습니다. 새 전역 event와 interaction 상태는 추가하지 않습니다. 결정은 [ADR-0049](./docs/adr/0049-durable-conversation-deployment.md)에 기록합니다.

### 대화 command 조회와 별도 Hub 승인

Conversation control responder는 본문 artifact를 다시 확인하고 아래 두 형식만 처리합니다.

- `/lervo command <rcd_delivery_id>`: command와 현재 승인 상태를 조회합니다.
- `/lervo approval <rcd_delivery_id>`: 같은 상태와 별도 Hub 검토 주소를 반환합니다.

자연어 요청, reaction, interactive action과 모델 분류 결과는 이 명령을 대신하지 않습니다. Project·participant마다 Hub principal·destination과 `command.read`·`approval.review` binding을 구성합니다. Human actor와 binding이 정확히 맞아야 조회하며, 응답은 `chat` writing 평가·permit를 통과한 새 Markdown CAS artifact입니다. 응답 원문은 interaction outbox를 통해서만 플랫폼 adapter로 전달하고 responder가 직접 Slack, Discord나 자체 채팅 transport를 호출하지 않습니다.

Approval 검토 주소는 `destinationId`, `projectId`, `deliveryId`, `reviewGrant`를 URL fragment에 둡니다. Grant는 HMAC-SHA256으로 principal과 세 좌표, 만료 시각에 결속되고 principal 원문을 포함하지 않습니다. 기본 TTL은 600초, 구성 상한은 3,600초입니다. Browser는 fragment를 읽은 즉시 `history.replaceState`로 주소에서 제거합니다. `GET /v1/control/projects/<projectId>/commands/<deliveryId>?destinationId=...`는 bearer project scope와 `command.read`, `x-lervo-control-review`가 같은 bearer principal에 결속됐는지 확인한 뒤에만 source를 읽습니다.

Review 응답의 필수 필드는 schema version, destination/project와 project identity hash, delivery ID·command ID·상태·시도 횟수·queue/만료/terminal 시각, role·provider·risk·verification suite·발급/만료 시각, 현재 snapshot ID·최대 승인 만료·철회 이력 여부, capability·repository path별 approval ID와 검사 시각입니다. Browser UI는 approval ID를 표시하지 않습니다. Request artifact·본문, command hash·signature, approver subject hash·principal, policy signature와 내부 오류는 응답에 없습니다.

Approval 파생 상태는 다음과 같습니다.

- `unavailable`: 현재 policy snapshot을 확인할 수 없습니다.
- `denied`: 같은 role·risk rule 중 deny가 있습니다.
- `not_required`: require-approval rule이 없습니다.
- `approval_required`: 필요한 범위에 유효한 승인이 없습니다.
- `partially_approved`: 필요한 범위 중 일부만 유효합니다.
- `approved`: 필요한 모든 범위에 현재 유효한 승인이 있습니다.

이 상태와 `hadRevokedApproval`은 command·snapshot·approval·revocation 원본에서 계산하는 read model이며 새 저장 상태나 실행 event가 아닙니다. `/control` shell에는 데이터와 credential이 없고 token은 현재 탭 메모리에만 둡니다. 실제 승인 버튼은 기존 `POST /v1/policy/projects/<projectId>/approvals`를 호출합니다. 따라서 review grant는 승인 capability가 아니며, 재인증 bearer가 같은 project scope와 `approval.write` 또는 기존 `policy.write`를 가질 때만 Hub clock과 signer가 기존 command-bound approval 원본을 만듭니다.

대화 경계 실패는 `control_command_invalid`, `control_access_denied`, `control_source_failed`, `message_artifact_invalid`, `writing_publication_blocked`입니다. HTTP의 잘못된 좌표는 `400`, 인증 없음은 `401`, scope·permission·principal/grant 불일치는 `403`, command 부재는 `404`, source 불일치는 `500`입니다. 오류에는 token, grant, principal, request artifact, command 원본과 내부 예외를 넣지 않습니다. 이 기능은 새 전역 event를 추가하지 않으며 상태 조회·링크 발급·승인 작성이 Node 실행, `loaded`, `injected` 또는 `used`를 뜻하지 않습니다. 결정은 [ADR-0050](./docs/adr/0050-principal-bound-conversation-command-review.md)에 기록합니다.

## Managed run 승인 재검증

`filesystem.write=require_approval` managed run은 `ManagedRunApprovalAuthorization`과 `ManagedCapabilityApprovalVerifier`가 함께 있어야 합니다. Coordinator preflight는 adapter를 시작하기 전에 authorization schema, project/run/session/role, provider, risk, request digest, verification suite와 전체 expected path를 확인합니다. Policy verifier는 current snapshot ID와 유효 기간, snapshot·approval·revocation signature, command/hash·signer binding, 승인 기간·철회와 승인 경로를 project-bound store 원본으로 다시 판정합니다.

Preflight를 통과한 경우에만 `executionMode=managed_write`를 adapter에 보냅니다. Provider가 실제 파일 변경을 요청하면 managed write bridge는 정규화된 단일 요청 경로와 현재 시각을 더해 같은 verifier를 다시 호출합니다. 그 사이 snapshot 교체, 만료나 철회가 생기면 `capability.decided=require_approval`, `approvalId=null`을 기록하고 permit를 만들지 않습니다. 서명 원본 검증 예외도 fail-closed하며 provider write 실패로 run을 닫습니다.

재검증 성공 뒤에도 current generation E3, expected path와 실제 before hash가 별도로 맞아야 합니다. 발급된 permit는 approval ID와 snapshot ID를 포함하고 한 변경 완료 뒤 소비됩니다. `capability.decided=allow`에는 `policyRuleId=managed_context_e3+signed_approval`과 실제 approval ID를 기록하되 command, signature, 승인자 정보와 원문은 event에 넣지 않습니다. 새 event type은 추가하지 않습니다. 상세 결정은 [ADR-0044](./docs/adr/0044-signed-approval-managed-write-permit.md)에 기록합니다.

## 실패 의미

| code | 실패 의미 |
|---|---|
| `telemetry_recording_failed` | 변경 capability를 닫고 run을 중단합니다. Document migration에서는 성공 event를 commit하지 못한 것으로 보고 이번 apply가 만든 sidecar를 모두 되돌립니다. |
| `redaction_failed` | 민감정보가 섞인 event를 생략해 진행하지 않고 변경 capability를 닫습니다. |
| `hub_sync_failed` | 로컬 run은 계속하고 outbox에 보관합니다. |
| `interaction_store_failed` | Inbox claim, decision commit 또는 outbox 상태를 durable하게 확정하지 못했습니다. 응답 완료나 전달 완료를 주장하지 않고 저장소를 진단합니다. |
| `response_generation_failed` / `publication_verification_failed` | 응답 원문 생성 또는 `chat` writing 공개 검증이 끝나지 않았습니다. 원문 오류를 저장하지 않고 현재 inbox lease를 bounded retry로 되돌립니다. |
| `adapter_delivery_failed` / `invalid_delivery_receipt` | 플랫폼 전송이 실패했거나 receipt 좌표가 다릅니다. `delivered`로 바꾸지 않고 outbox를 bounded retry로 되돌립니다. |
| `invalid_command` / `unknown_signer` / `invalid_signature` / `signer_scope_denied` / `target_mismatch` | 원격 command 계약, 신뢰 key, 서명 또는 project 좌표가 맞지 않습니다. 로컬 정책과 executor를 호출하지 않고 새 command를 요구합니다. |
| `command_not_yet_valid` / `command_expired` / `command_lifetime_exceeded` | 로컬 clock과 허용된 skew·lifetime에서 command를 실행할 수 없습니다. 만료 command를 갱신된 서명 없이 재사용하지 않습니다. |
| `idempotency_conflict` / `nonce_replay` / `command_in_progress` | 다른 command가 같은 idempotency/nonce를 사용했거나 같은 command가 이미 처리 중입니다. Executor를 중복 호출하지 않으며 terminal receipt가 생긴 뒤 동일 command를 조회할 수 있습니다. |
| `policy_denied` / `approval_required` / `policy_evaluation_failed` | 로컬·Hub 병합 정책이 거부됐거나 현재 command-bound 승인이 없거나 서명 원본으로 유효한 판정을 만들지 못했습니다. Reservation과 실행을 시작하지 않습니다. 승인은 같은 command를 lease 만료 뒤 다시 평가할 수 있지만 deny와 검증 실패를 승인으로 추정하지 않습니다. |
| `invalid_policy_bundle` / `unknown_policy_signer` / `policy_signer_scope_denied` / `policy_signer_purpose_denied` / `invalid_policy_signature` | 정책 bundle의 계약, signer, project scope, purpose 또는 signature가 맞지 않습니다. Bundle 전체를 저장하지 않고 현재 정책을 유지합니다. |
| `policy_store_failed` | 정책 원본 조회·연속 snapshot transaction 또는 저장 후 검증이 실패했습니다. 새 정책이나 승인을 적용했다고 주장하지 않고 원격 executor를 열지 않습니다. |
| `trust_store_failed` / `replay_store_failed` | 신뢰 key 또는 replay 상태를 안전하게 읽고 저장하지 못했습니다. 실행 완료를 주장하지 않으며 운영 상태 확인 전 자동 실행 재시도를 하지 않습니다. |
| `remote_command_registration_required` / `remote_command_identity_mismatch` / `remote_command_conflict` | Hub queue 대상의 registration·identity·command 원본이 맞지 않습니다. Pending delivery를 만들거나 기존 원본을 덮어쓰지 않습니다. |
| `remote_command_ack_invalid` / `invalid_remote_command_acknowledgement` | Delivery·lease·command·receipt 또는 acknowledgement 시각이 현재 Hub 원본과 다릅니다. Terminal 상태를 commit하지 않습니다. |
| `hub_unavailable` / `transport_authentication_failed` / `invalid_lease_response` / `invalid_delivery_confirmation` | Reconnect transport, Hub peer, lease 또는 confirmation을 신뢰할 수 없습니다. 새 executor를 열지 않거나 이미 durable한 Node receipt를 유지하고 lease 재전달을 기다립니다. |
| `derived_index_failed` | 명시적 경로와 전문 검색으로 저하 운전합니다. |
| `invalid_node` / `projection_invalid` | 그래프 focus·끝점 좌표가 유효하지 않거나 allowlist event의 명시적 좌표로 관계를 만들 수 없습니다. 조회를 시작하지 않거나 event batch 전체를 rollback하며 관계 인덱싱 완료를 주장하지 않습니다. |
| `source_inconsistent` / `integrity_failed` | 그래프 source page의 project·focus·정렬·cursor·관계 ID가 다르거나 파생 테이블이 event 재투영 결과와 다릅니다. 일부 page를 반환하지 않고 재구축 또는 운영자 진단을 요구합니다. |
| `invalid_query` / `corpus_invalid` / `corpus_limit_exceeded` | 검색 query·source 또는 corpus 한도가 계약 밖입니다. 부분 index와 search attempt를 만들지 않습니다. |
| `corpus_read_failed` | 등록 문서 하나 이상을 안전하고 완전하게 읽지 못했습니다. 누락 문서를 숨긴 검색 결과를 반환하거나 attempt를 기록하지 않습니다. |
| `invalid_attempt` / `invalid_assessment` / `observation_conflict` | 검색 관측의 ID·hash·project·시간·결과 관계가 다르거나 한 attempt에 서로 다른 평가가 있습니다. 기존 원본을 유지하고 일부 평가만 집계하지 않습니다. |
| `observation_invalid` / `observation_read_failed` / `observation_write_failed` / `observation_limit_exceeded` | 검색 관측 경로·파일·저장 또는 bounded 전체 조회를 신뢰할 수 없습니다. 검색·평가 기록이나 품질 report 완료를 주장하지 않습니다. |
| `invalid_recommendation` / `invalid_search_recommendation` | 추천 묶음의 attempt·ID·순위·정책·선택 또는 현재 project·registry 관계가 다릅니다. Context plan과 추천 event를 만들지 않습니다. |
| `engine_selection_unavailable` | 선택 chain·정책·검토·비교·registry·현재 corpus·replay·index 또는 응답을 안전하게 소비하지 못했습니다. Baseline으로 낮추거나 attempt·추천을 만들지 않습니다. |
| `required_context_missing` | 필수 문서 부재, hash/scope 불일치, 오래된 context generation을 포함하며 쓰기 전에 중단합니다. |
| `provider_capability_unsupported` | capability matrix에 따른 낮은 assurance를 명시하거나 정책상 차단합니다. |
| `capability_denied` | Role 또는 프로젝트 정책이 요청한 capability를 거부했습니다. 실행은 읽기 전용으로 계속할 수 있지만 해당 변경은 재시도하지 않습니다. |
| `approval_required` | 검증된 승인 원본이 없어 변경 capability를 닫고 승인 대기 상태를 유지합니다. |
| `contract_validation_failed` | project, role, skill, document 또는 adapter 계약이 유효하지 않으므로 run 시작과 변경 capability를 차단합니다. 파일을 수정한 뒤 새 검증으로 다시 시작해야 하며 자동 재시도하지 않습니다. |
| `repository_snapshot_failed` | 실행 전후 저장소 상태를 안전하게 비교할 수 없으므로 managed 완료와 변경 증명을 차단합니다. 안전하지 않은 경로·동시 변경·snapshot 제한을 해결한 뒤 새 run으로 시작합니다. |
| `unmanaged_change_detected` | 현재 run의 검증된 write permit 밖에서 저장소 변경이 발견되었습니다. 변경을 `file.changed`로 승격하지 않고 run을 실패시키며, 사용자가 검토한 뒤 별도 managed run으로 가져올 수 있습니다. |
| `provider_start_failed` / `provider_turn_failed` / `provider_stream_failed` / `provider_stop_failed` | 해당 provider 수명주기 단계가 정상 완료되지 않았습니다. 원문 오류는 event에 넣지 않고 code와 digest만 기록하며, start/stream/stop의 일시 실패만 정책상 재시도할 수 있습니다. |
| `provider_result_failed` | 완료 signal과 결속된 최종 결과를 얻지 못했습니다. 결과 artifact와 정상 완료를 만들지 않으며 자동 재시도하지 않습니다. |
| `provider_write_failed` | 승인된 파일 변경이 완료되지 않았거나 요청 종류·실제 hash·최종 snapshot이 다릅니다. 검증된 `file.changed`와 정상 완료를 만들지 않으며 새 run에서 다시 context를 준비해야 합니다. |
| `cancelled` | 호출자가 run을 중단했습니다. Active turn interrupt와 adapter 종료를 시도하고 정상 완료를 기록하지 않습니다. |
| `writing_verification_failed` | 사람 대상 산출물의 정책 좌표가 다르거나 필수 결정적/의미 검사가 누락 또는 실패했습니다. 로컬 run의 변경은 유지하지만 공개를 막고, 산출물을 고친 뒤 다시 평가할 수 있습니다. |
| `role_profile_invalid` / `evaluation_bundle_invalid` | 전문 역할 profile, output schema, verification suite 또는 평가 check 결속이 유효하지 않습니다. 역할 실행과 평가를 시작하지 않고 정의를 고친 뒤 다시 검증합니다. |
| `evaluation_result_invalid` / `role_publication_blocked` | 평가 check·생산/평가 run·evidence·파생 상태가 다르거나 평가 대상과 CAS 원본이 일치하지 않습니다. 역할 산출물 원문을 공개하지 않습니다. |
| `high_risk_workflow_invalid` | 고위험 workflow의 역할 분리, profile/evaluation hash, provider 정책, 필수 suite 또는 회차가 맞지 않습니다. 숙의를 시작하거나 교차 검토 완료를 주장하지 않습니다. |
| `policy_contract_invalid` / `artifact_contract_invalid` / `history_contract_invalid` / `outcome_contract_invalid` | 숙의 정책, artifact 좌표, 역할별 이력 또는 종료 결과가 실제 상태와 다릅니다. `converged`를 만들지 않고 입력 계약을 고친 새 숙의로 시작합니다. |
| `verification_evidence_invalid` | 숙의 verification metadata가 실제 suite/result 또는 canonical CAS artifact와 다르거나 사용되지 않은 근거를 포함합니다. 검증 통과와 수렴을 주장하지 않습니다. |
| `artifact_publication_failed/provider_not_allowed` | Managed run의 역할에 배정되지 않은 provider가 결과를 만들었습니다. 실행 사실은 남기되 writing 평가와 숙의 artifact 기록을 시작하지 않으며 provider 정책을 고친 새 역할 run이 필요합니다. |
| `candidate_not_eligible/outcome_not_converged` | 숙의가 `no_consensus` 또는 `failed`로 끝났습니다. 지식 candidate와 생성 event를 만들지 않으며 임의 결론을 선택하지 않습니다. |
| `candidate_evidence_invalid` / `candidate_contract_invalid` | Decision CAS, 현재 claim, verification revision, 완료·artifact event, 영향 path 또는 candidate schema가 실제 원본과 다릅니다. 후보를 기록하지 않고 누락된 원본을 복구하거나 새 숙의를 실행합니다. |
| `review_contract_invalid` | 승격 정책, 사람 reviewer, 검토 revision, 충돌 해소 또는 승인 CAS 계약이 실제 candidate와 다릅니다. Reviewed 완료와 verified 승격을 주장하지 않습니다. |
| `promotion_not_eligible` | 승인 결정, candidate·review event/CAS, 현재 repository revision 또는 영향 path가 승격 조건과 다릅니다. Verified 원본과 event를 만들지 않습니다. |
| `staleness_contract_invalid` | Verified 원본, snapshot, stale 결과의 상태·신호·사유가 서로 맞지 않습니다. Current 또는 stale 상태 event를 주장하지 않습니다. |
| `artifact_storage_failed` / `event_recording_failed` | Candidate CAS를 저장·재검증하지 못했거나 생성 event transaction이 실패했습니다. Candidate 생성 완료를 반환하지 않으며 event 없는 CAS object는 지식으로 간주하지 않습니다. |
| `artifact_storage_failed` | CAS object를 안전하게 저장하거나 hash로 검증할 수 없습니다. 해당 artifact에 의존하는 변경을 차단하고 원문 없이 code와 digest만 기록한 뒤 재시도할 수 있습니다. |
| `invalid_approval` / `invalid_migration_artifact` | Migration 승인, plan ID 또는 candidate artifact bytes/hash가 계약과 다릅니다. Sidecar를 쓰기 전에 전체 apply를 거부합니다. |
| `invalid_legacy_registry` | 기존 `documents.yaml` 또는 항목별 artifact와 structural plan을 schema-valid하게 해석할 수 없습니다. 원본을 유지하고 archive·sidecar를 만들지 않습니다. |
| `plan_stale` / `migration_conflict` | Dry-run 이후 source·target·manifest layout이 달라졌거나 기존 registry, ID, path, 관계가 충돌합니다. 부분 적용하지 않고 새 계획 또는 structural migration을 요구합니다. |
| `migration_apply_failed` | Event 기록 전에 승인 sidecar 전체를 공개·검증하지 못했습니다. 이번 작업이 만든 파일을 되돌리고 새 apply에서 재검증합니다. |
| `migration_finalization_failed` / `rollback_failed` | 성공 event 뒤 transaction marker를 제거하지 못했거나 실패한 apply의 생성 파일을 안전하게 되돌리지 못했습니다. 완료로 표시하지 않으며 marker와 현재 layout을 운영자가 확인해야 합니다. |
| `invalid_patch_request` / `source_changed` | Managed block patch의 source 좌표가 잘못됐거나 요청에 결속된 bytes/hash가 달라졌습니다. 후보를 만들지 않고 새 source snapshot을 요구합니다. |
| `source_structure_invalid` / `block_not_found` / `legacy_marker_not_writable` | 안전한 표준 managed block 하나를 확정할 수 없습니다. 원본과 이전 marker를 유지하며 파일을 쓰지 않습니다. |
| `replacement_invalid_utf8` / `replacement_too_large` / `no_changes` | Replacement가 입력 계약을 어겼거나 실제 변경이 아닙니다. Candidate artifact와 output을 만들지 않습니다. |
| `output_structure_invalid` / `candidate_contract_invalid` | 결과 Markdown의 구조·보존 조건 또는 candidate schema를 증명하지 못했습니다. 검토나 적용 가능한 결과로 공개하지 않습니다. |
| `invalid_staleness_request` | Manifest, repository snapshot, 판정 시각 또는 managed input 관측이 일관된 노후화 근거가 아닙니다. 결과를 만들지 않고 입력을 다시 수집합니다. |
| `staleness_contract_invalid` | 계산된 노후화 결과가 공개 schema를 통과하지 못했습니다. `current`, `stale`, `unknown` 어느 상태로도 보고하지 않습니다. |
| `invalid_verification_suite` / `verification_suite_not_found` / `verification_layout_invalid` | Project verification suite를 유효하고 안전한 원본으로 읽지 못했습니다. 명령을 시작하지 않고 검증을 통과로 표시하지 않습니다. |
| `invalid_verification_request` / `command_working_directory_invalid` | Repository snapshot, clock, root 또는 command cwd가 실행 계약에 맞지 않습니다. 전체 suite를 시작하지 않습니다. |
| `repository_snapshot_failed` / `repository_snapshot_mismatch` | Snapshot을 안전하게 수집하지 못했거나 요청 revision과 실행 직전 상태가 다릅니다. 명령을 시작하지 않습니다. |
| `repository_changed_during_verification` | 명령 실행 중 repository snapshot이 바뀌었습니다. 저장된 output만으로 정상 result를 만들지 않고 새 snapshot에서 다시 검증합니다. |
| `result_contract_invalid` | Verification 결과의 상태, suite·command 결속 또는 artifact 좌표가 서로 다릅니다. 정상 verification result와 `passed` 상태를 공개하지 않습니다. |
| `verification_failed` | 필수 suite가 실패했거나 검증 port의 결과 schema·suite·repository revision·canonical CAS 원본을 확인할 수 없습니다. `run.completed`를 만들지 않고 새 run에서 다시 검증합니다. |
