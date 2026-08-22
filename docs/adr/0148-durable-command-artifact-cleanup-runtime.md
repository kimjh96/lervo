# ADR-0148: durable cursor와 Hub 수명주기에 결속된 command artifact cleanup runtime

- 상태: 채택
- 기준일: 2026-08-22

## 맥락

[ADR-0147](./0147-bounded-command-artifact-lifecycle.md)은 만료·orphan 정리를 한 번 실행하는 bounded cycle을 만들었지만, 실제 반복 실행과 inventory cursor 보존은 배포 scheduler에 남겼습니다. Process 메모리의 timer와 cursor만 사용하면 재시작할 때 매번 처음부터 훑고, Hub process가 여러 개면 같은 page를 동시에 검사합니다. HTTP server와 무관하게 timer가 남거나 store를 먼저 닫는 종료 순서도 피해야 합니다.

같은 CAS URI를 참조하는 command 수에도 상한이 없으므로 object 한 개가 한 transaction과 메모리를 비대하게 만들 수 있습니다. 반복 scheduler를 연결하기 전에 이 참조 정리도 bounded해야 합니다.

## 결정

### Scheduler 원장과 물리 정리를 분리한다

`@lervo/hub-command`의 cleanup loop는 다음 세 연결 지점만 조합합니다.

- 물리 CAS inventory·삭제
- artifact retention claim·purge repository
- cleanup cycle schedule store

Loop는 SQLite table, HTTP server나 filesystem 경로를 알지 않습니다. 기본 1시간 간격으로 실행하며 작업이 더 남았거나 일부 object가 실패하면 기본 1초 뒤 이어갑니다. Cycle 자체가 시작 또는 schedule 완료 전에 실패하면 고정 code만 남기고 기본 1분 뒤 재시도합니다. Runtime lease 기본값은 5분이고 허용 상한은 30분입니다. 하나의 loop 안에서는 cycle과 wait를 차례로 하나씩 실행합니다.

만료 기준 시각과 실제 완료 시각은 분리합니다. Retention 후보는 cycle 시작 시각으로 고정하지만 각 CAS 삭제 뒤 claim 완료·해제 시각과 scheduler 완료 시각은 clock에서 다시 읽습니다. 오래 걸린 작업은 과거 시작 시각으로 만료 lease를 통과할 수 없습니다. Server 중단 신호는 새 cycle과 wait를 끝내며 이미 시작한 bounded cycle은 완료 또는 안전한 실패 기록까지 마친 뒤 loop가 멈춥니다.

### Durable singleton이 다중 Hub 실행을 직렬화한다

`@lervo/hub-sync-sqlite`는 `command_artifact_cleanup` singleton row를 둡니다. 필수 운영 필드는 다음과 같습니다.

- 다음 CAS inventory cursor 또는 `null`
- 다음 cycle 시각과 epoch millisecond index
- 활성일 때만 존재하는 무작위 lease ID, worker ID, claim·만료 시각과 millisecond index
- 누적 cycle 수, 마지막 `completed|failed`, 마지막 cycle 시각
- 완료 cycle의 claimed·deleted·already-missing·purged-delivery·orphan-purged·failure 개수와 continuation 여부
- 실패 cycle의 고정 `artifact_cleanup_cycle_failed`

첫 migration 값은 cursor `null`, 다음 cycle 시각은 epoch이므로 runtime이 처음 연결되면 즉시 한 cycle을 시도합니다. SQLite `BEGIN IMMEDIATE` transaction에서 다음 시각과 활성 lease를 함께 판정하고 lease를 기록하므로 같은 database를 쓰는 여러 Hub process 중 하나만 cycle을 얻습니다. Process가 멈추면 lease 만료 뒤 다른 worker가 같은 durable cursor에서 이어갑니다. Cycle 완료와 실패는 같은 lease 소유자·ID이고 아직 만료되지 않았을 때만 cursor와 다음 시각을 바꿉니다. Singleton delete는 trigger로 막고 open 및 전체 audit에서 구조와 시각·개수 관계를 검사합니다.

### 공유 참조도 작은 batch로 나눈다

Artifact claim에는 delivery ID 배열을 넣지 않습니다. Expired completion은 한 claim에서 최대 100개 delivery purge만 append합니다. 남은 참조가 있으면 `partial` completion을 기록하고 claim을 닫아 다음 cycle이 같은 URI를 다시 claim합니다. CAS 삭제는 멱등이므로 첫 batch 뒤 object가 이미 없어도 후속 batch는 정상 완료할 수 있습니다.

최신 `partial`을 닫는 `completed`가 생길 때까지 해당 URI 전체를 cleanup 진행 중으로 봅니다. 아직 purge되지 않은 authorship은 `cleanup_claimed`로 조회하고 새 authorship도 conflict로 막으므로 batch 사이에 접근 가능한 command 참조가 생기지 않습니다. CAS put과 SQLite commit 사이의 이 충돌은 접근 불가능한 orphan object를 남길 수 있고 다음 batch의 멱등 삭제가 회수합니다. 최종 batch가 끝난 뒤의 새 command는 이 과거 상태를 상속하지 않고 자신의 retention을 따릅니다. 한 cycle은 최대 100 artifact claim과 claim당 100 delivery purge이므로 물리 object 수와 SQLite append 양이 모두 명시적으로 제한됩니다.

### HTTP server에는 명시적으로 부착한다

기존 `createHubServer`는 storage와 background task를 소유하지 않는 HTTP adapter로 유지합니다. `attachHubArtifactCleanupLifecycle` 또는 `createHubServerWithArtifactCleanup`을 선택한 조합만 server의 `listening`에서 loop를 시작하고 `close`에서 중단 신호를 보냅니다. Lifecycle은 `settled` promise와 명시적 `stop()`을 제공해 조합 root가 store를 닫기 전에 cleanup 종료를 기다릴 수 있습니다. 같은 server에는 한 번만 부착할 수 있습니다.

백그라운드 실패는 callback과 lifecycle 결과에 `artifact_cleanup_runtime_failed`만 전달합니다. 내부 exception, database path, CAS URI나 원문을 넘기지 않습니다. 이 API는 process supervisor, signal handler나 service manager를 대신하지 않습니다.

## 개인정보와 상태 의미

Scheduler row에는 request byte, principal, credential, provider 응답과 내부 오류를 저장하지 않습니다. Worker ID는 비밀이 아닌 배포 instance 좌표여야 합니다. CAS URI와 cursor, lease·cycle 시각, 안전한 개수와 고정 실패 code만 저장합니다.

`claimed`, `waiting/not_due`, `waiting/leased`, `completed`, `partial`, `failed`는 cleanup 운영 상태입니다. Command 실행·전달, `selected`, `loaded`, `injected`, `used`, acknowledgement, event sync나 사람이 결과를 읽었다는 뜻이 아닙니다. 새 runtime event와 command queue 상태는 추가하지 않습니다.

## 실패 의미

- `artifact_cleanup_cycle_failed`: CAS inventory, retention claim 또는 cycle 저장을 정상 완료하지 못했습니다. 오류 원문 없이 같은 cursor를 보존하고 bounded retry를 예약합니다.
- `artifact_cleanup_runtime_failed`: loop가 schedule failure를 durable하게 닫을 수도 없거나 구성·callback 경계가 실패했습니다. Server lifecycle에 고정 code만 반환하고 loop는 끝납니다.
- `artifact_cleanup_conflict`: scheduler 또는 artifact claim lease가 만료·교체됐습니다. 이전 worker가 cursor나 완료를 덮어쓰지 않습니다.
- `partial`: 실패가 아니라 한 URI의 공유 delivery가 batch 상한을 넘었다는 뜻입니다. 다음 cycle이 이어서 처리합니다.

## 검증

임시 owner-only CAS와 실제 Hub SQLite, 실제 Node HTTP server 수명주기로 다음을 확인했습니다.

- 두 worker의 singleton lease 경쟁과 lease 만료 인계
- 실패 뒤 next cycle, 완료 뒤 inventory cursor의 database 재시작 보존
- 직렬 loop, durable 완료 개수와 고정 실패 code만 저장되는지 확인
- server listening 전 미실행, listening 뒤 시작, close 중 wait 취소와 settled 종료
- runtime 시작 실패에서 내부 오류 대신 고정 failure callback만 전달
- cycle 시작과 다른 최신 claim 완료·해제 시각 사용
- 101개 command가 공유하는 URI를 100개 `partial`과 1개 `completed` batch로 정리
- batch 사이 unpurged authorship의 `cleanup_claimed` 조회와 전체 무결성 감사

검증은 임시 저장소에만 수행했으며 실제 사용자 CAS에는 cleanup runtime을 연결하지 않았습니다.

## 결과와 후속 범위

Hub HTTP server 조합이 선택할 수 있는 durable cleanup scheduler와 cursor 복구가 구현되었습니다. 실제 배포 entrypoint는 store·CAS를 열고 이 조합을 선택한 뒤 process signal에 server close, lifecycle settled, store close 순서를 적용해야 합니다. 설치 가능한 Hub/Node daemon, production TLS·credential loading, process supervisor와 운영 backup 삭제는 별도 배포 작업입니다.
