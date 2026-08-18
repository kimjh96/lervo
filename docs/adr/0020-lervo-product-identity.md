# ADR-0020: Lervo 제품 식별자 통일

상태: Accepted
날짜: 2026-08-19

## 맥락

제품명과 npm scope가 다르면 설치 명령, package import, 관리 경로와 문서에서 서로 다른 이름을 설명해야 합니다. 아직 공개 호환 계약이 없는 `0.0.0` 단계에서 이 차이를 남기면 이후 모든 migration과 지원 경로에 불필요한 별칭이 생깁니다.

관리 경로에는 append-only event hash chain과 CAS 주소가 들어 있습니다. 기존 경로의 문자열만 바꾸면 저장된 증거의 식별자와 실제 저장 위치가 달라질 수 있으므로, 단순 directory rename을 안전한 migration으로 취급할 수 없습니다.

## 결정

외부와 내부의 제품 식별자를 다음과 같이 통일합니다.

- 제품명: `Lervo`
- CLI와 root package: `lervo`
- 저장소 관리 경로: `.lervo`
- npm scope: `@lervo/*`
- Schema와 CAS URI, adapter ID, managed marker, 스킬 manifest 접두사: `lervo`

이전 이름의 CLI, npm package alias와 이중 관리 경로는 제공하지 않습니다. `lervo init`은 저장소 root에 이전 `.roven` 경로가 있으면 새 `.lervo`를 만들기 전에 전체 계획을 차단합니다. 이전 경로는 읽거나 수정하거나 삭제하지 않습니다.

기존 상태를 지원하는 명칭 migration은 다음 조건을 만족하는 별도 작업으로 구현합니다.

1. 이전 관리 tree와 원본 bytes를 먼저 고정하고 보존합니다.
2. Event hash chain, CAS object와 URI를 새 계약에서 어떻게 참조할지 명시합니다.
3. 새 layout을 완성하고 검증하기 전에는 이전 layout을 비활성화하지 않습니다.
4. 실패하면 새 layout을 제거하고 이전 bytes와 활성 상태를 복원합니다.
5. 완료 여부와 보존 좌표를 원문 없이 event로 남깁니다.

## 결과

새 코드와 문서는 하나의 이름만 사용합니다. 사용자는 제품명에서 CLI, 관리 폴더와 package scope를 바로 예측할 수 있습니다.

이전 실험 상태가 있는 저장소는 자동 초기화되지 않습니다. 이는 조용한 상태 유실과 두 event store의 동시 사용을 막기 위한 의도적인 fail-closed 동작입니다. 명칭 migration이 구현되기 전에는 이전 상태를 별도로 보존해야 합니다.
