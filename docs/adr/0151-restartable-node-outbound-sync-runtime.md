# ADR-0151: 재시작 가능한 Node outbound sync runtime

- 상태: 채택
- 기준일: 2026-08-22

## 맥락

Node worker와 인증 HTTP transport, Hub 수신 API는 실제 event를 한 cycle 동안 전달할 수 있었습니다. 하지만 사용자가 직접 store와 transport를 조립하고 cycle을 반복해야 했습니다. Process signal과 store 종료 순서도 정해지지 않아 장기 실행 진입점으로 쓸 수 없었습니다.

동기화를 기존 CLI 실행 안에 넣으면 Hub 지연이 local-first 작업 수명주기에 섞입니다. 반대로 별도 process가 event를 다시 만들거나 자체 성공 원장을 원본으로 삼으면 로컬 event store와 outbox의 책임이 겹칩니다.

## 결정

### Polling은 worker와 분리해 직렬로 실행한다

`@lervo/sync`에 `runOutboundSyncLoop`를 추가합니다. 한 cycle이 끝나기 전에 다음 cycle을 시작하지 않습니다. `synchronized` 뒤에는 남은 outbox를 위해 바로 반복하고, `idle`에는 bounded poll interval을 적용합니다. 등록 지연과 batch 재시도는 worker가 반환한 `nextAttemptAt`까지 기다립니다. Abort 뒤에는 새 cycle을 시작하지 않습니다.

Polling은 network, SQLite와 project manifest를 직접 알지 않습니다. 기존 worker options와 wait·clock·cycle callback port만 받습니다. Cycle callback도 직렬 경계 안에서 실행하므로 느리거나 실패한 callback과 다음 cycle이 겹치지 않습니다.

### `lervo-node`는 한 project의 조합 root다

새 `@lervo/node-runtime` 앱은 `lervo-node --config <config.json>`을 제공합니다. Config는 strict JSON이며 repository root, HTTPS Hub URL, 별도 bearer token 파일, destination·Hub identity와 worker·poll·HTTP 상한만 가집니다. 상대 경로는 config 파일 위치에서 해석합니다. 예시는 [node-runtime.config.example.json](../examples/node-runtime.config.example.json)에 둡니다.

구성과 token은 owner-only 일반 파일이어야 합니다. Token 원문은 config에 넣지 않으며 32~4096자 visible ASCII와 선택적인 마지막 줄바꿈 하나만 허용합니다. Hub와 Node가 공통으로 쓰는 파일 검사와 Hub SQLite parent 검사는 `@lervo/runtime-security`로 추출합니다. 이 package는 process signal, project 의미나 제품별 오류를 소유하지 않습니다. Hub runtime은 얇은 wrapper로 기존 오류 code를 유지합니다.

Node runtime은 실제 repository와 project manifest를 확인하고 `hubSyncEnabled=true`일 때만 project-bound event store를 엽니다. Manifest identity, destination, Hub identity와 token을 HTTPS transport에 고정하고 polling lifecycle을 시작합니다. Manifest와 config는 시작 snapshot이며 hot reload로 일부 값만 섞지 않습니다.

### 종료는 진행 중 cycle 뒤에 store를 닫는다

`SIGINT`, `SIGTERM`과 명시적 `close()`는 같은 promise로 수렴합니다. 먼저 AbortSignal로 wait와 다음 cycle을 막습니다. 이미 시작한 bounded HTTP cycle이 끝난 뒤 SQLite event store를 닫습니다. 중복 close는 같은 결과를 반환합니다.

Hub offline, timeout과 검증 실패는 기존 `registration_deferred|retry_scheduled` 결과이므로 process를 죽이지 않습니다. Worker 구성·local store·callback 오류처럼 loop를 계속할 수 없는 실패만 `sync_runtime_failed`로 닫습니다.

## 상태와 개인정보

새 event type, scheduler database나 실행 상태를 추가하지 않습니다. Polling의 cycle count와 마지막 결과는 process memory에만 있습니다. 재시작 근거는 기존 outbox의 `pending|leased|acknowledged`, `availableAt`, lease와 고정 failure code입니다.

CLI 시작 문구는 동기화 process 시작만 알립니다. Repository path, Hub URL·identity, destination, token, manifest·event payload와 내부 오류는 stdout·stderr에 넣지 않습니다. Config·token 오류는 `invalid_config|unsafe_runtime_file`, project·event store 문제는 `project_invalid|startup_failed`, loop·종료 문제는 `sync_runtime_failed|shutdown_failed`의 고정 code와 일반 설명만 사용합니다.

Runtime 시작이나 project 등록은 event 전송 완료가 아니며, 전송 성공도 문서가 `loaded`, `injected`, `used`됐거나 원격 command가 실행됐다는 뜻이 아닙니다. Hub가 없거나 `lervo-node`가 꺼져 있어도 기존 CLI의 로컬 실행은 계속 완료됩니다.

## 검증

공용 보안 package에서 owner-only UTF-8 파일, 다른 계정이 읽을 수 있는 파일 거부와 owner-only SQLite 경로를 확인했습니다. Hub runtime의 기존 config·signal·재개방 test도 같은 wrapper 뒤에서 다시 통과했습니다.

실제 project event SQLite에 event와 outbox를 저장한 뒤 Hub가 없는 상태로 Node runtime 한 cycle을 실행했습니다. 결과는 `registration_deferred`였고 process를 정상 종료했습니다. 같은 config로 runtime을 다시 열고 실제 Hub HTTP·SQLite를 시작하자 등록과 event가 전송됐고 local outbox acknowledgement와 Hub 전체 audit가 각각 event 하나를 확인했습니다. 별도 signal fixture는 `SIGTERM` 뒤 repository, identity와 token이 출력되지 않는지 확인했습니다.

## 결과와 후속 범위

사용자가 직접 cycle을 호출하지 않아도 `lervo-node`가 한 project의 outbound sync를 반복하고, offline과 process 재시작 뒤 기존 outbox에서 안전하게 이어갑니다. Sync core, HTTP transport, project loader, store와 process lifecycle은 각각 분리되어 있습니다.

현재 runtime은 outbound event sync만 조합합니다. 원격 command·정책 polling, 여러 project를 한 process에서 운영하는 방식, credential·manifest hot reload, OS service installer·supervisor와 production TLS 인증서 수명주기는 후속 작업입니다.
