# ADR-0038: 이력 크기와 분리된 비동기 Hub 저장·조회 경계

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

첫 durable Hub 구현은 정확성을 먼저 확인하기 위해 배치마다 한 project의 전체 event state를 읽어 순수 reducer에 넣고, 저장 뒤 같은 전체 state를 다시 비교했습니다. Trace도 project 목록을 만들 때 모든 project state를 읽고 run 상세의 event를 한 번에 반환했습니다.

이 방식은 작은 fixture에서는 명확하지만 event가 쌓일수록 배치 하나와 목록 조회의 CPU·메모리가 전체 이력에 비례합니다. Store의 공개 동기 callback도 SQLite에는 맞지만 PostgreSQL이나 원격 DB처럼 commit이 비동기인 adapter가 같은 계약을 구현하기 어렵습니다. HTTP와 web view를 연결하기 전에 저장과 조회의 크기 경계를 고정해야 합니다.

## 결정

### 공개 command port는 commit 뒤 resolve하는 비동기 계약이다

`@lervo/hub-sync`는 `registerProject`와 `acceptEventBatch`만 가진 `HubSyncCommandStore`를 공개합니다. 두 메서드는 `Promise`를 반환하며 adapter가 durable commit을 끝낸 뒤에만 resolve해야 합니다. Handler는 schema-valid 입력의 복사본을 command port에 전달하고 응답을 기다립니다. Transaction callback, 전체 project state, connection lifecycle은 application port에 노출하지 않습니다.

`sync-contract`의 전체 state reducer는 중복·역순·cursor 의미를 설명하고 독립적으로 검증하는 참조 구현으로 유지합니다. 운영 adapter가 reducer와 같은 결과를 내는 한 저장 방식은 전체 state 재구성 대신 증분 연산을 사용할 수 있습니다.

### SQLite batch 수락은 batch와 인접 원본만 읽는다

등록은 project head의 registration과 cursor만 읽고 갱신합니다. Event batch는 최대 100개라는 계약 안에서 각 event의 seq·ID 중복 좌표와 바로 앞뒤 event만 확인합니다. 새 event insert와 cursor update는 한 `BEGIN IMMEDIATE` transaction에서 수행합니다.

Cursor는 현재 다음 seq 존재 여부와 첫 gap을 index query로 찾습니다. 저장된 인접 event의 hash 연결은 insert 때 확인하므로 cursor를 전진시키기 위해 과거 전체 event를 복제·정렬하지 않습니다. Ack의 inserted·duplicate·buffered count도 batch 결과와 집계 query로 계산합니다. Commit 실패 시 insert와 cursor를 모두 rollback하고 ack를 반환하지 않습니다.

SQLite 구현은 registration, event inbox, trace query와 audit repository를 분리합니다. 하나의 store 객체가 이들을 조합하지만 command, query, integrity와 lifecycle interface는 합치지 않습니다.

### Trace는 세 단계 모두 제한된 cursor page다

`@lervo/hub-trace`는 저장 구현을 모르는 `HubTraceSource`를 정의합니다. 공개 reader의 기본 page 크기는 50, 최대는 100입니다.

- Project 목록 cursor: `destinationId`, `projectId`
- Project의 run 목록 cursor: 첫 project seq, `runId`
- Run event cursor: 마지막 project seq

각 source 메서드는 project summary와 해당 page를 한 read transaction에서 반환합니다. `hub_projects`의 event/run count, `hub_runs`와 `hub_run_sessions`는 event 원본에서 재생성할 수 있는 파생 read index입니다. 새 event와 같은 transaction에서 증분 갱신하므로 project와 run 목록을 만들 때 전체 event JSON이나 전체 event index를 다시 훑지 않습니다. Cursor가 전진하면 새로 continuous가 된 seq 범위만 run count에 반영합니다. Run summary의 session ID 표본은 첫 등장 순서의 최대 16개이며 전체 `sessionCount`와 `sessionIdsTruncated`를 함께 반환합니다. Run event 원본만 허용된 page 크기 안에서 반환하고 `continuous`와 `buffered` 의미는 유지합니다.

잘못된 limit·cursor·좌표는 `invalid_query`입니다. Project와 run 부재는 각각 `project_not_found`, `run_not_found`이며 빈 원본으로 바꾸지 않습니다. HTTP adapter는 구조화 cursor를 외부 token으로 부호화할 수 있지만 순서 의미를 바꾸면 안 됩니다.

### 시작 검사와 전체 audit를 분리한다

Store 개방과 `checkIntegrity`는 foreign key 강제 설정, 필수 append-only trigger와 transaction 안에서 유지한 global project/event count metadata만 확인합니다. 이 경로는 database page, 모든 event JSON과 hash chain을 순회하지 않습니다.

SQLite quick check와 foreign key 원본 검사, 전체 registration, event schema·hash chain, cursor와 파생 run/session/global count index 재검증은 명시적 `auditIntegrity`가 담당합니다. 운영자는 별도 진단이나 예약 작업에서 audit을 실행할 수 있으며, audit 실패를 정상 시작 검사 성공으로 숨기지 않습니다. 파생 index는 원본이 아니며 audit 또는 별도 rebuild 작업으로 다시 만들 수 있습니다. Event segment가 도입되면 full audit도 segment 단위 검증으로 확장합니다.

## 실패 의미와 개인정보

이 결정은 새 event나 telemetry 상태를 추가하지 않습니다. `closed`, `nested_transaction`, `transaction_async`, `read_failed`, `integrity_failed`, `write_failed`의 기존 저장 실패 의미는 유지합니다. `transaction_async`는 SQLite 내부 transaction runner의 방어 오류이며 공개 application callback 계약은 아닙니다. 등록 identity와 event chain 충돌은 `sync-contract`의 `registration_identity_conflict`, `registration_required`, `event_chain_conflict`로 반환합니다.

Project summary에는 event payload와 session ID를 넣지 않습니다. Run summary에는 제한된 session ID와 count만, run event page에는 이미 allowlist를 통과해 Hub에 저장된 event만 포함합니다. Repository 본문, prompt, 문서·스킬 본문, command output, authorization과 credential을 새로 저장하거나 오류에 결합하지 않습니다. 사용자 인증과 project authorization은 HTTP adapter가 query port를 호출하기 전에 완료해야 하며 이 port만으로 인증 성공을 주장하지 않습니다.

## 검증

실제 SQLite에서 registration·batch 응답이 commit 뒤 resolve되는지, 역순 gap 해소, duplicate 복구, cursor update rollback과 Node outbox 응답 유실 복구를 다시 확인했습니다. 50개 event run은 10개 page 두 번으로 읽고 전체 timeline을 한 결과에 반환하지 않았습니다. 두 project와 여러 run은 cursor로 중복 없이 나뉘며 선택 이유와 verification payload는 run 상세에서 유지됩니다.

변조한 event JSON을 가진 DB는 bounded 시작 검사를 통과하더라도 명시적 full audit에서 `integrity_failed`로 거부되는 것을 확인했습니다. 이 차이는 시작 검사가 전체 원본 검증을 했다는 잘못된 주장을 막습니다.

## 결과

Batch 처리 비용은 project 전체 이력이 아니라 최대 batch 크기와 index query에 묶입니다. Trace 결과 크기도 각 page limit으로 제한됩니다. SQLite의 동기 내부 구현을 공개 port에서 제거했으므로 이후 중앙 DB adapter는 비동기 transaction으로 같은 commit-before-response 의미를 구현할 수 있습니다. 다음 HTTP 작업은 이 bounded query만 사용하고 인증·project authorization을 먼저 결속해야 합니다.
