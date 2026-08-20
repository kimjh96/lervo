# ADR-0066: 제한된 검색 rollout 검토 상태 조회

- 상태: 채택
- 날짜: 2026-08-20

## 배경

Rollout 검토는 당시 품질 입력에 결속된 불변 원본이지만, 이후 시도나 평가가 추가됐는지 파일을 직접 대조하지 않고는 알기 어렵습니다. 단순히 가장 최근 검토를 현재 판단으로 표시하면 사람의 기록을 승인이나 자동 선택으로 오해하게 됩니다. 전체 검토 이력을 한 응답에 계속 누적하는 방식도 원본 수가 늘수록 조회 경계를 흐립니다.

## 결정

`SearchRolloutStatusPage` v1을 로컬의 read-only 파생 조회로 둡니다. 현재 선택을 `implicit_baseline`, `recorded_baseline`, `candidate`로 구분하고, rollout 검토를 검토 시각과 ID 역순으로 기본 20개·최대 50개만 반환합니다. 다음 페이지 cursor는 현재 페이지의 마지막 rollout review ID이며, 원본에서 찾을 수 없는 cursor는 실패합니다. 저장 원본 자체는 최대 256개라는 기존 경계를 유지합니다.

조회 전 각 검토가 가리키는 선택 전이·candidate·engine·adapter build·후보 review를 전체 선택 chain에 다시 맞춥니다. 정책에 결속된 v2 검토는 정책 원본의 존재와 project 좌표도 확인하지만 기준 충족 여부는 이 조회에서 다시 판정하지 않습니다. 검토 시각까지 관측된 대상 attempt·assessment로 기존 검토 snapshot을 재생성해 원본 무결성을 확인합니다. 그 다음 조회 시각까지의 모든 대상 입력으로 현재 `SearchRolloutQualitySnapshot`을 파생합니다.

`qualityInputState`는 두 snapshot ID가 아니라 `inputDigest`를 비교해 `unchanged` 또는 `changed`로 표시합니다. Snapshot ID에는 관측 종료 시각이 포함되므로 입력이 같아도 조회 시각이 다르면 ID가 달라질 수 있기 때문입니다. 현재 선택 전이와 같은 검토는 `current_selection`, 그 밖은 `historical_selection`입니다. Rollback 뒤에도 과거 검토와 현재 품질 입력을 조회할 수 있지만 검토의 판단과 효과 필드는 바꾸지 않습니다.

페이지는 가장 최근 판단을 선택하지 않고 `reviewDecisionSelection=not_performed`를 고정합니다. 조회 효과도 `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`입니다. 실제 선택 전이는 기존 명시적 engine 명령만 만들며 상태 조회는 정책 eligibility도 계산하지 않습니다.

## 개인정보와 실패 의미

응답은 로컬 검토 원본과 선택·build 좌표, 품질 수량, snapshot·입력 digest와 reviewer ID를 포함합니다. Raw query·nonce, index·result-set hash, source ID·content hash·path·본문, prompt, provider 응답, credential과 verification receipt는 포함하지 않습니다. Reviewer ID와 digest가 있는 상태 조회는 로컬 CLI에만 제공하며 파일·event·Hub 원본으로 저장하거나 sync하지 않습니다.

형식·limit·cursor·project·시각 관계가 다르면 `invalid_rollout_status`로 실패합니다. 선택 chain, 후보 review, 검토 당시 입력을 재검증할 수 없거나 원본이 삭제·변조됐으면 기존 `observation_invalid`, `invalid_rollout_review` 등으로 전체 페이지를 실패시킵니다. 일부 검토를 누락하고 정상 페이지처럼 반환하지 않습니다. 조회 실패와 성공 모두 선택·검토·품질 원본을 수정하지 않습니다.

## 검증

- 검토 시각·ID 역순의 기본 20·최대 50개 페이지와 안정된 review ID cursor를 유지함
- 검토 당시 입력을 재생성한 뒤에만 상태를 반환함
- 실제 입력 digest가 같으면 `unchanged`, attempt·assessment가 추가되면 `changed`로 표시함
- 조회 시각 때문에 snapshot ID만 달라진 것을 품질 입력 변경으로 오인하지 않음
- Rollback 뒤 현재 baseline과 과거 후보 검토를 분리해 표시함
- 최신 검토나 특정 판단을 승인·적용 대상으로 선택하지 않음
- Query·문서 좌표·provider 결과·credential을 출력·저장하거나 event·Hub sync를 만들지 않음
