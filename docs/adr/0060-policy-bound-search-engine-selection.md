# ADR-0060: 정책에 결속된 검색 엔진 선택과 rollback

- 상태: 채택 (`applicationState`와 미연결 범위는 ADR-0061로 대체)
- 날짜: 2026-08-20

## 배경

재현된 채택 검토가 있어도 어떤 reviewer와 operator를 허용하는지, 후보가 최소 몇 개 case를 개선해야 하는지 정하지 않으면 운영 선택을 일관되게 검증할 수 없습니다. 현재 선택만 덮어쓰는 파일은 누가 어떤 원본을 근거로 바꿨는지와 이전 엔진으로 돌아갈 좌표를 잃습니다. 동시에 두 operator가 같은 상태에서 다른 후보를 고르는 분기도 막아야 합니다.

실제 검색 코드에 후보를 연결하기 전에 정책, 증거 재확인, 선택 전이와 rollback 이력을 공급자·저장소와 분리된 계약으로 고정합니다.

## 결정

### Project별 정책 원본

`SearchEngineActivationPolicy`는 project, 허용 reviewer·operator·candidate, 최소 후보 승리 1~64개, baseline 승리 허용값 0, 작성자와 시각을 content-bound ID로 묶습니다. 작성자는 허용 operator에 포함되어야 합니다. CLI는 정적 registry 후보만 정책에 넣습니다.

정책은 `.lervo/search-engine-policies/<policyId>.yaml`에 mode `0600`으로 하나씩 저장하며 최대 32개입니다. 기존 정책을 덮어쓰거나 하나의 파일에 이력을 추가하지 않습니다. 이 디렉터리는 Git으로 검토할 project 설정이고 init은 빈 디렉터리만 준비합니다.

### 활성화 전 재검증

후보 선택 전 현재 bundle·coverage·case·등록 문서 corpus와 comparison의 baseline·candidate run·result를 전부 다시 확인합니다. 정적 registry의 후보를 비교 당시 corpus·case·시각으로 재실행하고 기존 review와 같은 content-bound review ID가 나와야 합니다.

Review는 `adopt_candidate`와 `eligible_for_activation_review`여야 합니다. Reviewer·operator·candidate와 후보 승리 수가 정책에 맞고 baseline 승리는 0이어야 합니다. 현재 선택과 같은 후보를 다시 선택하는 no-op도 거부합니다.

### Immutable 선택 전이 chain

`SearchEngineActivation`은 sequence, 이전 activation ID, `activate_candidate` 또는 `rollback`, 정책·operator·시각, 이전·새 선택과 rollback 좌표를 content-bound ID로 묶습니다. 후보 선택은 candidate·engine·review·comparison을 함께 고정하고 baseline은 이 좌표를 모두 null로 둡니다.

첫 전이는 `.lervo/state/search/engine-selections/baseline.json`, 다음 전이는 `<previousActivationId>.json`에 mode `0600`으로 저장합니다. 이전 activation을 파일 열쇠로 쓰므로 같은 head에서 서로 다른 두 전이 중 하나만 원자적으로 게시됩니다. Reader는 최대 256개 원본이 하나의 project·sequence·previous ID·선택 관계로 이어지는지 확인합니다.

Rollback은 현재 전이의 이전 선택을 새 선택으로 삼는 별도 전이입니다. 대상이 후보면 그 후보의 review·comparison과 현재 corpus, replay를 다시 확인합니다. 대상이 baseline이면 후보 증거를 만들지 않습니다. 기존 전이와 정책·검토·비교 원본은 수정하거나 삭제하지 않습니다.

## 개인정보와 적용 상태

정책에는 reviewer·operator ID가 들어가며 Git 검토 대상입니다. Credential, 개인 비밀값이나 저장소 공개 범위에 맞지 않는 식별자를 쓰지 않습니다. 전이의 operator ID는 gitignore 대상 로컬 state에만 둡니다. Query·문서 path·본문, prompt, provider 응답과 credential은 정책·전이에 넣지 않습니다.

새 event와 Hub sync는 없습니다. 이 결정 당시 전이는 `applicationState=not_connected`, `embeddingDecision=not_determined`였고 일반 검색과 managed context는 `lexical-v1`을 사용했습니다. 이후 ADR-0061이 전이를 `recordState=selection_recorded`로 바꾸고 운영 소비 경계를 연결했습니다. `engine activate` 자체가 검색 실행 완료를 뜻하지 않는 원칙은 유지합니다.

## 실패 의미

- `invalid_engine_activation_policy`: 정책 좌표·목록·한도·작성자·시각 또는 content ID가 유효하지 않습니다.
- `engine_policy_not_found` / `engine_policy_invalid`: 지정 정책이 없거나 정책 파일 계약이 잘못됐습니다.
- `engine_policy_read_failed` / `engine_policy_write_failed`: 정책을 안전하게 읽거나 immutable하게 게시하지 못했습니다.
- `candidate_review_not_found`: 선택 근거로 지정한 review 원본이 없습니다.
- `engine_activation_not_eligible`: Reviewer·operator·candidate·표본 기준·재현 결과 또는 현재 선택이 정책에 맞지 않습니다.
- `invalid_engine_activation`: 선택·rollback·project·sequence·이전 전이 관계나 content ID가 유효하지 않습니다.
- `engine_activation_conflict`: 같은 이전 head에서 다른 전이가 먼저 게시됐습니다. 현재 head를 다시 읽고 판단해야 합니다.
- `engine_activation_not_found`: rollback할 현재 전이가 없습니다.

증거 재검증 또는 게시가 실패하면 선택 전이를 만들지 않으며 정책·review·comparison·run·result와 이전 전이를 수정하지 않습니다.

## 검증

- 미등록 candidate와 허용되지 않은 reviewer·operator를 거부함
- 정책 최소 승리 수에 못 미치는 review를 거부함
- 검토 뒤 corpus가 바뀌면 선택 전이를 게시하지 않음
- 후보를 다시 replay하고 같은 review가 재생성된 경우만 선택함
- 첫 선택이 baseline과 후보, review·comparison, rollback 좌표를 고정함
- Rollback이 새 전이로 baseline 또는 검증된 이전 후보를 선택함
- 같은 이전 head의 다른 전이를 immutable 저장에서 거부함
- 정책과 전이에 query·문서 원문·path가 없음
- 이 단계의 상태 조회와 실제 검색에서 미연결 상태를 확인함. 후속 운영 연결 검증은 ADR-0061이 담당함
