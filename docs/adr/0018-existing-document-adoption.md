# ADR-0018: 기존 문서 도입과 안전한 migration

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Roven을 새 저장소에만 설치한다고 가정할 수 없습니다. 실제 저장소에는 `README.md`, `AGENTS.md`, `CLAUDE.md`, ADR, MDX, AsciiDoc, custom front matter와 과거 Roven `documents.yaml`이 서로 다른 규칙으로 쌓여 있을 수 있습니다. 표준 managed block parser부터 구현하면 기존 형식을 표준 marker에 억지로 맞추거나 사용자 원본을 수정하는 방향으로 경계가 굳어질 수 있습니다.

`roven init`은 안전한 project layout 생성만 담당합니다. 기존 문서를 Roven의 관리 대상으로 도입하는 일은 원본 형식과 소유권을 판정하고 사용자가 승인해야 하므로 init과 같은 암묵적 단계가 될 수 없습니다.

## 결정

### 구현 순서

문서 수명주기의 남은 구현을 다음 순서로 고정합니다.

1. 안전한 read-only scanner와 `DocumentImportAdapter` 공통 계약
2. Source 문서별 `MigrationCandidate`와 hash-bound dry-run plan
3. 사용자 승인과 metadata-only sidecar apply
4. CommonMark와 legacy marker adapter/parser
5. Byte 보존 managed block patch candidate
6. Staleness detector와 구조 변경 후보

앞 단계의 계약 테스트와 원본 무변경 fixture를 통과하기 전에는 다음 단계가 사용자 문서를 수정하지 않습니다.

### 탐색과 형식 adapter를 분리한다

Core scanner가 탐색 root, 제외 경로, 파일 수·개별 크기·전체 byte 한도, 안전한 전체 파일 읽기, source hash와 결정적 순서를 소유합니다. 절대 경로, root 이탈, 심볼릭 링크, 일반 파일이 아닌 항목과 읽는 중 변경을 거부합니다. 기본 제외 대상은 `.git`, 의존성 디렉터리와 `.roven/state`입니다.

`DocumentImportAdapter`는 adapter ID/version, 지원 확장자와 탐지 함수를 공개합니다. Adapter는 scanner가 읽은 저장소 상대 경로와 byte만 받고 파일 시스템이나 event store 쓰기 port를 받지 않습니다. 반환값은 형식, 소유권, document ID/profile/관계와 marker 후보, confidence와 warnings입니다. Markdown, MDX, AsciiDoc, 과거 Roven registry와 프로젝트 custom 형식은 같은 공통 계약 테스트를 통과해야 합니다.

### 후보와 계획은 원본에 묶는다

`MigrationCandidate`는 다음을 포함합니다.

- source path, format, content hash와 byte count
- 탐지한 소유권과 제안 document ID/profile/relations
- confidence, warnings와 `observed` 또는 `review_required` 처분
- candidate artifact ID와 artifact hash

Candidate는 source document별 artifact로 만들고 한 Markdown/YAML 파일에 계속 append하지 않습니다. `MigrationPlan`은 candidate artifact 좌표, 만들 sidecar 경로, 예상 대상 부재 또는 hash, 생성 시각과 승인 좌표를 연결합니다. 원문과 절대 경로는 event payload에 복제하지 않습니다.

Dry-run은 어떤 파일도 만들거나 수정하지 않습니다. Apply 직전 모든 source hash와 대상 layout을 다시 확인합니다. 하나라도 달라지면 전체 plan을 `stale`, ID·경로 소유권이나 기존 대상과 충돌하면 `conflict`로 거부하며 부분 적용하지 않습니다.

### 기본 적용은 metadata-only다

승인된 첫 적용은 `.roven/documents/<documentId>.yaml` sidecar만 원자적으로 만듭니다. Source 위치, byte, front matter와 기존 marker를 유지합니다. 알 수 없는 형식과 낮은 신뢰도는 자동 관리 대상으로 승격하지 않고 `observed/review_required`로 남깁니다.

본문 이동, 형식 변환, marker 삽입과 문서 분할은 별도 structural patch입니다. Source와 target snapshot, block 밖 byte 보존과 명시적 승인이 없으면 적용하지 않습니다. 기존 `.roven/documents.yaml`의 분할도 같은 원칙을 따르며 init이 자동 실행하지 않습니다.

### 첫 슬라이스의 상태와 실패 의미

첫 슬라이스는 read-only candidate와 dry-run plan만 구현하므로 migration 완료 event를 만들지 않습니다.

- `review_required`: 형식은 읽었지만 소유권·profile·관계를 자동 확정할 신뢰도가 부족합니다. 원본을 유지하고 사람 결정을 기다립니다.
- `stale`: Plan 생성 뒤 source hash 또는 대상 layout이 바뀌었습니다. 어떤 sidecar도 쓰지 않고 다시 탐색합니다.
- `conflict`: Document ID, source path 소유권 또는 대상 sidecar가 기존 원본과 충돌합니다. 부분 적용하지 않습니다.
- `unsupported_format`: 일치하는 adapter가 없습니다. 오류로 원본을 배제하지 않고 observed 후보와 경고를 반환합니다.
- `unsafe_source`: 경로, 파일 종류, 크기 또는 읽기 안정성을 보장할 수 없습니다. 해당 scan을 실패시키고 원문을 읽은 것으로 주장하지 않습니다.

후속 apply event를 추가할 때는 이름, candidate/plan hash, 승인 원본, before/after layout hash, 개인정보 allowlist와 위 실패 처분을 별도 schema 변경에 고정합니다.

## 결과

- 기존 저장소의 문서 형식이 표준 marker에 맞지 않아도 안전하게 발견할 수 있습니다.
- Init, import 판정, metadata 도입과 본문 변환의 권한 경계가 분리됩니다.
- Dry-run 이후 바뀐 원본에 오래된 계획을 적용할 수 없습니다.
- 형식 adapter 추가가 scanner와 compiler의 파일 시스템 권한을 넓히지 않습니다.
- Managed block compiler는 실제 legacy 형식 계약을 입력으로 받아 구현됩니다.
