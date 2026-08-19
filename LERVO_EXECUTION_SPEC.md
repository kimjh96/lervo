# Lervo 실행 및 증거 규격

상태: `0.1-draft`  
기준일: 2026-08-19

## 목적

이 문서는 “DD 기능 개발”, “DD 기능 개발 중 발생한 버그 수정” 같은 요청이 Lervo에서 어떻게 실행되고, 문서 읽기와 스킬 사용을 어디까지 보장하는지 정의합니다.

## 로컬 프로젝트 초기화

`lervo init`은 실행 상태 저장소를 만들기 전에 project identity를 고정합니다. `--dry-run`과 실제 적용은 같은 `InitPlan` 형식을 사용합니다. 계획에는 각 경로가 새로 생성되는지, 그대로 유지되는지, 충돌 때문에 적용할 수 없는지가 표시됩니다. 새 파일은 전체 본문을 diff 형태로 보여줍니다.

첫 슬라이스가 관리하는 경로는 다음과 같습니다.

- `.lervo/project.yaml`: stable project id, 생성 시각과 로컬 우선 데이터 기본값
- `.lervo/documents/`: document ID별 sidecar manifest를 둘 빈 디렉터리
- `.lervo/verifications/`: suite ID별 project 검증 명령을 둘 빈 디렉터리
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

`write_authorized`는 실제 파일 변경이 아닙니다. 현재 generation, 정규화된 대상 상대 경로, 대상 digest와 허가 시점의 실제 before hash에 묶인 1회용 permit가 발급된 상태입니다. 다른 경로, 다른 generation 또는 이미 소비한 permit로 `file.changed`를 기록할 수 없습니다. 변경 뒤 저장소 파일을 안전하게 다시 읽은 실제 after hash도 일치해야 합니다. Role의 `filesystem.write`가 `deny`면 `capability.decided=deny`, `require_approval`이면 검증된 승인 원본이 아직 없으므로 `capability.decided=require_approval`을 기록하고 permit를 발급하지 않습니다.

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

E1에는 선택 이유, rule ID, 필수 여부, scope와 정책 version만 있습니다. E2 loader는 plan이 현재 project/run/session의 E0/E1만 포함하고 모든 문서·선택 이유와 대응하는지 먼저 확인합니다. 다른 run의 receipt나 이미 만들어진 E2/E3를 넣은 plan은 `invalid_context_plan`으로 거부합니다. 그 뒤 각 파일을 전체 bytes로 읽고 SHA-256, byte count, source revision을 기록합니다. Handoff 문서는 publication의 hash와 현재 bytes가 일치해야 합니다. 한 문서라도 없거나 안전하지 않거나 읽는 중 바뀌거나 예상 hash와 다르면 적재 결과와 E2 묶음을 반환하지 않습니다. 사용자 문서를 수정하거나 timestamp를 갱신하지 않습니다.

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

Orchestrator는 준비가 성공하면 모든 E1 `context.selected`와 E2 `document.loaded`를 한 transaction에 기록합니다. E3는 검증된 aggregate adapter receipt를 받은 뒤 `context.injected`로 기록합니다. 이 기록이 commit된 뒤에만 메모리 evidence를 전진시킵니다.

| event | 이 슬라이스의 필수 payload |
|---|---|
| `context.selected` | `documentId`, `reasonCode`, `ruleId`, `required`, `scope` |
| `document.loaded` | `evidenceReceiptId`, `documentId`, `contentHash`, `byteCount`, `scope`, `sourceRevision` |
| `context.injected` | `receiptId`, `evidenceReceiptIds`, `envelopeId`, `documentIds`, `targetTurnId`, `contextGeneration` |
| `capability.requested` | `capability=filesystem.write`, `targetDigest`, `risk` |
| `capability.decided` | `capability`, `decision`, `policyRuleId=managed_context_e3`, `approvalId` |
| `file.changed` | Permit와 실제 저장소 상태로 확인한 `path`, `beforeHash`, `afterHash`, `changeKind` |
| `context.invalidated` | `documentIds`, 기계용 `reason`, 무효화된 `contextGeneration` |

E1 하나에 선택 이유가 여러 개면 `context.selected`를 이유별로 보존합니다. `context.invalidated.contextGeneration`은 증가하기 전의 무효화 대상 generation이며, event commit 뒤 메모리 generation을 하나 올립니다. Snapshot invalidation reason이 여러 개면 reason별 event를 같은 transaction에 기록하고 generation은 한 번만 올립니다.

Capability 요청과 결정, `file.changed`와 뒤따르는 `context.invalidated`도 각각 한 transaction입니다. 일부 append, event payload redaction 또는 저장 실패가 발생하면 transaction 전체를 되돌리고 `telemetry_failed`로 전환합니다. 이 상태에서는 새 permit를 발급하지 않으며 pending permit와 과거 E3를 사용할 수 없도록 generation을 올립니다. Hub/outbox는 이 로컬 gate의 선행 조건이 아닙니다.

이 event에는 지침 본문, inline context, raw prompt, provider 응답과 credential을 저장하지 않습니다. 상대 경로, ID, hash, byte count, scope, 기계용 reason과 receipt 좌표만 원본 telemetry로 남깁니다. 파일 변경 기록 실패가 이미 일어난 filesystem mutation을 되돌렸다고 주장하지 않으며, run을 중단하고 이후 unmanaged change 탐지 대상이 되게 합니다.

### 중앙 화면의 표현

각 문서를 다음과 같이 보여줍니다.

- 문서명과 revision/content hash
- 선택 이유: 경로 일치, 역할 필수, 상위 지침, 명시 링크, 역할 handoff, 검색 추천
- E0~E4 상태와 시각
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
- `context.selected`, `document.loaded`, `context.injected`, `context.invalidated`
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

Event append와 enqueue, 또는 ack와 `sync.acknowledged` event 기록은 같은 동기 transaction에 넣을 수 있습니다. 둘 중 하나가 실패하면 모두 되돌립니다. Hub가 없거나 전송만 실패한 경우 기존 event 원본은 유지하고 로컬 run을 계속합니다. `invalid_outbox_request`는 호출 계약 위반, `outbox_not_found`는 존재하지 않는 event 또는 배송 좌표, `outbox_lease_conflict`는 다른 worker의 lease나 만료된 lease 사용을 뜻합니다. 이 세 오류의 상세 문자열은 event에 복제하지 않습니다. Outbox 무결성이나 외래 키 검사가 실패하면 store를 열지 않고 `telemetry_recording_failed`로 처리합니다.

Ack된 outbox 행은 보존 정책의 기준 시각보다 오래된 항목만 제한된 개수로 삭제할 수 있습니다. 이 정리는 event와 hash chain을 삭제하지 않으며, pending 또는 leased 항목을 건드리지 않습니다.

CAS는 원문 bytes의 SHA-256으로 주소를 정합니다. 반환 형식은 `lervo-cas://sha256/<64 hex>`이며 원문은 `.lervo/state/cas` 아래에만 둡니다. 큰 입력은 청크를 임시 파일에 쓰는 동안 hash와 byte count를 계산합니다. 생산자가 중간에 실패하면 임시 파일을 제거하고 object를 공개하지 않습니다. 새 object는 쓰기와 동기화를 끝낸 뒤 원자적인 hard link로 확정합니다. 같은 bytes는 기존 object를 재사용하고, 저장하거나 읽을 때 주소와 실제 bytes의 hash를 비교합니다. 유효한 주소가 없으면 `not_found`, bytes가 주소와 다르면 `corrupt_object`, 경로가 안전하지 않으면 `unsafe_path`입니다. `has`는 `not_found`만 `false`로 바꾸며 변조를 숨기지 않습니다. 세 경우 모두 상위 실행에서는 `artifact_storage_failed`로 처리합니다. 이 실패가 난 artifact에 의존하는 변경은 중단하며, 원문이나 비밀 값은 실패 event에 넣지 않고 digest와 오류 code만 기록합니다.

## M0 직렬화 계약

현재 구현은 다음 계약을 JSON Schema Draft 2020-12와 동일 원본에서 파생된 TypeScript 타입으로 제공합니다.

- project manifest: stable project id, schema version, 생성 시각, 명시적 데이터 정책
- event envelope: 단조 증가 seq, actor/provider, 정책 version, previous/event hash
- deliberation event payload: started/recorded/completed별 필수 hash 좌표와 상태별 decision/failure 규칙
- context evidence: E0~E4별 필수 필드와 controlled E3 receipt
- adapter message: descriptor, start/session, context envelope/receipt, normalized event, stop/result
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

`lervo trace [last|run-id]`는 SQLite hash chain을 확인한 뒤 해당 run의 allowlist event만 순서대로 텍스트 또는 JSON으로 반환합니다. `lervo doctor`는 project storage와 event chain을 열고 candidate, review, verified와 stale CAS schema/hash/ID 및 각 event 연결을 읽기 전용으로 역검증합니다. 이어서 문서 registry와 등록 원본, 프로젝트·사용자 스킬 package와 실행별 lock, Codex와 Claude 실행 파일을 서로 다른 항목으로 검사합니다.

각 검사는 `healthy`, `unhealthy`, `unknown` 중 하나입니다. 계약을 끝까지 확인한 항목만 `healthy`이고, 손상·누락·stale 원본을 직접 확인하면 `unhealthy`입니다. 선행 원본이나 실행 환경이 없거나 안전한 probe가 끝나지 않으면 `unknown`입니다. 전체 판정은 `unhealthy`, `unknown`, `healthy` 순서로 우선하며 모든 항목이 `healthy`일 때만 종료 코드 0입니다.

Provider probe는 adapter가 정한 실행 파일에 shell 없이 `--version`만 호출합니다. 5초와 16 KiB로 제한하고 첫 ASCII 문장 최대 200자만 version으로 남깁니다. 이 성공은 인증, 네트워크, 모델 접근이나 실제 session 성공을 증명하지 않습니다. Issue에는 절대 경로, 문서·스킬 본문, publisher, credential, 환경 변수와 raw provider output을 넣지 않으며 doctor는 event를 만들지 않습니다. 상세 결정은 [ADR-0030](./docs/adr/0030-evidence-bound-knowledge-candidates.md), [ADR-0031](./docs/adr/0031-reviewed-verified-knowledge-lifecycle.md)과 [ADR-0033](./docs/adr/0033-bounded-environment-doctor.md)에 기록합니다.

## Hub 등록과 outbound event sync

Project registration은 전체 `ProjectManifest`, `schemaVersion`·project ID·생성 시각에 결속된 identity hash, manifest hash, destination ID와 요청 시각을 가집니다. Manifest의 `hubSyncEnabled`가 true이고 event payload mode가 `allowlist`인 경우에만 만들 수 있습니다. 등록 상태는 `registered`, `updated`, `unchanged`이며 이름과 data policy 변경은 같은 identity의 갱신입니다. 같은 destination과 project 좌표에 다른 생성 identity를 자동 병합하지 않습니다.

`OutboundEventBatch`는 하나의 registration·project·destination에 속한 event 1~100개를 seq와 hash chain 순서로 가집니다. 첫·마지막 seq, 앞 hash, head hash와 canonical batch ID를 중복 검증합니다. Event는 local schema와 hash를 다시 계산하고 payload allowlist가 어떤 field도 제거하지 않는 경우에만 포함합니다. Artifact와 원문은 이번 sync 계약에 포함하지 않습니다.

Hub는 같은 canonical event 재전송을 duplicate로 수락할 수 있고 gap 뒤 event를 먼저 보관할 수 있습니다. Cursor는 `{seq: 0, eventHash: null}`에서 시작해 seq와 previous hash가 연속된 구간까지만 전진합니다. Ack는 batch의 event ID 전체, inserted·duplicate 개수, `accepted` 또는 `duplicate` 상태, 현재 cursor와 buffered event 개수를 포함합니다.

공통 reducer는 Hub가 저장할 다음 state와 응답 후보만 계산하며 durable 저장이나 network 성공을 주장하지 않습니다. Hub handler는 registration·event inbox·cursor를 하나의 transaction으로 저장한 뒤 응답해야 합니다. Node는 구성된 destination의 인증된 transport 응답과 batch 좌표 전체를 검증한 뒤 현재 outbox lease를 ack합니다. 이 연결 전에는 `sync.acknowledged` event를 만들지 않습니다. 상세 상태, 개인정보 경계와 실패 의미는 [ADR-0034](./docs/adr/0034-project-registration-and-event-sync-contract.md)에 기록합니다.

## 실패 의미

| code | 실패 의미 |
|---|---|
| `telemetry_recording_failed` | 변경 capability를 닫고 run을 중단합니다. Document migration에서는 성공 event를 commit하지 못한 것으로 보고 이번 apply가 만든 sidecar를 모두 되돌립니다. |
| `redaction_failed` | 민감정보가 섞인 event를 생략해 진행하지 않고 변경 capability를 닫습니다. |
| `hub_sync_failed` | 로컬 run은 계속하고 outbox에 보관합니다. |
| `derived_index_failed` | 명시적 경로와 전문 검색으로 저하 운전합니다. |
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
