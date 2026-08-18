# Roven 실행 및 증거 규격

상태: `0.1-draft`  
기준일: 2026-08-18

## 목적

이 문서는 “DD 기능 개발”, “DD 기능 개발 중 발생한 버그 수정” 같은 요청이 Roven에서 어떻게 실행되고, 문서 읽기와 스킬 사용을 어디까지 보장하는지 정의합니다.

## 로컬 프로젝트 초기화

`roven init`은 실행 상태 저장소를 만들기 전에 project identity를 고정합니다. `--dry-run`과 실제 적용은 같은 `InitPlan` 형식을 사용합니다. 계획에는 각 경로가 새로 생성되는지, 그대로 유지되는지, 충돌 때문에 적용할 수 없는지가 표시됩니다. 새 파일은 전체 본문을 diff 형태로 보여줍니다.

첫 슬라이스가 관리하는 경로는 다음과 같습니다.

- `.roven/project.yaml`: stable project id, 생성 시각과 로컬 우선 데이터 기본값
- `.roven/documents.yaml`: schema-valid 빈 문서 registry
- `.roven/.gitignore`: `state/` 제외 규칙
- `.roven/generated/`, `.roven/state/`, `.roven/knowledge/`: 이후 단계가 사용할 로컬 디렉터리

기존 project/document 설정은 YAML 구문과 현재 JSON Schema를 통과할 때만 그대로 사용합니다. 일반 파일이 아닌 항목과 심볼릭 링크는 따라가지 않습니다. 충돌이 하나라도 있거나 계획을 만든 뒤 대상이 바뀌면 아무 파일도 만들기 전에 적용을 중단합니다. `README.md`, `AGENTS.md`, `CLAUDE.md`를 포함한 사용자 파일은 이 단계에서 수정하지 않습니다.

## 로컬 storage 개방

실행 진입점은 저장소 root에서 계산한 공통 경로로 event/outbox와 CAS를 함께 엽니다. 순서는 다음과 같습니다.

1. 저장소 root가 실제 디렉터리인지 확인하고 심볼릭 링크를 거부합니다.
2. `.roven/project.yaml`을 읽어 현재 schema로 검증합니다.
3. `.roven`과 `.roven/state`, 이미 존재하는 CAS 구성 경로가 실제 디렉터리인지 확인하고 심볼릭 링크를 거부합니다.
4. Manifest의 project id로 `.roven/state/events.sqlite`를 엽니다. 이미 다른 project에 묶인 database는 거부합니다.
5. `.roven/state/cas`를 엽니다.

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

파일 변경 capability는 `context_prepared` 이전에 열리지 않습니다. 필수 context receipt가 무효화되면 다시 준비 상태로 돌아갑니다.

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

이 슬라이스는 새 event type을 추가하지 않습니다. E1은 기존 `context.selected`, E2는 `document.loaded`, 위 사유는 `context.invalidated`에 대응합니다. Event payload에는 문서 본문을 넣지 않고 ID, hash, byte count, scope, source revision과 기계용 reason만 저장합니다.

잘못된 path/rule, 중복 ID·경로, 다른 수신 Role의 handoff, 등록되지 않은 shared 문서와 유효하지 않은 evidence는 `contract_validation_failed`입니다. 문서 부재·안전하지 않은 경로·읽기 중 변경·handoff hash 불일치와 snapshot 무효화는 `required_context_missing`으로 쓰기 전에 다시 준비합니다. 오류와 event에는 원문 bytes, raw prompt, credential이나 provider payload를 넣지 않습니다.

## 문서 보장 수준

Roven은 아래 상태를 분리합니다.

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

## 별도로 실행한 코딩 에이전트

별도 Codex/Claude 프로세스가 파일을 수정하는 것 자체를 금지하지 않습니다. 다만 `roven run` 또는 등록된 hook/plugin을 거치지 않으면 Roven은 그 프로세스의 컨텍스트 주입과 도구 호출을 증명할 수 없습니다.

이 경우 Roven은 다음만 할 수 있습니다.

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
- `knowledge.candidate.created`, `document.stale.detected`
- `unmanaged_change.detected`, `sync.acknowledged`

M0 구현에서 모든 event payload는 type별 allowlist를 통과합니다. 키는 Unicode 호환 정규화 후 구분 기호와 대소문자를 제거해 검사하므로 `rawPrompt`, `access_token`, 전각 문자 변형도 같은 민감 키로 취급합니다. raw prompt, 문서 본문, authorization/cookie/credential/password/secret/token/API key/tool input 같은 민감 키는 중첩 객체에서도 event에 보존하지 않습니다. 순환 참조, 유한하지 않은 숫자, 일반 JSON 객체가 아닌 값은 정리된 것처럼 저장하지 않고 `redaction_failed`로 기록을 중단합니다. 파일 경로와 작업 디렉터리는 저장소 상대 경로만 허용합니다. 원문이 필요한 실행 경로는 event payload와 분리된 로컬 context envelope/CAS를 사용합니다.

`context.published`에는 shared context/document ID, content hash, 생산 역할, 공개 방식과 허용 역할, 만료 시각만 저장합니다. `handoff.created`에는 handoff ID, 보내고 받는 역할, shared context/evidence event ID와 요청 digest만 저장합니다. 두 event 모두 문서 본문, raw prompt, 내부 추론과 provider payload를 허용하지 않습니다. 이 event를 기록하지 못하면 역할 간 공유가 성립했다고 주장하지 않고 `telemetry_recording_failed`로 실행을 중단합니다. `context.published`는 다른 역할이 읽었다는 뜻이 아니며, 수신 역할의 `document.loaded`와 `context.injected`가 별도로 필요합니다.

## 로컬 event store, outbox와 CAS

로컬 event store는 `.roven/state/events.sqlite`를 기본 경로로 사용하며 하나의 project id에 묶입니다. Event를 추가할 때 raw payload를 먼저 type별 allowlist와 민감 키 제거 규칙으로 정리합니다. 그 뒤 project 전체의 다음 `seq`, 직전 event hash, 현재 event hash를 한 SQLite transaction에서 계산하고 저장합니다. Schema는 `PRAGMA user_version` 기반 migration으로 올립니다. 공통 `transact` 경계는 동기 callback만 허용하고 실패 시 callback 안의 기록을 모두 되돌립니다. Outbox는 이 transaction을 확장해 event insert와 enqueue를 같은 commit에 넣습니다.

Event hash는 `eventHash`를 제외한 envelope 전체를 대상으로 합니다. 객체 key를 정렬하고 배열 순서를 유지하는 결정적 JSON 직렬화를 사용합니다. 첫 event는 `seq=1`, `previousHash=null`이며 이후 event는 바로 앞 project event의 hash를 가리킵니다. 같은 event id가 다시 오면 정리된 내용이 같을 때만 기존 event를 반환합니다. 내용이 다르면 `event_id_conflict`로 거부합니다.

SQLite는 WAL과 `synchronous=FULL`을 사용합니다. `UPDATE`와 `DELETE`는 trigger로 막습니다. Store를 열 때 database `quick_check`, schema, 연속된 seq, previous hash와 event hash를 다시 검증합니다. Event schema 위반, project 불일치, event id 충돌 또는 무결성 실패는 commit 전에 transaction을 되돌립니다. Event 기록이나 무결성 확인 실패는 상위 실행에서 `telemetry_recording_failed`로 처리하므로 변경 capability가 열리지 않습니다.

Outbox는 변경 가능한 전송 상태이며 실행 증거 원본을 대신하지 않습니다. 필수 좌표는 `eventId`, `destinationId`, `enqueuedAt`, `availableAt`, `attemptCount`입니다. 모든 입력 시각은 timezone을 명시해야 하며 SQLite에는 UTC ISO 8601 형식으로 정규화해 저장합니다. 상태 의미는 다음과 같습니다.

- `pending`: ack되지 않았고 현재 lease가 없습니다. `availableAt` 이후 가져갈 수 있습니다.
- `leased`: `workerId`, `claimedAt`, `expiresAt`이 함께 있으며 해당 worker만 lease 유효 구간 안에서 ack 또는 재시도를 예약할 수 있습니다.
- `acknowledged`: `acknowledgedAt`이 있으며 다시 배송하지 않습니다. 같은 ack 요청은 성공한 상태를 유지하는 no-op입니다.

멱등 키는 `(eventId, destinationId)`입니다. 한 event를 여러 destination에 독립적으로 보낼 수 있지만 같은 destination에는 한 항목만 둡니다. Claim할 때 `attemptCount`가 증가하며, 만료된 lease는 다른 worker가 회수할 수 있습니다. 실패한 전송은 lease를 놓고 `lastFailureCode`, `lastFailedAt`, 새 `availableAt`만 기록합니다. Failure code는 64자 이하의 소문자 기계용 코드로 제한하며 HTTP 응답 본문, 예외 메시지, authorization 값과 provider payload는 저장하지 않습니다. 배송할 event는 이미 allowlist와 redaction을 통과한 envelope입니다.

Event append와 enqueue, 또는 ack와 `sync.acknowledged` event 기록은 같은 동기 transaction에 넣을 수 있습니다. 둘 중 하나가 실패하면 모두 되돌립니다. Hub가 없거나 전송만 실패한 경우 기존 event 원본은 유지하고 로컬 run을 계속합니다. `invalid_outbox_request`는 호출 계약 위반, `outbox_not_found`는 존재하지 않는 event 또는 배송 좌표, `outbox_lease_conflict`는 다른 worker의 lease나 만료된 lease 사용을 뜻합니다. 이 세 오류의 상세 문자열은 event에 복제하지 않습니다. Outbox 무결성이나 외래 키 검사가 실패하면 store를 열지 않고 `telemetry_recording_failed`로 처리합니다.

Ack된 outbox 행은 보존 정책의 기준 시각보다 오래된 항목만 제한된 개수로 삭제할 수 있습니다. 이 정리는 event와 hash chain을 삭제하지 않으며, pending 또는 leased 항목을 건드리지 않습니다.

CAS는 원문 bytes의 SHA-256으로 주소를 정합니다. 반환 형식은 `roven-cas://sha256/<64 hex>`이며 원문은 `.roven/state/cas` 아래에만 둡니다. 큰 입력은 청크를 임시 파일에 쓰는 동안 hash와 byte count를 계산합니다. 생산자가 중간에 실패하면 임시 파일을 제거하고 object를 공개하지 않습니다. 새 object는 쓰기와 동기화를 끝낸 뒤 원자적인 hard link로 확정합니다. 같은 bytes는 기존 object를 재사용하고, 저장하거나 읽을 때 주소와 실제 bytes의 hash를 비교합니다. 유효한 주소가 없으면 `not_found`, bytes가 주소와 다르면 `corrupt_object`, 경로가 안전하지 않으면 `unsafe_path`입니다. `has`는 `not_found`만 `false`로 바꾸며 변조를 숨기지 않습니다. 세 경우 모두 상위 실행에서는 `artifact_storage_failed`로 처리합니다. 이 실패가 난 artifact에 의존하는 변경은 중단하며, 원문이나 비밀 값은 실패 event에 넣지 않고 digest와 오류 code만 기록합니다.

## M0 직렬화 계약

현재 구현은 다음 열한 계약을 JSON Schema Draft 2020-12와 동일 원본에서 파생된 TypeScript 타입으로 제공합니다.

- project manifest: stable project id, schema version, 생성 시각, 명시적 데이터 정책
- event envelope: 단조 증가 seq, actor/provider, 정책 version, previous/event hash
- context evidence: E0~E4별 필수 필드와 controlled E3 receipt
- adapter message: descriptor, start/session, context envelope/receipt, normalized event, stop/result
- role profile: 요청 유형, 필수 입력 schema, E3 context policy, 전체 capability matrix, 산출물·검증·handoff 계약
- shared context publication: 등록 문서와 hash, 생산 역할/run/session, 접근 범위, 민감도, 근거와 만료
- handoff bundle: 보내고 받는 역할, 생산 context generation, 요청 digest, shared context와 evidence 좌표
- skill manifest: 출처·publisher·version/hash, 역할, provider/runtime/tool 호환성, capability, 입출력 schema, trust와 enabled scope
- document registry: 상대 경로, 책임자, 연결 경로, 검증 revision/date, review interval, 사용자/managed block/Roven 생성 파일 소유권
- writing policy: 독자와 surface, 정보 순서, 문장·문단·용어·행동·근거 규칙, 필수 결정적/의미 검사
- writing evaluation: artifact/content hash, 검사자와 별도 의미 검사 단계, 검사별 상태, 전체 공개 가능 상태

E3 쓰기 게이트는 `selected`, 같은 hash의 `loaded`, 같은 context generation의 controlled `injected`가 모두 있어야 통과합니다. receipt 하나가 다른 단계를 대신할 수 없습니다. 구체적인 기본값은 [ADR-0001](./docs/adr/0001-m0-contracts-and-data-defaults.md)에 정의합니다.

Role의 `sensitive` 입력 필드는 입력값이 아니라 redaction 필요 여부만 선언합니다. Skill의 source URI, publisher/reviewer id와 document의 responsible party/path는 로컬 registry metadata이며 기본 event payload나 Hub 전송 대상이 아닙니다. Hub 동기화는 project policy에서 명시적으로 활성화하고 허용 필드를 정해야 합니다.

## 사람 대상 writing 계약

사람이 읽는 산출물은 기계용 식별자와 설명 문장을 섞지 않습니다. 식별자는 원형을 보존하고, 본문은 목적이나 결론부터 시작합니다. 그 뒤에 이유, 결과와 영향, 다음 행동, 근거, 필요한 기술 세부사항을 산출물에 맞는 순서로 적습니다.

기본 한국어 정책은 완전한 문장과 이어지는 문단을 요구합니다. 한 문장에는 주요 사실 하나를 담고, 번역투와 명사 조각 나열을 피합니다. 내부 용어는 처음 나올 때 뜻을 설명하고, 추상적인 주체에게 확인이나 판단을 떠넘기는 표현 대신 대상과 행동을 직접 적습니다.

검증은 두 층으로 나뉩니다.

- 결정적 검사: 금지된 문장 부호, 추상적인 행동 주체, 빈 Markdown 섹션, 정책이 정한 모호한 용어를 검사합니다.
- 의미 검사: 한국어가 자연스러운지, 문단 맥락이 이어지는지, 독자가 이해할 말인지, 결과와 다음 행동이 구체적인지를 생성과 분리된 모델 또는 사람이 평가합니다.

결정적 검사는 자연스러움을 증명하지 않습니다. 의미 검사가 실행되지 않은 상태도 통과로 보지 않습니다. 정책 ID, artifact ID, content hash, locale가 평가 대상과 다르거나 필수 검사 하나라도 실패하면 `writing_verification_failed`로 공개를 막습니다. 평가 기록에는 원문을 복제하지 않고 hash, 상태, 위반 수와 evidence digest만 저장합니다.

## 스킬 해석과 사용 기록

실행 전 registry는 동일 id의 후보를 다음 순서로 해석합니다.

1. 프로젝트에서 고정한 버전
2. 프로젝트 로컬 스킬
3. 사용자 전역 스킬
4. 조직/외부 registry 스킬

정확한 우선순위는 정책으로 바꿀 수 있지만 결과는 lock과 `skill.resolved`에 기록됩니다. 호환성은 provider 이름만 보지 않고 필요한 도구, filesystem/network 권한, 입력/출력 schema, 최소 runtime version으로 판정합니다.

기록 내용:

- 선택/탈락 후보와 이유
- source, version, content hash, trust status
- 부여된 capability와 승인
- 호출 시각, 입력의 비밀 제거 digest, 출력 artifact
- 성공/실패와 검증 결과

스킬의 프롬프트 전체나 비밀 입력을 Hub로 기본 전송하지 않습니다.

## 문서 생성과 노후화

Roven은 문서를 세 유형으로 다룹니다.

- `canonical`: 사람이 검토하는 원본
- `generated`: canonical policy에서 생성되는 provider 호환 문서/블록
- `observed`: Roven이 소유하지 않지만 수명주기를 점검하는 기존 문서

`AGENTS.md`를 공통 canonical 진입점으로 쓰고 `CLAUDE.md`에는 해당 지침을 연결하는 얇은 호환 블록을 둘 수 있습니다. 프로젝트가 반대 방향을 선택해도 manifest에 명시하면 됩니다.

노후화 판정 신호:

- `verifiedRevision` 이후 연결된 `paths` 변경
- `reviewIntervalDays` 초과
- 문서가 언급한 명령/파일/스킬/정책 target 부재
- managed block의 입력 hash 불일치
- 실행 실패나 반복 질문으로 드러난 지침 누락

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

## 실패 의미

| code | 실패 의미 |
|---|---|
| `telemetry_recording_failed` | 변경 capability를 닫고 run을 중단합니다. |
| `redaction_failed` | 민감정보가 섞인 event를 생략해 진행하지 않고 변경 capability를 닫습니다. |
| `hub_sync_failed` | 로컬 run은 계속하고 outbox에 보관합니다. |
| `derived_index_failed` | 명시적 경로와 전문 검색으로 저하 운전합니다. |
| `required_context_missing` | 필수 문서 부재, hash/scope 불일치, 오래된 context generation을 포함하며 쓰기 전에 중단합니다. |
| `provider_capability_unsupported` | capability matrix에 따른 낮은 assurance를 명시하거나 정책상 차단합니다. |
| `contract_validation_failed` | project, role, skill, document 또는 adapter 계약이 유효하지 않으므로 run 시작과 변경 capability를 차단합니다. 파일을 수정한 뒤 새 검증으로 다시 시작해야 하며 자동 재시도하지 않습니다. |
| `writing_verification_failed` | 사람 대상 산출물의 정책 좌표가 다르거나 필수 결정적/의미 검사가 누락 또는 실패했습니다. 로컬 run의 변경은 유지하지만 공개를 막고, 산출물을 고친 뒤 다시 평가할 수 있습니다. |
| `artifact_storage_failed` | CAS object를 안전하게 저장하거나 hash로 검증할 수 없습니다. 해당 artifact에 의존하는 변경을 차단하고 원문 없이 code와 digest만 기록한 뒤 재시도할 수 있습니다. |
