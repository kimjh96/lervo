# ADR-0025: 사람 대상 산출물 공개 gate와 content-bound permit

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Provider 결과 artifact는 실행과 CAS 무결성을 증명하지만 사람이 읽기 쉬운 문장인지 증명하지 않습니다. 기존 writing 계약과 순수 gate만으로는 CLI가 평가 전에 원문을 읽어 출력하는 경로를 막지 못했습니다. 결정적 정규식만 통과한 한국어를 자연스럽다고 간주해서도 안 됩니다.

공개 판정을 boolean 하나로 넘기면 다른 내용, 바뀐 정책이나 다른 surface에 이전 통과 결과를 재사용하기 쉽습니다. 반대로 평가 원문이나 evaluator 오류를 event에 넣으면 provider 결과 비복제와 개인정보 경계를 깨뜨립니다.

## 결정

### 평가 실행과 공개 읽기를 분리한다

`@lervo/writing`은 provider adapter, orchestrator, CLI 출력과 분리된 application package입니다. 입력은 writing contract, 공개 surface, provider 결과 artifact 좌표, local artifact store와 선택적인 `WritingSemanticEvaluator` port입니다.

평가 실행은 다음 순서를 지킵니다.

1. CAS에서 원문을 다시 읽어 media type, ID·URI, hash, byte count, 4 MiB 한도와 손실 없는 UTF-8을 확인합니다.
2. `@lervo/core`의 결정적 검사를 실행합니다. 하나라도 실패하면 의미 평가기를 호출하지 않습니다.
3. 결정적 검사가 통과했을 때만 생성 경로와 별도로 주입된 의미 평가기를 호출합니다. 평가기는 policy·locale·surface·artifact 좌표, 원문과 필수 의미 검사 요구를 받습니다.
4. 의미 평가 응답은 `model` 또는 `human` evaluator ID와 필수 check별 `passed`/`failed`, violation count만 반환합니다. 누락, 중복, 알 수 없는 검사, 모순된 상태와 예외는 통과가 아닙니다.
5. Lervo가 검사별 evidence digest, 파생 전체 상태와 content-addressed evaluation ID를 계산합니다. Canonical 평가 JSON은 CAS에 저장하고 같은 bytes를 다시 읽어 확인합니다.

원문을 실제 소비하는 코드는 `readPublishableWritingArtifact`를 사용합니다. 이 함수는 평가 schema와 의미 계약, 평가 CAS bytes, 현재 policy와 공개 permit를 다시 검증한 뒤에만 원문 artifact를 반환합니다. CLI는 이 경계를 통과한 결과만 stdout과 JSON의 `content`에 넣습니다. 이후 shared context와 숙의 publisher도 원문을 사람 대상 산출물로 공개할 때 같은 경계를 사용해야 합니다.

### Permit는 내용과 판정 조건 전체에 결속한다

`WritingPublicationPermit`의 필수 필드는 다음과 같습니다.

- `permitId`, `issuedAt`, `surface`
- `artifactId`, `contentHash`
- `writingPolicyId`, `writingPolicyHash`
- `evaluationId`, `evaluationHash`

Permit ID는 ID를 제외한 canonical 내용의 SHA-256에서 계산합니다. 따라서 같은 artifact라도 policy 본문, 평가 JSON이나 공개 surface가 달라지면 재사용할 수 없습니다. Permit는 모든 필수 검사가 통과한 경우에만 생성합니다. 이번 단계는 permit 영속 저장소를 추가하지 않으며 호출 결과에서만 전달합니다.

### 상태와 실패 의미를 분리한다

공개 판정 상태는 다음 둘입니다.

- `allowed`: 평가가 `passed`이고 permit와 공개 가능한 `content`가 있습니다.
- `blocked`: `failure=writing_verification_failed`, `permit=null`, `content=null`이며 누락·실패한 check ID와 좌표 불일치 여부를 가집니다.

의미 평가 시도 상태는 공개 판정과 별도로 둡니다.

- `completed`: 계약에 맞는 의미 평가 응답을 받았습니다. 검사 결과에 따라 공개는 여전히 차단될 수 있습니다.
- `not_run`: 평가기가 없거나 결정적 검사 실패로 호출하지 않았습니다.
- `failed`: 평가기 호출이 예외로 끝났습니다.
- `invalid`: 응답의 검사 집합이나 상태가 계약과 달랐습니다.

계약 오류 code와 처분은 다음과 같습니다.

| code | 의미와 처분 |
|---|---|
| `invalid_writing_request` | Policy가 surface를 허용하지 않거나 clock이 유효하지 않습니다. 평가를 시작하거나 공개하지 않습니다. |
| `artifact_contract_invalid` | Provider 결과의 media type, 좌표 또는 크기가 계약과 다릅니다. 의미 평가를 실행하지 않습니다. |
| `artifact_storage_failed` | 원문 또는 평가 artifact를 CAS에서 안전하게 읽고 다시 확인하지 못했습니다. 공개 결과를 만들지 않습니다. |
| `evaluation_contract_invalid` | 평가의 schema, 필수 검사·검사자 집합, 파생 상태 또는 ID가 다릅니다. Permit를 만들지 않습니다. |
| `publication_permit_invalid` | Permit가 현재 surface, policy, 평가 또는 내용과 다릅니다. 원문을 반환하지 않습니다. |

`writing_verification_failed`는 위 계약 오류와 다른 정상적인 fail-closed 판정입니다. Provider run과 이미 검증된 파일 변경은 유지하며 결과 원문 공개만 막습니다. CLI는 이 상태를 stdout에 설명하고 종료 코드 1을 반환합니다.

### 개인정보와 증거 범위를 제한한다

평가 artifact에는 policy/artifact 좌표, 검사자 ID, 검사 상태·위반 수·evidence digest와 시각만 저장합니다. Provider 결과 원문, raw prompt, tool input, provider payload와 evaluator 예외 본문은 넣지 않습니다. 의미 평가기는 판정을 위해 원문을 메모리에서 받지만 응답에는 원문을 되돌려주지 않습니다.

새 event type이나 payload field는 추가하지 않습니다. 평가 CAS와 permit가 있어도 Hub 전송, shared context 발행, 다른 역할의 E2/E3, E4 또는 지식 승격을 뜻하지 않습니다. 현재 CLI의 고정 `developer` Role은 `presentation.audience=machine`, `writingPolicyId=null`을 유지합니다. 이번 gate는 결과 생성 후 기본 한국어 정책으로 평가할 뿐, 생성 전에 정책 원문을 provider에 주입했다고 주장하지 않습니다.

## 관심사 분리

- `@lervo/core`: 기본 정책, 결정적 lint와 순수 gate 판정
- `@lervo/schemas`: writing surface와 publication permit의 공개 구조
- `@lervo/writing`: artifact 무결성, 의미 평가 port, 평가 생성·검증, permit와 공개 읽기
- `@lervo/cli`: 실행 조합, 사용자 출력과 종료 코드

Core의 기존 단일 writing 모듈도 정책, lint, gate 파일로 나눴습니다. 의미 평가 provider를 교체해도 adapter나 CLI 출력 코드를 바꾸지 않으며, 새 공개 surface는 같은 permit 검증기를 재사용합니다.

## 검증

실제 filesystem CAS fixture에서 통과 평가의 저장·재읽기와 공개, 의미 평가기 미구성, 결정적 검사 실패 시 미호출, 중복 응답, evaluator 예외, surface·policy·content 변경 뒤 permit 재사용 거부를 검증합니다. Codex와 Claude CLI fixture는 별도 평가기가 통과한 경우에만 원문을 보여줍니다. 평가기가 없는 fixture는 종료 코드 1과 원문 비공개를 확인하면서 파일 변경과 `run.completed`가 유지되는지도 함께 검증합니다.

## 결과

Provider 결과 artifact를 가진 코드가 실수로 바로 출력하던 경로가 CLI에서 제거됐습니다. 의미 평가를 실행하지 않은 상태를 자연스러운 한국어로 추정하지 않고, 통과 판정을 정확한 정책·평가·내용·surface에 묶어 재사용할 수 있습니다.

숙의 artifact와 policy schema는 [ADR-0026](./0026-structured-deliberation-contracts.md)에서 permit를 필수 artifact 좌표로 연결했습니다. 다음 shared context·숙의 runtime fixture는 이 permit를 실제 publisher 앞에서 다시 검증하고, writing 평가 event가 필요할 때 별도 payload allowlist와 영속 순서를 결정합니다.
