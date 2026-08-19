# ADR-0031: 사람 검토 기반 지식 승격과 경로 기반 stale 전이

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

지식 candidate는 수렴한 결정과 검증 결과를 묶지만, 그 자체로 검증된 프로젝트 지식은 아닙니다. Candidate 생성 event만 보고 자동 승격하면 사람이 검토하지 않은 결론, 이미 달라진 저장소 상태, 해소되지 않은 충돌까지 `verified`로 오인할 수 있습니다.

승격 뒤에도 저장소 전체 revision이 바뀌었다는 이유만으로 모든 지식을 stale로 만들면 관련 없는 변경이 불필요한 검토를 일으킵니다. 반대로 영향 경로의 기준 hash를 남기지 않으면 관련 코드가 달라진 사실을 나중에 증명할 수 없습니다.

## 결정

### 검토와 승격을 서로 다른 원본으로 남긴다

`KnowledgePromotionPolicy`는 허용된 사람 reviewer와 충돌 해소 요구를 정합니다. Policy version은 version 필드를 뺀 canonical policy snapshot의 hash입니다. `KnowledgeReviewApproval`은 candidate ID·content hash, 승인 또는 거절, reviewer, 당시 policy snapshot, 검토한 repository revision, 해소한 충돌 후보와 검토 시각을 가진 불변 CAS 원본입니다. 승인 ID는 reviewer와 policy snapshot을 포함한 나머지 canonical JSON의 hash로 계산합니다.

`knowledge.candidate.reviewed` event는 승인 원문을 복제하지 않고 candidate·approval·policy·revision의 ID와 hash만 기록합니다. Reviewer ID는 로컬 승인 CAS에만 있고 event allowlist에는 없습니다. 거절도 검토 원본으로 기록하지만 `verified` 승격에는 사용할 수 없습니다.

### Verified 원본은 승인과 현재 path hash를 함께 고정한다

승격기는 candidate CAS와 생성 event, candidate가 참조한 evidence event와 decision CAS, 승인 CAS와 review event를 모두 다시 확인합니다. 현재 정책이 reviewer를 허용하고, 결정이 `approved`이며, 필요한 충돌이 모두 해소되고, candidate·approval·현재 snapshot의 revision이 같고, 모든 영향 path가 존재해야 승격할 수 있습니다.

Verified 원본은 candidate와 approval CAS 좌표, claim digest, path별 기준 content hash, evidence event, 검증 revision, review interval과 검증 시각을 갖습니다. `knowledge.verified` event는 이 원본의 ID와 hash만 기록합니다. Candidate, 승인 원본과 사용자 문서는 수정하지 않습니다.

### Revision 자체가 아니라 연결 경로와 검토기한을 판정한다

Stale 판정기는 verified 원본과 현재 전체 repository snapshot에서 검토기한과 연결 path의 변경·부재를 계산합니다. 저장소 revision이 달라져도 연결 path hash가 모두 같고 검토기한 전이면 `current`입니다. 연결 path가 바뀌거나 사라졌거나 검토기한에 도달하면 `stale`입니다.

결과는 상태, 두 신호, 변경·부재 path와 정해진 사유를 가진 작은 파생 CAS 원본입니다. 상태·신호·사유가 서로 다르면 기록을 거부합니다. `current` 결과는 event로 누적하지 않고, `stale` 결과만 `knowledge.stale.detected`로 기록합니다.

## Event 필드와 개인정보

| event | 필수 좌표 | 제외하는 정보 |
|---|---|---|
| `knowledge.candidate.reviewed` | candidate/approval ID·hash, decision, policy ID·version, revision, 해소한 conflict ID | reviewer ID, 검토 문장, 원문 |
| `knowledge.verified` | knowledge/candidate/approval ID·hash, claim digest, path, verified revision | claim·decision 본문, reviewer ID |
| `knowledge.stale.detected` | knowledge/result ID·hash, 검증·현재 revision, 사유, 변경·부재 path | 파일 내용, 절대 경로, 사용자 문장 |

세 event 모두 artifact ID가 content hash에서 다시 계산되지 않으면 event 전체를 거부합니다. CAS 저장 뒤 event 기록이 실패하면 완료를 반환하지 않으며 event 없는 CAS object는 상태 전이 원본으로 취급하지 않습니다.

## 실패 의미

- `review_contract_invalid`: 정책, reviewer, revision, 충돌 해소 또는 승인 원본이 유효하지 않아 reviewed 완료를 주장하지 않습니다.
- `promotion_not_eligible`: 승인·candidate·현재 snapshot의 원본이나 좌표가 맞지 않아 verified를 만들지 않습니다.
- `staleness_contract_invalid`: verified 원본, 현재 snapshot, 결과 상태·신호·사유가 맞지 않아 stale를 기록하지 않습니다.
- `artifact_storage_failed`: review, verified 또는 stale CAS를 저장하고 다시 확인하지 못했습니다.
- `event_recording_failed`: 상태 전이 event를 기록하지 못했으며 완료를 반환하지 않습니다.

## 검증

실제 SQLite event store와 filesystem CAS를 사용해 승인된 사람 reviewer의 검토와 verified 승격을 확인했습니다. 허용되지 않은 reviewer, 거절된 승인, 해소되지 않은 충돌, 다른 revision과 누락 path는 상태 전이 전에 실패합니다.

관련 없는 파일만 바뀐 새 revision은 `current`로 남고, 연결 path 변경과 정확한 review due 시각은 `stale`가 됩니다. 모순된 상태·신호·사유를 새 ID로 다시 계산해도 기록할 수 없습니다. Doctor는 candidate, review, verified와 stale CAS·event 연결을 각각 읽기 전용으로 점검합니다.

## 결과

Candidate의 검토와 verified 승격이 명시적인 사람 승인 및 현재 저장소 증거에 결속됩니다. 모든 원본은 항목별 CAS object로 분리되며 하나의 지식 파일에 계속 덧붙이지 않습니다.
