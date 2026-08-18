# ADR-0017: 분할 문서 manifest와 누적 금지

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

초기 document registry는 `.roven/documents.yaml` 한 파일의 `documents` map에 모든 record를 넣었습니다. 이 구조는 문서가 늘 때마다 같은 파일이 길어지고 여러 작업이 같은 파일을 수정하게 합니다. 생성 이력과 새 주제를 기존 Markdown 끝에 계속 붙이는 방식도 사람의 탐색과 검토를 어렵게 하며 사용자 영역 보존 범위를 넓힙니다.

얇은 중앙 index도 항목 수에 따라 계속 커지므로 같은 문제를 늦출 뿐 없애지 못합니다. 문서 본문에 YAML front matter를 강제하면 기존 사용자 문서를 오염시키고 provider별 해석 차이도 생깁니다. 문서 내용, 수명주기 metadata와 실행 이력을 서로 다른 소유 경계로 분리해야 합니다.

## 결정

### 디렉터리가 index다

새 프로젝트는 단일 `.roven/documents.yaml` 대신 다음 구조를 사용합니다.

```text
.roven/
  documents/
    doc_architecture_01.yaml
    doc_skill_guide_01.yaml
  generated/
    documents/
      project-context.md
    manifests/
      doc_project_context.json
```

`.roven/documents/`의 파일 목록 자체가 registry index입니다. 별도 `index.yaml`을 만들지 않습니다. 파일은 `<documentId>.yaml`이며 파일명과 본문의 `documentId`가 정확히 같아야 합니다. 각 manifest는 최대 64 KiB, 한 번의 v0 조회는 최대 4,096개로 제한합니다. 심볼릭 링크, 다른 확장자, 하위 디렉터리와 계약 밖의 파일은 조용히 무시하지 않고 `document_layout_conflict`로 거부합니다.

Loader는 파일명 byte 순서로 manifest를 읽고 기존 context router가 사용하는 메모리 `DocumentRegistry`로 조립합니다. 여러 manifest가 같은 대상 경로를 소유할 수 없습니다. `parent`, `supersedes`, `related` 관계는 자기 자신이나 등록되지 않은 document ID를 가리킬 수 없습니다. 관계 조회용 그래프는 이 원본 manifest에서 다시 만들 수 있는 파생 인덱스입니다.

기존 `.roven/documents.yaml`이 단독으로 있으면 현재 실행 경로는 기존 schema로 계속 읽습니다. `roven init`은 이를 자동 분할하거나 다시 쓰지 않습니다. 새 디렉터리와 기존 파일이 함께 있으면 어느 쪽도 선택하지 않고 충돌로 중단합니다. 문서별 manifest API와 이후 compiler는 명시적 migration 전까지 기존 단일 registry를 수정하지 않습니다.

### 사람 본문과 기계 metadata를 분리한다

문서 본문은 `text/markdown; charset=utf-8`이고 기계 metadata는 `.roven/documents/<documentId>.yaml` sidecar에 둡니다. 사용자 Markdown에 front matter를 요구하지 않습니다. Sidecar는 문서 record 외에 다음을 고정합니다.

- `profileId`, locale와 독자
- metadata가 본문 밖 `sidecar`에 있다는 사실
- 이력을 현재 문서에 append하지 않고 `separate_documents`로 만든다는 규칙
- 넘친 내용을 주제별 문서로 나누는 `topic_documents` 전략
- parent, supersedes와 related 관계

새 결정이나 이력은 기존 문단 끝에 붙이지 않습니다. 별도 document ID와 파일을 만들고 `supersedesDocumentIds` 또는 `relatedDocumentIds`로 연결합니다. 진입 문서는 짧은 설명과 링크만 유지합니다. 기존 문서를 대체하더라도 이전 manifest를 삭제하지 않아야 관계와 근거를 재구성할 수 있습니다.

### 소유권별 크기와 갱신 방식

사용자 소유 문서는 Roven이 쓰지 않습니다. 32 KiB부터 주제 분리를 권고하고 64 KiB를 넘으면 별도 검토 대상으로 보고하지만 자동으로 나누거나 수정하지 않습니다.

Managed block은 문서 전체가 아니라 선언된 block만 교체할 수 있고 block 하나를 8 KiB로 제한합니다. 넘는 내용은 새 문서로 분리하고 block에는 설명과 링크만 둡니다. Marker는 다음 형식만 허용합니다.

```text
<!-- roven:begin block=<blockId> schema=1 -->
<!-- roven:end block=<blockId> -->
```

같은 document manifest의 block ID와 입력 source ID는 중복될 수 없습니다. 실제 Markdown parser는 marker가 code fence 안에 있는지, 중첩되거나 여러 번 나타나는지 확인해야 하며 다음 compiler 슬라이스에서 구현합니다. 현재 schema와 loader가 marker 문자열과 소유권 일치만 검증하므로 아직 block을 안전하게 수정할 수 있다고 주장하지 않습니다.

Roven 전용 생성 문서는 64 KiB와 최상위 section 12개를 넘길 수 없습니다. 현재 파일 hash가 직전 생성 output과 같을 때만 전체 교체할 수 있고, 넘치는 내용은 `split_and_link`로 분리해야 합니다. 생성 입력 hash, output hash, generator와 policy version은 본문이 아니라 `.roven/generated/manifests/`의 생성 manifest에 둡니다. 이 생성 manifest의 상세 schema와 원자적 compiler는 다음 슬라이스에서 확정합니다.

### 실패와 보존

- `contract_invalid`: 개별 manifest schema, 파일명/ID, marker, 관계 또는 대상 경로 소유권이 잘못됨
- `document_layout_conflict`: 단일/분할 registry가 함께 있거나 documents 디렉터리에 안전하지 않은 항목이 있음
- `not_initialized`: 새 디렉터리와 기존 registry가 모두 없음

이 오류가 있으면 context 실행과 init 적용을 시작하지 않습니다. 자동 migration, 일부 manifest만 선택하는 복구와 사용자 Markdown 수정은 하지 않습니다. 오류 문자열과 event에는 문서 본문을 복제하지 않습니다.

### 범위 밖의 누적 파일

이 결정은 문서 registry와 Roven이 생성·관리하는 Markdown의 누적을 막습니다. `.roven/state/events.sqlite`는 append-only 증거 원본이라 현재 v0에서는 단일 파일로 남아 있습니다. 장기 실행 전에 시간 또는 크기 기준 segment, segment 사이의 terminal hash 연결과 원자적 조회 계약을 별도 ADR로 정해야 합니다. 이 미해결 상태를 일반 문서의 분할 완료로 숨기지 않습니다.

## 결과

- 문서 하나를 등록하거나 바꿀 때 다른 문서의 manifest를 수정하지 않습니다.
- 문서 수가 늘어도 하나의 YAML 문서가 계속 길어지지 않습니다.
- 사용자 본문은 기계 metadata와 생성 이력 때문에 오염되지 않습니다.
- 긴 생성 결과는 append가 아니라 새 주제 문서와 명시적 관계로 분리됩니다.
- 기존 단일 registry는 무단 migration 없이 계속 읽을 수 있지만 새 compiler 기능과 혼용할 수 없습니다.
