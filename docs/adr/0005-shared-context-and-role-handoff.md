# ADR-0005: 전문 에이전트 공유 맥락과 역할 간 handoff

상태: `accepted`
기준일: 2026-08-18

## 맥락

Roven은 개발자, 연구자, 마케터, 디자이너처럼 여러 전문 역할을 같은 프로젝트에서 운영합니다. 기존 Role 계약에는 필수 문서와 handoff 가능 역할이 있었지만, 한 역할이 만든 결과를 다른 역할이 어떤 원본과 근거로 읽는지는 정하지 않았습니다. 이 상태에서는 대화 요약을 임의로 복사하거나, 생산 역할이 문서를 읽었다는 receipt를 수신 역할도 읽은 것처럼 재사용할 수 있습니다.

모든 원문을 모든 모델 turn에 넣는 방식도 적절하지 않습니다. 토큰 사용이 불필요하게 커지고 제한 자료가 관련 없는 역할에 노출될 수 있습니다. 프로젝트에서 발견하고 읽을 수 있는 범위와 실제 session에 주입한 범위를 구분해야 합니다.

## 결정

### 공유 원본

- 역할 간 공유할 내용은 등록된 문서로 남기고 content hash로 고정합니다.
- `SharedContextPublication`은 `sharedContextId`, project, 문서 ID/hash/revision, 맥락 종류, 생산 주체, 근거 event, 공개 범위, 민감도, 발행·만료 시각과 대체 관계를 기록합니다.
- 에이전트가 생산했다면 role, run, session을 모두 기록하고 근거 event를 하나 이상 연결합니다.
- `audience.mode=project`인 일반 맥락은 프로젝트의 모든 역할이 발견하고 읽을 수 있습니다.
- 역할 제한이 필요한 맥락은 `audience.mode=roles`와 allowlist를 사용합니다. `restricted` 맥락은 프로젝트 전체에 공개할 수 없습니다.
- Publication은 발견 경로이지 검증된 지식 승격이 아닙니다.

### 역할 간 handoff

- Role은 handoff에 evidence link와 shared context가 필요하다고 명시합니다.
- `HandoffBundle`은 handoff ID, project, 보내는 role/run/session/context generation, 받는 role, 요청 digest, shared context ID, evidence event ID와 생성 시각을 기록합니다.
- 보내는 Role이 받는 Role을 허용해야 하며 모든 shared context가 같은 project에 속하고 수신 Role이 읽을 수 있어야 합니다.
- Bundle은 raw 요청, 문서 본문, 내부 추론을 담지 않습니다.

현재 v0는 아직 Role manifest를 사용자 저장소에 생성하거나 배포하지 않았습니다. 따라서 기존 저장 데이터를 migration할 대상이 없는 M2 착수 전 계약 보완으로 Role schema version 1의 handoff 필드를 강화합니다. Role manifest를 외부에 배포한 뒤에는 같은 종류의 필수 필드 변경에 새 schema version과 migration을 사용합니다.

### 수신 역할의 읽기 증거

- Handoff 생성이나 publication 발행은 수신 역할이 읽었다는 뜻이 아닙니다.
- 수신 역할은 publication이 가리키는 문서를 `reasonCode=handoff`로 선택합니다.
- 수신 run/session에서 현재 bytes와 hash를 다시 확인해야 E2가 됩니다.
- 수신 provider session에 전달한 별도 receipt가 있어야 E3가 됩니다.
- 생산 역할의 E2/E3를 복사하거나 상속해 수신 역할의 쓰기 gate를 열 수 없습니다.
- 만료, 원문 hash 변경, context 압축·재시작과 publication 대체는 기존 receipt를 무효화합니다.

### 이벤트와 개인정보

새 event는 두 개입니다.

| event | 필수 metadata | 의미 |
|---|---|---|
| `context.published` | shared context/document ID, content hash, 생산 역할, audience mode와 허용 역할, 만료 시각 | 다른 역할이 찾을 수 있는 공유 맥락을 발행했습니다. 수신 역할의 읽기나 주입을 뜻하지 않습니다. |
| `handoff.created` | handoff ID, 보내고 받는 역할, shared context/evidence event ID, 요청 digest | 허용된 역할 사이에 근거가 연결된 handoff를 만들었습니다. 완료나 수신 확인을 뜻하지 않습니다. |

Event payload에는 원문, raw prompt, 내부 추론, credential과 provider payload를 저장하지 않습니다. 원문은 등록 문서 또는 CAS에 있고 event에는 ID와 digest만 둡니다. 두 event 기록이 실패하면 공유나 handoff가 성립했다고 주장하지 않고 `telemetry_recording_failed`로 run을 중단합니다.

잘못된 생산 역할, 허용되지 않은 수신 역할, 누락된 맥락, 다른 project 또는 접근할 수 없는 맥락은 `contract_validation_failed`입니다. 아직 발행 시각이 되지 않았거나 만료·대체된 맥락은 `required_context_missing`이며 현재 publication을 선택한 뒤 다시 준비할 수 있습니다. 여러 문제가 함께 있으면 계약 위반을 먼저 고쳐야 하므로 `contract_validation_failed`를 우선합니다.

## 결과

- 전문 에이전트는 허용된 프로젝트 맥락을 같은 원본과 hash로 발견하고 읽을 수 있습니다.
- 역할 간 협업이 모델의 숨은 기억이나 임의 대화 요약에 의존하지 않습니다.
- 공유 가능 여부와 실제 선택·적재·주입 증거를 구분합니다.
- 일반 맥락을 재사용하면서도 restricted 자료의 역할 경계를 유지합니다.
- 이후 M2 context router는 저장소 지침뿐 아니라 shared context와 handoff를 같은 문서 읽기 경로로 처리합니다.
