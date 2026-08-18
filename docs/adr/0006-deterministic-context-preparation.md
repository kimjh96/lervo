# ADR-0006: 결정적 context preparation

상태: `accepted`
기준일: 2026-08-18

## 맥락

M0는 `selected(E1)`와 `loaded(E2)`를 다른 증거로 정의했지만 실제 저장소에서 문서를 고르고 읽는 구현은 없었습니다. 여러 규칙이 같은 문서를 선택할 수 있고, 전문 에이전트 handoff는 기존 path 규칙과 함께 해석해야 합니다. 선택 시점의 파일 이름만 보고 “읽었다”고 기록하거나 심볼릭 링크를 따라 저장소 밖 파일을 읽으면 증거 의미와 보안 경계가 모두 깨집니다.

Context router가 event store, CAS와 provider adapter까지 직접 알게 만들면 선택 정책과 실행 수명주기가 한 모듈에 섞입니다. 첫 슬라이스는 문서 발견·선택·읽기와 snapshot 유효성만 독립 패키지로 구현합니다.

## 결정

### 패키지 경계

- `@roven/context`는 document registry, Role, 예상 변경 경로, shared context와 handoff를 입력으로 받습니다.
- 출력은 E0/E1 계획, 읽은 원문 bytes, E2 evidence와 snapshot 무효화 사유입니다.
- Event append, CAS 저장, adapter envelope와 E3는 이 패키지의 책임이 아닙니다.
- 선택 누적, evidence 생성·schema 검증, 파일 시스템 읽기, freshness 판정을 별도 모듈로 둡니다.

### 결정적 선택

- 예상 경로는 `/` 구분자를 쓰는 저장소 상대 경로로 정규화합니다. 절대 경로, `..`와 NUL 문자를 거부합니다.
- `AGENTS.md`는 root부터 예상 변경 파일의 가장 가까운 상위 디렉터리까지 선택합니다. 형제 경로의 지침은 선택하지 않습니다.
- Registry에 없는 instruction 문서는 정규화한 경로의 SHA-256 앞부분으로 안정된 `doc_path_...` ID를 만듭니다. Registry에 같은 경로가 있으면 등록된 ID를 사용합니다.
- Registry의 `connectedPaths`는 Node `path.matchesGlob`로 예상 변경 경로와 비교합니다.
- Role의 `repository.instructions`, `path.instructions`는 built-in rule입니다. 다른 필수 rule은 document ID map으로 받아 해석합니다.
- 같은 문서가 여러 규칙에 걸리면 한 번만 읽고 선택 이유별 E1 receipt는 모두 남깁니다.
- 현재 Role이 읽을 수 있는 shared context는 E0로 발견하지만 자동 선택하지 않습니다. 유효한 handoff에 포함된 맥락만 E1 필수 문서가 됩니다.
- 중복 문서 경로, shared context ID와 handoff ID, 해석되지 않은 필수 rule과 서로 다른 예상 content hash는 계약 오류입니다.

### 안전한 E2 적재

- E1에는 current content hash를 넣지 않습니다.
- 선택된 파일의 전체 bytes를 읽은 뒤 SHA-256과 byte count를 계산해야 E2를 만듭니다.
- 저장소 root와 경로의 각 구성 요소를 `lstat`으로 확인하고 심볼릭 링크와 일반 파일·디렉터리가 아닌 항목을 거부합니다.
- Final file은 `O_NOFOLLOW`로 열고, 읽기 전후 file descriptor의 device, inode, size, mtime과 ctime을 비교합니다. 읽은 뒤 경로가 같은 inode와 canonical path를 가리키는지도 확인합니다.
- Handoff 문서는 publication의 content hash와 실제 bytes가 일치해야 합니다.
- Loader는 E2를 만들기 전에 plan이 현재 project/run/session의 E0/E1만 포함하고, 모든 문서와 선택 이유가 plan에 대응하는지 다시 검증합니다. 다른 run의 receipt나 기존 E2/E3가 들어 있는 plan을 거부합니다.
- `LoadedContext`의 plan·문서·E0~E2 evidence 무결성 재검증은 이 패키지가 소유합니다. 문서 배열 순서는 계약 의미가 아니며 ID로 대응합니다.
- 한 문서라도 적재하지 못하면 `LoadedContext`와 E2 evidence 묶음을 반환하지 않습니다.
- 이 과정은 사용자 파일을 쓰거나 수정 시각을 바꾸지 않습니다.

### Snapshot 무효화

적재한 파일은 사용 직전에 다시 검증할 수 있습니다. 파일 부재·경로 위험·content hash 변경과 publication 부재·미발행·만료·대체·접근 회수·document ID 변경·content hash 변경을 서로 다른 기계용 reason으로 반환합니다. 다른 project의 publication은 현재 project의 대체 관계에 영향을 주지 않습니다.

무효화 reason은 원문을 포함하지 않습니다. 상위 orchestrator는 기존 `context.invalidated` event에 document ID와 reason을 기록하고 `required_context_missing`으로 다시 준비합니다.

### 오류와 개인정보

| 분류 | 대표 code | 처분 |
|---|---|---|
| 계약 오류 | `invalid_expected_path`, `invalid_path_rule`, `required_rule_unresolved`, `duplicate_document_path`, `duplicate_shared_context_id`, `duplicate_handoff_id`, `handoff_recipient_mismatch`, `handoff_invalid`, `invalid_context_evidence`, `invalid_context_plan`, `invalid_loaded_context` | `contract_validation_failed`로 context 준비를 시작 전 또는 E1/E2 사용 전에 중단합니다. 자동 재시도하지 않습니다. |
| 원문 적재 실패 | `document_missing`, `unsafe_document_path`, `document_read_failed`, `document_changed_during_read`, `content_hash_mismatch` | `required_context_missing`으로 변경 capability를 닫고 원문 상태를 바로잡은 뒤 다시 준비합니다. |
| 좌표 충돌 | `content_expectation_conflict`, `receipt_id_conflict`, `document_not_registered`, `shared_context_document_missing` | 모호한 증거를 만들지 않고 `contract_validation_failed`로 중단합니다. |

오류 문자열에는 관리 중인 상대 경로와 기계용 ID만 사용합니다. 문서 bytes, raw prompt, credential과 provider payload는 event나 오류 metadata에 넣지 않습니다. 이 슬라이스는 새 event type이나 영속 상태를 추가하지 않습니다.

## 결과

- 선택과 실제 읽기가 코드와 evidence에서 분리됩니다.
- Root·하위 지침, path 문서, Role 필수 문서와 전문 에이전트 handoff가 한 결정적 계획으로 합쳐집니다.
- 다른 역할이 발행한 일반 맥락을 발견할 수 있지만 handoff 없이는 읽었다고 주장하지 않습니다.
- 파일이나 publication이 바뀐 뒤 오래된 E2를 재사용할 수 없습니다.
- 다음 슬라이스는 `LoadedContext`만 받아 provider-neutral envelope와 E3 검증을 구현할 수 있습니다.
