# ADR-0007: Provider-neutral context delivery와 E3

상태: `accepted`
기준일: 2026-08-18

## 맥락

`@roven/context`는 문서를 선택하고 안전하게 읽어 E2를 만들지만 provider 입력에 전달하지 않습니다. E2 bytes를 바로 Codex나 Claude 구현에 넘기면 inline/CAS 선택, writing policy 포함, receipt 판정과 generation 무효화가 공급자마다 달라질 수 있습니다. 반대로 context router가 adapter와 CAS까지 알게 되면 선택 정책, 원문 수명주기와 provider 실행이 한 패키지에 섞입니다.

E3는 “adapter 메서드를 호출했다”는 기록이 아니라 현재 managed session의 통제된 입력에 정확한 E2 문서 집합을 전달했다는 receipt가 있어야 합니다. Aggregate adapter receipt 하나를 여러 문서 evidence에 그대로 쓰면 문서별 evidence ID의 고유성과 공급자 receipt 추적이 충돌합니다.

## 결정

### 패키지와 포트

- 새 `@roven/context-delivery` 패키지가 `LoadedContext`에서 provider-neutral envelope를 만들고 receipt를 검증합니다.
- 이 패키지는 Codex·Claude adapter나 `@roven/adapter-contract` 구현에 의존하지 않습니다. 공통 schema의 `AdapterSession`, envelope, receipt와 `(session, envelope) -> receipt` 함수 포트만 사용합니다.
- `@roven/context`는 E0~E2와 snapshot 판정 책임을 유지합니다. Event 저장, capability gate와 provider 프로세스 수명주기는 각각 orchestrator와 adapter 책임입니다.

### Envelope 조립

- Plan과 E2 문서·evidence의 좌표, ID, path, hash, byte count, scope, source revision을 다시 대조합니다. 중복 ID, plan 밖 evidence, 다른 실행 좌표, 변경된 bytes와 이미 들어 있는 E3/E4를 거부합니다.
- Session의 project/run/session/role이 E2 좌표와 같아야 합니다. Session에 writing policy ID가 있으면 그 정책의 문서 ID가 E2 문서 집합에 있어야 하고 envelope에 명시합니다.
- 기본 inline 한도는 64 KiB입니다. 한도 이하이면서 UTF-8 decode/encode가 원래 bytes와 정확히 같은 문서만 inline으로 전달합니다.
- 나머지는 `ArtifactStore`에 저장합니다. 반환된 URI가 content hash 주소와 같고 hash·byte count가 E2와 같으며, URI를 다시 읽은 bytes도 같은 hash·크기일 때만 CAS delivery로 사용합니다.
- Envelope 생성 결과를 adapter JSON Schema로 다시 검증합니다.

### Freshness와 generation

- 상위 호출은 monotonic `contextGeneration`의 현재 값을 제공해야 합니다.
- Delivery는 envelope 조립 전, adapter 호출 직전, receipt 수신 뒤 generation을 확인합니다. 조립과 호출 사이에는 파일과 shared publication snapshot도 다시 검사합니다.
- Compaction 또는 restart가 호출 중 발생하면 adapter가 과거 generation receipt를 반환해도 E3를 만들지 않습니다. 실제 provider 신호를 generation 증가로 바꾸는 책임은 M3 adapter/orchestrator에 있습니다.

### Receipt와 E3

- Receipt는 envelope ID, adapter/project/run/session/role/writing policy/provider session, 대상 turn, generation과 `controlledInput=true`를 정확히 유지해야 합니다.
- 문서 목록은 ID가 고유하고 envelope와 같은 집합이어야 하며 각 hash와 scope가 같아야 합니다. 누락, 추가, 중복, 변조를 허용하지 않습니다.
- Writing policy 문서도 receipt 문서 집합에 있어야 합니다.
- Adapter receipt의 `acceptedAt`은 session 시작과 envelope 생성보다 빠를 수 없습니다.
- 검증이 모두 끝난 뒤 문서별 E3 evidence를 한 번에 만듭니다. 문서별 `receiptId`는 고유하게 발급하고 aggregate adapter receipt는 `adapterReceiptId`로 연결합니다.
- 하나라도 실패하면 부분 E3를 반환하지 않습니다.

### 실패와 원문 보호

계약 형태나 내부 E2 체인이 잘못되면 `contract_validation_failed`, 파일/publication/receipt/generation이 현재 필수 context를 증명하지 못하거나 adapter 호출이 완료되지 않으면 `required_context_missing`입니다. CAS 저장소 부재·저장·재검증 실패는 `artifact_storage_failed`입니다. Adapter capability matrix가 controlled injection을 `unsupported`로 선언한 경우는 delivery 포트를 호출하기 전에 orchestrator가 `provider_capability_unsupported`로 차단합니다.

Inline 원문과 CAS bytes는 context 입력 또는 로컬 artifact store에만 존재합니다. Event에는 receipt/envelope/document ID, hash, scope, turn과 generation만 기록하며 raw prompt, 문서 본문과 provider payload를 넣지 않습니다. Adapter가 던진 원본 예외도 delivery 오류 cause에 보존하지 않습니다.

## 결과

- Codex와 Claude가 같은 envelope/receipt/E3 판정 경계를 구현하게 됩니다.
- Context 선택과 provider 실행 수명주기가 분리되어 다른 adapter와 delivery 방식으로 확장할 수 있습니다.
- Writing policy 원문도 일반 필수 문서와 같은 E2→E3 보장을 받습니다.
- 파일 변경과 compaction/restart 뒤 과거 receipt가 쓰기 gate를 열 수 없습니다.
- 다음 슬라이스는 E1/E2/E3 event 기록과 현재 generation을 첫 쓰기 capability gate에 연결할 수 있습니다.
