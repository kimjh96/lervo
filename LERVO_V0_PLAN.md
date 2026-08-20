# Lervo v0 구현 계획

상태: `0.1-draft`  
기준일: 2026-08-20

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

M5 이후 구현은 **M6 프로젝트 등록과 outbound event sync 계약**으로 전환했습니다.

### M6: 최소 Hub 실증

- 프로젝트 등록과 outbound event sync
- 읽기 전용 trace web view
- 서명된 원격 command protocol의 로컬 fixture
- offline queue/reconnect 검증

구현 현황(2026-08-19): **프로젝트 등록과 outbound event sync 계약 완료.** `@lervo/sync-contract`는 Hub sync가 명시적으로 활성화된 전체 project manifest에서 identity·manifest hash와 registration ID를 다시 계산합니다. 한 project의 allowlist event를 1~100개 연속 batch로 만들고 event·batch hash를 검증합니다. Hub 참조 reducer는 역순 batch를 gap 뒤에 보관하고 같은 원본 재전송을 duplicate로 처리하지만, cursor는 seq 1부터 hash가 연속된 구간까지만 전진시킵니다. Reducer는 저장이나 network 성공을 주장하지 않으며 실제 ack는 durable Hub transaction과 인증된 transport 이후에만 허용합니다. 결정은 [ADR-0034](./docs/adr/0034-project-registration-and-event-sync-contract.md)에 기록했습니다.

구현 현황(2026-08-19): **outbox delivery worker와 인증된 Hub transport port 연결 완료.** `@lervo/sync`는 registration을 먼저 확인한 뒤 현재 worker가 가진 destination lease만 가져와 연속 chain별 batch로 보냅니다. 인증된 peer 좌표와 durable ack 전체가 맞을 때만 batch 단위 local transaction으로 ack합니다. Hub 저장 뒤 응답이 유실되면 안전한 code와 시각으로 재예약하고 같은 batch ID를 다시 보내 duplicate ack로 복구합니다. Gap batch, 잘못된 peer·ack와 등록 장애는 실제 SQLite fixture로 확인했습니다. `sync.acknowledged` event는 재귀 배송을 피하기 위해 만들지 않습니다. 결정은 [ADR-0035](./docs/adr/0035-outbound-sync-worker.md)에 기록했습니다.

구현 현황(2026-08-19): **Hub registration·event inbox·cursor의 durable 저장 adapter 완료.** `@lervo/hub-sync`는 commit 뒤 resolve하는 비동기 command port를 제공하고 `@lervo/hub-sync-sqlite`는 destination·project별 registration, append-only event inbox와 cursor를 batch·인접 원본 기반 증분 transaction으로 저장합니다. 재시작, 두 project 격리, 역순·중복 batch, cursor update rollback과 실제 Node outbox의 응답 유실 복구를 SQLite로 확인했습니다. 시작 검사는 bounded 구조 검사, 전체 chain은 명시적 audit입니다. Handler는 HTTP나 인증 성공을 주장하지 않습니다. 결정은 [ADR-0036](./docs/adr/0036-durable-hub-sync-store.md)과 [ADR-0038](./docs/adr/0038-bounded-async-hub-storage-and-trace.md)에 기록했습니다.

구현 현황(2026-08-19): **project와 run을 분리하는 bounded Hub trace read model 완료.** `@lervo/hub-trace`는 storage-neutral query port에서 project, run과 event를 기본 50·최대 100개 cursor page로 읽습니다. SQLite source는 각 page와 summary를 한 read transaction에서 만들고 목록 집계에 전체 event state를 적재하지 않습니다. Cursor 이하 continuous event와 gap 뒤 buffered event를 count와 event 단위로 분리합니다. 두 project·여러 run/session pagination, 역순 gap 해소, duplicate·재시작, 선택 reason부터 verification까지 실제 event를 확인했습니다. 결정은 [ADR-0037](./docs/adr/0037-hub-trace-read-model.md)과 [ADR-0038](./docs/adr/0038-bounded-async-hub-storage-and-trace.md)에 기록했습니다.

구현 현황(2026-08-19): **인증·project authorization을 먼저 결속한 read-only trace HTTP API 완료.** `@lervo/hub`는 구성된 bearer token을 principal·project scope에 연결하고 인증 뒤에만 project-scoped reader를 만듭니다. 목록 scope는 SQLite SQL에 전달하고 scope 밖 상세는 source 호출 전에 거부합니다. 세 GET route, 종류별 외부 cursor, 고정 오류, no-store와 응답 byte 한도를 실제 Node HTTP server로 검증했습니다. 결정은 [ADR-0039](./docs/adr/0039-authenticated-project-scoped-trace-http.md)에 기록했습니다.

구현 현황(2026-08-19): **인증된 API만 사용하는 최소 read-only trace web view 완료.** `/trace`는 데이터 없는 shell만 제공하고 입력 token은 현재 탭 메모리의 API header에만 사용합니다. Project, run과 event는 독립된 20개 cursor page로 교체하며 `continuous`와 `buffered`를 `연속 이력`과 `연결 대기`로 구분합니다. 고정 asset route, CSP·no-store, 무권한 source 격리와 cursor 이전·다음·실패 보존을 실제 HTTP와 pager fixture로 확인했습니다. 결정은 [ADR-0040](./docs/adr/0040-bounded-trace-web-view.md)에 기록했습니다.

구현 현황(2026-08-19): **서명된 원격 command protocol의 로컬 fixture 완료.** `@lervo/remote-command-contract`는 raw request 대신 bounded artifact 좌표를 가진 `managed_run`, canonical command ID/hash, project target과 Ed25519 envelope·terminal receipt를 고정합니다. `@lervo/remote-command`는 trust key scope, signature, receiver identity, replay, freshness, local policy, payload hash 순으로 실행 경계를 열고 atomic in-memory reservation 뒤에만 executor를 호출합니다. 위조 서명, 다른 project, 만료, 정책 거부, payload 변조, idempotency/nonce 충돌, terminal retry와 두 동시 요청을 실제 Ed25519 fixture로 확인했습니다. 현재 replay store는 process-local이므로 재시작 내구성이나 Hub delivery를 주장하지 않습니다. 결정은 [ADR-0041](./docs/adr/0041-signed-scoped-remote-command.md)에 기록했습니다.

구현 현황(2026-08-19): **offline command queue와 Node reconnect 전체 검증 완료.** Hub SQLite는 등록된 project identity에 결속된 signed envelope을 event inbox와 별도 queue에 저장하고 `pending`, `leased`, `completed`, `rejected`, `expired` 상태를 durable transaction으로 전이합니다. Node의 `@lervo/remote-command-sqlite`는 project-bound replay 좌표와 terminal receipt만 저장하며 reconnect worker가 인증된 transport port의 Hub·destination·lease 좌표를 다시 확인합니다. Hub 오프라인, 양쪽 database 재시작, acknowledgement commit 전 유실, 만료 command와 위조 signature를 통합 fixture로 검증했습니다. Receipt 재전달에서는 executor가 한 번만 호출됩니다. 실제 HTTP/TLS와 daemon scheduler는 이 fixture의 보장 범위가 아닙니다. 결정은 [ADR-0042](./docs/adr/0042-durable-remote-command-delivery.md)에 기록했습니다.

후속 구현 현황(2026-08-19): **Hub 정책 작성·durable source·인증된 HTTP transport 완료.** Hub가 원본 시각과 project-scoped 승인자 hash를 만들고, 현재 snapshot과 durable command에 결속된 signed 원본을 append-only SQLite에 저장합니다. `policy.read`·`policy.write`와 project scope를 source보다 먼저 확인하며 Node transport는 HTTPS, Hub identity와 bounded 응답 좌표를 확인합니다. 결정은 [ADR-0045](./docs/adr/0045-hub-policy-authoring-and-http-sync.md)에 기록했습니다.

완료 조건:

- Hub command adapter가 commit 전 response를 resolve하지 않고 전체 project event state 없이 batch를 수락
- Project, run과 event 조회가 최대 100개 cursor page를 강제하고 목록 조회에 전체 event payload를 적재하지 않음
- 인증되지 않은 요청과 scope 밖 project 요청이 trace source를 호출하지 않으며 목록 권한이 SQL query에 적용됨
- 외부 cursor, 오류 본문, cache와 응답 byte 한도가 HTTP contract test로 고정됨
- Web shell에 Hub data·credential 구성이 없고 project·run·event page가 이전 DOM에 누적되지 않음
- Bounded 시작 검사와 명시적 전체 audit의 보장 범위를 혼용하지 않음
- 서명, signer project scope, receiver identity, freshness와 local policy를 통과하기 전에 원격 executor를 호출하지 않음
- 같은 command의 동시·완료 후 재전송이 한 번만 실행되고 idempotency key 충돌과 nonce 재사용이 서로 구분됨
- Raw request와 loader/executor 오류 원문이 command, replay 좌표와 receipt에 남지 않음
- 두 fixture 프로젝트를 한 화면에서 분리 조회
- 중복/역순 전송에도 일관된 read model
- Node 오프라인 중 로컬 실행 후 재연결 동기화
- trace에서 문서 선택 이유부터 verification까지 탐색
- Policy write가 client timestamp와 approver hash를 받지 않고 Hub clock·인증 principal에서 원본을 만듦
- Hub policy 원본이 command 관계와 snapshot 연속성을 유지한 채 재시작 후 같은 signed bundle로 복구됨
- Policy HTTP가 permission·project scope를 source보다 먼저 적용하고 request/response 상한과 고정 오류를 유지함
- Node policy HTTP transport가 HTTPS를 기본으로 하고 Hub identity나 응답 좌표가 다르면 현재 정책을 유지함

M6 완료.

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
  sync-contract/
  sync/
  hub-sync/
  hub-sync-sqlite/
  hub-trace/
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

1. Hub 정책 배포와 `require_approval` 승인 수명주기, 고급 trace 운영 UX — 서명 snapshot·command-bound 승인/철회, Node 재평가와 managed write permit 연결 완료
2. 플랫폼 중립 conversation 계약과 능동 참여 runtime — native chat adapter·durable inbox/outbox 첫 슬라이스 완료
3. Managed conversation responder bridge — 완료
4. Slack/Discord 인증 adapter — 완료
5. Conversation 배포 조합과 durable identity/delivery replay — 완료
6. Hub command/approval 대화 UX — 완료
7. 연구자·마케터·디자이너 RoleProfile/평가 묶음과 고위험 숙의 정책 확장 — 완료
8. 명시적 관계 기반 지식 그래프 시각화 — 완료
9. 실제 검색 실패 관측과 전문 검색 baseline, 측정 결과에 따른 임베딩/RAG 도입 판단 — 관측·`lexical-v1`·managed context 추천·검토된 반복 평가 첫 슬라이스 완료, 도입 판단 보류
10. 조직 단위 비용·품질·가드레일 분석

Conversation 첫 슬라이스 완료 조건:

- 플랫폼명 없이 inbound, participation decision, verified outbound와 delivery receipt를 직렬화할 수 있음
- 직접 mention이 없어도 확정된 relevance 또는 구독 signal에는 응답하고, 미확정 relevance·cooldown·rate·automation depth 초과에는 관찰만 함
- Reply artifact와 canonical `chat` writing permit가 다르면 outbox를 만들지 않음
- Source message와 role 조합마다 decision을 독립적으로 만들고 최초 policy를 고정하며, inbox decision과 outbox 생성이 원자적이고 재시작·정책 변경·lease 만료·전송 실패 뒤에도 responder와 delivery가 멱등적으로 복구됨
- 자체 채팅 adapter가 공통 contract를 통과하고 interaction DB에 대화 본문, 외부 사용자·message·delivery ID 원문이 남지 않음
- Conversation 관찰·응답을 shared context의 `loaded`, `injected`, `used`로 승격하지 않음

Conversation 배포 조합 완료 조건:

- 현재 배포 설정에 있는 external conversation·participant binding만 활성 mapping으로 사용하고 제거된 설정을 재시작 뒤 수신 범위로 되살리지 않음
- Inbound canonical event와 outbound source event의 외부 주소를 receipt 전에 기록하고 재시작 뒤 thread·reply·automation depth를 복원함
- OAuth·bot credential은 저장하지 않으며 raw 외부 ID는 mode `0600`의 전용 mapping DB 밖으로 복제하지 않음
- 전송 전 request hash를 예약하고 성공, 명시적 거부, 응답 유실을 각각 `delivered`, `rejected`, `unknown`으로 구분함
- 확인하지 못한 전송은 자동 재발송하지 않고 receipt와 interaction `delivered`를 만들지 않음
- Discord Gateway driver가 주입되지 않은 상태를 실제 Gateway 배포 완료로 표시하지 않음

Hub command/approval 대화 UX 완료 조건:

- 자연어와 reaction을 승인 명령으로 해석하지 않고 명시적 `/lervo command`, `/lervo approval`만 처리함
- 대화 participant와 Hub principal·project·destination binding이 없으면 command source를 읽지 않음
- 짧게 만료되는 review grant가 같은 principal과 command 좌표에 결속되며 다른 bearer·command와 만료 뒤 재사용되지 않음
- 대화 응답은 승인 미생성을 명시하고 `chat` writing 검증을 통과하며 플랫폼 transport를 직접 호출하지 않음
- `/control`은 token을 탭 메모리에만 두고 별도 bearer 인증과 `approval.write` 뒤에만 기존 signed approval을 만듦
- Review 응답과 오류에 request artifact, command hash·signature, approver subject hash, principal, token과 grant가 노출되지 않음
- 실제 SQLite·HTTP fixture가 승인 없음, 일부 승인, 전체 승인과 철회 뒤 상태를 원본에서 다시 계산함

전문 역할 계약 완료 조건:

- Researcher·marketer·designer가 서로 다른 입력, capability, 필수 E3 문서, 산출물 schema, verification suite와 handoff 계약을 가짐
- 역할별 평가 묶음이 profile/output schema hash에 결속되고 deterministic·별도 의미·project verification을 구분함
- 평가 결과가 생산 run과 artifact CAS 좌표에 결속되며 누락, 실패와 통과를 혼용하지 않고 같은 생산 run의 의미 평가를 거부함
- 모든 역할 평가를 통과한 같은 CAS bytes만 반환하고 사람 대상 공개에는 기존 writing permit가 별도로 필요함
- 고위험 workflow가 서로 다른 제안·결정, 검토, 검증 역할과 모든 verification suite를 기존 provider-neutral 숙의 정책에 결속함
- 평가 결과와 workflow를 실행 event, shared context, E2/E3 또는 수렴 증거로 과장하지 않음

명시적 지식 그래프 완료 조건:

- Provider·Hub·저장 구현을 모르는 projector가 allowlist event의 명시적 ID와 project 상대 경로만 controlled relation으로 만듦
- 문서 `selected`, `loaded`, `injected`를 구분하고 event가 증명하지 않은 `used`, 의미적 관련성과 인과관계를 만들지 않음
- Relation ID가 project·종류·두 끝점에 안정적으로 결속되고, 관계 종류별 허용 방향을 검증하며, 각 관계가 원본 event ID·type·run·seq를 증거로 가짐
- SQLite 관계 인덱스가 event와 같은 transaction에서 갱신되며 삭제·version 변경 뒤 원본 event만으로 재구축되고 전체 audit에서 변조·누락을 찾음
- 인증과 project scope를 source보다 먼저 적용하고 focus 인접 관계만 기본 50·최대 100개의 안정된 cursor page로 반환함
- `/trace`가 현재 20개 relation page만 SVG와 접근 가능한 목록에 표시하고 focus·page 전환 때 기존 DOM을 교체함
- 관계 저장·응답·화면에 문서·artifact 본문, content hash, prompt, provider 응답, 내부 추론과 credential을 넣지 않음
- 그래프 조회와 화면 동작을 새 event, context 이해·사용, 실행 또는 지식 검증으로 기록하지 않음

검색 baseline과 실패 관측 첫 슬라이스 완료 조건:

- 등록된 Markdown 원본의 content hash·실제 검색 field 투영 digest와 engine version에서 매번 재생성 가능한 provider·저장소 중립 `lexical-v1` index를 만듦
- Unicode 정규화·field별 고정 가중치·source ID tie-break로 corpus 입력 순서와 시각에 무관한 순위를 반환함
- 문서 하나라도 missing·unsafe·동시 변경·invalid UTF-8·empty·크기 초과이면 일부 corpus로 검색하지 않음
- Query 500자·32 term, source 4,096개·각 128 KiB·전체 16 MiB, 결과 50개의 상한을 강제함
- Attempt에는 query digest·크기, index·result-set hash와 path 없는 bounded source 좌표만 두고 raw query·term·문서 본문을 저장하지 않음
- 결과가 0개이거나 클릭됐다는 사실로 품질을 추정하지 않고 사람 또는 독립 verification의 별도 assessment만 성공·controlled 실패로 집계함
- Attempt와 assessment를 각각 독립된 immutable 파일로 저장하고 project·ID·hash·시간·결과 관계를 report 전에 모두 다시 검증함
- Search hit를 context `selected`, `loaded`, `injected`, `used`, 검증된 지식 또는 임베딩 필요성으로 승격하지 않음
- Report는 미평가를 분리하고 실패 사유를 집계하지만 `embeddingDecision=not_determined`를 유지함
- 로컬 query·assessment·report가 Hub와 새 실행 event 없이 완료됨

검색 추천과 managed context 연결 첫 슬라이스 완료 조건:

- Search attempt와 document hit 최대 5개, `top_ranked-v1`의 최대 3개 선택을 content-bound recommendation·batch ID로 결속함
- Context input이 최대 8개 batch·전체 50개 추천을 받고 project·시각·registry·중복·원본 attempt 관계를 모두 검증함
- 모든 입력 hit는 `recommended` evidence를 갖지만 policy가 선택한 recommendation ID만 `search_recommendation` E1이 됨
- 선택되지 않은 추천은 plan 필수 문서, E2·E3와 쓰기 gate에 포함하지 않음
- 선택된 추천의 검색 당시 content hash와 현재 bytes가 다르면 다른 선택 이유와 섞어 부분 적재하지 않음
- `context.recommended`, `context.selected`, `document.loaded`, `context.injected`를 각각 별도 evidence·event로 보존하고 `used`를 추정하지 않음
- 추천 event에는 query·digest·path·title·label·본문·prompt·provider 응답을 넣지 않고 필수 ID·hash·rank·score·policy 좌표만 허용함
- 로컬 managed run이 provider 시작 전 attempt를 저장하고 결과의 attempt·선택 document ID로 별도 명시적 assessment를 받을 수 있음
- 긴 작업 문장은 최대 32개 단어·500자로 결정적으로 투영하고 검색 가능 단어가 없을 때만 예상 경로를 사용해 보조 검색 한도 때문에 run을 깨뜨리지 않음
- 자동 선택, run·verification 성공이나 결과 수로 검색 품질 assessment와 임베딩 필요성을 만들지 않음

검토된 검색 평가 케이스와 반복 측정 첫 슬라이스 완료 조건:

- 사람 또는 독립 verification의 기존 assessment와 query digest·크기가 모두 맞아야 재사용 케이스를 만듦
- Assessment에서 기대하거나 수락하지 않은 source를 자동 정답으로 만들지 않고, 실패 평가에 기대 원본이 없으면 승격을 거부함
- Query 원문은 최대 256개 케이스별 mode `0600` YAML에만 두고 result·run·event·Hub payload에 복제하지 않음
- 케이스의 원본 attempt·assessment, 기준 index·result-set·기대 source 순위와 `any`/`all`·최대 허용 순위를 content-bound ID로 결속함
- 현재 등록 Markdown을 완전하게 읽어 하나의 `lexical-v1` index에서 모든 케이스를 반복하고, 기대 source별 현재 순위를 보존함
- 통과·`no_results`·`expected_source_missing`·`low_rank`와 기준 대비 개선·유지·회귀를 결정적으로 계산함
- Result와 run을 항목별 immutable JSON으로 나누고 result가 모두 검증된 뒤 run을 마지막에 게시함
- 케이스 하나라도 unsafe·변조·다른 project이면 일부 평가나 run을 만들지 않음
- 반복 평가 실패와 회귀가 있어도 context 상태, verification 통과나 임베딩 필요성을 만들지 않고 `embeddingDecision=not_determined`를 유지함
- 전체 흐름이 Hub와 새 실행 event 없이 로컬에서 완료됨

검색 평가 묶음과 표본 충분성 첫 슬라이스 완료 조건:

- 역할·작업 유형별 활성 case, 최소 표본과 대체 관계를 query 없는 작은 묶음 원본으로 분리함
- 최대 32개 묶음, 묶음당 활성 64개·대체 192개를 강제하고 같은 역할·작업 유형의 중복 묶음을 거부함
- 대체된 case와 활성 case의 중복, 끝나지 않는 대체 관계와 순환을 거부함
- 같은 query의 활성 case를 여러 표본으로 계산하지 않고 모든 참조 case의 project·무결성을 확인함
- 묶음마다 별도 `.bundle.yaml`을 만들며 기존 묶음과 사용자 케이스를 자동 덮어쓰거나 한 파일에 이력을 누적하지 않음
- 표본 상태 `sufficient`·`insufficient`와 비교 준비 상태 `ready`·`insufficient_sample`을 원본에서 결정적으로 다시 계산함
- 표본이 부족한 묶음은 report와 현재 baseline 실행에서 종료 코드 1로 드러내되 관측 result·run을 품질 비교로 위장하지 않음
- `--bundle` 평가는 선언된 활성 case만 실행하고 묶음·coverage·result·run에 query를 복제하지 않음
- 충분성 상태가 검색 품질, context 상태, verification 통과나 임베딩 필요성을 만들지 않고 `embeddingDecision=not_determined`를 유지함
- 전체 흐름이 Hub와 새 실행 event 없이 로컬에서 완료됨

공급자 중립 검색 후보 비교 첫 슬라이스 완료 조건:

- 평가 결과·run의 engine 좌표를 일반화하되 이 비교 단계만으로 운영 attempt·managed context 추천을 바꾸지 않음
- 후보 engine·index·search port와 공통 평가 실행기를 파일 시스템·Hub·구체 adapter에서 분리함
- `ready`가 아닌 묶음은 corpus 로드와 후보 index 생성을 시작하기 전에 닫고 비교 artifact를 만들지 않음
- 준비된 묶음은 baseline과 후보에 같은 corpus source, 활성 case, 평가 시각과 50위 조건을 공급함
- 실제 corpus digest와 현재 `lexical-v1` index를 비교 검증 시 다시 계산해 baseline 실행을 원본 입력에 결속함
- 엔진별 score 숫자를 비교하지 않고 동일 순위 조건의 통과·실패 전이만 case별 승·패·동률로 계산함
- 후보 계약 실패 때 baseline result·run도 완료된 비교처럼 게시하지 않음
- 두 엔진 result·run을 먼저 게시하고 query 없는 comparison을 항목별 immutable JSON으로 마지막에 게시함
- 관측 집계와 후보 채택 결정을 분리하고 `candidateDecision`, `embeddingDecision`을 `not_determined`로 유지함
- 실제 후보 adapter와 CLI를 허위로 만들지 않으며 전체 비교 조합이 Hub와 새 실행 event 없이 로컬에서 완료됨

첫 결정적 검색 후보 adapter와 명시적 등록 첫 슬라이스 완료 조건:

- Baseline과 후보가 source 안전성·상한·canonical 정렬·corpus digest를 같은 공용 계약에서 사용함
- 기존 `lexical-v1` index ID의 source identity 계산을 유지해 공용 corpus 추출만으로 과거 engine 의미를 바꾸지 않음
- 공통 adapter 검사가 engine·index 좌표, 입력 비변경, corpus 역순과 반복 query의 동일 응답을 확인함
- `bm25f-v1`를 별도 package에 두고 field 가중치·길이 정규화·빈도 포화·정수 희귀도 점수를 결정적으로 계산함
- 부동소수 로그, 실행 시각, 입력 순서와 외부 서비스 없이 같은 index·순위·result-set hash를 반환함
- 후보 ID와 engine 좌표가 중복되지 않는 최대 16개의 명시적 allowlist registry만 허용함
- 미등록 후보와 현재 `lexical-v1` 후보 등록을 거부하고 path·module·URL·동적 코드를 해석하지 않음
- CLI가 등록 후보 목록과 준비된 묶음의 `bm25f-v1` 비교를 제공하고 query·문서 path를 출력에 추가하지 않음
- 비교 관측으로 후보를 자동 채택하거나 운영 search·managed context engine을 바꾸지 않음
- 후보·임베딩 판단을 미결정으로 유지하고 전체 흐름이 Hub와 새 실행 event 없이 로컬에서 완료됨

재현 검증을 거치는 검색 후보 검토 첫 슬라이스 완료 조건:

- 비교 ID와 현재 bundle·coverage·case·corpus, 두 run과 모든 result를 검토 전에 다시 확인함
- 비교의 engine 좌표로 정적 allowlist 후보만 해석하고 path·module·URL·동적 코드를 실행하지 않음
- 후보를 비교 당시 corpus·활성 case·평가 시각으로 한 번 재실행하고 기존 candidate run ID와 정확히 같은지 확인함
- 채택·기각·표본 추가 필요를 서로 다른 명시적 결정으로 보존하고 관측 결과에서 자동 결정을 만들지 않음
- 후보 승리가 하나 이상이고 baseline 승리가 없는 비교만 채택 검토 대상으로 허용함
- 검토 원본은 reviewer·결정·재현 좌표와 승·패·동률 합계를 content-bound ID에 묶어 항목별 immutable JSON으로 저장함
- Reviewer ID는 로컬 검토 원본에만 두고 query·문서 path·본문·prompt·provider 응답·credential을 복제하지 않음
- 검토 원본 게시 전 실패하면 부분 검토를 남기지 않고 기존 비교·run·result를 수정하지 않음
- 모든 검토가 `activationState=not_applied`, `embeddingDecision=not_determined`를 유지하며 운영 engine을 바꾸지 않음
- 전체 흐름이 Hub와 새 실행 event 없이 로컬에서 완료됨

정책에 결속된 검색 엔진 선택·rollback 첫 슬라이스 완료 조건:

- Project, 허용 reviewer·operator·candidate, 최소 후보 승리와 baseline 무회귀를 content-bound 정책에 고정함
- 정책을 한 파일에 누적하지 않고 `.lervo/search-engine-policies`의 정책별 YAML로 보존함
- 정책 작성 CLI가 정적 allowlist 후보만 허용하고 path·module·URL·동적 코드를 해석하지 않음
- 활성화 직전에 현재 bundle·coverage·case·corpus, comparison·run·result와 candidate replay를 다시 확인함
- 채택 review와 정책상 허용 reviewer·operator·candidate·표본 기준이 모두 맞아야 선택 전이를 만듦
- 선택 전이가 이전 activation, 이전·새 engine, review·comparison, policy·operator와 rollback 대상을 content-bound ID로 고정함
- 이전 activation을 파일 열쇠로 써 같은 head에서 서로 다른 두 전이가 갈라지지 않게 함
- Rollback을 기존 전이 수정이 아닌 이전 선택으로 돌아가는 새 immutable 전이로 기록함
- 이전 후보로 rollback할 때 해당 review·comparison·현재 corpus와 후보 replay를 다시 확인함
- 정책과 전이에 query·문서 path·본문·prompt·provider 응답·credential을 넣지 않음
- 모든 전이가 `recordState=selection_recorded`, `embeddingDecision=not_determined`만 주장하고 활성화 명령 자체를 실제 검색 실행으로 표시하지 않음
- 전체 흐름이 Hub와 새 실행 event 없이 로컬에서 완료됨

검증된 운영 검색 엔진 resolver와 fail-closed 소비 첫 슬라이스 완료 조건:

- 평가용 engine·index port를 공급자 중립 공통 계약으로 일반화하고 기존 평가 조합과 adapter 계약을 유지함
- 선택 전이가 없으면 현재 corpus의 `lexical-v1`, 전이가 있으면 전체 정책·선택 chain을 재현하는 하나의 resolver를 사용함
- 현재 후보 선택은 현재 corpus·comparison·review replay·registry·candidate index를 다시 확인한 경우에만 반환함
- 일반 `lervo search`, managed context와 `engine status`가 같은 resolver를 사용하고 evaluation baseline은 `lexical-v1`에 고정함
- 후보 선택을 사용할 수 없을 때 baseline으로 낮추지 않고 `engine_selection_unavailable`로 attempt·추천·provider 시작 전에 중단함
- 전이가 없는 baseline의 corpus 오류는 기존 `corpus_read_failed`를 유지하고 rollback baseline은 과거 후보 replay 없이 복구함
- Attempt·recommendation·`context.recommended`가 실제 engine과 nullable 선택 전이 ID를 이어받고 후보 attempt는 전이 ID 없이 만들 수 없음
- `engine status`는 같은 resolver가 현재 index까지 확인한 경우에만 `resolverState=ready`를 표시하고 실제 query 실행으로 해석하지 않음
- 선택 ID와 engine 좌표 외에 query·문서 path·본문·prompt·provider 응답·credential을 event나 오류에 추가하지 않음
- 평가 case와 result를 배열 위치가 아닌 `caseId`로 결합해 ID 순서 변화에도 원본 관계를 검증함
- 후보 적용, 미등록 후보 fail-closed, 선택 뒤 corpus 변경 실패와 rollback baseline 복구를 실제 로컬 수직 테스트로 확인함
- 기존 `applicationState` v1과 직전 `recordState` v1 선택 원본을 수정하지 않고 읽고 신규 전이만 명시적 v2로 기록함
- 과거 추천 event를 선택 전이 ID 없이 hash 그대로 재동기화하고 신규 recommendation evidence만 전이 ID를 필수로 가짐
- 후보 replay에 사용한 index를 다시 만들지 않고 동일 인스턴스로 운영 응답을 생성함
- 운영 조합이 구체 registry class 대신 candidate ID 해석 port에 의존함
- 상태 inspection이 기록된 선택과 현재 `ready`/`unavailable` 및 controlled failure code를 함께 반환함
- 비교·검토 테스트와 운영 선택 수직 테스트를 별도 파일로 분리함

선택된 검색 후보의 검증 원본 갱신 첫 슬라이스 완료 조건:

- 현재 선택과 같은 candidate ID·engine에 새 comparison·review가 있을 때만 `refresh_candidate`를 허용함
- 현재 후보의 새 증거를 일반 활성화로 기록하지 않고 refresh와 후보 변경 action을 구분함
- 새 review·comparison과 현재 bundle·case·corpus·registry replay 및 정책을 전이 기록 직전에 다시 확인함
- 같은 review·comparison 반복, 다른 후보로의 refresh, baseline 상태의 refresh를 거부함
- 기존 선택을 수정하지 않고 이전 head에 결속된 별도 v2 immutable 전이로 새 증거를 기록함
- Refresh의 fallback을 baseline으로 명시해 오래된 후보 증거로 자동 복귀하지 않음
- Rollback runner와 순수 전이 생성기가 같은 fallback 해석 계약을 사용함
- Refresh가 없거나 실패하면 fail-closed 상태를 유지하며 baseline 대체나 자동 rollback을 만들지 않음
- 문서 변경 실패, 재평가·검토·refresh, 후보 운영 재개, baseline rollback을 하나의 로컬 수직 테스트로 확인함
- Query·문서 path·본문·prompt·provider 응답·credential을 새 전이나 오류에 추가하지 않고 Hub와 새 event 없이 완료함

검색 adapter build identity와 재생성 가능한 검증 receipt 첫 슬라이스 완료 조건:

- 공통 engine port와 정적 registry가 candidate·engine 좌표와 별도의 content-bound adapter build ID를 요구함
- Candidate ID, engine 좌표와 build ID 중복을 모두 거부하고 path·module·URL·동적 코드를 허용하지 않음
- 신규 comparison·review만 schema v2 build ID를 content ID에 결속하고 v1 원본은 수정 없이 읽음
- V1 비교·검토에서 새 review·activation·refresh를 만들지 않고 현재 build의 새 평가 원본을 요구함
- Review·activation·refresh·운영 resolver가 저장 build와 현재 registry를 후보 호출 전에 확인함
- 같은 candidate·engine과 같은 결과를 내더라도 build ID가 다르면 명시적으로 실패하고 baseline으로 낮추지 않음
- 성공한 v2 replay가 project·candidate·build·comparison·review·corpus·run·index에서 같은 receipt ID를 재생성함
- Receipt를 별도 파일·event·Hub 원본으로 쌓지 않고 status와 운영 검색 결과에 nullable ID만 반환함
- Receipt를 검색 실행, 결과 사용, 품질이나 모델 이해 증거로 해석하지 않음
- Build·receipt와 오류에 query·문서 path·본문·prompt·provider 응답·credential을 추가하지 않음

선택에 결속된 운영 검색 품질 관측 첫 슬라이스 완료 조건:

- 기존 전체 attempt·assessment 집계를 유지하면서 nullable 선택 전이 ID별 파생 slice를 제공함
- 전이 없는 lexical, candidate activation·refresh와 baseline rollback을 서로 다른 상태로 구분함
- Candidate build ID를 attempt·assessment에 복제하지 않고 검증된 activation→review 원본에서 다시 찾음
- V2 build-bound 후보, v1 legacy-unbound 후보와 build가 해당되지 않는 baseline을 구분함
- 각 slice가 전체·평가·미평가·수락·실패와 controlled 실패 사유를 독립적으로 집계함
- 미평가 attempt, 빈 결과, 추천·context 선택·provider 실행·verification 성공을 assessment로 추정하지 않음
- `no_failures_observed`를 표본 충분성이나 rollout 성공으로 해석하지 않음
- Rollout·rollback·embedding 판단을 모두 `not_determined`로 유지하고 자동 선택 변경을 만들지 않음
- 누락된 선택 전이, engine 불일치나 검증할 수 없는 정책·review·comparison chain에서 일부 report를 반환하지 않음
- Query·digest·문서 좌표·receipt를 출력 slice에 추가하거나 새 파일·event·Hub 원본을 만들지 않음

사람의 검색 rollout 검토 첫 슬라이스 완료 조건:

- 현재 선택된 build-bound 후보 전이와 하나 이상의 실제 attempt만 검토 대상으로 허용함
- 선택 전이·candidate·engine·adapter build·후보 review와 reviewer·검토 시각을 내용 기반 원본에 결속함
- 검토 시점의 대상 attempt·assessment ID 목록 hash와 전체·평가·미평가·수락·실패 집계를 별도 snapshot ID로 고정함
- `keep_candidate`, `rollback_recommended`, `more_assessments_required`를 사람의 명시적 판단으로만 기록함
- 명시적 정책 없이 최소 표본·허용 실패 기준이나 판단 eligibility를 계산하지 않음
- 검토에 `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`를 고정함
- 검토 뒤 attempt·assessment가 추가돼도 기존 snapshot과 검토 파일을 수정하지 않음
- 최대 256개 검토를 항목별 immutable mode `0600` 파일로 보존하고 한 파일에 이력을 누적하지 않음
- Rollback 뒤 기존 검토를 보존하되 과거 전이에 새 검토를 만들지 않음
- Query·digest·문서 좌표·본문·provider 결과·credential을 저장하거나 새 event·Hub 원본을 만들지 않음

검색 rollout 검토 상태 조회 첫 슬라이스 완료 조건:

- 현재 선택을 전이 없는 baseline·기록된 baseline·build-bound 또는 legacy 후보로 구분함
- Rollout 검토를 검토 시각·ID 역순의 기본 20·최대 50개 페이지로 제한함
- 다음 page cursor를 현재 page 마지막 review ID에 결속하고 알 수 없는 cursor를 거부함
- 각 검토의 선택 전이·candidate·engine·build·후보 review와 검토 당시 품질 입력을 다시 검증함
- 조회 시각의 대상 attempt·assessment로 현재 품질 snapshot을 파생함
- Snapshot ID가 아니라 attempt·assessment 입력 digest로 `unchanged`와 `changed`를 구분함
- 현재 선택과 같은 검토는 `current_selection`, rollback·refresh 전이는 `historical_selection`으로 구분함
- 최신 검토나 특정 판단을 자동 선택·승인·적용하지 않음
- 조회가 선택 전이·rollback·approval·정책 eligibility와 새 원본을 만들지 않음
- Query·문서 좌표·본문·provider 결과·credential을 출력하거나 event·Hub sync를 만들지 않음

검색 rollout 검토 정책 첫 슬라이스 완료 조건:

- 허용 reviewer·candidate와 유지·롤백 판단별 평가·실패 수 기준을 별도 내용 기반 정책에 고정함
- 유지 최대 실패와 롤백 최소 실패 기준을 겹치지 않게 검증함
- 정책을 검토보다 먼저 만들고 신규 v2 검토에 exact policy ID와 `bound` 상태를 결속함
- 정책 미충족 검토를 기록하지 않고 다른 판단으로 자동 변경하지 않음
- 기존 v1은 `legacy_unbound`, 다른 정책의 v2는 `different_policy`로 판정함
- 저장 당시 snapshot 정책 확인과 현재 품질 입력 변경 상태 조회를 분리함
- 정책을 최대 32개 항목별 immutable mode `0600` YAML로 저장하고 기존 엔진 정책 저장 계약을 보존함
- 정책 판정이 결정 선택·승인·선택 유지·rollback을 실행하지 않음
- Query·문서 좌표·본문·provider 결과·credential을 저장하거나 event·Hub sync를 만들지 않음

검색 rollout 조치 첫 슬라이스 완료 조건:

- 검토 정책과 별도인 action policy가 한 조치와 허용 operator만 고정함
- Rollback operator를 exact engine policy 범위와 교차 확인하고 keep에는 엔진 권한을 부여하지 않음
- 명시한 rollout review ID만 사용하고 판단 종류·현재 선택 head·현재 quality input digest를 다시 확인함
- 입력이 추가되거나 과거 선택이 된 검토, `more_assessments_required`와 허용되지 않은 operator를 거부함
- 후보 유지 확인을 선택 변경·rollback·approval 없는 항목별 immutable acknowledgement로 기록함
- Rollback 근거와 엔진 선택 전이를 별도 파일로 나누지 않고 schema v3 원본 하나로 게시함
- 기존 schema v1·v2 선택 전이를 수정하지 않고 같은 previous-head CAS와 fallback 계약을 재사용함
- 운영 resolver가 schema v3의 정책·검토·품질 원본을 재생성해 변조·누락을 fail-closed함
- Query·문서 좌표·본문·provider 결과·credential을 저장하거나 event·Hub sync를 만들지 않음

검색 rollout 조치 상태 조회 첫 슬라이스 완료 조건:

- Keep acknowledgement와 action policy에 결속된 schema v3 rollback만 하나의 상태 page로 조합함
- 조치 시각·ID 역순의 기본 20·최대 50개 page와 마지막 action ID cursor를 사용함
- Pagination 전에 전체 acknowledgement와 선택 chain의 정책·검토·candidate review·품질 원본을 검증함
- Page 밖의 끊어지거나 변조된 증거도 숨기지 않고 전체 조회를 실패시킴
- 조회 시각의 대상 attempt·assessment로 현재 품질 snapshot을 만들고 input digest 변경을 구분함
- 검토 대상 선택과 rollback 결과 전이의 현재·과거 관계를 별도로 표시함
- 일반 schema v1·v2 rollback을 정책에 결속된 rollout 조치로 표시하지 않음
- 빈 상태와 cursor page가 최신 조치를 자동 선택·승인·실행하지 않음
- Query·digest·문서 좌표·본문·provider 결과·credential을 출력하거나 새 원본·event·Hub sync를 만들지 않음

검색 rollout 조치 사전 점검 첫 슬라이스 완료 조건:

- Rollout review·action policy·요청 조치·operator를 모두 명시하고 최신 원본을 자동 선택하지 않음
- 실제 apply와 같은 코어 eligibility 판정으로 판단·정책·operator·현재 선택·품질 입력을 확인함
- 미충족 조건을 고정된 사유와 순서로 반환하고 다른 조치나 operator를 추천하지 않음
- Rollback이 eligible이면 실제 게시 직전과 같은 engine policy·head·fallback 후보 재현을 읽기 전용으로 검증함
- 원본 누락·변조·재현 실패를 ineligible로 완화하지 않고 점검 전체를 실패시킴
- Eligible 결과를 승인·예약·실행 보장으로 사용하지 않고 apply가 모든 조건을 다시 검사함
- 점검 전후 acknowledgement와 engine selection 파일 집합이 바뀌지 않음
- Query·digest·품질 원본 ID·문서 좌표·본문·provider 결과·credential을 출력하지 않음
- 새 파일·event·Hub sync를 만들지 않고 action·selection·rollback·approval 상태를 전진시키지 않음

검색 rollout 운영 진단 첫 슬라이스 완료 조건:

- 검색 엔진 선택, engine·rollout review·action 정책, rollout 검토와 조치를 독립된 doctor 항목으로 표시함
- 선택은 운영 resolver와 같은 전체 chain·후보 replay를, 검토와 조치는 기존 bounded 상태 조회의 전체 원본 검증을 재사용함
- 정상적으로 비어 있는 범위는 관측 수 0의 `healthy`로, 직접 확인한 손상은 `unhealthy`로 구분함
- 선택·정책 손상 뒤의 검토와 조치, 검토 손상 뒤의 조치를 `unknown`으로 두고 정상이라고 추측하지 않음
- 한 검색 항목이라도 `unhealthy` 또는 `unknown`이면 전체 doctor 종료 코드가 0이 아님
- Query·digest·원본 ID·문서 좌표·본문·provider 결과·credential·내부 오류 원문을 issue에 넣지 않음
- 조회 중 검색 파일·event·Hub 원본을 만들거나 선택·검토·조치 상태를 전진시키지 않음

범위가 명시된 doctor 조회 첫 슬라이스 완료 조건:

- 기본 `all`과 명시적 `search`를 구분하고 지원하지 않는 범위는 project 원본을 열기 전에 거부함
- 검색 범위에서 검색 엔진 선택·정책·검토·조치 네 검사기만 실제로 실행함
- 검색 범위에서 event store·CAS와 문서·스킬 전용 검사, Codex·Claude runtime probe를 열거나 호출하지 않음
- 텍스트는 제한 조회가 프로젝트 전체 상태가 아님을 설명하고 JSON은 `scope: search`와 실제 검사만 반환함
- 검색 범위 종료 코드 0을 제외한 범위의 정상이나 프로젝트 전체 정상으로 해석하지 않음
- 전체 검사 결과를 사후 필터링하거나 제외한 검사를 관측 수 0의 정상으로 채우지 않음
- 새 파일·event·Hub 원본을 만들거나 검색 상태를 전진시키지 않음

Doctor 복구 안내 첫 슬라이스 완료 조건:

- 모든 현재 doctor issue code를 고정된 action code와 사람이 읽는 한국어 안내에 compile-time 전체 매핑함
- 안내를 자유 형식 오류 문장이나 event ID가 아니라 issue code에서만 파생함
- 같은 issue code가 반복되면 첫 등장 순서를 유지한 안내 하나만 반환하고 서로 다른 issue code는 숨기지 않음
- Issue가 없으면 빈 안내 배열을 반환하고, JSON에는 `issueCode`·`actionCode`·`message`·`actionState=not_performed`, 텍스트에는 action code·한국어 안내·미실행 설명을 제공함
- Project·원본 ID, digest, 경로, 문서·스킬 본문, provider 원문, credential과 내부 오류를 안내에 복사하거나 추측하지 않음
- 안내가 복구 성공·원인 확정·승인·실행 보장을 주장하지 않음
- 자동 수정이나 명령을 실행하지 않고 파일·event·Hub 원본 및 선택·검토·조치 상태를 바꾸지 않음

Doctor 범위 확장 첫 슬라이스 완료 조건:

- `all`, `knowledge`, `documents`, `skills`, `providers`, `search`를 명시적으로 지원함
- 지식 범위는 event chain과 지식 수명주기 검사만 실행하고 project storage·CAS 외의 환경 검사기를 호출하지 않음
- 문서·스킬·provider·검색 범위는 project manifest로 project를 확인하되 event store와 CAS를 열지 않음
- 문서는 등록 정보·원본, 스킬은 package·lock, provider는 두 runtime probe, 검색은 선택·정책·검토·조치만 실행함
- Scope별 허용 검사 ID의 누락·중복·다른 범위 혼입을 report 생성 전에 거부함
- 텍스트와 JSON의 scope·checks가 실제 실행 범위와 같고 제한 조회 성공을 프로젝트 전체 정상으로 표시하지 않음
- 선택 범위의 `unhealthy`·`unknown`이 종료 코드 1과 기존 복구 안내로 이어짐
- 파일·event·Hub 원본을 만들거나 진단 대상 상태를 전진시키지 않음

Doctor report 호환성 계약 첫 슬라이스 완료 조건:

- JSON에 `schemaVersion: 1`과 기존 report 필드를 모두 필수로 두고 JSON Schema와 TypeScript 타입을 같은 원본에서 파생함
- 정상 v1과 report·하위 항목의 선택 필드 추가를 이전 reader가 받아들임
- 기존 필드 삭제·타입 변경·controlled value 변경을 v1 호환으로 처리하지 않음
- 미지원 정수 버전은 `doctor_report_schema_unsupported`, 손상된 v1은 `doctor_report_invalid`로 구분함
- Scope와 check 집합, 전체 status와 check 상태, recovery guidance와 issue 투영이 다르면 report를 거부함
- 검증 오류에 입력 원문, ID, 경로, 문서·provider 내용이나 credential을 복사하지 않음
- 정상·추가 필드·미지원 버전·손상 구조와 실제 CLI JSON을 fixture·계약 테스트로 고정함

Trace report 호환성 계약 첫 슬라이스 완료 조건:

- JSON에 `schemaVersion: 1`과 run·integrity·시각·session·event 필드를 필수로 두고 schema와 정적 타입을 같은 원본에서 파생함
- 각 event의 기존 schema, payload allowlist와 canonical hash를 다시 확인함
- 모든 event의 project/run, 증가하는 전역 seq, 연속 seq hash link와 파생 status·시각·session 집계를 확인함
- 선택된 run 조각만으로 생략된 다른 run의 전체 chain을 재검증했다고 주장하지 않음
- 미지원 버전과 손상된 v1을 서로 다른 code로 거부하고 검증 오류에 입력 내용을 복사하지 않음
- 정상·선택 필드 추가·미지원 버전·구조·hash·allowlist·집계 손상을 fixture와 CLI JSON 테스트로 고정함

Bounded trace 원본 조회 첫 슬라이스 완료 조건:

- `last`를 기본 100개 list page가 아니라 project 전역 head event에서 결정함
- 전체 event chain을 SQLite row iterator로 검증하고 전체 배열을 만들지 않음
- 완전한 report가 1,000개를 넘으면 `trace_result_too_large`로 실패하고 일부 성공을 반환하지 않음
- 100개를 넘긴 project의 실제 최신 run 선택과 1,001개 단일 run 실패를 회귀 테스트로 고정함
- 조회 중 event, 파일, CAS나 Hub 원본을 만들거나 변경하지 않음

Snapshot-bound local trace page 첫 슬라이스 완료 조건:

- 기존 전체 `TraceReport` 의미를 바꾸지 않고 별도 `TracePageReport` v1을 사용함
- 첫 page는 1~100개 명시적 상한, 다음 page는 응답 cursor만 받음
- Cursor를 project/run, integrity count/head, 마지막 event seq/hash와 page 크기에 결속함
- Page 사이 append는 `trace_cursor_stale`, 손상·모순 cursor는 `trace_cursor_invalid`로 실패함
- Page가 전체 run status·시각·session을 주장하지 않고 event·page 좌표만 반환함
- Event schema·allowlist·hash, 순서·연속 link, 반환 수와 다음 cursor 의미를 reader가 다시 확인함
- Cursor를 인증이나 접근 권한으로 사용하지 않고 조회 중 원본을 변경하지 않음

Trace page event type filter 첫 슬라이스 완료 조건:

- 기존 allowlist event type만 중복 없이 받고 실제 조건을 report와 텍스트에 표시함
- 정렬된 조건을 cursor에 결속하고 다음 page에서 조건 재지정을 받지 않음
- 최대 1,000개 source batch를 순회하되 일치 event는 page 상한+1개만 보관함
- 반환 event가 모두 조건에 속하고 report와 cursor 조건이 같은지 reader가 검증함
- Run 존재·일치 결과 없음과 run 부재를 `trace_filter_empty`, `trace_run_not_found`로 구분함
- Filtered page를 전체 run event 부재나 전체 상태로 표현하지 않고 원본을 변경하지 않음

Diagnostics report compatibility 경계 정리 완료 조건:

- Doctor, trace, trace page의 version 추출·schema 검증·의미 검증 순서를 한 공통 reader로 관리함
- Report별 error class·code와 의미 검증기는 독립 모듈에 유지함
- 공통 오류 생성이 입력 JSON, payload, ID, 경로나 credential을 받지 않음
- Trace CLI의 옵션 해석, 사람용 formatter와 storage 수명주기 조합을 별도 모듈로 분리함
- 전체·첫 page·cursor page 요청을 배타적인 타입으로 만들고 잘못된 조합을 storage open 전에 거부함
- 기존 report fixture와 CLI 출력·오류 회귀 테스트가 그대로 통과함

Trace output mode deprecation 계약 첫 슬라이스 완료 조건:

- 암묵적 전체 출력과 명시적 `--full`을 서로 다른 요청 모드로 구분함
- 0.0.x의 암묵적 전체 stdout·종료 코드는 유지하고 성공 뒤 controlled stderr 경고만 한 번 출력함
- `--full`은 같은 v1 report를 경고 없이 반환함
- Full·page·filter·cursor 모순을 project storage open 전에 거부함
- Page·cursor mode와 실패한 전체 조회에는 deprecation 경고를 내지 않음
- 경고에 project/run/event ID, payload, 경로나 credential을 넣지 않음
- Bounded page 기본 전환을 0.1.0 별도 변경으로 두고 현재 코드에서 자동 활성화하지 않음

Machine-readable trace capability report 완료 조건:

- `lervo trace --capabilities`가 project storage 없이 versioned JSON만 반환함
- 현재 기본 mode와 implicit/full/page/cursor의 명시성, report 종류·schema version을 구조화함
- 기본·최대 page 크기, 전체 report event 상한과 cursor byte 상한을 실제 구현 상수에서 가져옴
- deprecation code, 대상·대체 mode, 변경 version과 다음 기본 mode를 사람용 문장 없이 제공함
- Capability mode가 다른 trace 조회 옵션과 섞이면 storage open 전에 거부함
- Reader가 미지원 version과 구조·관계 손상을 구분하고 입력 원문을 오류에 포함하지 않음
- 조회가 event, 파일, project 설정이나 현재 기본 mode를 만들거나 변경하지 않음

Trace default transition compatibility fixture 완료 조건:

- 기본 page보다 하나 많은 51개 합성 event로 full과 bounded page를 같은 run에서 구분함
- 0.1.0 기본 JSON이 첫 50개의 page v1이고 stderr가 비어 있는지 고정함
- 명시적 `--full`이 51개 전체의 full v1을 경고 없이 반환하는지 고정함
- Capability가 선언한 기본 page 크기로 첫 page를 만들고 cursor page까지 seq 중복·누락 없이 읽음
- Full과 page 결과를 각각 기존 compatibility reader로 검증하고 page에 전체 status가 없음을 확인함
- Fixture가 production version·기본 mode·event schema나 사용자 project를 바꾸지 않음

Trace bounded-default 0.1.0 release 전환 완료 조건:

- 인자 없는 text·JSON trace가 기본 50개 `TracePageReport`를 경고 없이 반환함
- 전체 `TraceReport` v1과 1,000개 상한은 명시적 `--full`에서 유지함
- Capability default를 `page`, 유일한 `explicit=false` mode를 page, deprecations를 빈 목록으로 갱신함
- Reader가 유일한 비명시 mode와 default의 일치를 검증함
- 루트와 55개 private workspace package version을 모두 0.1.0으로 맞추고 검사로 drift를 거부함
- Help와 별도 migration 문서가 기본 page, `--full`, cursor stale 의미를 설명함
- 이전 report schema, event 원본과 project 상태를 변경하지 않음

설치된 CLI 0.1.0 smoke fixture 완료 조건:

- `lervo --version`이 project storage 없이 CLI package manifest의 semantic version을 한 줄로 반환함
- 전체 build 뒤 CLI와 production workspace dependency closure를 임시 deploy로 조립함
- 저장소 밖 cwd에서 설치본 `dist/bin.js`와 설치본 diagnostics·project-storage만 사용함
- 루트·source CLI·설치 manifest version과 `bin.lervo` 좌표가 같지 않으면 실패함
- 설치본 capability가 기본 page와 빈 deprecation을, 실제 기본 trace가 status 없는 page v1을 반환함
- 설치본의 명시적 `--full`이 같은 합성 event를 가진 completed full v1을 반환함
- 기존 51-event fixture와 책임을 중복하지 않고 package 연결용 두 event만 사용함
- `pnpm check`가 build 뒤 smoke를 실행하고 성공·실패 모두 임시 설치와 project를 제거함
- Registry 게시·다운로드, 전역 shell shim과 provider 실행을 검증했다고 주장하지 않음

Canonical CLI release artifact manifest 완료 조건:

- CLI archive가 dist JavaScript·선언 파일과 package manifest만 포함하고 source·test·설정·build cache를 거부함
- 각 dist 파일의 정렬된 path·byte 수·SHA-256과 전체 canonical content digest를 고정함
- Package identity, 공개 file pattern과 workspace version으로 정규화한 직접 dependency를 manifest에 결속함
- 임시 production deploy의 portable dependency closure를 정렬·중복 제거하고 별도 digest로 고정함
- OS·CPU 제한 package는 portable 목록과 섞지 않고 name prefix·정확한 version family로 제한함
- Tar header·생성 시각·임시 경로·symlink와 현재 platform 이름을 checksum 입력에서 제외함
- Manifest 자체 digest를 실제 artifact와 비교하기 전에 검증하고 변경 section만 오류로 표시함
- 파일 변경·dependency 누락·stale digest·오류 출력 경계를 회귀 테스트로 검증함
- 명시적 update만 bounded manifest 한 파일을 교체하고 기본 check는 원본을 쓰지 않음
- 서명·SBOM·registry 게시와 모든 platform 실행을 검증했다고 주장하지 않음

## 다음 실행 작업

현재 정의한 M0~M6 v0 범위와 후속 **Hub 정책 배포·`require_approval` managed write 연결 및 Hub 정책 HTTP 수직 슬라이스**를 완료했습니다. `PolicySnapshot`, command·capability·snapshot·경로에 묶인 approval과 별도 revocation을 purpose별로 서명하고, 인증된 Hub transport에서 검증한 bounded bundle을 project-bound SQLite에 원자적으로 저장합니다. 로컬·Hub 중 더 제한적인 결정을 적용하며 승인 대기 command는 reservation 없이 재평가됩니다. 저장 후 signature 재검증, Node 재시작, 승인 만료·철회, local deny 우선, 잘못된 purpose와 snapshot rollback을 fixture로 확인했습니다.

Coordinator는 provider 시작 전과 실제 쓰기 직전에 현재 signed 원본, command/run/provider/risk/suite와 승인 경로를 재검증합니다. E3·예상 경로·실제 before hash도 통과한 경우에만 `capability.decided.approvalId`와 policy snapshot ID가 묶인 기존 1회용 permit를 발급합니다. 실행 전 통과 뒤 철회·만료된 승인과 policy rule보다 넓은 승인 경로도 fixture로 차단했습니다. 결정은 [ADR-0043](./docs/adr/0043-signed-policy-and-command-bound-approval.md)과 [ADR-0044](./docs/adr/0044-signed-approval-managed-write-permit.md)에 기록했습니다.

`@lervo/hub-policy`는 현재 head와 durable command 원본에 결속된 snapshot·approval·revocation을 작성하고, Hub SQLite는 세 signed 원본을 append-only table에 보존합니다. `@lervo/hub`는 `policy.read`·`policy.write`와 project scope를 source보다 먼저 확인하며 원본 시각은 Hub clock이 정합니다. Node HTTP transport는 HTTPS, bearer token, Hub identity header, 응답 좌표와 byte 상한을 확인합니다. Hub·Node 재시작, 순차 snapshot, 같은 head의 늦은 승인·철회, 권한 거부, 요청 상한, identity 불일치와 승인자 원문 비저장을 실제 HTTP fixture로 확인했습니다. 결정은 [ADR-0045](./docs/adr/0045-hub-policy-authoring-and-http-sync.md)에 기록했습니다.

플랫폼 중립 conversation 첫 슬라이스를 완료했습니다. `@lervo/conversation-contract`는 외부 플랫폼과 자체 채팅 서비스가 함께 쓰는 adapter capability, hash-only inbound, participation policy·decision과 writing permit-bound outbound를 정의합니다. `@lervo/interaction`은 mention·relevance·signal, actor, cooldown, rate와 automation depth를 구분하며 관련성을 확정하지 못하면 관찰만 합니다. `@lervo/interaction-sqlite`는 재시작 가능한 inbox·decision·outbox와 되돌릴 수 없는 완료·전달 상태를 보존합니다. Native adapter fixture에서 재시작 뒤 중복 responder 방지, 전송 실패 복구, raw platform key와 본문 비저장까지 확인했습니다. 결정은 [ADR-0046](./docs/adr/0046-platform-neutral-conversation-participation.md)에 기록했습니다.

Managed conversation responder bridge를 완료했습니다. `@lervo/conversation-responder`는 message CAS 원본과 request digest를 결속하고, 역할별 독립 Codex·Claude 읽기 전용 session에서 허용된 shared context의 E2/E3와 원본 event를 다시 검증합니다. Provider 결과는 실제 `chat` writing 평가와 재검증 가능한 평가 artifact가 있어야 reply candidate가 됩니다. 변조된 공개 증거는 outbox 없이 bounded retry로 남습니다. 결정은 [ADR-0047](./docs/adr/0047-managed-conversation-responder.md)에 기록했습니다.

Slack·Discord 인증 conversation adapter를 완료했습니다. 공통 `@lervo/conversation-platform`이 외부 identity mapping, CAS 본문과 delivery correlation 경계를 소유합니다. Slack adapter는 raw body HMAC, 5분 시각과 app/team scope를 확인하고, Discord adapter는 인증된 Gateway session의 `MESSAGE_CREATE`와 guild/DM scope만 받습니다. Resume·HTTP 재전송은 같은 canonical event ID로 수렴하고 outbound port는 restart 뒤에도 같은 `outboundId`를 같은 외부 message ID로 수렴시켜야 합니다. 결정은 [ADR-0048](./docs/adr/0048-authenticated-platform-conversation-adapters.md)에 기록했습니다.

Conversation 배포 조합을 완료했습니다. `@lervo/conversation-platform-sqlite`는 외부 주소·participant·thread의 가역 mapping, inbound/outbound correlation과 delivery replay를 interaction DB 밖에 보존합니다. `apps/conversation`은 이 저장소와 CAS, Slack OAuth Web API, Discord bot-token REST transport와 인증된 Gateway port를 조합합니다. 재시작 뒤 답글과 automation depth가 복원되며 확인하지 못한 API 응답은 `unknown`으로 남겨 자동 재전송하지 않습니다. 실제 Discord Gateway WebSocket driver와 `unknown` 운영자 reconciliation은 완료로 주장하지 않습니다. 결정은 [ADR-0049](./docs/adr/0049-durable-conversation-deployment.md)에 기록했습니다.

Hub command/approval 대화 UX를 완료했습니다. `@lervo/conversation-control`은 명시적 command만 처리하고 project·participant를 Hub principal에 결속합니다. 짧게 만료되는 HMAC review grant는 같은 principal로 재인증한 `/control` 조회에만 쓰이며 승인 권한이 아닙니다. 실제 signed approval은 별도 bearer의 `approval.write`와 기존 Hub policy 작성 경계를 통과해야 생깁니다. 대화 응답 writing gate, grant principal·command·만료 결속, SQLite approval 없음·일부·전체·철회 전이를 실제 HTTP fixture로 확인했습니다. 결정은 [ADR-0050](./docs/adr/0050-principal-bound-conversation-command-review.md)에 기록했습니다.

연구자·마케터·디자이너 전문 역할 계약을 완료했습니다. `@lervo/roles`는 역할별 입력·E3 문서·capability·산출물·verification·handoff와 평가 묶음을 결속합니다. 평가 결과는 생산 run과 대상 artifact CAS 좌표, 별도 의미 평가 run, check별 evidence와 파생 상태를 검증하며 같은 bytes를 다시 확인한 경우만 역할 공개 경계를 통과합니다. 고위험 workflow는 서로 다른 제안·결정, 검토, 검증 역할과 전체 suite를 기존 provider-neutral 숙의 정책에 묶습니다. 역할 평가는 writing permit나 실제 숙의 실행을 대신하지 않습니다. 결정은 [ADR-0051](./docs/adr/0051-evidence-bound-multi-discipline-roles.md)에 기록했습니다.

명시적 관계 기반 지식 그래프 첫 슬라이스를 완료했습니다. `@lervo/knowledge-graph`는 allowlist event에 실제로 있는 ID와 경로만 안정된 relation과 증거 좌표로 투영합니다. Hub SQLite는 파생 관계를 event transaction에서 증분 반영하고 version 변경 시 event에서 다시 만들며 전체 audit로 변조·누락을 대조합니다. 인증된 graph API와 `/trace`는 focus에 직접 닿는 현재 page만 반환·표시하고 문서 본문, content hash, prompt와 내부 추론을 다루지 않습니다. 결정은 [ADR-0052](./docs/adr/0052-rebuildable-explicit-knowledge-graph.md)에 기록했습니다.

결정적 어휘 검색과 명시적 실패 관측 첫 슬라이스를 완료했습니다. `@lervo/search`는 등록 원본 hash에 결속된 `lexical-v1` index와 순위를 재현하고 `@lervo/search-local`은 안전하게 읽은 로컬 문서와 query 원문 없는 attempt·별도 assessment를 연결합니다. `lervo search`, `search assess`, `search report`는 빈 결과를 자동 실패로 만들지 않고 명시적으로 평가된 사유만 집계하며 임베딩 판단을 미결정으로 유지합니다. 결정은 [ADR-0053](./docs/adr/0053-deterministic-lexical-search-observations.md)에 기록했습니다.

검색 추천과 managed context 연결 첫 슬라이스를 완료했습니다. Search attempt를 포함한 bounded recommendation batch가 document hit와 `top_ranked-v1` 선택을 다시 검증하고, context preparation은 모든 추천과 실제 선택·적재·주입을 서로 다른 evidence와 event로 남깁니다. 로컬 managed run은 provider를 시작하기 전에 attempt를 기록하고 결과에 별도 assessment용 ID를 표시합니다. 결정은 [ADR-0054](./docs/adr/0054-search-recommendation-managed-context-boundary.md)에 기록했습니다.

검토된 검색 평가 케이스와 반복 측정 첫 슬라이스를 완료했습니다. 기존 attempt·assessment와 일치하는 query, 평가자가 기대하거나 수락한 source만 케이스별 YAML로 승격합니다. 현재 `lexical-v1` 실행은 query 없는 result·run 원본으로 분리되고 검토 시점 대비 개선·회귀를 계산하지만 임베딩 판단은 미결정으로 둡니다. 결정은 [ADR-0055](./docs/adr/0055-reviewed-search-evaluation-cases.md)에 기록했습니다.

검색 평가 묶음과 표본 충분성 첫 슬라이스를 완료했습니다. 역할·작업 유형별 작은 묶음이 활성 case, 대체 관계와 최소 표본을 선언하고, 현재 고유 query 표본이 비교에 충분한지 별도 coverage로 계산합니다. 부족한 표본도 baseline 관측은 남길 수 있지만 비교 준비 완료나 임베딩 필요성으로 승격하지 않습니다. 결정은 [ADR-0056](./docs/adr/0056-search-evaluation-sample-bundles.md)에 기록했습니다.

공급자 중립 검색 후보 비교 첫 슬라이스를 완료했습니다. 공통 engine port와 실행기는 같은 corpus·case·시각·순위 조건을 두 엔진에 공급하고, 준비 gate는 부족한 묶음에서 후보 호출 자체를 막습니다. 비교는 case 통과·실패 전이만 query 없는 별도 원본에 기록하며 score 우열, 후보 채택과 임베딩 필요성을 결정하지 않습니다. 결정은 [ADR-0057](./docs/adr/0057-provider-neutral-search-candidate-comparison.md)에 기록했습니다.

첫 결정적 검색 후보 adapter와 명시적 등록 첫 슬라이스를 완료했습니다. 공용 corpus·응답 계약과 재현성 검사가 baseline과 `bm25f-v1`의 입력·index·결과 경계를 맞추고, 정적 allowlist와 CLI는 등록된 후보만 준비된 묶음에서 비교합니다. `bm25f-v1`는 고정 정수 field 가중·길이·포화·희귀도 점수만 사용하며 운영 검색을 바꾸지 않습니다. 결정은 [ADR-0058](./docs/adr/0058-deterministic-bm25f-search-candidate.md)에 기록했습니다.

재현 검증을 거치는 검색 후보 검토 첫 슬라이스를 완료했습니다. 지정 comparison과 현재 bundle·coverage·case·corpus, 두 run·result를 다시 확인하고 등록 후보를 같은 시각과 입력으로 재실행해 run ID가 일치할 때만 채택·기각·표본 추가 필요 검토를 별도 immutable 원본으로 남깁니다. 채택 검토는 후보 승리가 있고 baseline 회귀가 없는 경우만 다음 활성화 검토 대상으로 표시하며 운영 검색과 임베딩 판단은 바꾸지 않습니다. 결정은 [ADR-0059](./docs/adr/0059-replayed-search-candidate-review.md)에 기록했습니다.

정책에 결속된 검색 엔진 선택·rollback 첫 슬라이스를 완료했습니다. Project별 정책이 허용 reviewer·operator·candidate와 최소 개선 기준을 고정하고, 활성화 직전에 비교 전체와 후보 replay를 다시 확인합니다. 선택과 rollback은 이전 head를 열쇠로 한 별도 immutable 전이 chain에 남아 동시 분기와 덮어쓰기를 막습니다. 전이는 선택 기록만 주장하고 실제 소비는 별도 attempt가 증명합니다. 결정은 [ADR-0060](./docs/adr/0060-policy-bound-search-engine-selection.md)에 기록했습니다.

검증된 운영 검색 엔진 resolver와 fail-closed 소비 첫 슬라이스를 완료했습니다. 일반 검색과 managed context가 전체 선택 chain·정책·등록 engine·현재 corpus·후보 replay를 확인하는 같은 resolver를 사용하고, 검증 실패를 lexical baseline으로 숨기지 않습니다. Attempt·recommendation·추천 event는 실제 engine과 선택 전이 ID를 이어받으며 evaluation baseline은 `lexical-v1`에 고정됩니다. 결정은 [ADR-0061](./docs/adr/0061-fail-closed-operational-search-engine-resolution.md)에 기록했습니다.

선택된 검색 후보의 검증 원본 갱신 첫 슬라이스를 완료했습니다. 문서 corpus가 달라진 후보는 계속 fail-closed로 두고, 새 비교·검토·정책과 현재 replay가 모두 맞을 때만 같은 후보의 새 증거를 `refresh_candidate` immutable 전이로 연결합니다. Refresh 뒤 운영 검색은 새 전이 ID를 사용하며 명시적인 rollback은 오래된 후보가 아니라 baseline으로 복구합니다. 결정은 [ADR-0062](./docs/adr/0062-selected-search-candidate-evidence-refresh.md)에 기록했습니다.

검색 adapter build identity와 재생성 가능한 검증 receipt 첫 슬라이스를 완료했습니다. 신규 비교·검토는 engine version과 별도의 adapter build ID를 원본에 결속하고, review·activation·refresh·운영 resolver는 현재 registry가 같은 build인지 후보 호출 전에 확인합니다. 성공한 v2 replay의 receipt는 원본 좌표에서 같은 ID로 다시 만들며 별도 파일이나 event로 쌓지 않습니다. 기존 v1 원본은 수정하지 않고 읽되 새 선택 증거로 승격하지 않습니다. 결정은 [ADR-0063](./docs/adr/0063-search-adapter-build-identity-and-replay-receipt.md)에 기록했습니다.

선택에 결속된 운영 검색 품질 관측 첫 슬라이스를 완료했습니다. 기존 전체 합계와 함께 전이 없는 baseline, build-bound candidate와 rollback baseline을 선택 전이별 slice로 분리합니다. Build ID는 attempt에 복제하지 않고 검증된 review에서 파생하며 평가되지 않은 시도는 미평가로 남습니다. 수락·실패 관측과 관계없이 rollout·rollback·embedding 판단은 모두 미결정이고 report는 선택 상태를 바꾸지 않습니다. 결정은 [ADR-0064](./docs/adr/0064-selection-bound-operational-search-quality.md)에 기록했습니다.

사람의 검색 rollout 검토 첫 슬라이스를 완료했습니다. 현재 build-bound 후보 전이의 attempt·assessment 입력 hash와 집계를 시점 snapshot으로 고정하고, reviewer의 후보 유지·롤백 권고·추가 평가 필요 판단을 별도 immutable 원본으로 남깁니다. 기준 정책이 없으므로 표본과 실패 수치에서 판단을 추정하지 않으며 검토는 선택 변경·rollback·승인을 실행하지 않습니다. 결정은 [ADR-0065](./docs/adr/0065-human-search-rollout-review.md)에 기록했습니다.

검색 rollout 검토 상태 조회 첫 슬라이스를 완료했습니다. 현재 선택과 검토 원본을 제한된 cursor page로 보여 주고, 검토 당시 입력을 재검증한 뒤 현재 품질 입력 digest의 변경 여부를 표시합니다. Rollback 뒤에는 과거 선택으로 구분하며 최신 검토를 승인이나 적용 대상으로 선택하지 않습니다. 결정은 [ADR-0066](./docs/adr/0066-bounded-search-rollout-review-status.md)에 기록했습니다.

검색 rollout 검토 정책 첫 슬라이스를 완료했습니다. 허용 reviewer·candidate와 유지·rollback의 평가·실패 기준을 정책별 immutable YAML에 고정하고, 신규 검토만 정확한 정책 ID에 결속해 기준을 충족할 때 게시합니다. 기존 v1은 소급 해석하지 않으며 정책 확인은 저장 당시 snapshot만 판정하고 결정 선택·승인·선택 변경을 실행하지 않습니다. 결정은 [ADR-0067](./docs/adr/0067-policy-bound-search-rollout-review.md)에 기록했습니다.

검색 rollout 조치 첫 슬라이스를 완료했습니다. 검토 정책과 분리한 action policy가 exact 조치·operator와 rollback용 engine policy를 고정합니다. 명시한 검토가 현재 선택이고 품질 입력이 그대로일 때만 keep acknowledgement 또는 schema v3 rollback을 게시하며, rollback 근거와 선택 전이는 파일 하나로 원자화했습니다. 운영 resolver는 모든 조치 원본을 다시 확인하고 변조된 digest를 fail-closed합니다. 결정은 [ADR-0068](./docs/adr/0068-explicit-search-rollout-actions.md)에 기록했습니다.

검색 rollout 조치 상태 조회 첫 슬라이스를 완료했습니다. Keep acknowledgement와 schema v3 rollback을 제한된 cursor page로 조합하고, 검토 대상과 rollback 결과 전이의 현재·과거 관계 및 현재 품질 입력 변경을 따로 표시합니다. Pagination 전에 모든 조치 원본을 검증하므로 숨겨진 과거 증거가 끊겨도 전체 조회를 실패시킵니다. 결정은 [ADR-0069](./docs/adr/0069-bounded-search-rollout-action-status.md)에 기록했습니다.

검색 rollout 조치 사전 점검 첫 슬라이스를 완료했습니다. 명시한 review·action policy·조치·operator의 현재 조건을 실제 apply와 같은 코어 판정으로 설명하고, eligible rollback은 게시 직전과 같은 engine policy·head·fallback 재현까지 읽기 전용으로 확인합니다. 점검은 승인이나 예약이 아니며 apply가 모든 조건을 다시 확인합니다. 결정은 [ADR-0070](./docs/adr/0070-read-only-search-rollout-action-preflight.md)에 기록했습니다.

검색 rollout 운영 진단 첫 슬라이스를 완료했습니다. 검색 엔진 선택, 세 종류의 정책, rollout 검토와 조치를 네 doctor 항목으로 분리하고 기존 운영 resolver와 bounded 상태 조회의 전체 원본 검증을 재사용합니다. 정상적인 빈 저장소는 관측 수 0의 정상이고, 직접 확인한 손상은 `unhealthy`, 선행 손상 때문에 판정할 수 없는 하위 범위는 `unknown`입니다. 진단은 검색 상태를 바꾸거나 query·digest·원본 ID를 노출하지 않습니다. 결정은 [ADR-0071](./docs/adr/0071-search-rollout-operational-doctor.md)에 기록했습니다.

범위가 명시된 doctor 조회 첫 슬라이스를 완료했습니다. 기본 `all`과 `--scope search`를 구분하고 검색 범위에서는 네 검색 검사만 실행합니다. Event store·CAS와 provider probe를 열지 않으며 텍스트는 프로젝트 전체 상태가 아님을 설명하고 JSON은 `scope`와 실제 검사만 반환합니다. 제한 범위의 종료 코드 0은 그 범위에만 적용됩니다. 결정은 [ADR-0072](./docs/adr/0072-explicitly-scoped-doctor.md)에 기록했습니다.

Doctor 복구 안내 첫 슬라이스를 완료했습니다. 모든 현재 issue code는 controlled action code와 고정된 한국어 안내에 전체 매핑되며, 같은 code의 반복은 한 번만 표시합니다. 안내는 오류 문장·event ID·경로를 복사하지 않고 `actionState=not_performed`를 유지하며 텍스트도 자동 수정이나 상태 변경을 실행하지 않았음을 밝힙니다. 결정은 [ADR-0073](./docs/adr/0073-bounded-doctor-recovery-guidance.md)에 기록했습니다.

Doctor 범위 확장 첫 슬라이스를 완료했습니다. `knowledge`, `documents`, `skills`, `providers`, `search`가 각자의 허용 검사와 의존성만 실행합니다. 지식은 project storage·CAS만 열고 나머지 제한 범위는 event store·CAS를 열지 않습니다. 텍스트와 JSON은 실제 범위를 표시하고 선택 범위의 `unknown`·`unhealthy`만 종료 코드와 복구 안내에 반영합니다. 결정은 [ADR-0074](./docs/adr/0074-doctor-scope-execution-plans.md)에 기록했습니다.

Doctor report 호환성 계약 첫 슬라이스를 완료했습니다. CLI JSON은 `schemaVersion: 1`을 필수로 내보내며 schema와 정적 타입은 한 원본에서 파생됩니다. Reader는 선택 필드 추가를 허용하지만 미지원 버전, 필수 구조 손상과 scope/check·status·recovery guidance 의미 불일치를 구분해 거부합니다. 검증 오류는 입력 내용을 복사하지 않습니다. 결정은 [ADR-0075](./docs/adr/0075-versioned-doctor-report-contract.md)에 기록했습니다.

Trace report 호환성 계약 첫 슬라이스를 완료했습니다. CLI JSON은 `schemaVersion: 1`을 포함하고 reader는 event별 schema·allowlist·hash와 run/status/시각/session 집계를 다시 확인합니다. 선택된 run 조각만으로 생략된 전역 chain을 증명하지 않으며 미지원 버전과 손상된 v1을 구분합니다. 결정은 [ADR-0076](./docs/adr/0076-versioned-trace-report-contract.md)에 기록했습니다.

Bounded trace 원본 조회 첫 슬라이스를 완료했습니다. `last`는 전역 head를 직접 읽고 integrity는 SQLite iterator로 확인합니다. 100개 기본 list page를 전체로 오해하지 않으며 완전한 report가 1,000개를 넘으면 일부 결과 대신 명시적으로 실패합니다. 결정은 [ADR-0077](./docs/adr/0077-bounded-trace-source-reads.md)에 기록했습니다.

Snapshot-bound local trace page 첫 슬라이스를 완료했습니다. 기존 전체 report와 별도인 page report가 최대 100개 event만 반환하고 cursor를 project/run, integrity head와 마지막 event에 결속합니다. Page 사이 append, cursor 손상과 page 의미 불일치를 닫힌 상태로 거부합니다. 결정은 [ADR-0078](./docs/adr/0078-snapshot-bound-local-trace-pages.md)에 기록했습니다.

Trace page event type filter 첫 슬라이스를 완료했습니다. Allowlist 조건을 report·텍스트와 cursor에 함께 고정하고 bounded batch scan으로 일치 event만 page화합니다. 조건에 맞는 기록 없음과 run 부재를 구분하며 filtered page를 전체 run 상태로 표현하지 않습니다. 결정은 [ADR-0079](./docs/adr/0079-explicit-trace-page-event-filter.md)에 기록했습니다.

Diagnostics report compatibility 경계 정리를 완료했습니다. 세 report reader는 공통 version·schema·의미 검증 순서를 사용하되 각 code와 의미 검증을 독립적으로 유지합니다. Trace CLI는 옵션·format·실행 조합으로 나뉘고 요청 모드는 타입 수준에서 배타적입니다. 결정은 [ADR-0080](./docs/adr/0080-shared-diagnostics-report-compatibility.md)에 기록했습니다.

Trace output mode deprecation 계약 첫 슬라이스를 완료했습니다. 0.0.x의 암묵적 full은 기존 stdout을 유지하면서 controlled 경고를 내고, `--full`은 경고 없이 같은 v1을 고정했습니다. 이 단계에서 분리했던 bounded 기본값 전환은 이후 0.1.0의 ADR-0084에서 완료했습니다. 결정은 [ADR-0081](./docs/adr/0081-trace-output-mode-deprecation.md)에 기록했습니다.

Machine-readable trace capability report를 완료했습니다. `lervo trace --capabilities`는 저장소를 열지 않고 현재 기본·지원 mode, report version, 실제 page/full/cursor 상한과 구조화된 deprecation을 v1 JSON으로 반환합니다. Reader는 mode 참조와 상한 관계를 검증하며 오류에 입력 원문을 복사하지 않습니다. 결정은 [ADR-0082](./docs/adr/0082-machine-readable-trace-capabilities.md)에 기록했습니다.

Trace default transition compatibility fixture를 완료했습니다. 기본 page보다 하나 많은 합성 run에서 0.1.0 기본 page, 명시적 full과 두 bounded cursor page를 실제 CLI와 report reader로 재현합니다. 기본 stderr, full/page event 경계와 seq 연속성 중 하나라도 달라지면 CI가 실패합니다. 결정은 [ADR-0083](./docs/adr/0083-trace-default-transition-fixture.md)에 기록했습니다.

Trace bounded-default 0.1.0 release 전환을 완료했습니다. 인자 없는 trace는 기본 50개 page를 반환하고 전체 v1은 `--full`에서 유지합니다. Capability와 전환 fixture, help, 별도 migration 안내를 현재 동작에 맞췄으며 루트와 55개 workspace package version을 0.1.0으로 함께 올렸습니다. 결정은 [ADR-0084](./docs/adr/0084-trace-bounded-default-release.md)에 기록했습니다.

설치된 CLI 0.1.0 smoke fixture를 완료했습니다. CLI version은 배포 manifest를 단일 원본으로 사용하고, 전체 build 뒤 임시 production deploy의 실제 `dist/bin.js`와 설치된 runtime dependency로 capability·기본 page·명시적 full을 검증합니다. 51-event 경계 fixture는 중복하지 않으며 registry 게시나 provider 실행은 주장하지 않습니다. 결정은 [ADR-0085](./docs/adr/0085-installed-cli-smoke-boundary.md)에 기록했습니다.

Canonical CLI release artifact manifest 검사를 완료했습니다. Archive는 dist JavaScript·선언 파일과 package manifest만 허용하며 파일별 SHA-256, package identity, 직접 dependency와 portable production closure를 하나의 교체형 manifest에 결속합니다. Tar metadata와 platform 전용 native package 이름은 portable digest에서 분리하고 기본 검사는 원본을 쓰지 않습니다. 결정은 [ADR-0086](./docs/adr/0086-canonical-cli-release-artifact-manifest.md)에 기록했습니다.

다음 구현 작업은 CLI가 참조하는 private workspace package를 함께 게시할지 단일 실행 bundle로 만들지 결정하고 검증하는 **CLI 배포 단위 계약**입니다.
