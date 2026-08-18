# ADR-0002: 안전한 로컬 프로젝트 초기화

상태: `accepted`  
기준일: 2026-08-18

## 맥락

`roven init`은 기존 저장소에 Roven의 project identity와 로컬 상태 경로를 추가합니다. 이 과정에서 사용자 문서를 덮어쓰거나 dry-run과 실제 적용이 서로 다른 판단을 하면 이후 실행 증거를 신뢰할 수 없습니다. 반대로 아직 계약이 없는 설정 파일을 미리 만들면 임시 형식이 공개 규격처럼 굳을 수 있습니다.

## 결정

### 같은 계획을 확인하고 적용

- Dry-run과 apply는 같은 `InitPlan` 구조와 생성 함수를 사용한다.
- 각 작업은 `create`, `unchanged`, `conflict` 중 하나다.
- 새 파일은 dry-run에 전체 내용을 표시한다.
- Apply 직전에 모든 대상의 존재 여부와 기존 파일 hash를 다시 확인한다.
- 계획 이후 대상이 바뀌면 새 계획을 요구하며 적용하지 않는다.
- 새 `.roven`은 같은 저장소 안의 임시 트리에 모든 내용을 쓴 뒤 원자적인 rename으로 공개한다. 중간 쓰기가 실패하면 임시 트리를 제거하므로 부분 초기화가 보이지 않는다.
- 이미 `.roven`이 있는 경우 이번 적용에서 새로 만든 항목만 추적하고, 중간 실패 시 역순으로 되돌린다.
- 적용할 수 있는 경로는 `.roven`과 그 하위로 제한하며, 외부에서 만든 계획 객체도 저장소의 다른 파일을 쓸 수 없다.

### 첫 슬라이스의 소유 범위

- `.roven/project.yaml`과 `.roven/documents.yaml`은 현재 JSON Schema를 통과하는 내용만 만들거나 읽는다.
- `.roven/.gitignore`는 새 파일일 때만 `state/` 규칙을 쓴다. 기존 파일은 수정하지 않는다.
- `.roven/generated/`, `.roven/state/`, `.roven/knowledge/` 디렉터리를 준비한다.
- 아직 독립 계약이 없는 `policy.yaml`과 `skills.lock`은 만들지 않는다.
- 저장소 루트의 `README.md`, `AGENTS.md`, `CLAUDE.md`와 다른 사용자 파일은 읽거나 수정하지 않는다.

### 기존 상태와 충돌

- 유효한 기존 project manifest의 `projectId`, 이름, 생성 시각과 데이터 정책은 그대로 유지한다.
- 기존 project/document YAML이 현재 schema를 통과하지 못하면 자동 보정하거나 덮어쓰지 않는다.
- 관리 대상 경로의 심볼릭 링크는 따라가지 않는다.
- 충돌이 하나라도 있으면 전체 계획을 막아 일부 디렉터리나 파일만 생기지 않게 한다.
- 새 project id는 plan 생성 시 한 번 만들고 apply는 그 값을 그대로 쓴다.

## 결과

- 초기화를 반복해도 project identity와 사용자 파일이 바뀌지 않는다.
- Dry-run에서 본 새 파일 내용과 같은 계획이 실제 적용된다.
- 새 저장소의 중간 실패는 `.roven` 일부를 남기지 않으며 다시 계획할 수 있다.
- 계약이 없는 설정 형식을 서둘러 고정하지 않고 이후 단계의 ADR과 schema에서 결정할 수 있다.
- SQLite event store가 아직 없어 init 자체는 실행 이벤트를 기록하지 않는다. M1의 다음 수직 슬라이스에서 로컬 event store를 연결한다.
