# ADR-0143: 실행 증거와 대화 조립 경계 강화

- 상태: 채택
- 날짜: 2026-08-22

## 맥락

Event store의 `list` 기본값은 100개였지만 숙의 runtime은 한 run의 완료 증거가 이 범위 안에 있다고 암묵적으로 가정했습니다. Provider가 많은 정상 signal을 내면 `run.completed`가 첫 page 뒤에 놓여 정상 산출물 공개가 실패할 수 있었습니다. 숙의 snapshot 복원은 대상과 무관한 프로젝트 event 전체를 한 배열에 모았고 provider signal 개수에는 명시적 상한이 없었습니다.

대화 배포 앱은 Slack과 Discord 생성 코드를 직접 소유했습니다. 자체 채팅 adapter는 공통 계약을 구현해도 같은 composition root에 등록할 수 없었고, 새로운 외부 플랫폼을 추가하려면 앱 본체와 두 플랫폼으로 닫힌 SQLite 종류 제약을 함께 수정해야 했습니다. 또한 숙의 queue SQLite adapter가 상위 `conversation-control`에 의존하고 숙의 runtime이 상위 `orchestrator` 결과·검증 구현에 의존해 저장·도메인 경계의 방향이 뒤집혀 있었습니다.

## 결정

`@lervo/storage-contract`는 page가 순방향인지 확인하는 snapshot visitor와 명시적 최대 개수를 요구하는 run event collector를 제공합니다. 숙의 runtime과 managed conversation 검증은 최대 2,000개의 run event를 끝까지 읽으며 초과·역행·잘못된 run 좌표를 일부 성공으로 처리하지 않습니다. 숙의 snapshot 복원은 시작 시점의 project head sequence까지만 streaming 방문하고 대상 artifact·완료 좌표만 보관합니다.

Managed provider signal은 기본 500개, 구성 가능한 절대 최대 10,000개로 제한합니다. 구성값 자체는 adapter 시작 전에 검증하고, 상한을 넘은 signal은 telemetry에 기록하지 않고 `provider_stream_failed`로 실행을 닫습니다. 한 managed run의 증거 event 최대 2,000개는 `@lervo/execution-contract`의 단일 상수로 공유합니다. 이 변경은 새 event type이나 payload를 추가하지 않으며 signal 원문, tool 입력, command 출력과 provider payload를 새 저장소에 남기지 않습니다.

`apps/conversation`은 `ConversationIntegrationDeployment` registry를 조립합니다. Slack·Discord는 credential transport를 감싼 내장 factory이고, 외부 adapter와 native chat은 같은 registry에 등록합니다. `platform=null`은 자체 서비스가 canonical Lervo 좌표를 직접 공급해 외부 ID mapping을 사용하지 않는다는 뜻입니다. Platform 값이 있으면 factory가 반환한 descriptor의 `adapterKind`도 같은 값이어야 합니다. 외부 ID mapping이 필요한 adapter kind는 소문자·숫자·`_`·`-`로 된 최대 64자 이름을 사용합니다. `@lervo/conversation-platform-sqlite` schema v2는 기존 Slack·Discord v1 행과 다섯 테이블의 관계를 보존하면서 이 종류 제약을 일반화합니다.

Queue job·summary·lease·대조 port는 `@lervo/conversation-deliberation-contract`, managed 실행 결과와 E2/E3·완료 증거 검증은 `@lervo/execution-contract`가 소유합니다. SQLite queue adapter와 숙의 runtime은 각각 이 하위 계약에만 의존합니다. 시작·재개 SQLite store는 공통 open, bounded row iterator 무결성 검사와 rollback core를 공유하되 enqueue와 terminal reconciliation 정책은 분리합니다. CI는 production dependency cycle, package의 app 의존, contract의 구현 의존과 이 두 금지 의존의 transitive 경로를 검사합니다.

CLI 숙의 workspace는 writing contract를 선택하지 않습니다. Composition root가 계약을 주입하고 재개 시 주입된 canonical bytes의 hash가 checkpoint와 같은지 확인합니다. Workspace의 상태·publication 조립과 임시 디렉터리를 이용한 원자적 문서 materialization도 분리합니다. Materializer는 repository 내부의 실제 숙의 디렉터리와 단일 경로 이름만 받고 traversal을 쓰기 전에 거부합니다. 숙의 runtime의 실행 상태 전이와 snapshot 원본 검증·복원은 별도 모듈로 나누며, 복원 검증기는 완전히 검증된 값만 runtime에 반환하고 예상하지 못한 중첩 형식 오류도 `runtime_snapshot_invalid`로 닫습니다. Managed provider 조정기의 결과 저장·project 검증·terminal 판정은 공급자 실행 단계와 분리된 phase 메서드가 담당합니다.

## 결과

Event page 기본값과 프로젝트 이력 크기가 정상 run 증거 의미를 바꾸지 않으며 과도한 provider stream은 명시적으로 실패합니다. 새 플랫폼과 자체 채팅은 conversation app 본체를 수정하지 않고 등록할 수 있고 새 external platform kind는 SQLite schema 변경 없이 binding을 사용할 수 있습니다. 저장 adapter와 숙의 runtime의 상위 구현 의존이 제거되며 package boundary 검사가 회귀를 차단합니다. 파일 I/O, snapshot 검증, 실행·결과 마감의 변경 이유가 서로 다른 모듈 경계로 분리되어 이후 포맷·저장 방식·검증 정책을 독립적으로 바꿀 수 있습니다. Event reader의 exact-limit·overflow·sequence·snapshot head, 실제 v1 행 보존, 경로 traversal과 descriptor 불일치는 직접 계약 fixture로 검증하며 긴 provider·숙의 회귀 파일은 책임별 suite와 공통 fixture로 나눕니다.

Run event 2,000개 상한이나 provider signal 10,000개 절대 상한을 늘리는 변경은 메모리·telemetry·privacy 예산과 회귀 fixture를 함께 검토해야 합니다. Project snapshot scan의 메모리는 bounded지만 시간은 snapshot event 수에 비례하므로, 이후 파생 인덱스를 추가하더라도 event 원본 재검증과 snapshot 의미를 유지합니다.
