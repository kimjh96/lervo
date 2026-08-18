# ADR-0001: M0 계약과 데이터 기본값

상태: `accepted`  
기준일: 2026-08-18

## 맥락

Lervo의 첫 구현은 공급자 구현보다 먼저 project, event, context evidence, adapter 경계를 고정해야 한다. 타입과 런타임 검증 규격이 따로 관리되면 Codex와 Claude가 서로 다른 의미를 구현하거나, 텔레메트리가 증명하지 못한 상태를 채우게 될 위험이 있다. 사람 대상 글도 공급자의 기본 말투에 맡기면 번역투, 명사 조각, 이어지지 않는 문단이 다시 생길 수 있다. 기존 Actverse writing rule과 공개 전 guard 경험을 참고해 provider 중립 writing 계약을 M0에 포함한다. 개인정보와 로컬 보존 기본값도 event store 구현 전에 결정되어야 한다.

## 결정

### 계약 원본

- JSON Schema Draft 2020-12 객체를 `@lervo/schemas`의 TypeScript 상수로 관리한다.
- TypeScript 타입은 `json-schema-to-ts`로 같은 객체에서 추론한다.
- 외부 저장 형식은 schema version `1`, RFC 3339 timestamp, `sha256:<64 hex>` 콘텐츠 해시를 사용한다.
- project/run/session/event/document/receipt id는 접두사가 있는 opaque id이며 내부 생성 알고리즘을 공개 계약으로 고정하지 않는다.

### 컨텍스트 증거와 쓰기 게이트

- `discovered(E0)`, `selected(E1)`, `loaded(E2)`, `injected(E3)`, `referenced(E4)`는 하나의 가변 상태가 아니라 각각 고유 필드를 가진 판별 가능한 receipt다.
- 쓰기 게이트는 같은 project/run/session의 E1→E2→E3 체인이 모두 있어야 열린다.
- E2와 E3의 content hash가 현재 필수 문서 hash와 일치해야 한다.
- E3는 현재 context generation과 일치하고 `controlledInput: true`여야 한다.
- E3는 이해나 준수를 뜻하지 않는다. 결과의 명시적 참조만 E4로 기록한다.

### 어댑터 계약

- 모든 공급자 어댑터는 descriptor, start request/session, context envelope/receipt, normalized event, stop request/result 계약을 구현한다.
- capability는 `supported`, `unsupported`, `unknown` 중 하나로 명시하며 관측하지 못한 값을 추정하지 않는다.
- context receipt는 전달한 envelope의 좌표, generation, 문서 hash와 scope를 그대로 확인해야 유효하다.
- start/session/context envelope/receipt는 같은 role과 writing policy ID를 유지한다. writing 정책이 있으면 정책 원문 문서 ID와 hash가 envelope와 receipt에 포함되어야 한다.
- v0 context envelope는 본문을 메모리에서 직접 전달하는 `inline`과 손실 없는 로컬 CAS 참조인 `cas`를 허용한다.

### 역할 계약

- Role은 persona가 아니라 요청 유형, 입력 schema, context policy, capability, 산출물, 검증과 handoff의 계약이다.
- 파일 읽기/쓰기, 셸 실행, 네트워크, 외부 메시지, 배포, 데이터 변경 capability를 모두 `allow`, `deny`, `require_approval` 중 하나로 명시한다. 누락은 계약 오류다.
- 변경 가능한 역할의 최소 context assurance는 E3이며, handoff에는 evidence link가 필수다.
- 산출물 위치는 저장소 상대 경로만 허용한다.
- 사람 또는 혼합 독자용 산출물은 locale과 writing policy ID가 필수다. 기계 전용 산출물에는 writing 정책을 적용하지 않는다.

### 사람 대상 writing 계약

- 정책은 하나의 고정 문안이 아니라 적용 surface, 독자, 정보 순서, 문장과 문단, 용어, 행동 표현, 근거와 검증 요구를 정의한다. Role의 artifact 종류가 사용할 정책을 선택한다.
- 기본 한국어 정책은 목적이나 결론을 먼저 말하고, 완전한 문장과 이어지는 문단을 사용한다. 번역투와 명사 조각 나열을 피하고 내부 용어는 처음 등장할 때 뜻을 설명한다.
- 기계 식별자는 원형을 보존하되 사람 대상 제목, 상태, 설명과 구분한다. 추상적인 주체에게 확인이나 판단을 떠넘기지 않고 대상과 행동을 직접 적는다.
- 결정적 검사는 명백한 금지 형태만 찾는다. 정규식 통과를 자연스러운 한국어의 증거로 사용하지 않는다.
- 자연스러움, 문단 맥락, 독자에게 맞는 표현, 구체적인 결과와 행동은 생성과 분리된 모델 또는 사람의 의미 검사로 평가한다.
- 필수 의미 검사가 실행되지 않은 상태는 통과가 아니다. 모든 검사가 통과하고 정책/artifact/content hash/locale가 일치할 때만 공개 게이트가 열린다.

### 스킬 계약

- Skill은 source/publisher, version/content hash, 지원 role, provider/runtime/platform/tool 호환성, 필요 capability, 입출력 schema, trust와 enabled scope를 기록한다.
- provider 호환성은 `any` 또는 allowlist로 표현하며 확인할 수 없는 호환성은 지원으로 간주하지 않는다.
- `reviewed`는 reviewer와 review timestamp가 필요하고, `verified`는 여기에 유효한 서명이 추가되어야 한다.
- Manifest에는 민감한 실제 입력이 아니라 schema reference와 digest 가능한 metadata만 둔다.

### 문서 registry 계약

- Registry는 document id를 key로 사용해 중복 id를 구조적으로 방지한다.
- `observed` 문서는 `user` 소유만 허용하고 Lervo가 자동 수정하지 않는다.
- `canonical` 문서는 `user` 또는 `managed_blocks`, `generated` 문서는 `managed_blocks` 또는 `lervo_generated`만 허용한다.
- `managed_blocks`는 블록 밖을 `preserve`하고 생성 입력의 id/hash를 기록한다.
- `lervo_generated`는 사용자 내용이 없는 전용 파일이며 생성 manifest와 입력 hash를 기록한다.
- Managed block marker의 구체 문법과 parser 선택은 M4 전 별도 ADR로 남긴다.

### 개인정보·보존 기본값

| 항목 | 기본값 |
|---|---|
| 이벤트 metadata 로컬 보존 | 90일 |
| 원문 artifact 로컬 보존 | 30일 |
| raw prompt event 저장 | 비활성 |
| 문서 본문 event 저장 | 비활성 |
| Hub 동기화 | 비활성 |
| event payload 처리 | event type별 allowlist 후 민감 키 제거 |

보존 기간은 project policy에서 명시적으로 바꿀 수 있다. 원문이 실행 중 context envelope에 존재하는 것과 append-only event payload에 보존되는 것은 구분한다. Writing evaluation은 원문 대신 artifact/content hash, 검사 상태, 위반 수와 evidence digest를 저장한다. redaction이나 telemetry 기록이 실패하면 event를 생략한 채 실행하지 않고 변경 capability를 닫는다.

Role의 sensitive input 표시는 실제 값이 아니라 redaction 요구 metadata다. Skill source URI와 publisher/reviewer id, document responsible party와 상대 경로는 로컬 registry metadata이며 Hub 동기화나 event payload에 기본 포함하지 않는다.

### 실패 처분

| code | 로컬 run | 변경 capability | 재시도 |
|---|---|---|---|
| `telemetry_recording_failed` | 중단 | 거부 | 가능 |
| `redaction_failed` | 중단 | 거부 | 가능 |
| `hub_sync_failed` | 계속 | 허용 | 가능 |
| `derived_index_failed` | 명시적 경로로 계속 | 허용 | 가능 |
| `required_context_missing` | context 준비 전 중단 | 거부 | 가능 |
| `provider_capability_unsupported` | 정책이 낮은 assurance를 허용하지 않으면 중단 | 거부 | 불가 |
| `capability_denied` | 읽기 전용으로 계속 가능 | 거부 | 불가 |
| `approval_required` | 승인 대기 | 거부 | 승인 후 가능 |
| `contract_validation_failed` | 시작 전 중단 | 거부 | 자동 재시도 불가 |
| `writing_verification_failed` | 로컬 변경을 유지하고 공개 전 중단 | 허용 | 수정 후 가능 |
| `artifact_storage_failed` | 필수 artifact 저장 또는 검증 실패 시 중단 | 거부 | 가능 |

## 결과

- schema fixture와 어댑터 contract suite가 공급자 구현보다 먼저 계약 이탈을 검출한다.
- Hub나 파생 인덱스 장애가 로컬 원본 실행을 막지 않는다.
- telemetry/redaction 장애는 증거 없는 변경으로 저하 운전하지 않는다.
- Role, skill, document registry, writing policy/evaluation까지 동일한 schema/type/fixture 검증 경계 안에 들어와 M0 계약이 완결된다.
- 공급자가 바뀌어도 같은 한국어 writing 정책과 공개 게이트를 적용하며, 정책 주입과 준수 평가를 서로 다른 증거로 남긴다.
