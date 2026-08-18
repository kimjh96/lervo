# ADR-0004: Project storage bootstrap

상태: `accepted`
기준일: 2026-08-18

## 맥락

Project manifest, SQLite event/outbox와 파일 CAS는 각각 구현되어 있었지만 실행 진입점에서 함께 여는 계약은 없었습니다. 호출자가 다른 root나 project id를 조합하면 manifest와 실행 증거가 어긋날 수 있고, 두 저장소 중 하나만 열린 채 다음 단계가 실패하면 자원이 남을 수 있습니다.

이 조합을 `@roven/project`에 넣으면 project 설정 계층이 SQLite와 CAS 구현에 의존합니다. 이후 저장 backend를 바꾸거나 테스트용 구현을 넣기도 어려워집니다. 설정과 저장 구현 사이에 별도 조합 계층이 필요합니다.

## 결정

### 패키지 경계

- `@roven/project`는 초기화, manifest 검증과 관리 경로 계산만 담당합니다.
- `@roven/project-storage`는 검증된 project와 구체적인 저장 backend를 조합합니다.
- 기본 backend는 `@roven/event-store-sqlite`와 `@roven/cas`입니다. 테스트나 이후 구현은 같은 공통 계약을 만족하는 opener로 바꿀 수 있습니다.
- 반환 handle은 manifest, canonical project 경로, event/outbox store와 artifact store를 한 묶음으로 제공합니다.

### 개방 순서와 경로

1. 입력한 저장소 root를 canonical 경로로 바꿉니다.
2. `.roven/project.yaml`을 읽고 현재 schema로 검증합니다.
3. `.roven`, `.roven/state`와 이미 존재하는 `cas`, `cas/sha256`, `cas/.tmp`가 실제 디렉터리인지 확인하고 심볼릭 링크를 거부합니다.
4. Manifest의 project id와 `.roven/state/events.sqlite`로 event/outbox store를 엽니다.
5. `.roven/state/cas`로 artifact store를 엽니다.

호출자는 project id나 backend 경로를 따로 넘기지 않습니다. 따라서 manifest의 identity와 실제 저장 위치가 한 경로 계약에서 나옵니다. Hub가 비활성인 manifest도 로컬 저장소를 열 수 있으며, bootstrap은 outbox 항목을 자동으로 만들지 않습니다.

### 실패와 정리

- Manifest나 storage layout이 유효하지 않으면 backend를 열지 않습니다.
- Event store가 다른 project에 묶여 있으면 CAS를 열기 전에 중단합니다.
- CAS 개방이 실패하면 앞서 연 event store를 닫습니다.
- 원래 개방 실패와 정리 실패가 함께 발생하면 `cleanup_failed`가 두 원인을 모두 보존합니다. 정리 성공으로 기록하지 않습니다.
- 정상 handle의 `close`는 같은 Promise를 재사용해 각 backend를 한 번만 닫습니다.

| code | 의미와 처분 |
|---|---|
| `storage_layout_invalid` | 관리 경로가 없거나 일반 디렉터리가 아니거나 심볼릭 링크입니다. Backend를 열지 않고 상위에서 `contract_validation_failed`로 처리합니다. 경로를 고친 뒤 새로 검증합니다. |
| `cleanup_failed` | 부분 개방 뒤 다음 단계와 자원 정리가 모두 실패했습니다. Run 시작을 중단하고 수동 진단이 필요합니다. 자원이 닫혔다고 가정하지 않습니다. |

기존 `not_initialized`, manifest 계약 오류, event store의 `project_mismatch`와 CAS 오류는 원래 의미를 유지합니다. 새 event type이나 영속 상태는 추가하지 않습니다. 오류 메시지에는 관리 경로와 기계용 code만 넣고 raw prompt, 문서 본문, credential과 provider payload는 넣지 않습니다.

## 결과

- 이후 `roven run`은 project 설정과 서로 다른 저장 root를 임의로 조합하지 않습니다.
- Project 설정 계층은 구체적인 저장 구현에 의존하지 않습니다.
- 부분 개방 실패와 반복 종료의 자원 수명주기를 독립적인 backend fixture로 검증할 수 있습니다.
- 실제 저장소 fixture에서 event와 artifact를 기록하고 닫은 뒤 같은 project로 다시 열어 복구할 수 있습니다.
- Hub 없이도 로컬 실행 원본을 저장하며, 동기화 여부는 호출자의 명시적인 outbox 작업으로 남습니다.
