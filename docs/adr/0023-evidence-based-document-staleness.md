# ADR-0023: 증거 기반 문서 노후화 판정

- 상태: 채택
- 날짜: 2026-08-19

## 배경

Document manifest의 검증 revision과 현재 revision이 다르다는 사실만으로는 문서가 낡았다고 할 수 없습니다. 반대로 현재 파일 목록만 보고 연결 경로가 그대로라고 판단하면, 검증 이후 변경됐다가 삭제된 파일을 놓칠 수 있습니다. 확인하지 못한 상태를 최신으로 취급하면 문서 수명주기 검사가 실제보다 강한 보장을 주장하게 됩니다.

노후화 판정은 원본 문서나 manifest를 고치는 작업과도 분리해야 합니다. 판정 결과는 저장소 상태와 입력 hash에서 다시 만들 수 있는 파생 자료이며, patch 생성이나 적용 권한을 가져서는 안 됩니다.

## 결정

`@lervo/documents`는 순수 함수 `evaluateDocumentStaleness`를 제공합니다. 입력은 schema와 의미 계약을 통과한 `DocumentManifest`, 판정 시각, 현재 repository snapshot, 선택적인 검증 revision snapshot, 선택적인 managed input 관측값입니다. Snapshot은 revision과 상대 경로별 content hash만 가지며 provider나 Hub에 의존하지 않습니다.

결과는 독립 `DocumentStalenessResult` schema를 따르고 문서마다 하나씩 생성합니다. 필수 좌표는 document/result ID, 판정 시각, 검증·현재 revision, 전체 상태, 신호별 상태와 기계용 사유입니다. Result ID는 나머지 결과 내용을 canonical JSON으로 직렬화한 hash에서 결정합니다.

전체 상태는 다음 세 값만 사용합니다.

- `current`: 모든 적용 가능한 신호가 현재 상태임을 증명했습니다.
- `stale`: 하나 이상의 변경이나 만료를 증명했습니다. 다른 신호가 `unknown`이어도 stale 근거를 숨기지 않습니다.
- `unknown`: stale 근거는 없지만 하나 이상의 신호를 확인하지 못했습니다.

신호별 규칙은 다음과 같습니다.

- `reviewInterval`: `verifiedAt + reviewIntervalDays`의 정확한 시각부터 `stale`입니다.
- `documentPath`: 현재 revision이 manifest의 `verifiedRevision`과 같고 현재 snapshot에 문서가 있으면 `current`, 문서가 없으면 `stale`입니다. Revision이 다르면 해당 revision과 정확히 일치하는 검증 snapshot의 문서 hash와 현재 hash를 비교합니다. 검증 snapshot이 없거나 revision이 다르면 `unknown`입니다.
- `connectedPaths`: 각 경로 자체와 그 하위 경로의 파일 집합을 두 snapshot에서 비교합니다. 양쪽 모두에 관측된 파일이 없으면 변경 없음이 아니라 `unknown`입니다. `src`는 `src2`와 일치하지 않습니다.
- `managedInputs`: `managed_blocks`와 `lervo_generated`가 manifest에 고정한 source ID/hash를 현재 관측과 비교합니다. Hash 변경과 명시적인 source 부재는 `stale`, 관측값 자체가 없으면 `unknown`입니다. 사용자 소유 문서에는 `not_applicable`입니다.

같은 revision을 가리키는 두 snapshot의 파일 집합이 다르거나, 선언하지 않은·중복된 managed input 관측, 안전하지 않은 경로, 잘못된 시각은 입력 계약 위반으로 거부합니다. 판정 함수는 파일, CAS, event를 쓰지 않으며 문서 수정·승인·검증 완료를 주장하지 않습니다.

## 개인정보와 실패 의미

결과의 상대 경로와 source ID는 로컬 진단 자료입니다. 문서 본문, 입력 원문, 절대 경로와 비밀정보를 포함하지 않으며 현재 구현은 `document.stale.detected` event를 만들지 않습니다. 향후 event를 추가할 때는 별도의 허용 payload와 기록 실패 의미를 먼저 정해야 합니다.

- `invalid_staleness_request`: manifest, snapshot, 시각 또는 managed input 관측이 서로 일관된 판정 근거가 아닙니다. 결과를 만들지 않고 입력을 다시 수집해야 합니다.
- `staleness_contract_invalid`: 계산 결과가 공개 schema를 통과하지 못했습니다. 결과를 사용하거나 current/stale로 보고하지 않습니다.

## 결과

Revision 문자열의 차이를 노후화로 과장하지 않고, 근거가 부족한 상태를 명시적으로 드러낼 수 있습니다. `AGENTS.md`, `CLAUDE.md`, `README.md`도 같은 계약과 fixture로 검사하며 provider별 예외를 두지 않습니다. Repository snapshot 수집과 결과 저장·CLI 출력은 이 판정기 바깥의 후속 조합 계층이 맡습니다.
