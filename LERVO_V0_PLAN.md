# Lervo v0 구현 계획

상태: `0.1-draft`  
기준일: 2026-08-19

## v0 목표

하나의 실제 저장소에서 `lervo init`과 `lervo run`을 사용해 Codex 또는 Claude 작업을 실행하고, 필수 문서의 선택 이유·현재 hash·컨텍스트 주입 receipt·사용 스킬·파일 변경·검증 결과를 로컬 trace로 재구성합니다. Hub, Slack, 그래프 DB, 임베딩은 이 기반이 증명된 뒤 확장합니다.

## 범위

포함:

- TypeScript/Node.js monorepo와 CLI
- `.lervo/project.yaml`, policy 및 분할 document manifest schema
- SQLite event store, CAS, outbox interface
- deterministic context router와 문서 E0~E3 receipt
- 전문 에이전트가 함께 읽는 shared context publication과 역할 간 handoff bundle
- capability gate 및 unmanaged change 탐지
- Codex/Claude adapter contract와 최소 어댑터
- 스킬 discovery/lock/usage event
- 기존 저장소 문서의 형식별 read-only 탐색, migration dry-run과 승인된 sidecar 도입
- `AGENTS.md`, `CLAUDE.md`, `README.md` managed block 및 staleness 검사
- `lervo trace` 텍스트/JSON 출력
- fixture 저장소 기반 contract/acceptance test
- 사람 대상 산출물의 provider 중립 writing 정책과 공개 전 평가
- 역할별 독립 session과 구조화된 artifact를 사용하는 제한 회차 provider 중립 숙의

제외:

- 완성형 중앙 SaaS와 멀티테넌시 과금
- Slack/Discord 실제 배포 연동
- 외부 graph database
- 기본 실행에 필요한 vector database
- 모든 직군용 완성 스킬 카탈로그
- 에이전트의 의미적 “이해”를 증명한다는 주장

## 구현 단계

### 제품 식별자 전환

구현 현황(2026-08-19): **Lervo 명칭 통일 완료.** 제품명, CLI, `.lervo` 관리 경로, `@lervo` package scope, schema/CAS URI, adapter ID, managed marker와 스킬 manifest 이름을 하나의 식별자로 맞췄습니다. 저장소가 아직 `0.0.0`인 동안 별도 호환 CLI와 이중 package scope는 두지 않습니다. 이전 `.roven`이 있으면 새 초기화를 무부작용으로 차단하며, 원본 event hash chain과 CAS 주소를 보존하는 명시적 명칭 migration은 후속 작업으로 남깁니다. 결정은 [ADR-0020](./docs/adr/0020-lervo-product-identity.md)에 기록했습니다.

### M0: 계약 고정

- event, adapter, context receipt, role, skill, document registry, writing policy/evaluation JSON Schema 작성
- assurance level과 실패 의미를 테스트 가능한 규칙으로 변환
- 개인정보/redaction 및 로컬 보존 기본값 결정

완료 조건:

- schema fixture의 valid/invalid test가 존재
- Codex와 Claude 어댑터가 구현할 공통 contract가 문서와 타입으로 일치
- `selected`, `loaded`, `injected`, `referenced`가 코드에서 별도 상태
- 사람 대상 산출물은 Role의 locale/writing policy와 필수 공개 전 검사에 연결

구현 현황(2026-08-18): **M0 완료, 공유 맥락 계약 보완 완료.** 기존 project, event, context evidence, adapter, role, skill, document registry와 writing 계약에 shared context publication과 handoff bundle을 추가했습니다. 일반 맥락의 프로젝트 전체 공개, 제한 맥락의 역할 allowlist, 생산자 좌표와 만료, 근거 event를 schema로 고정했습니다. 수신 역할이 생산 역할의 receipt를 상속하지 않고 자기 E1→E2→E3를 만들어야 쓰기 게이트가 열리는 동작을 테스트합니다. 기본 계약은 [ADR-0001](./docs/adr/0001-m0-contracts-and-data-defaults.md), 역할 간 공유 결정은 [ADR-0005](./docs/adr/0005-shared-context-and-role-handoff.md)에 기록했습니다.

### M1: 로컬 기반

- `lervo init`, project identity, 설정 로더 구현
- SQLite WAL event store와 CAS 구현
- 순서, hash chain, crash recovery, outbox 멱등성 테스트
- 기존 파일을 보존하는 dry-run/patch 출력 구현

완료 조건:

- 빈 저장소와 기존 문서가 있는 저장소 모두 idempotent init
- Hub가 없어도 모든 로컬 상태 저장 및 조회 가능
- 사용자 작성 문서 영역을 byte-level fixture로 보존

구현 현황(2026-08-18): **M1 완료.** 안전한 `lervo init`, project별 SQLite event/outbox와 CAS에 이어 project storage bootstrap을 구현했습니다. Bootstrap은 검증된 manifest와 canonical 경로만 사용하며, 다른 project database와 심볼릭 링크를 거부합니다. 부분 개방 시 이미 연 자원을 정리하고 정상 handle은 멱등적으로 닫힙니다. 실제 저장소 fixture에서 event와 artifact 재시작 복구, Hub 비활성 시 outbox 미생성, manifest/layout 오류의 무부작용을 검증했습니다. 결정은 [ADR-0004](./docs/adr/0004-project-storage-bootstrap.md)에 기록했습니다.

### M2: 컨텍스트와 가드레일

- 지침 계층 및 path 기반 context router
- project 공개 또는 현재 Role에 허용된 shared context 탐색과 handoff 해석
- 파일 full-read/hash와 E2 receipt
- adapter context envelope와 E3 receipt
- Role이 선택한 writing 정책 문서의 envelope 포함과 E3 receipt
- compaction/restart/file change invalidation
- 필수 E3 기반 파일 쓰기 gate

완료 조건:

- 필수 문서를 읽지 않은 fixture run은 첫 쓰기 전에 실패
- 연구자→마케터 fixture에서 shared context를 찾되 수신 run의 별도 E2/E3 없이는 쓰지 못함
- 제한 맥락, 다른 project, 만료되거나 대체된 맥락을 handoff로 우회할 수 없음
- 문서 변경 후 오래된 receipt 재사용 불가
- trace에 선택 이유, 정책 버전, hash, invalidation 표시

구현 현황(2026-08-18): **M2 완료.** `@lervo/context`가 E0/E1 선택, 안전한 전체 bytes 읽기와 E2 체인 무결성을 소유하고 `@lervo/context-delivery`가 writing policy까지 결속한 provider-neutral E3를 만듭니다. `@lervo/orchestrator`는 E1/E2/E3를 append-only event store에 원자적으로 기록하고, Role의 파일 쓰기 정책·현재 generation·필수 문서 E3를 경로별 1회용 permit에 연결합니다. 쓰기 직전 snapshot 변경, managed file change, compaction/restart와 telemetry transaction 실패가 capability를 닫는 전이를 실제 SQLite fixture로 검증했습니다. 실제 provider 신호 수집과 Codex/Claude 실행은 M3에 남습니다. 결정은 [ADR-0006](./docs/adr/0006-deterministic-context-preparation.md), [ADR-0007](./docs/adr/0007-provider-neutral-context-delivery.md), [ADR-0008](./docs/adr/0008-managed-context-gate-orchestration.md)에 기록했습니다.

### M3: 공급자 어댑터

- Codex adapter 구현
- Claude adapter 구현
- 도구, 명령, 파일, session, 종료 이벤트 정규화
- 기능 차이를 capability matrix로 출력

완료 조건:

- 동일 fixture task를 두 adapter가 공통 contract suite로 통과
- 두 adapter가 같은 role/writing policy ID와 정책 문서 hash를 유지하고 같은 공개 게이트를 적용
- 제공되지 않는 telemetry는 `unknown/unsupported`로 남음
- 관리 경로 밖 변경은 `unmanaged`로 탐지

구현 현황(2026-08-19): **M3와 `lervo run` 한 파일 CLI 수직 슬라이스 완료.** Codex의 file-change approval과 Claude의 Write/Edit hook을 같은 요청·결정·완료 계약으로 바꾸고, orchestrator의 예상 경로별 1회용 permit에 연결했습니다. 승인 직전 before hash, 완료 직후 after hash, 실행 전후 snapshot이 모두 맞아야 `file.changed`가 되며 추가 변경은 계속 `unmanaged`로 실패합니다. Session은 실행 모드에서 실제 열린 기능을 별도로 기록하고, provider 도구 실행 전 turn 수락을 알리며, 종료 실패 때도 승인·결과 원문 상태를 폐기합니다. `lervo run`은 provider·예상 경로·작업 문장을 받아 검증된 project storage와 coordinator를 실행하고 결과 CAS를 로컬 출력으로 연결했습니다. 이 단계 당시 실행하지 않은 두 검사는 `not_run`이었고, writing 공개 상태는 M5의 후속 gate에서 교체했습니다. 결정은 [ADR-0009](./docs/adr/0009-codex-app-server-managed-adapter.md), [ADR-0010](./docs/adr/0010-claude-agent-sdk-managed-adapter.md), [ADR-0011](./docs/adr/0011-managed-provider-run-lifecycle.md), [ADR-0012](./docs/adr/0012-provider-result-artifacts.md), [ADR-0013](./docs/adr/0013-provider-neutral-managed-write-bridge.md), [ADR-0014](./docs/adr/0014-managed-adapter-session-hardening.md), [ADR-0015](./docs/adr/0015-lervo-run-cli-vertical-slice.md)에 기록했습니다.

### M4: 스킬과 문서 수명주기

- 로컬/사용자/외부 스킬 discovery와 충돌 해석
- `skills.lock`, trust/compatibility 판정, invocation event
- 분할 document manifest
- 기존 Markdown/MDX/AsciiDoc/legacy/custom 문서의 read-only discovery와 `DocumentImportAdapter` 계약
- source hash에 묶인 migration candidate/dry-run, 승인된 metadata-only sidecar 적용
- import 계약을 사용하는 managed block parser/compiler와 stale detector
- 자동 수정 patch/candidate 생성

완료 조건:

- 동일 id의 스킬 충돌이 결정적으로 해석되고 근거가 trace에 표시
- 실제 사용한 스킬 버전/hash를 run에서 조회 가능
- migration dry-run이 원본 byte를 바꾸지 않고 형식·소유권·관계 후보와 불확실성을 문서별로 표시
- source hash나 대상 layout이 바뀌면 승인된 migration plan도 전체 stale/conflict로 거부
- 알 수 없는 형식과 낮은 신뢰도 문서를 자동 관리 대상으로 승격하지 않음
- AGENTS/CLAUDE/README의 노후화 fixture를 검출
- managed block 밖 사용자 내용 무변경

구현 현황(2026-08-19): **스킬 discovery와 lock 첫 슬라이스 완료.** `@lervo/skills`가 요청된 프로젝트·사용자 후보의 패키지 전체 hash를 확인하고 pinned project, project, user 순서와 version으로 선택합니다. Provider, Role, runtime, platform, 도구와 허용 capability를 보수적으로 판정하며 선택과 탈락 사유를 독립 schema의 `.lervo/skills.lock`에 원자적으로 기록합니다. `lervo run --skill`은 `skill.resolved`를 실행 시작 event와 같은 transaction에 남기되 URI와 publisher 정보는 event에 넣지 않습니다. Provider에 실제 스킬을 호출하는 경로는 아직 없으므로 `skill.invoked`나 사용을 주장하지 않습니다. 원본 스킬과 유효하지 않은 기존 lock을 byte 단위로 보존하는 fixture를 포함합니다. 결정은 [ADR-0016](./docs/adr/0016-local-skill-resolution-and-lock.md)에 기록했습니다.

구현 현황(2026-08-19): **분할 document manifest와 누적 금지 계약 완료.** 새 init은 중앙 `documents.yaml` 대신 빈 `.lervo/documents/`를 만들고 document ID별 최대 64 KiB sidecar를 결정적으로 조립합니다. 사용자·managed block·Lervo 전용 문서의 쓰기 범위, 크기, separate history와 topic split을 schema로 고정했습니다. 파일명/ID, 표준 marker, 관계, 대상 경로의 단일 소유권과 심볼릭 링크를 loader가 거부합니다. 기존 단일 registry는 자동 migration 없이 byte를 보존하고 읽기 호환만 제공합니다. 결정은 [ADR-0017](./docs/adr/0017-sharded-document-manifests.md)에 기록했습니다.

구현 현황(2026-08-19): **기존 문서 read-only discovery와 migration dry-run 첫 슬라이스 완료.** `@lervo/documents`가 제한된 root에서 symbolic link, root 이탈, 변경 중인 파일과 파일/전체 byte·항목 한도를 거부하고 stable source hash를 만듭니다. Provider-neutral `DocumentImportAdapter`는 파일 시스템 port 없이 격리된 byte만 받고 adapter ID/version을 결과에 남깁니다. Markdown/MDX, schema-valid 기존 `documents.yaml`과 unknown fallback을 구현했습니다. Candidate는 source별 canonical JSON artifact/hash로 분리되고 dry-run plan은 source hash와 sidecar target snapshot에 묶이며 어떤 파일이나 event도 쓰지 않습니다. 원본 tree 불변, 결정적 순서, source 변경에 따른 plan ID 변경, existing/unsafe target, 중복 문서 제안, legacy 원문 미탐색, adapter 입력 변조와 모호한 adapter를 실제 fixture로 검증했습니다.

구현 현황(2026-08-19): **검토된 metadata-only sidecar apply 완료.** 승인은 plan의 모든 candidate를 정확히 한 번 다루고 생성 항목에는 책임자·locale·검토 주기를 포함한 최종 manifest를 요구합니다. Apply는 plan ID와 candidate canonical bytes, source·target·기존 manifest 전체를 다시 검증합니다. Staging과 transaction marker로 부분 layout의 loader 사용을 차단하며 파일과 directory entry를 동기화합니다. 공개 뒤 snapshot이 승인 내용과 같고 privacy-bounded `document.migration.applied` event가 durable하게 기록된 경우에만 receipt를 반환합니다. Event 기록 실패 rollback, source/target 변경, 변조된 plan/artifact/승인과 legacy registry 혼용을 실제 fixture로 검증했습니다.

구현 현황(2026-08-19): **기존 단일 registry structural migration dry-run 완료.** `.lervo/documents.yaml` 원본은 stable hash와 content-addressed archive target에 묶고, 최대 4,096개 `DocumentRecord`는 source registry hash를 포함한 독립 artifact로 분리합니다. Plan은 `archive_then_remove` 처분, 새 manifest directory와 모든 sidecar target, 각 record가 가리키는 문서의 file hash 또는 missing/unsafe 상태까지 결속합니다. Duplicate path, 안전하게 snapshot할 수 없는 참조 문서, 기존 sidecar layout과 archive 충돌은 conflict이며 managed/generated ownership과 missing 참조 문서는 review warning입니다. 원본 tree 무변경, 생성 시각과 무관한 결정성, source byte 변경 전파, 충돌과 unsafe source를 fixture로 검증했습니다.

구현 현황(2026-08-19): **Legacy structural migration 승인과 apply 완료.** 승인은 모든 entry artifact를 정확히 한 번 승인 또는 제외하고 승인 manifest가 원래 `DocumentRecord`를 보존하도록 검증합니다. Apply는 registry·참조 문서·archive·sidecar target을 다시 확인하고 staging에서 전체 출력을 완성합니다. Transaction marker 아래에서 sidecar directory를 공개하고 legacy 원본을 비활성화하며, hash-only 완료 event가 durable하게 기록된 뒤에만 새 layout을 활성화합니다. Event 이전 단계별 실패는 원본 layout으로 rollback하고, rollback 안전성을 확인할 수 없거나 event 뒤 마무리가 실패하면 marker를 남겨 loader를 닫습니다. 성공, 전체 제외, stale/변조 승인, event 실패, 여섯 pre-event checkpoint와 event 이후 fail-closed fixture를 검증했습니다.

구현 현황(2026-08-19): **CommonMark/legacy marker parser 완료.** 최대 4 MiB의 검증된 bytes를 읽기만 하고 code block·inline code와 HTML comment를 구조적으로 구분합니다. 표준·이전 marker family, 중첩·중복·불완전·혼합 상태와 8 KiB 한도를 판정하며 정상 문서에만 managed block과 그 밖의 UTF-8 byte range를 반환합니다. Markdown import adapter는 이 결과로 소유권 confidence와 migration warning을 만들고, MDX는 구조 미검증 상태를 유지합니다. 한글·CRLF byte 경계, code 예시 오탐, 오류 상태와 입력 불변을 실제 fixture로 검증했습니다. 결정은 [ADR-0021](./docs/adr/0021-commonmark-managed-block-parser.md)에 기록했습니다.

구현 현황(2026-08-19): **Byte 보존 managed block patch candidate 완료.** Source hash와 표준 block 하나에 결속해 content range만 교체하고, 결과 전체의 CommonMark 구조·block topology·marker bytes·대상 앞뒤 bytes를 다시 검증합니다. Candidate JSON은 원본/replacement/output hash와 byte 좌표, 실제로 확인한 보존 상수만 가지며 전체 output bytes는 별도 검토 payload로 반환합니다. Candidate는 쓰기 권한이 없고 이전 marker, stale source, 8 KiB 초과, marker 주입, 구조 오류와 no-op을 닫힌 상태로 거부합니다. 결정성과 한글·CRLF 사용자 영역 보존을 실제 fixture로 검증했습니다. 결정은 [ADR-0022](./docs/adr/0022-byte-preserving-managed-block-patch-candidate.md)에 기록했습니다.

구현 현황(2026-08-19): **증거 기반 document stale detector 완료.** Manifest의 검토 기한, 문서·연결 경로와 managed/generated input hash를 독립 `DocumentStalenessResult`로 계산합니다. Revision 문자열 차이만으로 stale을 주장하지 않고 검증 snapshot이 없거나 연결 범위·입력을 관측하지 못하면 `unknown`으로 남깁니다. 판정기는 파일·CAS·event를 쓰지 않으며 결과 ID는 canonical 내용에 결속됩니다. `AGENTS.md`, `CLAUDE.md`, `README.md` 경로 변경과 기한 경계, 변경·삭제·미관측 입력, snapshot 불일치를 fixture로 검증했습니다. 결정은 [ADR-0023](./docs/adr/0023-evidence-based-document-staleness.md)에 기록했습니다.

M4 완료.

### M5: 검증과 지식 후보

- 프로젝트별 verification command와 결과 artifact
- 사람 대상 산출물의 결정적 writing 검사와 생성 후 별도 의미 평가 실행
- 구조화된 proposal/objection/revision/verification/decision artifact와 `DeliberationPolicy`
- 역할별 독립 provider session을 순서화하는 제한 회차 숙의와 `converged`/`no_consensus`/`failed` 판정
- observation/candidate 생성 및 paths/evidence 연결
- 검증 revision 기반 stale 전이
- `lervo doctor`, `lervo trace` 완성

완료 조건:

- 기능 작업과 버그 수정 acceptance scenario 통과
- 실패한 검증을 성공으로 표시할 수 없음
- 실행되지 않거나 실패한 필수 writing 검사가 있는 산출물은 공개할 수 없음
- Codex와 Claude 참여자가 같은 shared context를 각 session에서 별도로 E2/E3 없이 재사용할 수 없음
- 최대 회차 또는 차단 반론이 남은 숙의를 결론이나 verified 지식으로 표시할 수 없음
- `converged`는 결정 책임자, 필수 verification 통과와 차단 반론 0개를 모두 증명
- candidate에서 verified로의 전이가 정책과 evidence 없이는 거부됨

구현 순서: **(1) verification command/result artifact → (2) writing 공개 gate → (3) 숙의 artifact와 policy schema → (4) 단일 provider 두 역할 fixture → (5) Codex·Claude 교차 검토 fixture → (6) 지식 candidate와 trace/doctor 연결** 순입니다. 6단계의 candidate 생성과 로컬 증거 진단 첫 슬라이스까지 완료했습니다. 숙의 구현은 shared context, provider result artifact와 verification 결과가 모두 준비된 뒤 시작하며, provider별 자유 형식 대화를 합의로 해석하지 않습니다. 결정은 [ADR-0019](./docs/adr/0019-provider-neutral-deliberation.md)에 기록했습니다.

구현 현황(2026-08-19): **Project verification command/result artifact 완료.** `lervo init`은 계속 누적되는 중앙 설정 대신 빈 `.lervo/verifications/`를 만들고, loader는 suite ID별 최대 64 KiB YAML을 안전하게 읽습니다. `@lervo/verification`은 shell 없이 최대 32개 명령을 순차 실행하며 timeout·취소·합산 output 한도와 첫 실패 뒤 `not_run`을 구분합니다. Stdout·stderr와 전체 result JSON은 각각 CAS에 저장하고 다시 확인합니다. 결과는 실행 전후 같은 snapshot port가 확인한 repository hash, suite hash, command digest·exit code·시간·artifact 좌표에 묶이며 의미 검증기가 전체 상태와 ID를 다시 계산합니다. 실패 결과의 상태만 `passed`로 바꾼 조작, snapshot 불일치·실행 중 변경, 미실행 명령, symlink cwd, timeout·과다 output과 CAS 불일치를 실제 subprocess fixture로 검증했습니다. 결정은 [ADR-0024](./docs/adr/0024-provider-neutral-project-verification.md)에 기록했습니다.

구현 현황(2026-08-19): **`lervo run` project verification 연결 완료.** CLI는 한 개 이상, 최대 16개의 중복 없는 suite ID를 요구하고 provider 시작 전에 원본을 읽습니다. Provider 종료·실행 후 snapshot·결과 CAS 검증 다음에 같은 revision에서 suite를 실행하며, orchestrator는 주입된 공급자 중립 port의 result schema·suite·revision, canonical result CAS와 참조한 command output CAS를 다시 확인합니다. 시작·완료 event에는 suite/result/hash 좌표와 통과하지 못한 command ID만 남기고 command와 output 원문은 넣지 않습니다. 필수 suite 실패는 `verification_failed`와 `run.failed`로 끝나며 `run.completed`를 만들지 않습니다. 실제 subprocess 성공·실패와 위조·누락 CAS 거부를 함께 검증했습니다. 결정은 [ADR-0032](./docs/adr/0032-managed-run-project-verification.md)에 기록했습니다.

구현 현황(2026-08-19): **Writing 공개 gate 완료.** `@lervo/writing`은 provider 결과 artifact의 CAS bytes와 좌표를 다시 확인하고, 결정적 검사와 생성 경로에서 분리된 의미 평가 port를 순서대로 실행합니다. 평가기는 필수 검사 전체를 정확히 한 번 반환해야 하며 누락, 중복, 예외와 미구성은 통과로 추정하지 않습니다. 평가 canonical JSON은 원문 없이 CAS에 저장하고 다시 확인합니다. 통과한 결과만 policy·evaluation·content·surface hash에 결속된 permit를 만들며, 재사용 시 모든 좌표를 다시 검증합니다. `lervo run`은 이 경계를 통과한 결과만 stdout/JSON에 포함합니다. 의미 평가기가 없는 기본 실행은 파일 변경과 `run.completed`를 유지하지만 원문을 숨기고 종료 코드 1을 반환합니다. 이 단계에서는 writing policy를 생성 전에 주입하지 않으므로 사후 평가만 증명합니다. 결정은 [ADR-0025](./docs/adr/0025-writing-publication-gate.md)에 기록했습니다.

구현 현황(2026-08-19): **숙의 artifact와 policy schema 완료.** `@lervo/schemas`가 역할별 provider 정책, 다섯 구조화 artifact와 세 종료 결과를 고정하고 `@lervo/deliberation`이 policy·artifact·이력·실제 verification 근거·outcome 의미를 분리해 검증합니다. 최신 revision 직접 승인, 현재 claim digest를 대상으로 한 필수 suite, 결정 책임자의 마지막 decision과 미해결 차단 반론 0개가 모두 있어야 `converged`입니다. 역할 간 managed run·Lervo session·context receipt 재사용, 위조 검증 결과, 과거 claim 버전과 writing permit 복사는 실패합니다. `deliberation.started`, `deliberation.artifact.recorded`, `deliberation.completed`의 hash 중심 allowlist도 이 단계에서 고정했습니다. Runtime의 실제 event 발행, E2/E3 원본 대조와 provider session 격리는 이후 [ADR-0028](./docs/adr/0028-same-provider-deliberation-runtime.md)에서 완료했습니다. 결정은 [ADR-0026](./docs/adr/0026-structured-deliberation-contracts.md)에 기록했습니다.

구현 현황(2026-08-19): **숙의 runtime 전 계약 경계 정리 완료.** 숙의 event 세 종류는 allowlist 뒤 필수 필드와 상태별 null 규칙까지 schema로 검증합니다. `verification-contract`와 `writing-contract`가 실행·CAS 없는 canonical 검증을 소유해 deliberation이 전체 실행 패키지를 의존하지 않습니다. 이력 검증은 좌표·격리, 상태, 종류별 exhaustive 전이, 최종 분석으로 분리했고 오류는 상위 처분 code와 안정적인 reason을 함께 제공합니다. 테스트 fixture는 실제 verification/permit 생성과 시나리오를 분리하고 예상 outcome 좌표를 명시합니다. Workspace build는 수동 패키지 목록 대신 dependency-aware topological 실행을 사용합니다. 결정은 [ADR-0027](./docs/adr/0027-deliberation-boundary-hardening.md)에 기록했습니다.

구현 현황(2026-08-19): **단일 provider 두 역할 contract fixture 완료.** `@lervo/deliberation-runtime`은 역할별 managed run의 E2/E3 evidence를 실제 SQLite `document.loaded`·`context.injected`와 대조하고 `run.completed` result 좌표, writing 평가·permit와 현재 숙의 history를 다시 검증합니다. 같은 Codex provider의 제안자와 검토자가 별도 run·Lervo session·provider session·receipt를 사용하며, permit를 통과한 제안 원문을 shared context로 공개한 뒤 검토자 context loader가 같은 hash를 다시 적재·주입합니다. Artifact, publication과 handoff event에는 원문을 넣지 않습니다. Event에 없는 receipt를 주입하거나 다른 역할이 provider session을 재사용하면 artifact 기록 전에 실패합니다. 결정은 [ADR-0028](./docs/adr/0028-same-provider-deliberation-runtime.md)에 기록했습니다.

구현 현황(2026-08-19): **Codex·Claude 교차 검토 contract fixture 완료.** 실제 `CodexAdapter` 제안 결과를 공통 artifact와 shared context로 공개하고 실제 `ClaudeAdapter` 검토자가 별도 session에서 같은 원문 hash를 다시 적재·주입하는 전체 경로를 검증했습니다. 두 adapter의 context 표현, provider session ID 형식, turn과 종료 protocol 차이는 공통 receipt, artifact, event와 `no_consensus` 의미를 바꾸지 않습니다. 역할별 고정 provider와 다른 managed run은 writing 평가 전에 `artifact_publication_failed/provider_not_allowed`로 실패하며 artifact event를 만들지 않습니다. 결정은 [ADR-0029](./docs/adr/0029-cross-provider-deliberation-runtime.md)에 기록했습니다.

구현 현황(2026-08-19): **증거 결속 지식 candidate와 로컬 trace/doctor 첫 슬라이스 완료.** `@lervo/knowledge`는 전체 숙의 outcome과 history, 실제 verification evidence, 완료·artifact event와 decision CAS를 다시 검증하고 채택 claim별 path·revision·review interval을 가진 canonical candidate JSON을 CAS에 저장합니다. `knowledge.candidate.created`는 원문 없이 candidate/outcome/decision/verification/CAS hash 좌표만 기록합니다. `no_consensus`와 `failed`, 누락 event·path·CAS, 서로 다른 verification revision과 중복 candidate는 닫힌 상태로 거부합니다. 결정은 [ADR-0030](./docs/adr/0030-evidence-bound-knowledge-candidates.md)에 기록했습니다.

구현 현황(2026-08-19): **사람 검토 기반 verified 승격과 stale 전이 완료.** 검토와 승격을 별도 CAS/event 원본으로 나누고 정책이 허용한 사람 reviewer, 승인 결정, 같은 repository revision, 충돌 해소와 현재 path hash가 모두 확인될 때만 verified를 만듭니다. Reviewer ID는 로컬 승인 CAS에만 두고 event에는 넣지 않습니다. Verified path hash가 현재 snapshot과 같으면 전체 revision이 달라도 current이며, path 변경·부재 또는 review due 시각만 stale 근거가 됩니다. Current 판정은 event로 누적하지 않고 stale 결과만 CAS/event로 기록합니다. Doctor는 candidate, review, verified와 stale 연결을 각각 역검증합니다. 결정은 [ADR-0031](./docs/adr/0031-reviewed-verified-knowledge-lifecycle.md)에 기록했습니다.

구현 현황(2026-08-19): **문서·스킬·provider 실행 환경 doctor 확장 완료.** 문서 registry와 등록 원본, 프로젝트·사용자 스킬 package와 lock, Codex PATH 실행 파일과 Claude SDK bundled 실행 파일을 독립 항목으로 검사합니다. 결과는 `healthy`, `unhealthy`, `unknown`으로 나뉘며 모든 항목이 `healthy`일 때만 성공합니다. 스킬 lock은 기록된 runtime으로 공통 resolver를 다시 실행해 선택·탈락 전체를 비교하고, provider version probe는 인증·네트워크·실제 session 성공을 주장하지 않습니다. 결정은 [ADR-0033](./docs/adr/0033-bounded-environment-doctor.md)에 기록했습니다.

M5 완료.

다음 구현 순서: **M6 프로젝트 등록과 outbound event sync 계약**입니다.

### M6: 최소 Hub 실증

- 프로젝트 등록과 outbound event sync
- 읽기 전용 trace web view
- 서명된 원격 command protocol의 로컬 fixture
- offline queue/reconnect 검증

완료 조건:

- 두 fixture 프로젝트를 한 화면에서 분리 조회
- 중복/역순 전송에도 일관된 read model
- Node 오프라인 중 로컬 실행 후 재연결 동기화
- trace에서 문서 선택 이유부터 verification까지 탐색

## 첫 번째 수직 슬라이스

처음부터 모든 M단계를 넓게 구현하지 않고 아래 한 흐름을 먼저 완성합니다.

```text
fixture repo
  -> lervo init --dry-run / apply
  -> lervo run --provider codex "작은 기능 변경"
  -> AGENTS.md + path 문서 E3 확인
  -> 한 파일 변경
  -> 지정 테스트 실행
  -> lervo trace last
```

그 다음 같은 fixture를 Claude adapter로 통과시켜 공급자 중립 계약의 실제 틈을 찾습니다.

## 초기 패키지 제안

```text
apps/
  cli/
  hub/                    # M6에서 시작
packages/
  schemas/
  event-contract/
  storage-contract/
  core/
  project/
  project-storage/
  event-store-sqlite/
  context/
  context-delivery/
  orchestrator/
  policy/
  adapter-contract/
  adapter-codex/
  adapter-claude/
  skills/
  documents/
  testing/
fixtures/
  sample-repo/
```

## 핵심 검증 시나리오

1. 필수 문서를 선택했지만 읽지 않으면 수정 차단
2. 문서를 읽은 후 파일이 바뀌면 receipt 무효화
3. context 압축 후 재주입 없이 수정 차단
4. 공급자 직접 실행 변경을 managed run으로 오인하지 않음
5. 스킬 버전 충돌과 비호환 capability를 설명 가능하게 거부
6. 문서 연결 경로 변경 시 stale 후보 생성
7. event store 장애 시 조용히 telemetry를 유실하지 않음
8. Hub 장애 중 로컬 완료 및 재연결 후 멱등 동기화
9. 기능 개발 중 생긴 버그를 부모 run과 evidence로 연결
10. 민감정보 fixture가 event/Hub payload에 남지 않음
11. Claude가 writing 정책을 누락하거나 바꾸면 계약 실패, 의미 검사를 실행하지 않으면 공개 실패
12. 다른 역할의 shared context를 발견할 수 있지만 생산 역할의 receipt만으로 수신 역할의 쓰기 gate가 열리지 않음
13. restricted context가 project 전체 공개나 허용되지 않은 역할 handoff로 유출되지 않음
14. 기존 문서 migration dry-run과 실패한 apply가 원본 byte를 변경하지 않음
15. Migration 계획 뒤 source hash가 바뀌면 일부 sidecar도 적용하지 않고 재탐색을 요구
16. 숙의 참여자마다 같은 근거의 별도 E2/E3가 필요하고 내부 추론이나 전체 대화가 handoff에 복제되지 않음
17. 필수 검증 실패, 미해결 차단 반론 또는 최대 회차 도달을 `converged`로 기록하지 않음

## 선행 결정이 필요한 항목

구현을 시작하며 ADR로 확정할 항목입니다.

- Codex/Claude 각각에서 E3 receipt를 만드는 가장 안정적인 통제 지점
- provider context compaction 탐지 가능 범위와 보수적 fallback
- Git worktree별 Node/state 격리 규칙
- event payload 기본 보존 기간과 원문 artifact 암호화
- 단일 `events.sqlite`를 대체할 크기/시간 segment와 segment 간 hash 연결
- 사용자 전역 스킬과 프로젝트 고정 스킬의 최종 우선순위
- 첫 import adapter가 지원할 Markdown/MDX/AsciiDoc dialect와 custom adapter 등록 경계
- Managed block byte 보존 교체 알고리즘과 patch 승인 경계
- 숙의 runtime event의 원자적 영속 순서와 중단 복구 규칙

## v0 이후 순서

1. Hub trace UI와 정책 배포
2. Slack/Discord command gateway와 승인 UX
3. 연구자·마케터·디자이너 RoleProfile/평가 묶음과 고위험 숙의 정책 확장
4. 명시적 관계 기반 지식 그래프 시각화
5. 실제 검색 실패 데이터를 바탕으로 임베딩/RAG 도입
6. 조직 단위 비용·품질·가드레일 분석

## 다음 실행 작업

다음 구현 작업은 **M6 프로젝트 등록과 outbound event sync 계약**입니다. 로컬 완료를 Hub 가용성과 분리한 채 project identity, 전송 envelope, cursor와 멱등 수락 의미를 먼저 고정합니다.
