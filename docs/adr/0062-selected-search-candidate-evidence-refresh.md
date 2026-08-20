# ADR-0062: 선택된 검색 후보의 검증 원본 갱신

- 상태: 채택
- 날짜: 2026-08-20

## 배경

선택된 후보 검색 엔진은 comparison과 review 당시의 corpus에 결속됩니다. 문서가 정상적으로 바뀌면 운영 resolver가 이 차이를 발견해 fail-closed로 중단하지만, 같은 후보가 새 corpus에서도 다시 검증된 경우 이를 이어 갈 명시적인 전이가 없었습니다. 기존 활성화 명령을 재사용하면 후보 변경과 증거 갱신이 같은 action으로 보이고, 직전 선택을 rollback 대상으로 삼으면 이미 오래된 후보 증거로 되돌아갈 수 있습니다.

## 결정

`refresh_candidate`를 schema v2 선택 전이에 추가합니다. 이 action은 현재 선택과 새 선택이 같은 candidate ID와 같은 engine 좌표일 때만 허용합니다. 새 comparison과 review는 현재 bundle·case·corpus, 등록 engine과 replay를 다시 통과해야 하며 정책의 reviewer·operator·candidate·승리 기준도 다시 확인합니다. 같은 review와 comparison을 반복하거나 다른 후보로 바꾸는 요청은 거부합니다. 다른 후보 선택은 기존 `activate_candidate`를 사용합니다.

Refresh는 기존 전이와 원본을 수정하지 않고 `<previousActivationId>.json`에 다음 immutable 전이로 기록합니다. 새 전이는 이전 선택과 새 evidence 좌표를 모두 content-bound ID에 묶습니다. `recordState=selection_recorded`는 선택 기록만 뜻하며 실제 query 실행이나 결과 사용을 주장하지 않습니다.

Refresh의 `fallbackSelection`은 `lexical-v1` baseline이고 `fallbackActivationId`는 null입니다. 따라서 refresh 뒤 rollback은 갱신 전의 오래된 후보 증거를 재실행하지 않고 baseline으로 복구합니다. Rollback runner와 순수 전이 생성기는 모두 공통 fallback 해석 함수를 사용합니다. Refresh가 실패하면 기존 선택 파일을 바꾸거나 baseline으로 자동 전환하지 않으며 현재 fail-closed 상태를 유지합니다.

## 개인정보와 실패 의미

새 event와 Hub 원본은 없습니다. 전이에는 project, 공개 가능한 engine·candidate 좌표, review·comparison·policy·operator ID와 시각만 두며 query, 문서 path·본문, prompt, provider 응답과 credential은 넣지 않습니다. Operator ID와 전이는 기존처럼 gitignore 대상 mode `0600` 로컬 상태에만 저장합니다.

현재 후보가 없거나 project가 다르면 `engine_activation_not_found`, 같은 원본 반복·다른 후보·정책 또는 재현 조건 불일치는 `engine_activation_not_eligible`, 구조·fallback·chain 좌표 위반은 `invalid_engine_activation`입니다. 같은 head에 다른 전이가 먼저 기록되면 기존 `engine_activation_conflict`를 유지합니다.

## 검증

- 같은 후보의 새 검토 원본만 refresh할 수 있고 기존 활성화 action으로 우회할 수 없음
- Refresh 전이가 이전 선택, 새 review·comparison과 baseline fallback을 정확히 보존함
- 문서 변경으로 사용할 수 없어진 후보가 새 비교·검토·refresh 뒤 다시 운영 검색에 사용됨
- Refresh 뒤 후보 adapter가 없어도 명시적인 rollback이 baseline으로 복구됨
- 전체 선택 chain과 현재 후보 증거를 resolver가 다시 검증하며 evaluation baseline은 바뀌지 않음
