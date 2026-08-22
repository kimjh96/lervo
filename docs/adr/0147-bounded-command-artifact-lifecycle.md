# ADR-0147: 경합과 중단을 견디는 command artifact 수명주기

- 상태: 채택
- 기준일: 2026-08-22

후속 결정: [ADR-0148](./0148-durable-command-artifact-cleanup-runtime.md)은 cycle의 durable cursor·singleton scheduler와 Hub server 시작·종료 결속을 구현하고, 공유 delivery purge도 claim당 100개로 제한합니다.

## 맥락

Hub command의 요청 원문은 owner-only CAS에 분리했지만 물리 정리 기능이 없었습니다. Database commit 전에 프로세스가 멈추면 참조 없는 object가 남고, 여러 command가 같은 내용 주소를 공유하므로 한 command의 만료만 보고 지우면 아직 보존 중인 원문도 함께 사라집니다. 작성과 정리가 동시에 일어나는 경합, CAS 삭제와 SQLite 완료 기록 사이의 중단도 안전하게 복구해야 합니다.

## 결정

### 물리 저장소와 수명주기 원장을 분리한다

`OwnerOnlyFileSystemCas`는 내용 주소순 inventory와 멱등 삭제만 제공합니다. Inventory는 기본 100개, 최대 1,000개를 반환하고 기본 100,000개, 최대 1,000,000개 object만 훑습니다. Cursor는 마지막 CAS URI이며 object hash, 일반 파일 여부와 내용을 다시 확인합니다. Symlink, 잘못된 prefix와 scan 상한 초과는 일부 결과로 숨기지 않고 실패합니다.

`@lervo/hub-command`의 cleanup application은 이 물리 port와 별도 수명주기 repository port만 조합합니다. SQLite table 이름, filesystem 경로, scheduler나 provider를 알지 않습니다. 한 cycle은 기본 최대 100개의 만료 참조와 inventory 후보만 처리하며 호출자가 inventory cursor를 보존해 다음 cycle에 넘깁니다.

### 공유 object는 모든 참조가 끝난 뒤에만 정리한다

새 authorship은 command 만료보다 짧지 않고 최대 30일인 `artifactRetainUntil`을 가집니다. 기본값은 원문 artifact 보존 기본값인 30일입니다. 같은 CAS URI를 참조하는 purge되지 않은 모든 authorship의 보존 기한과 command 만료가 cleanup 시각을 지났을 때만 `expired` claim을 만들 수 있습니다. 일부 참조만 만료됐으면 object와 모든 참조를 그대로 둡니다.

Authorship, retention, purge와 cleanup completion은 append-only입니다. Claim만 lease가 있는 가변 운영 상태이며 worker ID, claim ID, 종류, artifact URI, claim·lease 시각을 가집니다. 만료 claim은 다음 write transaction이 회수할 수 있습니다. 작성 transaction은 같은 URI의 활성 claim을 `artifact_cleanup_conflict`로 거부합니다.

Authorship 조회는 `retained`, `cleanup_claimed`, `purged`를 구분합니다. 이미 정리 중이거나 끝난 idempotency key의 중복 요청은 최초 signed envelope만 반환하고 만료 원문을 CAS에 다시 만들지 않습니다. 이 상태는 조회 시 retention·claim·purge 원장에서 계산하며 새 command 상태나 실행 증거가 아닙니다.

CAS put과 SQLite commit은 하나의 원자 transaction이 될 수 없습니다. 작성기는 commit 전 저장·재검증에 더해 commit 뒤 같은 URI를 다시 put하고 검증합니다. 정리가 그 사이 byte를 지워도 새 참조가 보인 completion은 실패하고, 이미 completion이 끝났다면 commit 뒤 put이 object를 복구합니다. 따라서 성공한 authorship이 삭제된 object만 가리키는 상태로 끝나지 않습니다.

### 삭제와 완료는 재시도 가능하게 나눈다

Cleanup 순서는 `SQLite claim → CAS 멱등 삭제 → SQLite 재검증·완료`입니다. 완료 시점에 모든 공유 참조의 보존 조건을 다시 확인하고, 통과한 delivery별 purge와 claim completion을 한 transaction에 기록합니다. CAS 삭제 뒤 중단되면 다음 cycle이 같은 참조를 다시 claim하고 `deleted: false`를 정상 복구로 받아 완료합니다. 완료 재요청은 claim completion을 기준으로 `duplicate`를 반환합니다. 삭제나 완료가 실패하면 가능한 경우 claim을 풀고 cycle 결과의 failure count만 늘립니다.

Inventory에서 SQLite의 purge되지 않은 authorship 참조가 없고 수정 시각이 기본 24시간 grace보다 오래된 object만 `orphan` claim 대상입니다. Claim 뒤 새 authorship이 생기면 완료를 거부합니다. 짧은 grace는 부분 작성 중인 object를 즉시 고아로 오인하지 않기 위한 안전 여유이며, 운영자는 허용 범위 안에서 늘릴 수 있습니다.

## 개인정보와 상태 의미

SQLite에는 raw request를 넣지 않습니다. Retention은 delivery ID, CAS URI와 보존 시각만, claim은 비밀이 아닌 worker ID·무작위 claim ID·종류·URI·관측 및 lease 시각만, purge와 completion은 delivery 또는 claim 좌표와 시각·개수만 저장합니다. Credential, principal 원문, request byte와 내부 예외는 저장하지 않습니다.

`expired`, `orphan`, claim, purge와 completion은 CAS 운영 원장의 상태이며 runtime event가 아닙니다. Command 실행, `loaded`, `injected`, `used`, acknowledgement나 사람이 결과를 읽었다는 뜻이 아닙니다. 이 변경은 새 실행 event를 추가하지 않습니다.

## 실패 의미

- `artifact_cleanup_conflict`: 활성 claim, 만료 lease, 새 참조 또는 달라진 보존 조건 때문에 현재 정리를 완료할 수 없습니다. HTTP 작성에서는 원문을 노출하지 않는 `409 conflict`입니다.
- `capacity_exceeded`: inventory limit 또는 실제 scan이 허용 상한을 넘었습니다. 일부 inventory를 정상 전체 결과처럼 사용하지 않습니다.
- `unsafe_path|invalid_uri|corrupt_object`: CAS 구조, cursor나 object 내용이 안전한 수명주기 전제와 다릅니다. 해당 cycle을 성공으로 만들지 않습니다.
- 물리 삭제 실패: purge 원본을 기록하지 않고 claim을 가능한 범위에서 해제합니다. 오류 원문은 수명주기 원장에 넣지 않습니다.

## 검증

임시 owner-only CAS와 실제 Hub SQLite로 다음을 확인했습니다.

- 안정된 cursor inventory, scan 상한과 멱등 삭제
- 같은 object를 공유하는 두 command 중 더 늦은 보존 기한까지 정리되지 않음
- CAS 삭제 뒤 SQLite를 닫고 다시 열어 기존 claim을 완료함
- 완료 재요청, 이미 없는 object와 정리 뒤 같은 내용 재작성
- 오래된 orphan 정리, 삭제 실패 뒤 claim 해제와 다음 cycle 복구
- orphan claim과 authorship 경합 차단, 해제 뒤 안전한 작성
- retention, purge, completion 관계와 append-only trigger 무결성 검사

검증은 임시 저장소에만 수행했으며 실제 사용자 CAS object를 정리하지 않았습니다.

## 결과와 후속 범위

Command CAS의 30일 기본 만료 정리와 orphan 회수에 필요한 bounded cycle은 구현되었습니다. 실제 주기 실행은 배포 scheduler가 이 cycle을 호출하고 cursor를 보존해야 합니다. 설치된 Node daemon, Hub process supervisor, production TLS·credential 조합과 운영 backup 삭제는 이 결정의 범위가 아닙니다.
