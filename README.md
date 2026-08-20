# Lervo

Lervo(레르보)는 저장소 안에서 독립적으로 동작하면서, 필요할 때 중앙에서 여러 프로젝트와 AI 에이전트를 관리할 수 있는 로컬 우선(local-first) 에이전트 운영 체계입니다.

현재 상태: 0.1.0, M0·M1·M2·M3·M4·M5·M6 완료, 플랫폼 중립 대화 runtime·증거 결속 전문 역할·명시적 지식 그래프·검색 평가와 정책 기반 엔진 선택·버전이 있는 doctor·bounded trace 자동화 계약 완료 (2026-08-20)

## 목표

- Codex와 Claude를 동일한 실행 계약과 증거 모델로 지원합니다.
- 개발자뿐 아니라 연구, 마케팅, 디자인 등 여러 전문 에이전트를 역할 프로필로 구성합니다.
- 에이전트가 어떤 근거와 문서를 선택하고 실제로 로드했는지 추적합니다.
- 작업 결과에서 재사용 가능한 지식을 후보로 만들고 검증 후 승격합니다.
- `AGENTS.md`, `CLAUDE.md`, `README.md`와 사용자/외부 스킬의 노후화 및 사용 여부를 관리합니다.
- 각 저장소는 오프라인에서도 동작하며, 선택적으로 Lervo Hub와 동기화합니다.
- Slack, Discord 같은 외부 플랫폼과 자체 채팅 서비스에서 같은 대화·명령 계약을 사용할 수 있게 확장합니다.

## 설계 문서

- [제품 비전](./LERVO_VISION.md)
- [시스템 아키텍처](./LERVO_ARCHITECTURE.md)
- [실행 및 증거 규격](./LERVO_EXECUTION_SPEC.md)
- [v0 구현 계획](./LERVO_V0_PLAN.md)
- [M0 계약과 데이터 기본값 ADR](./docs/adr/0001-m0-contracts-and-data-defaults.md)
- [`lervo init` 안전한 초기화 ADR](./docs/adr/0002-safe-project-initialization.md)
- [로컬 event store, outbox와 CAS ADR](./docs/adr/0003-local-event-store-and-cas.md)
- [project storage bootstrap ADR](./docs/adr/0004-project-storage-bootstrap.md)
- [전문 에이전트 공유 맥락과 handoff ADR](./docs/adr/0005-shared-context-and-role-handoff.md)
- [결정적 context preparation ADR](./docs/adr/0006-deterministic-context-preparation.md)
- [Provider-neutral context delivery와 E3 ADR](./docs/adr/0007-provider-neutral-context-delivery.md)
- [Managed context gate orchestration ADR](./docs/adr/0008-managed-context-gate-orchestration.md)
- [Codex app-server managed adapter ADR](./docs/adr/0009-codex-app-server-managed-adapter.md)
- [Claude Agent SDK managed adapter ADR](./docs/adr/0010-claude-agent-sdk-managed-adapter.md)
- [Managed provider run 수명주기 ADR](./docs/adr/0011-managed-provider-run-lifecycle.md)
- [Provider-neutral 결과 artifact ADR](./docs/adr/0012-provider-result-artifacts.md)
- [Provider-neutral managed write bridge ADR](./docs/adr/0013-provider-neutral-managed-write-bridge.md)
- [Managed adapter session 경계 강화 ADR](./docs/adr/0014-managed-adapter-session-hardening.md)
- [`lervo run` 한 파일 CLI 수직 슬라이스 ADR](./docs/adr/0015-lervo-run-cli-vertical-slice.md)
- [로컬 스킬 해석과 실행별 lock ADR](./docs/adr/0016-local-skill-resolution-and-lock.md)
- [분할 문서 manifest와 누적 금지 ADR](./docs/adr/0017-sharded-document-manifests.md)
- [기존 문서 도입과 안전한 migration ADR](./docs/adr/0018-existing-document-adoption.md)
- [공급자 중립 숙의와 명시적 수렴 ADR](./docs/adr/0019-provider-neutral-deliberation.md)
- [Lervo 제품 식별자 통일 ADR](./docs/adr/0020-lervo-product-identity.md)
- [CommonMark 기반 managed block 판정 ADR](./docs/adr/0021-commonmark-managed-block-parser.md)
- [Byte 보존 managed block patch candidate ADR](./docs/adr/0022-byte-preserving-managed-block-patch-candidate.md)
- [증거 기반 문서 노후화 판정 ADR](./docs/adr/0023-evidence-based-document-staleness.md)
- [공급자 중립 프로젝트 검증과 결과 artifact ADR](./docs/adr/0024-provider-neutral-project-verification.md)
- [사람 대상 산출물 공개 gate와 content-bound permit ADR](./docs/adr/0025-writing-publication-gate.md)
- [구조화된 숙의 계약과 증거 기반 수렴 판정 ADR](./docs/adr/0026-structured-deliberation-contracts.md)
- [숙의 runtime 전 계약 경계 정리 ADR](./docs/adr/0027-deliberation-boundary-hardening.md)
- [동일 공급자 역할 격리와 숙의 runtime 증거 결속 ADR](./docs/adr/0028-same-provider-deliberation-runtime.md)
- [Codex·Claude 교차 검토와 역할별 공급자 강제 ADR](./docs/adr/0029-cross-provider-deliberation-runtime.md)
- [수렴 결과 기반 지식 candidate와 로컬 진단 ADR](./docs/adr/0030-evidence-bound-knowledge-candidates.md)
- [사람 검토 기반 지식 승격과 stale 전이 ADR](./docs/adr/0031-reviewed-verified-knowledge-lifecycle.md)
- [`lervo run` 프로젝트 검증 연결 ADR](./docs/adr/0032-managed-run-project-verification.md)
- [범위가 드러나는 로컬 환경 진단 ADR](./docs/adr/0033-bounded-environment-doctor.md)
- [프로젝트 등록과 연속 cursor 기반 event sync 계약 ADR](./docs/adr/0034-project-registration-and-event-sync-contract.md)
- [인증된 peer와 lease에 결속된 outbound sync worker ADR](./docs/adr/0035-outbound-sync-worker.md)
- [응답보다 먼저 commit하는 Hub sync 저장소 ADR](./docs/adr/0036-durable-hub-sync-store.md)
- [연속 이력과 buffered event를 구분하는 Hub trace read model ADR](./docs/adr/0037-hub-trace-read-model.md)
- [이력 크기와 분리된 비동기 Hub 저장·조회 경계 ADR](./docs/adr/0038-bounded-async-hub-storage-and-trace.md)
- [인증과 project scope를 먼저 적용하는 trace HTTP 경계 ADR](./docs/adr/0039-authenticated-project-scoped-trace-http.md)
- [페이지를 누적하지 않는 read-only trace web view ADR](./docs/adr/0040-bounded-trace-web-view.md)
- [서명·프로젝트 범위·로컬 정책을 순서대로 닫는 원격 command ADR](./docs/adr/0041-signed-scoped-remote-command.md)
- [재시작과 응답 유실을 견디는 durable command delivery ADR](./docs/adr/0042-durable-remote-command-delivery.md)
- [로컬 제한을 완화하지 않는 서명 정책과 command-bound 승인 ADR](./docs/adr/0043-signed-policy-and-command-bound-approval.md)
- [서명 승인 원본을 managed write permit에 결속하는 ADR](./docs/adr/0044-signed-approval-managed-write-permit.md)
- [Hub가 시각과 범위를 소유하는 정책 작성·동기화 ADR](./docs/adr/0045-hub-policy-authoring-and-http-sync.md)
- [플랫폼 중립 대화와 능동 참여 경계 ADR](./docs/adr/0046-platform-neutral-conversation-participation.md)
- [역할별 managed 대화 응답과 공개 증거 ADR](./docs/adr/0047-managed-conversation-responder.md)
- [Slack·Discord 인증 대화 adapter 경계 ADR](./docs/adr/0048-authenticated-platform-conversation-adapters.md)
- [재시작 가능한 대화 배포 조합 ADR](./docs/adr/0049-durable-conversation-deployment.md)
- [principal에 결속된 대화 command 검토와 별도 승인 ADR](./docs/adr/0050-principal-bound-conversation-command-review.md)
- [증거에 결속된 전문 역할과 고위험 교차 검토 ADR](./docs/adr/0051-evidence-bound-multi-discipline-roles.md)
- [재생성 가능한 명시적 지식 그래프 ADR](./docs/adr/0052-rebuildable-explicit-knowledge-graph.md)
- [결정적 어휘 검색과 명시적 실패 관측 ADR](./docs/adr/0053-deterministic-lexical-search-observations.md)
- [검색 추천과 managed context 선택 경계 ADR](./docs/adr/0054-search-recommendation-managed-context-boundary.md)
- [검토된 검색 평가 케이스 ADR](./docs/adr/0055-reviewed-search-evaluation-cases.md)
- [검색 평가 표본 묶음 ADR](./docs/adr/0056-search-evaluation-sample-bundles.md)
- [공급자 중립 검색 후보 비교 ADR](./docs/adr/0057-provider-neutral-search-candidate-comparison.md)
- [결정적 BM25F 검색 후보 ADR](./docs/adr/0058-deterministic-bm25f-search-candidate.md)
- [재현 검증을 거치는 검색 후보 검토 ADR](./docs/adr/0059-replayed-search-candidate-review.md)
- [정책에 결속된 검색 엔진 선택과 rollback ADR](./docs/adr/0060-policy-bound-search-engine-selection.md)
- [Fail-closed 운영 검색 엔진 선택 해석 ADR](./docs/adr/0061-fail-closed-operational-search-engine-resolution.md)
- [선택된 검색 후보의 검증 원본 갱신 ADR](./docs/adr/0062-selected-search-candidate-evidence-refresh.md)
- [검색 adapter build identity와 재생성 가능한 검증 receipt ADR](./docs/adr/0063-search-adapter-build-identity-and-replay-receipt.md)
- [선택에 결속된 운영 검색 품질 관측 ADR](./docs/adr/0064-selection-bound-operational-search-quality.md)
- [사람의 검색 rollout 검토와 실행 경계 ADR](./docs/adr/0065-human-search-rollout-review.md)
- [제한된 검색 rollout 검토 상태 조회 ADR](./docs/adr/0066-bounded-search-rollout-review-status.md)
- [정책에 결속된 검색 rollout 검토 ADR](./docs/adr/0067-policy-bound-search-rollout-review.md)
- [명시적 검색 rollout 조치와 원자적 rollback ADR](./docs/adr/0068-explicit-search-rollout-actions.md)
- [제한된 검색 rollout 조치 상태 조회 ADR](./docs/adr/0069-bounded-search-rollout-action-status.md)
- [쓰기 없는 검색 rollout 조치 사전 점검 ADR](./docs/adr/0070-read-only-search-rollout-action-preflight.md)
- [검색 rollout 운영 원본 진단 ADR](./docs/adr/0071-search-rollout-operational-doctor.md)
- [실행 범위가 명시된 doctor 조회 ADR](./docs/adr/0072-explicitly-scoped-doctor.md)
- [자동 수정 없는 doctor 복구 안내 ADR](./docs/adr/0073-bounded-doctor-recovery-guidance.md)
- [의존성을 분리한 doctor 범위 실행 계획 ADR](./docs/adr/0074-doctor-scope-execution-plans.md)
- [버전이 있는 doctor report 호환성 계약 ADR](./docs/adr/0075-versioned-doctor-report-contract.md)
- [버전이 있는 trace report 호환성 계약 ADR](./docs/adr/0076-versioned-trace-report-contract.md)
- [잘림을 숨기지 않는 bounded trace 원본 조회 ADR](./docs/adr/0077-bounded-trace-source-reads.md)
- [Snapshot에 묶인 local trace cursor page ADR](./docs/adr/0078-snapshot-bound-local-trace-pages.md)
- [조건이 드러나는 trace page event type filter ADR](./docs/adr/0079-explicit-trace-page-event-filter.md)
- [공통 diagnostics report 호환성 읽기 경계 ADR](./docs/adr/0080-shared-diagnostics-report-compatibility.md)
- [기본 trace output mode 전환 계약 ADR](./docs/adr/0081-trace-output-mode-deprecation.md)
- [기계가 읽는 trace capability report ADR](./docs/adr/0082-machine-readable-trace-capabilities.md)
- [trace 기본값 전환 호환성 fixture ADR](./docs/adr/0083-trace-default-transition-fixture.md)
- [0.1.0 bounded trace 기본값 전환 ADR](./docs/adr/0084-trace-bounded-default-release.md)
- [0.1.0 trace migration 안내](./docs/migrations/0.1.0-trace-bounded-default.md)

## 현재 구현

- `@lervo/schemas`: project, event, Hub sync, context evidence, shared context/handoff, provider와 conversation adapter, 역할, skill, document, verification, writing, 숙의·지식 수명주기와 doctor·trace·trace capability report JSON Schema 및 파생 TypeScript 타입
- `@lervo/conversation-contract`: 플랫폼 공통 inbound artifact 좌표, adapter capability, 참여 policy·decision, writing permit에 묶인 outbound와 hash-only delivery receipt의 canonical 계약
- `@lervo/interaction`: mention·relevance·signal·cooldown·rate·automation depth를 구분하는 능동 참여와 responder·writing 검증·delivery port를 연결하는 플랫폼 중립 runtime
- `@lervo/conversation-responder`: message artifact를 확인하고 역할별 E2/E3 공통 맥락을 실제 Codex·Claude 읽기 전용 session에 주입한 뒤, 재검증 가능한 `chat` writing 증거가 있는 reply만 반환하는 managed bridge
- `@lervo/conversation-control`: 명시적 command만 해석하고 대화 participant를 Hub principal에 결속한 뒤, writing 검증된 상태·승인 검토 응답을 만드는 플랫폼 중립 responder. 채팅에서 approval 원본을 만들지 않음
- `@lervo/interaction-sqlite`: 재시작 가능한 inbox·decision·outbox lease와 되돌릴 수 없는 완료·전달 상태를 보존하는 append-only SQLite adapter. 대화 본문과 외부 식별자 원문은 저장하지 않음
- `@lervo/adapter-native-chat`: 자체 채팅 서비스의 inbound mapping과 delivery port를 공통 conversation 계약에 연결하는 transport 독립 adapter
- `@lervo/conversation-platform`: 외부 식별자 mapping, CAS 본문 저장·복원, descriptor와 delivery receipt를 Slack·Discord가 공유하는 플랫폼 경계
- `@lervo/conversation-platform-sqlite`: 외부 주소·participant·thread의 가역 mapping, inbound/outbound correlation과 전송 결과 재생을 interaction DB 밖에 보존하는 SQLite adapter
- `@lervo/adapter-slack`: raw body HMAC·5분 시각·app/team scope를 확인하는 Events API ingress와 OAuth delivery port를 공통 conversation 계약에 연결하는 adapter
- `@lervo/adapter-discord`: 인증된 Gateway session의 `MESSAGE_CREATE`와 bot-token·멱등 delivery port를 공통 conversation 계약에 연결하는 adapter
- `@lervo/conversation-app`: CAS, durable platform 상태, Slack OAuth와 Discord bot-token transport를 배포 설정으로 조합하는 application entrypoint. Discord Gateway driver는 인증 port로 주입
- `@lervo/skills`: 프로젝트·사용자 스킬 패키지의 안전한 discovery와 전체 내용 hash, 보수적 호환성 판정, 결정적 우선순위와 원자적 `skills.lock` 기록
- `@lervo/event-contract`: 공급자와 저장 구현에 독립적인 payload 정리, 실행 완료·프로젝트 검증·숙의·지식 수명주기 event의 allowlist 후 schema·artifact 좌표 검증, canonical JSON과 event hash 규칙
- `@lervo/storage-contract`: event transaction, outbox와 artifact 저장소의 공통 interface
- `@lervo/sync-contract`: 전체 project manifest에 결속된 Hub 등록, allowlist event의 연속 batch, 역순 수락·중복 제거와 연속 cursor, durable ack 후보를 계산하는 저장·transport 독립 계약
- `@lervo/sync`: project 등록을 먼저 확인하고 현재 worker의 local outbox lease만 연속 batch로 보내는 Node runtime. 인증된 destination·peer와 durable ack 전체가 맞을 때 batch 단위로 local ack하고, 응답 유실·인증 실패·잘못된 ack는 안전한 code와 시각으로 재예약
- `@lervo/hub-sync`: commit 뒤 resolve하는 registration·event batch와 원격 command enqueue·lease·acknowledgement application port. 전체 state와 저장 transaction callback은 공개하지 않음
- `@lervo/hub-sync-sqlite`: destination·project별 registration, append-only event inbox·연속 cursor, 원격 command queue와 정책 snapshot·승인·철회 원본을 durable transaction으로 저장하는 adapter. 정책 원본은 별도 repository에서 command 원본 관계와 연속 snapshot chain을 감사하며 명시적 관계 인덱스는 event에서 재구축함
- `@lervo/hub-trace`: 기본 50·최대 100개의 cursor page로 project, run, event timeline과 focus 인접 관계를 읽는 파생 query 경계. Cursor 이하 `continuous`와 gap 뒤 `buffered` event를 구분하며 project 목록에는 event payload를 포함하지 않음
- `@lervo/hub-control`: durable command와 현재 signed policy 원본에서 민감정보 없는 승인 검토 view와 principal·command·만료 시각에 결속된 HMAC review grant를 만드는 경계
- `@lervo/hub`: bearer credential을 `trace.read`, `policy.read`, `policy.write`, `command.read`, `approval.write`와 project scope에 결속하는 HTTP adapter. Bounded trace·명시적 관계 그래프와 `/trace`, 재인증 `/control` web view에 더해 Hub 시각으로 정책 원본을 작성하고 순차 bundle을 제공하며, 고정 오류·no-store·요청/응답 byte 한도와 Hub identity header를 적용
- `@lervo/remote-command-contract`: 원문 대신 bounded artifact 좌표를 가진 `managed_run` command, canonical command ID/hash, Ed25519 서명 envelope와 terminal execution receipt를 정의하는 transport·실행 중립 계약
- `@lervo/remote-command`: 신뢰 key의 project scope, 서명, receiver identity, 짧은 유효 기간, nonce/idempotency replay, 로컬 정책과 payload hash를 실행 전에 확인하는 Node 수신 경계. 인증된 Hub transport port에서 lease를 pull하고 terminal acknowledgement를 보내는 reconnect worker 포함
- `@lervo/remote-command-sqlite`: project ID·identity hash에 고정된 Node replay 좌표와 terminal receipt를 보존하는 bounded SQLite adapter. Raw request와 command envelope은 저장하지 않음
- `@lervo/policy-contract`: project-bound 정책 snapshot, command·capability·snapshot에 결속된 승인과 별도 철회 원본의 canonical ID/hash 및 목적별 Ed25519 서명 계약
- `@lervo/hub-policy`: 현재 Hub head와 durable remote command를 사용해 snapshot·승인·철회 서명 원본을 만드는 저장·HTTP 중립 application 경계. 승인자 principal 원문 대신 project-scoped subject hash를 사용
- `@lervo/policy`: 인증된 Hub transport에서 bounded 정책 bundle을 검증하는 sync 경계, HTTPS 기본·Hub identity 확인을 강제하는 Node HTTP transport와 로컬·Hub 중 더 제한적인 결정을 적용하는 원격 command 정책 평가기
- `@lervo/policy-sqlite`: 연속 정책 snapshot과 승인·철회 서명 원본을 project별 append-only SQLite에 보존하고 command별 bounded 조회를 제공하는 Node adapter
- `@lervo/core`: E0~E4 assurance, 필수 E3 쓰기 게이트, 역할 간 shared context 접근·handoff 판정, 한국어 writing 검사와 공개 게이트, 실패 처분
- `@lervo/roles`: researcher·marketer·designer RoleProfile, 역할별 평가 묶음과 결과 무결성, CAS 원문 공개 판정 및 기존 숙의 계약에 결속된 고위험 교차 검토 workflow
- `@lervo/context`: `AGENTS.md` 계층·path·Role·handoff 기반 E1 선택, 안전한 전체 파일 읽기, E2 무결성 검증과 snapshot 무효화 판정
- `@lervo/context-delivery`: 검증된 E2와 schema-valid writing policy binding을 inline/CAS envelope로 조립하고 공통 adapter receipt 판정 뒤에만 E3를 만드는 공급자 중립 경계
- `@lervo/orchestrator`: E1/E2/E3와 1회용 파일 쓰기 permit를 provider 요청에 연결하고, 실제 변경 hash·snapshot·provider 결과·프로젝트 검증 결과 artifact를 함께 검증하는 fail-closed 상태 머신
- `@lervo/project`: 관리 경로, project 설정, 분할 document manifest/기존 registry 호환 loader와 원자적인 초기화 계획·적용
- `@lervo/documents`: 제한된 root의 안전한 read-only scan, Markdown/MDX·기존 Lervo registry adapter, CommonMark 기반 managed block byte 경계 판정과 쓰기 권한 없는 byte 보존 patch candidate, 문서별 migration candidate artifact와 source hash 기반 dry-run plan, 검토된 manifest의 metadata-only sidecar 적용, 기존 단일 registry의 항목별 보존 artifact와 승인 기반 원자적 structural migration, revision snapshot·검토 주기·연결 경로·managed input hash의 증거 기반 stale 판정.
- `@lervo/verification-contract`: suite/result canonical hash와 ID, 실행·CAS에 독립적인 suite/result 의미 검증
- `@lervo/verification`: 분할 project suite loader, shell 없는 순차 명령 실행, timeout·취소·output 한도, 명령별 stdout/stderr CAS와 repository snapshot에 결속된 결과 artifact
- `@lervo/writing-contract`: writing policy/evaluation/permit의 실행·CAS에 독립적인 canonical hash와 ID
- `@lervo/writing`: provider 결과 artifact의 결정적 검사, 분리된 의미 평가 port, CAS evaluation과 policy·evaluation·content·surface에 결속된 공개 permit. Permit 재검증을 통과한 원문만 반환하는 공개 경계
- `@lervo/deliberation`: 역할·provider 정책, 구조화된 proposal/objection/revision/verification/decision 이력, 실제 verification 근거와 명시적 종료 결과를 검증하는 provider 중립 경계
- `@lervo/project-storage`: 검증된 project 설정과 공통 경로로 SQLite event/outbox와 CAS를 함께 여는 실행 진입점
- `@lervo/event-store-sqlite`: project별 WAL event store, 원자적 outbox, versioned migration, append-only hash chain과 재시작 무결성 검사
- `@lervo/cas`: SHA-256 주소를 사용하는 로컬 원문·artifact 저장소
- `@lervo/adapter-contract`: Codex와 Claude가 같은 역할·writing 정책·turn 수락·session 유효 기능·managed write 요청/결정/완료 계약을 따르도록 강제하는 provider adapter interface와 contract suite. Shell 없이 제한된 version 응답만 확인하는 공통 runtime probe도 제공
- `@lervo/adapter-codex`: Codex app-server thread/turn과 controlled context를 관리하고 file-change 승인을 Lervo의 1회용 permit에 연결하는 adapter. PATH 또는 구성된 실행 파일 탐색을 소유
- `@lervo/adapter-claude`: Claude Agent SDK context replay를 검증하고 Write/Edit hook을 Lervo의 1회용 permit에 연결하는 adapter. 운영체제별 SDK bundled 실행 파일 탐색을 소유
- `@lervo/deliberation-runtime`: 역할별 managed run의 E2/E3·event 원본, writing permit, shared-context handoff와 구조화 artifact 기록을 연결하는 공급자 중립 숙의 runtime
- `@lervo/knowledge`: converged 결과의 claim별 CAS candidate, 사람 review 승인 원본, 현재 revision·path hash에 묶인 verified 원본과 review interval·path 변경 기반 stale 판정을 분리하는 지식 수명주기 경계
- `@lervo/knowledge-graph`: allowlist event의 명시적 ID·경로만 provider·저장소와 무관하게 안정된 node·relation·evidence로 투영하는 재생성 가능한 파생 경계
- `@lervo/search`: 등록 원본의 content hash에 결속된 재생성 가능한 `lexical-v1` 색인·순위, query 원문 없는 시도·bounded 추천 묶음, 명시적 품질 평가와 준비된 표본의 후보 비교·검토·정책 기반 선택 전이·rollout 검토·조치·상태 조회와 사전 점검 계약을 제공하는 공급자 중립 경계
- `@lervo/search-adapter-bm25f`: 공용 corpus·응답 계약을 따르는 결정적 field 가중치·길이 정규화·포화·정수 희귀도 기반 `bm25f-v1` 평가 후보
- `@lervo/search-local`: 등록 문서를 bounded하게 읽고 검색 attempt·assessment·평가 실행·후보 비교·검토·엔진 선택 전이·rollout 정책·검토·조치를 한 파일에 누적하지 않는 project-local immutable 원본으로 보존하며 조치 상태 조회와 쓰기 없는 사전 점검을 조합하는 adapter
- `@lervo/diagnostics`: append-only event의 run별 trace와 candidate·review·verified·stale CAS 및 근거 연결을 읽기 전용으로 점검하고, 실제 검사 범위와 자동 실행 없는 복구 안내를 포함한 항목별 결과와 저장소 독립 trace capability report를 조합하며 버전·구조·필드 간 의미를 확인하는 로컬 진단 경계
- `@lervo/cli`: 안전한 `lervo init`과 project storage·context·provider adapter·명시적으로 고른 verification suite를 연결하는 한 파일 `lervo run` 명령 진입점. 지식·문서·스킬·provider·검색을 필요한 의존성만 열어 따로 진단하고 문제별 다음 확인을 볼 수 있는 `doctor`, 로컬 `search`·명시적 `assess`·품질 `report` 포함
- `pnpm check`: 타입, schema fixture, contract test, 패키지 빌드, 문서 수명주기 기본 검사

M5의 project verification artifact, writing 공개 gate, 구조화 숙의 runtime과 지식 수명주기 경계를 구현했습니다. M6에서는 project manifest에 결속된 Hub 등록·event batch 계약, Node outbox worker, 증분 Hub SQLite 저장소와 bounded project/run trace query를 연결했습니다. 인증된 HTTP API와 이 API만 사용하는 `/trace` web view도 실제 Node server로 검증했습니다. Ed25519 원격 command는 durable Hub queue, project-bound Node replay SQLite와 reconnect worker까지 연결했습니다. Hub·Node 재시작과 acknowledgement 유실 뒤에도 저장된 receipt로 복구하며 executor를 다시 호출하지 않습니다. 이 reconnect 검증은 인증된 transport port를 사용한 로컬 fixture이고 실제 command HTTP/TLS endpoint는 아닙니다.

정책 수직 슬라이스는 순번·이전 ID가 있는 서명 snapshot과 command-bound 승인·철회를 Hub에서 작성해 append-only SQLite에 보존합니다. 인증·permission·project scope를 통과한 HTTP 요청만 원본을 만들며 발급·승인·철회 시각은 클라이언트가 아니라 Hub가 정합니다. Node는 HTTPS를 기본으로 하는 transport에서 Hub identity와 응답 좌표를 확인하고 다음 snapshot 또는 현재 snapshot의 늦게 추가된 승인·철회를 동기화합니다. 원격 command는 로컬과 Hub 중 더 제한적인 판정을 사용하고, 승인된 `require_approval` 실행도 provider 시작 전과 실제 파일 쓰기 직전에 다시 검증합니다. 이 기능은 Hub가 없어도 완료되는 기존 로컬 실행 경로를 바꾸지 않습니다.

## 핵심 명제

Lervo는 모델 자체가 아니라 **에이전트가 일하는 환경과 계약**을 제품화합니다. 그래프와 RAG는 유용하지만 원본 지식이나 실행 증거를 대신하지 않습니다. 원본은 버전 관리되는 문서, 저장소 상태, 스킬 정의, 검증 결과와 변경 불가능한 실행 이벤트이며 검색 인덱스는 언제든 재생성할 수 있어야 합니다.

## 예정된 사용 모습

```sh
pnpm build
pnpm lervo init --dry-run
pnpm lervo init
pnpm lervo run --provider codex --path src/example.ts --verification project.default "DD 기능 개발"
lervo trace last
lervo trace last --full --json
lervo trace --capabilities
lervo doctor
lervo doctor --scope knowledge
lervo doctor --scope documents
lervo doctor --scope skills
lervo doctor --scope providers
lervo doctor --scope search
lervo trace last --page-size 50 --json
lervo trace last --event-type run.failed --event-type verification.completed --json
lervo search "문서 수명주기"
lervo search report
lervo search case <attempt-id> --query "검토한 검색 문장"
lervo search evaluate
lervo search bundle create backend-maintenance --role developer --task-type maintenance --minimum-cases 5 --case <case-id>
lervo search bundle report backend-maintenance
lervo search evaluate --bundle backend-maintenance
lervo search candidates
lervo search compare backend-maintenance --candidate bm25f-v1
lervo search review <comparison-id> --decision more-samples --reviewer reviewer_search
lervo search engine policy create --reviewer reviewer_search --operator operator_search --author operator_search --candidate bm25f-v1
lervo search engine activate <review-id> --policy <policy-id> --operator operator_search
lervo search engine refresh <review-id> --policy <policy-id> --operator operator_search
lervo search engine status
lervo search rollout policy create --reviewer reviewer_search --author reviewer_search --candidate bm25f-v1 --keep-min-assessments 10 --keep-max-failures 1 --rollback-min-assessments 5 --rollback-min-failures 2
lervo search rollout review <selection-transition-id> --decision more-assessments --reviewer reviewer_search --policy <policy-id>
lervo search rollout policy check <rollout-review-id> --policy <policy-id>
lervo search rollout status --limit 20
lervo search rollout action policy create --review-policy <policy-id> --action keep --operator operator_search --author operator_search
lervo search rollout action apply <rollout-review-id> --action keep --policy <action-policy-id> --operator operator_search
lervo search rollout action check <rollout-review-id> --action keep --policy <action-policy-id> --operator operator_search
lervo search rollout action policy create --review-policy <policy-id> --action rollback --engine-policy <engine-policy-id> --operator operator_search --author operator_search
lervo search rollout action apply <rollout-review-id> --action rollback --policy <action-policy-id> --operator operator_search
lervo search rollout action status --limit 20
lervo search engine rollback --policy <policy-id> --operator operator_search
```

`lervo trace --capabilities`는 저장소를 열지 않고 현재 기본·지원 mode, report version, page/full/cursor 상한과 deprecation code를 versioned JSON으로 반환합니다. 자동화는 help나 한국어 stderr 문장을 파싱하는 대신 이 report를 사용합니다.

`lervo init`, 한 파일 `lervo run`, run별 `lervo trace`, 로컬 증거용 `lervo doctor`와 등록 문서 대상 `lervo search`를 실행할 수 있습니다. 0.1.0의 인자 없는 trace는 최대 50개 event의 bounded page를 경고 없이 반환합니다. 전체 `TraceReport` v1에 의존하는 자동화는 `--full`을 명시해야 하며 자세한 변경 방법은 [migration 안내](./docs/migrations/0.1.0-trace-bounded-default.md)에 있습니다. 검색 query는 원문 없이 digest만 attempt에 남고 품질은 별도 `lervo search assess`를 실행한 경우에만 집계됩니다. 검토한 attempt는 `search case`로 케이스별 YAML에 승격하고 `search evaluate`로 현재 `lexical-v1`을 같은 입력에 반복 실행할 수 있습니다. 역할·작업 유형별 평가 묶음은 활성 케이스, 대체 관계와 최소 표본을 별도 `.bundle.yaml`에 두며 `bundle report`로 비교 가능한 표본인지 확인합니다. 표본이 부족한 묶음도 현재 엔진 평가 결과는 남길 수 있지만 비교 준비 완료나 임베딩 필요성으로 해석하지 않습니다. 케이스 YAML에는 검토한 검색 문장이 들어가므로 비밀정보가 없는지 커밋 전에 확인해야 하며, 묶음·실행 결과와 report에는 문장을 복제하지 않습니다. Managed run은 작업 문장을 bounded 검색어로 투영하고 등록 문서 결과를 최대 5개 추천하며, `top_ranked-v1`이 고른 최대 3개만 별도 선택 근거로 E1에 넣습니다. 실행 결과의 attempt ID로 품질을 나중에 평가할 수 있으며 자동 선택이나 실행 성공 자체는 수락 평가가 아닙니다. `lervo run`은 `.lervo/verifications/<suite-id>.yaml`에 있는 suite를 `--verification`으로 하나 이상 명시해야 합니다. 모든 필수 suite가 통과하지 않으면 `run.completed`를 기록하지 않습니다. Writing 검사는 별도 의미 평가기가 구성되지 않은 기본 실행에서 결과 원문을 숨깁니다. Doctor는 각 검사 범위를 `healthy`, `unhealthy`, `unknown`으로 나누며 모든 항목이 `healthy`일 때만 성공합니다. `knowledge`, `documents`, `skills`, `providers`, `search` 제한 범위는 필요한 저장소와 probe만 실제로 열고 출력과 JSON에 범위를 표시합니다. JSON에는 `schemaVersion: 1`이 있으며 reader는 미지원 버전과 손상된 v1을 구분하고 선택 필드 추가만 이전 consumer와 호환되는 변경으로 봅니다. 종료 코드 0은 선택한 범위 정상일 뿐 프로젝트 전체 정상을 뜻하지 않습니다. 검색은 엔진 선택, 세 종류의 정책, rollout 검토와 조치를 따로 검사하며 선행 원본을 확인할 수 없으면 뒤의 범위를 `unknown`으로 둡니다. 문제가 있으면 고정된 issue code에서 파생한 한국어 다음 확인 안내를 보여 주며, 오류 원문을 복사하거나 자동 수정·상태 변경을 실행하지 않습니다. Provider version 확인은 실행 파일 증거일 뿐 인증, 네트워크나 실제 provider session 성공을 뜻하지 않습니다. 구체적인 범위와 완료 조건은 `LERVO_V0_PLAN.md`에 정의합니다.

첫 평가 후보 `bm25f-v1`와 로컬 비교 명령을 사용할 수 있습니다. `search candidates`는 빌드에 명시적으로 포함된 allowlist와 각 adapter build ID만 보여 주며, `search compare`는 표본이 충분한 묶음에서만 같은 corpus와 순위 조건으로 현재 `lexical-v1`을 비교합니다. Module path나 임의 코드를 후보로 실행하지 않습니다. 비교 결과는 관측일 뿐 운영 검색 엔진을 바꾸거나 후보 채택·임베딩 필요성을 결정하지 않습니다.

`search review`는 비교 ID, 검토자와 `adopt`, `reject`, `more-samples` 중 하나를 명시적으로 받습니다. 현재 bundle·case·corpus와 두 실행을 비교 원본에 다시 맞추고, 비교에 기록된 것과 같은 adapter build로 후보를 같은 시각과 조건에서 재실행한 뒤에만 검토 파일을 따로 남깁니다. 채택 검토는 후보 승리가 있고 baseline 회귀가 없는 비교에서만 가능하지만, 이 상태도 운영 검색 활성화가 아닙니다.

`search report`는 전체 시도·평가·실패 집계와 함께 선택 전이별 관측을 보여 줍니다. 전이 없는 기본 lexical, 후보 선택과 rollback baseline을 분리하고 후보는 immutable review에서 adapter build ID를 다시 찾습니다. Attempt나 assessment에 build·receipt를 복제하지 않으며, 평가되지 않은 시도는 그대로 미평가로 남깁니다. 수락만 관측되거나 실패가 있어도 rollout·rollback과 임베딩 판단은 자동으로 만들지 않습니다.

`search rollout policy create`는 허용 검토자·후보와 후보 유지·롤백 권고의 평가 및 실패 수 기준을 정책별 YAML로 만듭니다. `search rollout review --policy`는 사람이 고른 판단이 그 정책을 충족할 때만 정책 ID와 당시 attempt·assessment snapshot에 결속된 새 검토를 남깁니다. 정책을 붙이지 않은 기존 방식은 계속 읽을 수 있지만 새 정책으로 소급 해석하지 않습니다. `rollback`은 권고일 뿐 실제 `engine rollback`을 실행하지 않고, 어떤 판단도 승인으로 사용하지 않습니다.

`search rollout policy check`는 저장된 검토 당시의 snapshot이 지정한 정책에 맞는지만 확인합니다. 이후 품질 입력이 추가됐는지는 `search rollout status`로 따로 확인해야 하며, 두 조회 모두 판단을 대신 선택하거나 검색 엔진을 바꾸지 않습니다.

`search rollout action policy create`는 검토 정책과 분리된 operator 범위를 `keep` 또는 `rollback` 한 조치에만 부여합니다. `action apply`는 명시한 검토가 현재 선택이고 품질 입력이 그대로인지 다시 확인합니다. `keep`은 선택을 바꾸지 않는 확인 원본만 남기고, `rollback`은 검토·조치 정책과 quality digest를 기존 엔진 rollback 전이에 함께 기록합니다. 근거가 달라지거나 누락되면 운영 검색을 fail-closed하며 검토 자체를 실행 권한으로 사용하지 않습니다.

`search rollout action status`는 keep 확인과 정책에 따라 실행한 rollback을 기본 20개·최대 50개 페이지로 함께 보여 줍니다. 검토 대상과 rollback 결과가 현재 선택인지 과거 선택인지 따로 표시하고, 조회 시점에 품질 입력이 달라졌는지도 확인합니다. 페이지 밖의 정책·검토·품질 증거라도 깨져 있으면 일부 목록을 정상처럼 보여 주지 않고 전체 조회를 실패시킵니다. 이 조회는 조치를 선택하거나 실행하지 않습니다.

`search rollout action check`는 명시한 검토·action policy·operator와 요청 조치가 현재 맞는지 쓰기 없이 설명합니다. 판단 종류, 정책 기준, operator 범위, 현재 선택과 품질 입력의 미충족 사유만 제한된 코드로 보여 줍니다. Rollback이 가능하다고 나온 경우에도 실제 게시 직전의 엔진·fallback 재현을 읽기 전용으로 확인할 뿐 승인이나 실행 예약을 만들지 않으며, `action apply`가 모든 조건을 다시 검사합니다.

`search rollout status`는 현재 선택과 rollout 검토를 기본 20개·최대 50개 페이지로 보여 줍니다. 검토 당시 입력을 다시 확인한 뒤 현재 attempt·assessment 입력 digest가 같은지 `변경 없음`과 `변경됨`으로 구분합니다. Rollback 뒤에는 검토를 과거 선택으로 표시하며, 최신 검토를 자동 선택하거나 승인·rollback으로 적용하지 않습니다.

`search engine policy create`는 허용 reviewer·operator·candidate와 최소 후보 승리를 정책별 YAML로 만듭니다. `engine activate`는 현재 비교·검토·후보 replay와 정책을 모두 다시 확인한 뒤 이전 선택과 rollback 좌표를 별도 immutable 전이로 기록합니다. 선택 뒤 문서가 달라지면 후보를 자동 신뢰하지 않습니다. 새 비교와 검토를 만든 다음 `engine refresh`로 같은 후보의 검증 원본을 새 전이에 연결해야 합니다. 이 갱신의 안전 fallback은 baseline이며, 실패하면 기존 fail-closed 상태를 유지합니다. `engine rollback`도 기존 원본을 수정하지 않고 전이에 명시된 fallback으로 돌아가는 새 전이를 만듭니다. 일반 검색과 managed context는 같은 검증 resolver로 현재 선택을 소비합니다. 선택 chain·정책·후보 등록·adapter build·현재 corpus와 replay 중 하나라도 맞지 않으면 lexical 결과로 조용히 대체하지 않고 실패합니다. 성공한 후보 검증은 원본에서 다시 만들 수 있는 receipt ID로 상태에 표시되며 별도 원본 파일로 쌓이지 않습니다. 이 receipt는 replay 검증 좌표일 뿐 검색 실행, 결과 사용이나 품질을 뜻하지 않습니다. 기존 v1 비교·검토·선택 파일과 선택 전이 ID가 없던 추천 event는 원본 ID·hash를 바꾸지 않고 계속 읽습니다. Evaluation baseline은 비교 기준인 `lexical-v1`을 유지합니다.

이전 실험 버전이 만든 `.roven` 경로는 자동으로 읽거나 `.lervo`와 함께 사용하지 않습니다. `lervo init`은 두 관리 경로가 공존하는 상태를 만들지 않도록 초기화를 차단합니다. 기존 상태를 옮기는 작업은 event hash chain과 CAS 주소를 보존하는 별도 명칭 migration으로 다룹니다.
