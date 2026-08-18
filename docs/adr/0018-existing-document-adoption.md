# ADR-0018: 기존 문서 도입과 안전한 migration

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Lervo를 새 저장소에만 설치한다고 가정할 수 없습니다. 실제 저장소에는 `README.md`, `AGENTS.md`, `CLAUDE.md`, ADR, MDX, AsciiDoc, custom front matter와 과거 Lervo `documents.yaml`이 서로 다른 규칙으로 쌓여 있을 수 있습니다. 표준 managed block parser부터 구현하면 기존 형식을 표준 marker에 억지로 맞추거나 사용자 원본을 수정하는 방향으로 경계가 굳어질 수 있습니다.

`lervo init`은 안전한 project layout 생성만 담당합니다. 기존 문서를 Lervo의 관리 대상으로 도입하는 일은 원본 형식과 소유권을 판정하고 사용자가 승인해야 하므로 init과 같은 암묵적 단계가 될 수 없습니다.

## 결정

### 구현 순서

문서 수명주기의 남은 구현을 다음 순서로 고정합니다.

1. 안전한 read-only scanner와 `DocumentImportAdapter` 공통 계약
2. Source 문서별 `MigrationCandidate`와 hash-bound dry-run plan
3. 사용자 승인과 분할 layout 대상 metadata-only sidecar apply
4. 기존 단일 registry의 항목별 artifact와 structural migration dry-run
5. 같은 계획의 명시적 승인과 원자적 비활성화·분할 apply
6. CommonMark와 legacy marker adapter/parser
7. Byte 보존 managed block patch candidate
8. Staleness detector와 구조 변경 후보

앞 단계의 계약 테스트와 원본 무변경 fixture를 통과하기 전에는 다음 단계가 사용자 문서를 수정하지 않습니다.

### 탐색과 형식 adapter를 분리한다

Core scanner가 탐색 root, 제외 경로, 파일 수·개별 크기·전체 byte 한도, 안전한 전체 파일 읽기, source hash와 결정적 순서를 소유합니다. 절대 경로, root 이탈, 심볼릭 링크, 일반 파일이 아닌 항목과 읽는 중 변경을 거부합니다. 기본 제외 대상은 `.git`, 의존성 디렉터리와 `.lervo/state`입니다.

`DocumentImportAdapter`는 adapter ID/version, 지원 확장자와 탐지 함수를 공개합니다. Adapter는 scanner가 읽은 저장소 상대 경로와 byte만 받고 파일 시스템이나 event store 쓰기 port를 받지 않습니다. 반환값은 형식, 소유권, document ID/profile/관계와 marker 후보, confidence와 warnings입니다. Markdown, MDX, AsciiDoc, 과거 Lervo registry와 프로젝트 custom 형식은 같은 공통 계약 테스트를 통과해야 합니다.

### 후보와 계획은 원본에 묶는다

`MigrationCandidate`는 다음을 포함합니다.

- source path, format, content hash와 byte count
- 탐지한 소유권과 제안 document ID/profile/relations
- confidence, warnings와 `observed` 또는 `review_required` 처분
- candidate artifact ID와 artifact hash

Candidate는 source document별 artifact로 만들고 한 Markdown/YAML 파일에 계속 append하지 않습니다. `MigrationPlan`은 candidate artifact 좌표, 만들 sidecar 경로, 예상 대상 부재 또는 hash, 생성 시각과 승인 좌표를 연결합니다. 원문과 절대 경로는 event payload에 복제하지 않습니다.

Dry-run은 어떤 파일도 만들거나 수정하지 않습니다. Apply 직전 모든 source hash와 대상 layout을 다시 확인합니다. 하나라도 달라지면 전체 plan을 `stale`, ID·경로 소유권이나 기존 대상과 충돌하면 `conflict`로 거부하며 부분 적용하지 않습니다.

### 기본 적용은 metadata-only다

승인된 첫 적용은 `.lervo/documents/<documentId>.yaml` sidecar만 원자적으로 만듭니다. Source 위치, byte, front matter와 기존 marker를 유지합니다. 알 수 없는 형식과 낮은 신뢰도는 자동 관리 대상으로 승격하지 않고 `observed/review_required`로 남깁니다.

본문 이동, 형식 변환, marker 삽입과 문서 분할은 별도 structural patch입니다. Source와 target snapshot, block 밖 byte 보존과 명시적 승인이 없으면 적용하지 않습니다. 기존 `.lervo/documents.yaml`의 분할도 같은 원칙을 따르며 init이 자동 실행하지 않습니다.

### 승인은 최종 manifest를 확정한다

승인은 plan ID와 candidate artifact ID/hash에 묶이며 plan의 모든 candidate를 중복 없이 정확히 한 번 다룹니다. 각 결정은 `skip`과 사유 code이거나 `approve_sidecar`와 최종 `DocumentManifest`입니다. Dry-run 제안만으로는 책임자, locale, 검토 주기와 검증 revision을 확정할 수 없으므로 apply가 이를 임의로 채우지 않습니다. 승인 시각은 적용 시각보다 늦을 수 없고 승인 manifest의 document ID, 원본 경로와 sidecar target은 candidate 제안과 같아야 합니다.

### 적용은 부분 layout을 활성화하지 않는다

적용기는 plan 내용으로 plan ID를 다시 계산하고 candidate artifact canonical byte의 hash·크기·ID를 검증합니다. 이어서 모든 source byte, 각 target과 현재 `.lervo/documents/` snapshot을 다시 읽습니다. 하나라도 달라지거나 기존 manifest 전체와 새 manifest의 path·ID·관계가 충돌하면 어떤 sidecar도 활성화하지 않습니다.

Sidecar는 격리된 staging directory에서 완성하고 파일을 동기화합니다. 공개 전 `.lervo/documents/`에 transaction marker를 만들며 loader는 이 marker가 있는 부분 layout을 계약 위반으로 거부합니다. 승인된 sidecar를 모두 공개하고 전체 snapshot을 다시 확인한 뒤 `document.migration.applied` event를 영속합니다. Event recorder는 성공 반환 전에 event를 durable하게 commit하고, 실패 반환 시에는 commit하지 않는 port여야 합니다. Event 기록 전에 실패하면 이번 apply가 만든 파일을 content hash로 확인해 전부 되돌립니다. Event가 기록된 뒤 marker 제거에 실패하거나 rollback 안전성을 증명하지 못하면 정상 receipt를 반환하지 않고 fail-closed 상태를 남깁니다.

기존 `.lervo/documents.yaml`과 분할 sidecar directory는 동시에 활성화할 수 없습니다. 첫 metadata-only apply는 legacy registry가 있는 layout을 `migration_conflict`로 거부합니다. Registry byte의 보존 위치와 비활성화 처분, 항목별 artifact와 새 sidecar 전체를 묶는 structural dry-run 계약은 아래와 같이 분리합니다.

### Legacy registry는 불변 원본과 항목별 artifact로 나눈다

Structural dry-run은 `.lervo/documents.yaml`을 안정적으로 한 번 읽고 최대 4,096개 record를 document ID 순서로 분리합니다. 각 artifact는 source registry hash, document ID와 원래 `DocumentRecord` 전체를 포함합니다. 따라서 책임자, 연결 경로, 검증 revision·시각·주기와 소유권을 일반 import 제안으로 축약하지 않습니다. Artifact hash에는 source registry hash도 들어가므로 registry의 주석이나 직렬화가 달라져 원본 bytes가 바뀌면 모든 승인 좌표가 새로 만들어집니다.

원본 보존 target은 `.lervo/archive/document-registries/sha256/<source-digest>.yaml`입니다. 이 파일은 다음 migration 내용을 append하는 문서가 아니라 특정 source bytes의 불변 사본입니다. Plan은 원본 경로의 처분을 `archive_then_remove`로 명시하지만 dry-run은 archive directory도 만들지 않습니다.

Plan에는 새 `.lervo/documents` directory와 모든 sidecar target뿐 아니라 각 record가 가리키는 문서의 missing/file/unsafe snapshot도 포함합니다. 참조 문서는 structural apply가 수정하지 않지만, 승인자가 검토한 저장소 상태와 다른 문서 집합에 오래된 registry 분할을 적용하지 않기 위해 결속합니다. 참조 문서 부재는 review warning이고 안전한 snapshot을 만들 수 없는 문서는 `conflict`입니다. 중복 path·비정규 경로, 기존 sidecar layout과 다른 bytes의 archive target도 `conflict`입니다. Managed block과 Lervo 생성 소유권은 실제 본문 parser가 아직 없으므로 자동 확정하지 않고 review 대상으로 남깁니다.

Structural apply는 plan의 모든 entry artifact를 정확히 한 번 승인 또는 제외하고, 승인 항목에는 원래 `DocumentRecord`를 보존한 최종 `DocumentManifest`를 요구합니다. Archive와 sidecar를 staging에서 먼저 완성한 뒤 `.lervo/.document-migration.lock`으로 loader를 닫습니다. Marker가 있는 동안 sidecar directory를 한 번에 공개하고 legacy 원본을 staging으로 비활성화합니다. 참조 문서와 공개 snapshot을 다시 확인하고 durable 완료 event를 기록한 뒤에만 marker를 제거합니다.

Event 이전 실패는 공개 sidecar directory를 hash로 확인해 staging으로 되돌리고 legacy 원본 bytes를 복원하며, 이번 apply가 만든 archive와 빈 directory를 제거합니다. 단계별 failure injection fixture가 staging, archive, marker, sidecar 공개, legacy 비활성화와 event 직전 실패를 검증합니다. 외부 변경 때문에 rollback 대상을 확인할 수 없으면 marker를 남긴 `rollback_failed`, event commit 뒤 정리가 실패하면 marker를 유지한 `migration_finalization_failed`로 끝내며 정상 receipt를 반환하지 않습니다.

### 상태, event와 실패 의미

성공 event 이름은 `document.migration.applied`입니다. 공통 payload는 plan/approval ID, 승인 원본 digest, 적용 전후 전체 layout hash, 생성한 document ID/content hash와 적용 시각입니다. Metadata-only 적용은 source와 candidate artifact hash 집합을 사용합니다. Legacy 구조 전환은 `migrationKind=legacy_registry_structural`, source registry hash, entry artifact hash 집합과 archive content hash를 사용합니다. 승인자 ID, source/archive/document path, document 본문, manifest 내용과 절대 경로는 event에 넣지 않습니다. 반환 receipt에는 로컬 사용을 위한 archive·비활성화 경로, 생성 sidecar 상대 경로와 제외한 document ID를 포함하지만 event payload와 같은 정보라고 주장하지 않습니다.

- `review_required`: 형식은 읽었지만 소유권·profile·관계를 자동 확정할 신뢰도가 부족합니다. 원본을 유지하고 사람 결정을 기다립니다.
- `plan_stale`: Plan 생성 뒤 source hash 또는 대상 layout이 바뀌었습니다. 어떤 sidecar도 쓰지 않고 다시 탐색합니다.
- `migration_conflict`: Document ID, source path 소유권, 대상 sidecar 또는 document layout이 기존 원본과 충돌합니다. 부분 적용하지 않습니다.
- `unsupported_format`: 일치하는 adapter가 없습니다. 오류로 원본을 배제하지 않고 observed 후보와 경고를 반환합니다.
- `unsafe_source`: 경로, 파일 종류, 크기 또는 읽기 안정성을 보장할 수 없습니다. 해당 scan을 실패시키고 원문을 읽은 것으로 주장하지 않습니다.
- `invalid_approval` / `invalid_migration_artifact`: 승인 또는 hash-bound 계획·artifact 계약이 다릅니다. 쓰기 전에 거부합니다.
- `invalid_legacy_registry`: 기존 registry YAML/schema 또는 항목 artifact·structural plan을 안전하게 만들 수 없습니다. 어떤 archive나 sidecar도 쓰지 않습니다.
- `telemetry_recording_failed`: 성공 event를 기록하지 못했습니다. 생성한 sidecar를 되돌리고 완료를 주장하지 않습니다.
- `migration_finalization_failed` / `rollback_failed`: event 이후 공개 marker 정리 또는 실패 전 파일 복구를 안전하게 끝내지 못했습니다. 자동 성공이나 부분 복구로 표시하지 않습니다.

## 결과

- 기존 저장소의 문서 형식이 표준 marker에 맞지 않아도 안전하게 발견할 수 있습니다.
- Init, import 판정, metadata 도입과 본문 변환의 권한 경계가 분리됩니다.
- Dry-run 이후 바뀐 원본에 오래된 계획을 적용할 수 없습니다.
- 형식 adapter 추가가 scanner와 compiler의 파일 시스템 권한을 넓히지 않습니다.
- Managed block compiler는 실제 legacy 형식 계약을 입력으로 받아 구현됩니다.
