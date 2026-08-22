# Lervo

Lervo(레르보)는 저장소 안에서 독립적으로 동작하면서, 필요할 때 중앙에서 여러 프로젝트와 AI 에이전트를 관리할 수 있는 로컬 우선(local-first) 에이전트 운영 체계입니다.

현재 상태: 0.1.0, M0·M1·M2·M3·M4·M5·M6 완료, 사용자용 Codex·Claude 교차 숙의 CLI와 플랫폼 중립 대화 runtime·durable 숙의 시작/재개 queue·managed 실행과 원본 대조 연결·증거 결속 전문 역할·명시적 지식 그래프·검색 평가와 정책 기반 엔진 선택·버전이 있는 doctor·bounded trace 자동화 계약·명시적 제품 명칭 migration·최초 게시 완료 기록 점검 경계 완료 (2026-08-22)

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
- [원본 증거를 보존하는 제품 명칭 migration ADR](./docs/adr/0144-explicit-project-identity-migration.md)
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
- [설치된 CLI 산출물 smoke 경계 ADR](./docs/adr/0085-installed-cli-smoke-boundary.md)
- [Canonical CLI release artifact manifest ADR](./docs/adr/0086-canonical-cli-release-artifact-manifest.md)
- [단일 bundle CLI 배포 단위 ADR](./docs/adr/0087-single-bundle-cli-deployment-unit.md)
- [Packed CLI 소비자 설치 계약 ADR](./docs/adr/0088-packed-cli-consumer-installation.md)
- [CLI 다중 플랫폼 배포 matrix 계약 ADR](./docs/adr/0089-cli-multi-platform-release-matrix.md)
- [CLI 패키지 사용 안내 계약 ADR](./docs/adr/0090-cli-package-usage-guide.md)
- [CLI registry 게시 사전검증 계약 ADR](./docs/adr/0091-cli-registry-publish-preflight.md)
- [CLI release SBOM 계약 ADR](./docs/adr/0092-cli-release-sbom.md)
- [CLI release 출처 증명 경계 ADR](./docs/adr/0093-cli-release-attestation-boundary.md)
- [CLI release attestation 소비자 검증 ADR](./docs/adr/0094-cli-release-attestation-consumer-verification.md)
- [CLI release 게시 적격성과 권한 경계 ADR](./docs/adr/0095-cli-release-publication-authorization.md)
- [CLI Trusted Publisher 준비 상태 ADR](./docs/adr/0096-cli-trusted-publisher-readiness.md)
- [CLI 최초 공개 게시 bootstrap ADR](./docs/adr/0097-cli-first-publication-bootstrap.md)
- [CLI 최초 공개 게시 실행·전환 영수증 ADR](./docs/adr/0098-cli-first-publication-execution-transition-receipts.md)
- [CLI 최초 공개 게시 durable 저장·대화형 adapter ADR](./docs/adr/0099-cli-first-publication-durable-interactive-adapter.md)
- [CLI 최초 공개 게시 읽기 전용 사전 점검 보고서 ADR](./docs/adr/0100-cli-first-publication-read-only-preflight-report.md)
- [CLI 최초 공개 게시 사전 점검 명령 ADR](./docs/adr/0101-cli-first-publication-preflight-command.md)
- [CLI 최초 공개 게시 실행 계획과 arming 비활성 경계 ADR](./docs/adr/0102-cli-first-publication-execution-plan.md)
- [CLI 최초 공개 게시 실행 계획 조회 명령 ADR](./docs/adr/0103-cli-first-publication-execution-plan-command.md)
- [CLI 최초 공개 게시 활성화 차단 보고서 ADR](./docs/adr/0104-cli-first-publication-activation-blocker-report.md)
- [CLI 최초 공개 게시 metadata 결정과 비쓰기 변경 preview ADR](./docs/adr/0105-cli-first-publication-metadata-preview.md)
- [CLI 최초 공개 게시 package metadata patch 후보 ADR](./docs/adr/0106-cli-first-publication-package-metadata-candidate.md)
- [CLI 최초 공개 게시 package metadata 적용 허가 ADR](./docs/adr/0107-cli-first-publication-package-metadata-apply-permit.md)
- [CLI 최초 공개 게시 package metadata 적용 transaction ADR](./docs/adr/0108-cli-first-publication-package-metadata-apply-transaction.md)
- [CLI 최초 공개 게시 package metadata 사후 검증 ADR](./docs/adr/0109-cli-first-publication-package-metadata-post-apply-verification.md)
- [CLI 최초 공개 게시 외부 요구사항 증거 보고서 ADR](./docs/adr/0110-cli-first-publication-external-requirement-evidence-report.md)
- [CLI 최초 공개 게시 bootstrap v2 증거 결속 ADR](./docs/adr/0111-cli-first-publication-bootstrap-v2-evidence-integration.md)
- [CLI 최초 공개 게시 일회성 arming authorization ADR](./docs/adr/0112-cli-first-publication-arming-authorization.md)
- [CLI 최초 공개 게시 불명확한 결과 대조 ADR](./docs/adr/0113-cli-first-publication-unknown-outcome-reconciliation.md)
- [CLI 최초 공개 게시 reconciliation resolution ADR](./docs/adr/0114-cli-first-publication-reconciliation-resolution.md)
- [CLI 최초 공개 게시 transition evidence union ADR](./docs/adr/0115-cli-first-publication-transition-evidence-union.md)
- [CLI 최초 공개 게시 transition 완료 명령 ADR](./docs/adr/0116-cli-first-publication-transition-completion-command.md)
- [CLI 최초 공개 게시 stage-only workflow 후보 ADR](./docs/adr/0117-cli-first-publication-stage-only-workflow-candidate.md)
- [CLI stage 게시 명령 경계 ADR](./docs/adr/0118-cli-stage-publication-command-boundary.md)
- [CLI stage-only workflow 활성화 허가와 transaction ADR](./docs/adr/0119-cli-stage-only-workflow-activation-permit-transaction.md)
- [CLI stage-only workflow 사후 검증 ADR](./docs/adr/0120-cli-stage-only-workflow-post-apply-verification.md)
- [CLI stage-only workflow 원격 배포 증거 ADR](./docs/adr/0121-cli-stage-only-workflow-remote-deployment-evidence.md)
- [CLI stage-only workflow ref 도달 가능성 증거 ADR](./docs/adr/0122-cli-stage-only-workflow-ref-reachability-evidence.md)
- [CLI stage-only workflow 실행 증거 ADR](./docs/adr/0123-cli-stage-only-workflow-execution-evidence.md)
- [CLI npm stage 결과 artifact 증거 ADR](./docs/adr/0124-cli-npm-stage-result-artifact-evidence.md)
- [CLI npm staged package 검토 증거 ADR](./docs/adr/0125-cli-npm-staged-package-review-evidence.md)
- [CLI npm stage 승인 권한 ADR](./docs/adr/0126-cli-npm-stage-approval-authorization.md)
- [CLI npm stage 승인 durable 기록 ADR](./docs/adr/0127-cli-npm-stage-approval-durable-records.md)
- [CLI interactive npm stage 승인 실행 ADR](./docs/adr/0128-cli-interactive-npm-stage-approval-execution.md)
- [CLI npm stage 승인 결과 대조 증거 ADR](./docs/adr/0129-cli-npm-stage-approval-reconciliation-evidence.md)
- [CLI stage 승인 transition 통합 ADR](./docs/adr/0130-cli-stage-approval-transition-integration.md)
- [CLI stage 증거 bundle manifest ADR](./docs/adr/0131-cli-stage-evidence-bundle-manifest.md)
- [CLI 최초 게시 완료 기록 점검 ADR](./docs/adr/0132-cli-first-publication-completion-inspection.md)
- [사용자용 Codex·Claude 교차 숙의 CLI ADR](./docs/adr/0133-cli-two-provider-deliberation.md)
- [분할 정책 기반 다중 역할 숙의 CLI ADR](./docs/adr/0134-sharded-multi-role-deliberation-policy.md)
- [승인된 숙의 경계에서만 재개하는 ADR](./docs/adr/0135-approved-deliberation-resume-boundary.md)
- [플랫폼 중립 대화 숙의 제어 ADR](./docs/adr/0136-platform-neutral-conversation-deliberation-control.md)
- [숙의 실행 lease와 ID 기반 진단 ADR](./docs/adr/0137-deliberation-liveness-and-diagnostics.md)
- [대화 숙의 durable queue와 fail-closed worker ADR](./docs/adr/0138-durable-conversation-deliberation-queue.md)
- [대화 queue와 managed 숙의 실행 결속 ADR](./docs/adr/0139-conversation-queue-managed-deliberation-binding.md)
- [대화 숙의 queue와 프로젝트 원본 대조 ADR](./docs/adr/0140-authoritative-conversation-deliberation-reconciliation.md)
- [명시적 대화 숙의 재개와 별도 durable queue ADR](./docs/adr/0141-explicit-durable-conversation-deliberation-resume.md)
- [숙의 진단 snapshot 고정·bounded event 조회 ADR](./docs/adr/0142-snapshot-bounded-deliberation-event-scan.md)
- [실행 증거와 대화 조립 경계 강화 ADR](./docs/adr/0143-execution-and-conversation-boundary-hardening.md)
- [Node 범위에 결속된 원격 command HTTP 전달 ADR](./docs/adr/0145-authenticated-remote-command-http-delivery.md)
- [Hub가 소유하는 원격 command 작성과 요청 artifact 전달 ADR](./docs/adr/0146-hub-command-authoring-and-artifact-delivery.md)
- [경합과 중단을 견디는 command artifact 수명주기 ADR](./docs/adr/0147-bounded-command-artifact-lifecycle.md)
- [Durable cursor와 Hub에 결속된 command artifact cleanup runtime ADR](./docs/adr/0148-durable-command-artifact-cleanup-runtime.md)
- [Owner-only 구성과 loopback 실행을 강제하는 Hub runtime ADR](./docs/adr/0149-owner-only-loopback-hub-runtime.md)
- [프로젝트 범위에 결속된 Hub sync HTTP ADR](./docs/adr/0150-authenticated-project-scoped-hub-sync-http.md)
- [0.1.0 trace migration 안내](./docs/migrations/0.1.0-trace-bounded-default.md)

## 현재 구현

- `@lervo/schemas`: project, event, Hub sync, context evidence, shared context/handoff, provider와 conversation adapter, 역할, skill, document, verification, writing, 숙의·지식 수명주기와 doctor·trace·trace capability report JSON Schema 및 파생 TypeScript 타입
- `@lervo/conversation-contract`: 플랫폼 공통 inbound artifact 좌표, adapter capability, 참여 policy·decision, writing permit에 묶인 outbound와 hash-only delivery receipt의 canonical 계약
- `@lervo/conversation-deliberation-contract`: 대화 숙의 시작·재개 job, lease, 요약과 원본 대조 port를 control과 저장 adapter가 함께 사용하는 하위 계약
- `@lervo/execution-contract`: managed provider 결과와 E2/E3·완료 event 증거 검증을 orchestrator·숙의·대화가 함께 사용하는 공급자 중립 계약
- `@lervo/interaction`: mention·relevance·signal·cooldown·rate·automation depth를 구분하는 능동 참여와 responder·writing 검증·delivery port를 연결하는 플랫폼 중립 runtime
- `@lervo/conversation-responder`: message artifact를 확인하고 역할별 E2/E3 공통 맥락을 실제 Codex·Claude 읽기 전용 session에 주입한 뒤, 재검증 가능한 `chat` writing 증거가 있는 reply만 반환하는 managed bridge
- `@lervo/conversation-control`: 명시적 command만 해석하고 대화 participant를 principal과 권한에 결속한 뒤, writing 검증된 Hub 상태·승인 검토와 숙의 시작·재개·상태 응답을 만드는 플랫폼 중립 responder. 채팅에서 approval 원본을 만들거나 자연어를 실행 명령으로 추정하지 않음
- `@lervo/conversation-deliberation-sqlite`: 대화 숙의 시작과 명시적 재개를 각각 source event에 멱등 결속하고 queue·worker lease·종료·불확실 상태와 원본 대조 요약을 분리된 owner-only SQLite에 보존하는 adapter
- `@lervo/interaction-sqlite`: 재시작 가능한 inbox·decision·outbox lease와 되돌릴 수 없는 완료·전달 상태를 보존하는 append-only SQLite adapter. 대화 본문과 외부 식별자 원문은 저장하지 않음
- `@lervo/adapter-native-chat`: 자체 채팅 서비스의 inbound mapping과 delivery port를 공통 conversation 계약에 연결하는 transport 독립 adapter
- `@lervo/conversation-platform`: 외부 식별자 mapping, CAS 본문 저장·복원, descriptor와 delivery receipt를 검증된 범용 platform kind가 공유하는 플랫폼 경계
- `@lervo/conversation-platform-sqlite`: 외부 주소·participant·thread의 가역 mapping, inbound/outbound correlation과 전송 결과 재생을 interaction DB 밖에 보존하며 v1 Slack·Discord 행을 범용 kind의 v2로 이관하는 SQLite adapter
- `@lervo/adapter-slack`: raw body HMAC·5분 시각·app/team scope를 확인하는 Events API ingress와 OAuth delivery port를 공통 conversation 계약에 연결하는 adapter
- `@lervo/adapter-discord`: 인증된 Gateway session의 `MESSAGE_CREATE`와 bot-token·멱등 delivery port를 공통 conversation 계약에 연결하는 adapter
- `@lervo/conversation-app`: CAS, durable platform 상태와 숙의 시작·재개 queue를 범용 integration registry로 조합하는 application entrypoint. Slack OAuth·Discord bot-token은 내장 factory이고 native·외부 adapter, 숙의 실행기·원본 대조기와 Gateway driver는 provider-neutral port로 주입
- `@lervo/skills`: 프로젝트·사용자 스킬 패키지의 안전한 discovery와 전체 내용 hash, 보수적 호환성 판정, 결정적 우선순위와 원자적 `skills.lock` 기록
- `@lervo/event-contract`: 공급자와 저장 구현에 독립적인 payload 정리, 실행 완료·프로젝트 검증·숙의·지식 수명주기 event의 allowlist 후 schema·artifact 좌표 검증, canonical JSON과 event hash 규칙
- `@lervo/storage-contract`: event transaction, outbox와 artifact 저장소의 공통 interface 및 snapshot visitor·명시적 상한 run event reader
- `@lervo/sync-contract`: 전체 project manifest에 결속된 Hub 등록, allowlist event의 연속 batch, 역순 수락·중복 제거와 연속 cursor, durable ack 후보를 계산하는 저장·transport 독립 계약
- `@lervo/sync`: project 등록을 먼저 확인하고 현재 worker의 local outbox lease만 연속 batch로 보내는 Node runtime. HTTPS 기본, Hub identity 확인, 요청·응답 상한과 timeout을 강제하는 실제 HTTP transport를 포함하며 durable ack 전체가 맞을 때만 local ack함
- `@lervo/hub-sync`: commit 뒤 resolve하는 registration·event batch와 원격 command enqueue·lease·acknowledgement application port. 전체 state와 저장 transaction callback은 공개하지 않음
- `@lervo/hub-command`: 플랫폼 중립 command 작성, Hub 소유 시각·nonce·서명, durable idempotency, 현재 Node lease의 raw request 조회와 bounded artifact cleanup cycle·직렬 scheduler loop를 정의하는 application 경계
- `@lervo/hub-sync-sqlite`: destination·project별 registration, append-only event inbox·연속 cursor, 원격 command authorship·queue·artifact retention/purge와 정책 snapshot·승인·철회 원본을 durable transaction으로 저장하는 adapter. Raw request는 별도 CAS에만 두고 artifact claim, 100개 delivery purge batch와 singleton scheduler lease·cursor로 작성·정리·다중 Hub 경합을 닫음
- `@lervo/hub-trace`: 기본 50·최대 100개의 cursor page로 project, run, event timeline과 focus 인접 관계를 읽는 파생 query 경계. Cursor 이하 `continuous`와 gap 뒤 `buffered` event를 구분하며 project 목록에는 event payload를 포함하지 않음
- `@lervo/hub-control`: durable command와 현재 signed policy 원본에서 민감정보 없는 승인 검토 view와 principal·command·만료 시각에 결속된 HMAC review grant를 만드는 경계
- `@lervo/hub`: bearer credential을 `trace.read`, `sync.write`, `policy.read`, `policy.write`, `command.read`, `command.write`, `command.delivery`, `approval.write`와 project scope에 결속하는 HTTP adapter. 등록·event batch 수신, bounded trace·명시적 관계 그래프와 `/trace`, 재인증 `/control` web view, 정책 작성·동기화, command submission과 현재 lease에 묶인 artifact 전달을 제공함
- `@lervo/hub-runtime`: owner-only JSON·Ed25519 key·HMAC secret을 읽어 Hub SQLite, command CAS, 인증·서명·sync를 포함한 HTTP handler와 cleanup을 조합하는 `lervo-hub` 실행 앱. 평문 server는 loopback만 허용하고 signal에서 server, cleanup, store 순서로 종료함
- `@lervo/remote-command-contract`: 원문 대신 bounded artifact 좌표를 가진 `managed_run` command, canonical command ID/hash, Ed25519 서명 envelope와 terminal execution receipt를 정의하는 transport·실행 중립 계약
- `@lervo/remote-command`: 신뢰 key의 project scope, 서명, receiver identity, 짧은 유효 기간, nonce/idempotency replay, 로컬 정책과 payload hash를 실행 전에 확인하는 Node 수신 경계. HTTPS·Hub identity·bounded response를 강제하는 lease·acknowledgement transport와 artifact loader, reconnect worker와 직렬 polling lifecycle 포함
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
- `@lervo/identity-migration`: 이전 관리 경로의 읽기 전용 계획, event·CAS 검증, 명시적 적용과 원본 문서 metadata archive
- `@lervo/event-store-sqlite`: project별 WAL event store, 원자적 outbox, versioned migration, append-only hash chain과 재시작 무결성 검사
- `@lervo/cas`: SHA-256 주소를 사용하는 로컬 원문·artifact 저장소. 민감한 전용 저장소에는 directory `0700`, object `0600`을 강제하는 owner-only mode를 제공
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
- `@lervo/cli`: `lervo --version`, 안전한 `lervo init`, 한 파일 managed 실행인 `lervo run`, 서로 다른 Codex·Claude 역할을 연결하고 승인 경계에서 안전하게 재개하는 `lervo deliberate` 명령 진입점. 내부 대화 adapter는 queue가 할당한 숙의 ID와 기대 project를 기존 managed 실행기에 결속하지만 CLI 사용자가 ID를 지정할 수는 없음. 숙의는 역할별 독립 session, 공개된 shared context의 역할별 E2/E3, writing 검사와 실제 project verification을 거쳐야 수렴함. 개발 시 workspace 경계를 유지하고 배포 시 내부 package와 Ajv·YAML을 `dist/bin.js` 하나로 묶음
- `pnpm check`: 타입, schema fixture, contract test, 패키지 빌드, canonical CLI release manifest·SBOM과 로컬 unsigned statement, 빌드된 CLI·Hub runtime smoke, 임시 production deploy smoke, 실제 tarball 소비자 설치 smoke, 문서 수명주기 기본 검사

M5의 project verification artifact, writing 공개 gate, 구조화 숙의 runtime과 지식 수명주기 경계를 구현했습니다. M6에서는 project manifest에 결속된 Hub 등록·event batch 계약, Node outbox worker, 증분 Hub SQLite 저장소와 bounded project/run trace query를 연결했습니다. Node의 인증된 HTTP transport와 Hub 수신 API는 실제 양쪽 SQLite 사이에서 동작하며, Hub commit 뒤 응답만 유실돼도 같은 batch 재전송과 duplicate acknowledgement로 복구합니다. `/trace` web view도 같은 Hub server의 인증 API만 사용합니다. Ed25519 원격 command는 Hub 작성·서명, owner-only request CAS, durable queue, 인증된 HTTP lease·artifact·acknowledgement, project-bound Node replay SQLite와 reconnect worker까지 연결했습니다. Command CAS에는 30일 기본 retention, bounded expired/orphan cleanup, singleton scheduler lease와 durable cursor가 있습니다. `lervo-hub --config <config.json>`은 이 기능을 loopback server로 조합하고 signal에서 안전하게 종료합니다. 외부 접근을 위한 production TLS 종료와 설치된 Node daemon은 아직 구현하지 않았습니다.

`lervo deliberate --proposer codex --reviewer claude --verification <suite-id> <주제>`는 서로 다른 두 공급자를 제안·결정 역할과 독립 검토·검증 역할에 고정합니다. 검토자는 `판정: 승인` 또는 `판정: 수정 필요`를 명시해야 하며 자유로운 동의 표현은 승인으로 해석하지 않습니다. 최대 두 회차 안에 승인되지 않거나 필수 검증이 통과하지 않으면 `no_consensus`로 끝나고 결정이나 검증된 지식으로 올리지 않습니다. 사람용 출력에는 내부 ID·digest·경로를 숨기며, `--json`은 자동화용 증거 좌표를 반환합니다. 실행 문서는 `.lervo/state/deliberations/<숙의 ID>/` 아래에서 writing 정책·산출물·의미 평가 요청별 파일로 분리합니다.

`lervo deliberate --policy deliberation_product-review <주제>`는 `.lervo/deliberations/deliberation_product-review.yaml`을 읽습니다. 정책은 제안·결정 역할 하나, 한 명 이상의 독립 검토 역할과 별도 검증 역할을 최대 16개 참여자로 구성하고 각 역할의 Codex·Claude provider, 이름, 관점, 최대 5회와 필수 suite를 고정합니다. 두 provider가 모두 참여해야 하며 모든 검토자가 같은 최신 제안을 승인한 뒤 별도 검증 역할이 실제 suite를 실행해야 수렴합니다. 산출물 하나는 한 번 공개하지만 모든 참여자에게 역할별 handoff와 다음 session의 E2/E3를 따로 요구합니다.

검토 승인이 끝난 뒤 프로세스가 중단되면 `lervo deliberate --resume <숙의 ID>`로 검증과 결정 단계만 이어갈 수 있습니다. 재개 전에 현재 policy, append-only event, CAS 원문, 분할 workspace 문서를 체크포인트와 다시 대조합니다. 이미 완료됐거나 승인 경계 뒤 이력이 달라진 숙의는 재개하지 않습니다.

`lervo deliberate status <숙의 ID>`, `lervo trace --deliberation <숙의 ID>`, `lervo doctor --deliberation <숙의 ID>`는 여러 역할 run에 걸친 숙의 상태를 읽기 전용으로 보여 줍니다. 승인 뒤 살아 있는 process가 있으면 재개를 차단하고, 죽은 process나 관리된 중단만 재개 후보로 표시합니다. 후보 표시는 실행 권한이나 성공 보장이 아니며 실제 `--resume`이 전체 원본을 다시 확인합니다.

정책 수직 슬라이스는 순번·이전 ID가 있는 서명 snapshot과 command-bound 승인·철회를 Hub에서 작성해 append-only SQLite에 보존합니다. 인증·permission·project scope를 통과한 HTTP 요청만 원본을 만들며 발급·승인·철회 시각은 클라이언트가 아니라 Hub가 정합니다. Node는 HTTPS를 기본으로 하는 transport에서 Hub identity와 응답 좌표를 확인하고 다음 snapshot 또는 현재 snapshot의 늦게 추가된 승인·철회를 동기화합니다. 원격 command는 로컬과 Hub 중 더 제한적인 판정을 사용하고, 승인된 `require_approval` 실행도 provider 시작 전과 실제 파일 쓰기 직전에 다시 검증합니다. 이 기능은 Hub가 없어도 완료되는 기존 로컬 실행 경로를 바꾸지 않습니다.

## 핵심 명제

Lervo는 모델 자체가 아니라 **에이전트가 일하는 환경과 계약**을 제품화합니다. 그래프와 RAG는 유용하지만 원본 지식이나 실행 증거를 대신하지 않습니다. 원본은 버전 관리되는 문서, 저장소 상태, 스킬 정의, 검증 결과와 변경 불가능한 실행 이벤트이며 검색 인덱스는 언제든 재생성할 수 있어야 합니다.

## 예정된 사용 모습

```sh
pnpm build
pnpm lervo --version
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

`lervo --version`은 CLI package manifest의 정식 version을 한 줄로 반환합니다. `pnpm smoke:built-cli`는 내부 `@lervo/*` package가 없는 임시 production deploy를 만든 뒤 설치본의 version, capability, 기본 page와 명시적 full을 검증합니다. 합성 trace는 저장소에서 빌드한 호환성 reader와 fixture writer로 독립 검증합니다. 이는 로컬 배포 조합 검사이며 npm registry 게시나 외부 provider 실행 성공을 뜻하지 않습니다.

`pnpm release:manifest:check`는 CLI archive를 `dist/bin.js`, 짧은 package README와 package manifest로 제한합니다. Bundle에 들어간 workspace·외부 package, 유일하게 bundle 밖에 둔 Claude Agent SDK, 공개 metadata, 파일 SHA-256과 production dependency closure가 승인된 `apps/cli/release-artifact-manifest.json` v4와 같은지 확인합니다. Release 내용을 의도적으로 바꿀 때만 `pnpm release:manifest:update`로 이 한 파일을 통째로 갱신하고 diff를 검토합니다. Tarball 생성 metadata는 checksum에 넣지 않으며 이 검사는 registry 게시나 서명을 대신하지 않습니다.

`pnpm release:sbom:check`는 release manifest와 pnpm lockfile에서 현재 CLI의 CycloneDX 1.7 SBOM을 다시 만들고 `apps/cli/release-sbom.cdx.json`과 비교합니다. Production graph, optional native package, bundle에 들어간 workspace·외부 package와 각 lockfile integrity를 구분해 기록합니다. 생성 시각이나 임의 serial은 넣지 않고 document 내용에서 재현한 UUID v5 serial을 사용합니다. 의도적으로 바꿀 때만 `pnpm release:sbom:update`로 현재 release 파일 하나를 교체합니다. 이 인벤토리는 취약점 없음, dependency 라이선스 준수나 서명을 뜻하지 않습니다.

`pnpm release:attestation:check`는 매번 실제 tarball을 임시로 만든 뒤 tarball·manifest·SBOM 세 subject를 결속한 in-toto Statement v1과 SLSA provenance v1 구조를 검사하고 파일을 제거합니다. `release:attestation:local`은 같은 JSON을 stdout으로 볼 수 있지만 builder가 `local-unsigned`이고 signature envelope이 아니므로 인증 근거로 사용할 수 없습니다. 실행별 statement를 저장소에 쌓지 않습니다.

`pnpm smoke:packed-cli`는 실제 tarball을 만든 뒤 빈 임시 프로젝트에 일반 소비자 방식으로 설치합니다. 공개 파일 세 개, Node `>=22.13`, 설명·검색어·라이선스, 정확한 SDK·peer 버전, private Lervo 패키지 부재와 생성된 `lervo` 명령을 확인합니다. Package README가 4 KiB 이하이며 설치·첫 실행·dry-run과 Hub 비의존성을 실제 명령에 맞게 안내하는지도 검사합니다. 현재 OS·CPU에 맞는 Claude native package가 하나만 설치됐는지 확인하고 그 안의 실행 파일로 version을 읽은 뒤 CLI version·capability·초기화도 실행합니다. 첫 설치는 외부 dependency가 로컬 저장소에 없으면 registry를 사용할 수 있지만, 설치 뒤의 CLI 실행에는 registry나 provider 연결이 필요하지 않습니다.

`.github/workflows/cli-release-matrix.yml`은 같은 release manifest·SBOM·unsigned statement와 packed smoke를 Ubuntu, macOS와 Windows에서 실행하도록 구성합니다. 일반 matrix는 contents read만 사용합니다. 세 job이 모두 통과한 뒤 tag를 골라 수동 실행한 경우에만 별도 job이 GitHub OIDC로 세 release 파일의 SLSA build provenance와 tarball의 SBOM attestation을 서명합니다. Action은 전체 commit SHA로 고정합니다. 로컬 테스트는 workflow 구조를 확인할 뿐 원격 job의 실행·서명 성공이나 특정 SLSA level을 대신하지 않습니다.

전달받은 release directory는 `pnpm release:attestation:verify --release-directory <absolute-path> --repository <owner/repo> --tag <v-version> --source-digest <commit>`으로 검증합니다. GitHub CLI가 Sigstore signature·trusted root·transparency timestamp와 exact workflow certificate identity를 확인하고, Lervo는 provenance의 세 subject digest와 CycloneDX predicate를 실제 파일에 다시 대조합니다. Tag 이름뿐 아니라 source·signer commit을 고정하며 로컬 unsigned statement는 거부합니다. `--trusted-root <absolute-path>`를 주면 사전에 확보한 root로 offline 검증할 수 있습니다.

검증된 release의 게시 좌표는 `pnpm release:publication:authorize --release-directory <absolute-path> --repository <owner/repo> --tag <v-version> --source-digest <commit> --dist-tag <latest|next> --output <new-absolute-path>`로 고정합니다. 출력은 exact package·version·dist-tag·npm registry와 tarball SHA-256, registry SHA-512 integrity·SHA-1 shasum을 서명 evidence에 묶은 실행별 `eligible` 문서입니다. npm credential이나 외부 쓰기는 사용하지 않으며 기존 출력도 덮어쓰지 않습니다. `eligible`은 사람 승인, npm scope 소유권이나 게시 성공이 아닙니다. 현재 workflow는 이 문서를 30일 artifact로 보존할 뿐 `npm publish`는 실행하지 않습니다.

`pnpm release:publisher:readiness --repository <owner/repo>`는 package repository·라이선스·publish registry와 실제 게시 job 비활성 상태를 읽기 전용으로 점검합니다. `--online`을 명시해야 public npm package, `npm trust list`, GitHub `npm-release` reviewer·self-review·`v*` tag policy까지 확인합니다. 관측하지 못한 외부 상태는 `unknown`이며 전체 결과는 `blocked`입니다. Trust ID, reviewer identity와 외부 응답 원문은 출력하지 않습니다. 상시 publisher는 staged publishing 권한 하나만 허용하며 최초 package 게시, npm·GitHub 설정 변경과 실제 게시를 실행하지 않습니다.

`pnpm release:bootstrap:authorize --release-directory <absolute-path> --publication-authorization <absolute-path> --external-evidence <absolute-path> --output <new-absolute-path> --online`은 external evidence report v1을 exact release bytes·package identity와 새 public npm 404 관측에 다시 결속해 bootstrap v2를 만듭니다. Bootstrap은 license·scope·최초 게시 승인 문서를 다시 직접 해석하지 않으며 evidence report와 그 안의 post-apply·receipt·세 사람 문서 digest를 보존합니다. 유효기간은 evidence report 만료와 새 관측 뒤 10분 중 더 이른 시각입니다. v1 bootstrap과 예전 `--approval` 입력은 명시적으로 거부합니다. 결과는 수동 2FA 게시 준비물이며 재사용할 수 없고, private package 부재·실제 npm scope 권한·actor 신원을 증명하지 않습니다. Credential, 실제 게시, Trusted Publisher·GitHub 설정 변경도 실행하지 않습니다.

최초 게시 실행 코어는 유효한 arming authorization을 실행 시작과 예약 직전에 다시 확인하고, public package 부재를 재관측한 뒤 authorization digest에 결속된 durable 예약을 확보해야 exact tarball publisher port를 호출합니다. 호출 뒤 결과를 확인하지 못하면 `publication_unknown`으로 닫고 같은 bootstrap의 재시도를 금지하며, 성공해도 `published_transition_pending`일 뿐입니다. 별도 전환 코어는 정상 execution receipt, reviewed reconciliation resolution과 confirmed stage approval reconciliation을 서로 다른 증거로 검증합니다. 세 경로 모두 exact public release, stage-only workflow, exact npm `createStagedPackage` trust와 self-review를 막은 GitHub `npm-release` 보호가 같은 관측 묶음에서 ready여야 bootstrap을 `consumed`로 완료합니다. 전환 완료 명령은 준비된 control을 읽을 뿐 외부 설정이나 workflow를 바꾸지 않습니다.

`pnpm release:publication:stage --release-directory <절대 경로> --publication-authorization <절대 경로> --result-directory <새 절대 경로>`는 검증된 exact release를 GitHub OIDC의 `npm stage publish`로 접수하는 실제 외부 쓰기 명령입니다. 외부 호출 전 `attempt.json`, 호출 뒤 `terminal.json`을 실행별 directory에 따로 남깁니다. 성공은 stage 접수와 별도 2FA 검토 필요만 뜻하며 공개 완료를 주장하지 않습니다. 호출 뒤 결과가 불명확하거나 attempt만 남으면 같은 version을 자동 재시도하지 말고 인증된 npm Staged Packages에서 사람이 대조해야 합니다. Root workflow에는 이 job이 아직 적용되지 않았습니다.

`pnpm release:bootstrap:reconcile --publication-authorization <절대 경로> --bootstrap <절대 경로> --arming-authorization <절대 경로> --reservation-root <절대 경로> --online [--json]`은 `publication_unknown`으로 끝난 exact 예약만 public npm의 대상 version metadata와 dist-tag에 대조합니다. 두 값이 승인된 release와 모두 일치할 때 `published`, 둘 다 보이지 않을 때 `not_observed`, 일부만 보이거나 digest가 다르고 registry를 읽지 못하면 `unknown`입니다. 어느 결과도 자동 재시도나 게시 완료 전환 권한이 아니며 명령은 기존 예약·terminal·외부 설정을 바꾸거나 결과 파일을 남기지 않습니다.

사람이 `published` reconciliation JSON을 검토한 뒤 최대 10분의 canonical decision을 만들면 `pnpm release:bootstrap:resolve --publication-authorization <절대 경로> --bootstrap <절대 경로> --arming-authorization <절대 경로> --reservation-root <절대 경로> --reconciliation-report <절대 경로> --decision <절대 경로> --output <새 절대 경로> --online`으로 별도 resolution을 만들 수 있습니다. 명령은 public npm을 다시 읽어 exact release가 여전히 보일 때만 `transition_review_eligible`을 기록합니다. 기존 unknown terminal은 그대로이며 execution receipt 복구, 자동 재시도, 전환 완료나 외부 설정 변경은 허가하지 않습니다.

최초 게시 예약의 파일 adapter는 예약별 directory에 immutable `reservation.json`과 terminal 하나만 두며 재시작 뒤 중복 실행을 닫습니다. npm 대화형 adapter는 TTY·비CI·환경 credential 부재, `auth-and-writes` profile과 exact 사전 확인을 거친 뒤 direct publish를 현재 terminal에 연결합니다. 게시 뒤 2FA challenge 완료 확인은 사람 진술이며 npm이 발급한 proof로 표현하지 않습니다. 이 adapter를 여는 CLI 명령은 아직 없으므로 실제 npm 게시 경로는 비활성입니다.

최초 게시 사전 점검 report는 bootstrap 유효성, exact tarball, public package 부재, 예약 저장 상태와 npm 대화형 준비 상태를 `ready`, `blocked`, `unknown`으로 나눕니다. 조회는 예약 root를 만들지 않고 게시·예약·외부 설정을 실행하지 않습니다. `ready`도 실행 허가가 아니므로 실제 실행은 package 부재 재관측, durable 예약과 사람 확인을 생략할 수 없습니다. Profile·사용자명·설정 경로·token·OTP와 외부 출력 원문은 report에 넣지 않습니다.

`pnpm release:bootstrap:preflight --release-directory <absolute-path> --publication-authorization <absolute-path> --bootstrap <absolute-path> --reservation-root <absolute-path> --user-config <absolute-path> --online [--json]`은 이 report를 실제 릴리스 파일·예약 저장소·npm 계정 확인에 연결합니다. 입력 파일은 확인 전후 내용이 같은지 대조하고, npm은 임시 캐시와 빈 전역 설정에서 읽은 뒤 모두 제거합니다. 기본 출력은 한국어 설명, `--json`은 report v1이며 준비됐을 때만 종료 코드 0입니다. 명령은 결과 문서, 예약, 패키지 게시나 외부 설정을 만들지 않습니다.

최초 게시 execution plan은 실행 입력 확인부터 terminal 저장까지 8단계와 예약 전·예약 후·게시 시작 후의 서로 다른 취소 처분을 고정합니다. 상태는 `not_armed`, 활성화는 `not_implemented`이며 이전 preflight를 실행 허가로 사용하지 않습니다. `pnpm release:bootstrap:plan --publication-authorization <절대 경로> --bootstrap <절대 경로> [--json]`은 두 계약 파일에서 이 계획을 다시 만들어 stdout에만 보여 줍니다. 명령 성공은 계획을 정상적으로 읽었다는 뜻일 뿐 게시 준비나 실행 권한을 뜻하지 않으며, 온라인 확인·사람 확인 요청·예약·게시를 실행하지 않습니다.

검토한 exact plan에 대한 짧은 사람 decision 파일이 있을 때만 `pnpm release:bootstrap:arm --publication-authorization <절대 경로> --bootstrap <절대 경로> --decision <절대 경로> --output <새 절대 경로>`로 arming authorization v1을 만들 수 있습니다. Decision은 bootstrap·publication authorization·plan digest와 preflight 비권한성, 실행 시 fresh 재검증, 수동 2FA 1회, 결과 불명 시 reconciliation을 최대 5분 동안 승인해야 합니다. 결과는 actor 원문을 버리고 durable 예약에서 소비할 digest만 남깁니다. `armed`는 실행 코어가 요구하는 문서라는 뜻이며 이 명령은 preflight·사람 prompt·예약·npm 게시·외부 설정을 실행하지 않고 publisher CLI도 노출하지 않습니다.

`pnpm release:bootstrap:blockers [--json]`는 현재 CLI package manifest와 release manifest만 읽어 로컬에서 고칠 수 있는 항목과 외부에서 확인·승인해야 하는 항목을 나눠 보여 줍니다. 현재는 저장소·라이선스·public registry·provenance 설정이 로컬 차단 항목이고, public npm 이름 확인·`@lervo` scope 관리 권한·별도 최초 게시 승인은 외부 요구사항입니다. 이 보고서는 항상 advisory-only이고 activation은 `not_implemented`이며 온라인 확인·승인 생성·파일 수정·게시를 실행하지 않습니다.

`pnpm release:bootstrap:metadata-preview --repository <owner/repository> --license <license> --scope-owner-kind <organization|user> --scope-owner-name lervo [--json]`은 명시한 metadata 선택을 현재 manifest와 비교합니다. Package manifest에 필요한 네 필드의 `set` 연산만 보여 주고, 생성 파일인 release manifest는 직접 수정하지 않고 재생성 필요 여부만 표시합니다. 이 선택은 라이선스 승인, npm scope 권한 확인이나 게시 승인이 아니며 명령은 어떤 파일도 바꾸지 않습니다.

`pnpm release:bootstrap:metadata-candidate --repository <owner/repository> --license <license> --scope-owner-kind <organization|user> --scope-owner-name lervo [--json]`은 같은 선택과 현재 원본에 묶인 exact `package.json` 후보를 만들되 쓰지 않습니다. 기계가 읽는 `--json`과 `--package-json`은 `pnpm --silent`로 실행하며 각각 검토용 candidate metadata와 digest에 결속된 정확한 결과 바이트만 stdout에 보냅니다. 후보는 `review_required`, `writesAllowed=false`이고 release manifest 재생성·승인·활성화·게시를 실행하지 않습니다.

`pnpm release:bootstrap:metadata-permit`은 같은 metadata 인자와 검토한 candidate·source·output digest, `--confirm-reviewed-candidate`를 모두 요구합니다. 현재 원본에서 후보와 결과를 다시 계산해 모두 같을 때만 `apply_permitted` JSON을 stdout에 만들며, 이는 source compare-and-swap 조건의 로컬 package metadata 권한입니다. 사람의 검토 진술을 독립적인 검토 증명으로 과장하지 않고 이 명령 자체는 어떤 파일도 바꾸지 않습니다. 자세한 인자는 [ADR-0107](./docs/adr/0107-cli-first-publication-package-metadata-apply-permit.md)에 있습니다.

검토한 permit 파일이 있을 때만 `pnpm release:bootstrap:metadata-apply --permit <absolute-path> --write [--json]`로 package manifest, production generator의 release manifest와 새 SBOM을 함께 적용합니다. 모든 결과를 먼저 만들고 source compare-and-swap 뒤 staged replace하며 동기 실패는 세 파일을 모두 복구합니다. 프로세스가 중단되면 새 apply를 막고 `pnpm release:bootstrap:metadata-apply --recover`로 pre-commit 원본 복원 또는 committed cleanup을 명시적으로 완료합니다. 이는 전원 손실 순간까지 세 경로가 동시에 바뀌는 완전한 filesystem 원자성을 주장하지 않으며 실제 현재 metadata에는 아직 실행하지 않았습니다.

저장한 apply receipt가 있으면 `pnpm release:bootstrap:metadata-verify --receipt <absolute-path> [--json]`로 현재 package manifest·release manifest·SBOM·lockfile을 다시 읽습니다. 현재 세 결과가 receipt의 after binding과 같은지, production generator로 다시 만든 release manifest 및 SBOM이 일관적인지, 로컬 metadata 차단 항목이 해소됐는지 확인합니다. Pending transaction이 있으면 source를 읽기 전에 막고 검증 중 생긴 transaction도 반환 전에 다시 막습니다. Receipt의 서명이나 발급 주체, license 승인·public npm 이름·scope control·최초 게시 승인은 증명하지 않으며 파일 수정·온라인 관측·활성화·게시를 실행하지 않습니다.

`pnpm release:bootstrap:external-evidence --receipt <절대 경로> --post-apply-report <절대 경로> --publication-authorization <절대 경로> --license-approval <절대 경로> --scope-confirmation <절대 경로> --first-publication-approval <절대 경로> --online [--json]`은 서로 분리된 짧은 문서와 public npm 관측을 하나의 읽기 전용 report에 결속합니다. 저장한 post-apply report를 현재 원본에서 온라인 관측 전후 두 번 다시 계산하고, license 승인·scope control 확인·전체 최초 게시 승인이 같은 package·repository·license·scope와 release를 가리키는지 확인합니다. 결과는 `evidence_bound`이지만 `not_armed`이며 actor 신원, 실제 npm scope 권한, 비공개 package 부재, receipt 발급 진위와 release artifact bytes를 증명하거나 다시 검증하지 않습니다. 입력과 저장소 파일을 바꾸거나 승인·activation·게시를 실행하지 않습니다.

최초 게시 뒤에는 `pnpm release:bootstrap:transition`이 정상 execution receipt, 검토된 direct-publication reconciliation resolution 또는 `public_release_confirmed` stage approval reconciliation 중 정확히 한 경로를 받습니다. Stage 경로는 기존 다섯 source 인자 또는 `--stage-approval-bundle <절대 경로>` 하나를 사용하며 둘을 섞거나 direct arming 입력을 넣지 않습니다. Bundle도 내부 원본을 다시 열어 digest·계약·관측 뒤 불변성을 같은 방식으로 확인합니다. 명시적 `--online`에서 public npm exact release, npm Trusted Publisher와 GitHub `npm-release` 환경을 함께 다시 확인하고 모든 원본이 그대로일 때만 새 output을 기록합니다. 기존 두 경로는 receipt v2를 유지하고 새 stage provenance는 v3를 사용합니다. 준비되지 않은 control, 혼합 증거, 원본 변경과 기존 output은 실패하며 저장 기록·workflow·외부 설정·runtime telemetry를 바꾸지 않습니다.

`pnpm release:bootstrap:workflow-candidate [--json|--workflow-yaml]`은 비활성 release workflow에 exact `publish-cli` job 하나를 추가할 검토용 후보입니다. YAML 전체를 다시 쓰지 않고 `jobs` mapping의 byte 경계에 고정 block만 삽입하며 원본의 다른 bytes와 뒤쪽 최상위 block을 보존합니다. 후보는 package manifest의 exact `release:publication:stage` script를 확인하고, 원본 workflow·package manifest·외부 설정·게시 상태를 바꾸지 않습니다.

검토한 candidate에 대한 최대 10분의 사람 decision이 있으면 `pnpm release:bootstrap:workflow-permit --repository <owner/repo> --decision <절대 경로> --output <새 절대 경로> --online`으로 최대 5분의 적용 permit을 만들 수 있습니다. 현재 source가 비활성이고 npm의 exact stage trust와 GitHub `npm-release` reviewer·self-review·`v*` 보호가 모두 ready여야 하며, 명령은 이를 읽을 뿐 workflow나 외부 설정을 바꾸지 않습니다.

`pnpm release:bootstrap:workflow-apply --repository <owner/repo> --decision <절대 경로> --permit <절대 경로> --online --write [--json]`은 외부 control과 모든 source를 다시 확인한 뒤 exact workflow 한 파일만 mode를 보존해 교체합니다. Compare-and-swap journal은 중단 전 원본 rollback과 commit 뒤 cleanup을 구분하며, 남은 transaction은 `pnpm release:bootstrap:workflow-apply --recover`로만 복구합니다. 성공 receipt도 stage job 활성화만 뜻하고 workflow 실행·npm stage 접수·2FA 승인·package 공개는 주장하지 않습니다. 현재 저장소의 production workflow에는 이 적용을 실행하지 않았습니다.

`pnpm release:bootstrap:workflow-verify --repository <owner/repo> --receipt <절대 경로> --online [--json]`은 pending transaction이 없는지 확인하고 receipt 결과와 current workflow bytes, stage command와 action SHA·옵션 전체를 대조합니다. npm stage trust와 GitHub 보호도 새로 읽으며 관측 중 source 변경을 거부합니다. 성공은 local stage-only 구성과 관측 시점의 외부 control이 맞다는 뜻입니다. Receipt 발급 주체, GitHub 원격 배포·workflow 실행, npm stage 접수·2FA 승인·package 공개는 확인하지 않고 어떤 상태도 바꾸지 않습니다.

저장한 post-apply report가 있으면 `pnpm release:bootstrap:workflow-remote-evidence --repository <owner/repo> --source-commit <40자 소문자 commit SHA> --post-apply-report <절대 경로> --online [--json]`으로 GitHub의 exact commit·고정 workflow 경로를 읽어 현재 검증된 workflow와 byte 단위로 대조할 수 있습니다. 성공은 그 commit에 같은 stage-only 파일이 있다는 뜻뿐입니다. 기본 브랜치·release tag 포함, workflow 실행, npm stage 접수·2FA 승인·package 공개는 확인하지 않으며 로컬 파일이나 GitHub 설정을 바꾸지 않습니다.

저장한 remote evidence가 있으면 `pnpm release:bootstrap:workflow-reachability --repository <owner/repo> --source-commit <40자 소문자 commit SHA> --release-tag <vMAJOR.MINOR.PATCH> --remote-evidence-report <절대 경로> --online [--json]`으로 source commit이 현재 기본 브랜치에 포함되고 release tag가 같은 commit을 가리키는지 확인할 수 있습니다. Source commit의 CLI package bytes와 tag version도 현재 검증된 package에 대조합니다. Lightweight·annotated tag를 구분하고 관측 끝에 branch·tag ref를 다시 읽습니다. 성공은 관측 시점의 ref 관계일 뿐 이후 불변성, workflow 실행·stage·공개를 뜻하지 않으며 어떤 ref도 바꾸지 않습니다.

저장한 reachability evidence와 운영자가 고른 run 좌표가 있으면 `pnpm release:bootstrap:workflow-execution --repository <owner/repo> --source-commit <40자 소문자 commit SHA> --release-tag <vMAJOR.MINOR.PATCH> --run-id <양의 정수> --attempt <양의 정수> --reachability-report <절대 경로> --online [--json]`으로 exact workflow 실행을 읽기 전용으로 확인할 수 있습니다. 명시한 attempt가 현재 최신 attempt이고 run·`Stage CLI publication` job·stage와 결과 upload step이 성공으로 끝났으며 run-attempt 전용 artifact metadata가 하나인지 앞뒤로 재확인합니다. 성공은 GitHub Actions의 실행·artifact metadata 증거일 뿐 artifact 내용, npm stage 접수·2FA 승인이나 package 공개를 뜻하지 않으며 dispatch·rerun·download·게시를 실행하지 않습니다.

저장한 workflow execution evidence가 있으면 `pnpm release:bootstrap:stage-result-evidence --repository <owner/repo> --source-commit <40자 소문자 commit SHA> --release-tag <vMAJOR.MINOR.PATCH> --run-id <양의 정수> --attempt <양의 정수> --workflow-execution-report <절대 경로> --online [--json]`으로 exact artifact를 최대 1 MiB까지 읽기 전용으로 다운로드할 수 있습니다. Artifact metadata를 앞뒤로 대조하고 ZIP 전체 digest, 정확히 두 개인 canonical `attempt.json`·`terminal.json`, package·version과 `npm_cli_exit_zero` 결과를 검증합니다. 성공은 npm CLI가 stage 요청을 exit code 0으로 마쳤다고 기록한 증거이며 registry의 독립 접수, stage ID·tarball 검토, 2FA 승인이나 공개 상태를 뜻하지 않습니다.

저장한 stage result evidence와 별도의 npm user config가 있으면 `pnpm release:bootstrap:stage-review-evidence --repository <owner/repo> --source-commit <40자 소문자 commit SHA> --release-tag <vMAJOR.MINOR.PATCH> --run-id <양의 정수> --attempt <양의 정수> --stage-result-report <절대 경로> --npm-user-config <절대 경로> --online [--json]`으로 exact staged package를 읽기 전용으로 검토할 수 있습니다. 인증된 `stage list`에서 같은 package·version의 항목이 하나인지 확인하고 `view`, 임시 directory의 `download`, `view` 재확인으로 metadata와 tarball digest를 이전 stage 결과에 결속합니다. Stage ID는 digest만 남기고 actor·계정·credential·npm 원문은 버립니다. 성공은 사람의 검토 승인, 2FA 완료나 공개 배포가 아니며 `approve`·`reject`를 호출하지 않습니다.

검토한 stage review report와 canonical 사람 decision이 있으면 `pnpm release:bootstrap:stage-approve-authorize --repository <owner/repo> --source-commit <commit> --release-tag <tag> --run-id <id> --attempt <n> --stage-review-report <절대 경로> --decision <절대 경로> --output <새 절대 경로> --write [--json]`으로 최대 5분의 승인 권한을 만들 수 있습니다. Decision은 report 관측 뒤 최대 10분 안에 작성되어 exact review digest·stage ID digest·package·version과 다섯 확인 문구를 가져야 합니다. 권한은 대화형 2FA `stage approve` 1회만 허용하며 이 명령 자체는 npm을 호출하거나 approve·reject·공개 확인을 수행하지 않습니다.

Fresh authorization을 실제로 소비할 때만 `pnpm release:bootstrap:stage-approve --repository <owner/repo> --source-commit <commit> --release-tag <tag> --run-id <id> --attempt <n> --stage-review-report <절대 경로> --decision <절대 경로> --authorization <절대 경로> --npm-user-config <절대 경로> --result-directory <새 절대 경로> --online --write [--json]`을 대화형 terminal에서 실행합니다. 명령은 exact stage를 list·view로 재확인하고 immutable attempt를 먼저 저장한 뒤 `npm stage approve`를 한 번만 호출합니다. npm의 2FA 입력은 terminal에서 직접 처리하며 Lervo 문서에는 저장하지 않습니다. Exit code 0도 공개 증명은 아니므로 terminal은 별도 public registry 검증을 요구하고 재시도를 금지합니다.

승인 시도 뒤에는 `pnpm release:bootstrap:stage-approve-reconcile --repository <owner/repo> --source-commit <commit> --release-tag <tag> --run-id <id> --attempt <n> --stage-review-report <절대 경로> --decision <절대 경로> --authorization <절대 경로> --npm-user-config <절대 경로> --result-directory <절대 경로> --online [--json]`으로 결과를 읽기 전용 대조합니다. Public npm의 exact version integrity·shasum과 dist-tag, 인증된 stage list에서 승인 대상 stage가 사라졌는지를 함께 확인합니다. 둘 다 맞아야 `public_release_confirmed`이며, 결과가 다르거나 registry가 불안정하면 `unknown`입니다. 어떤 결과도 자동 재시도나 transition 완료 권한이 아닙니다.

`pnpm release:bootstrap:stage-evidence-bundle --stage-review-report <절대 경로> --decision <절대 경로> --authorization <절대 경로> --result-directory <절대 경로> --reconciliation-report <절대 경로> --output <새 절대 경로> --write [--json]`은 다섯 stage source를 전체 재검증한 뒤 16 KiB 이하의 짧은 manifest를 만듭니다. Manifest는 자기 디렉터리 안의 안전한 상대 경로와 여섯 원본 digest만 가지며 문서 본문·절대 경로·게시 상태를 복제하지 않습니다. 원본이 바뀌면 bundle도 사용할 수 없고 manifest 자체에는 게시·재시도·전환 권한이 없습니다.

`pnpm release:bootstrap:completion-inspect --stage-approval-bundle <절대 경로> --transition-receipt <절대 경로> [--json]`은 저장된 bundle의 모든 원본과 stage transition receipt를 읽기 전용으로 다시 맞춥니다. Receipt가 같은 reconciliation 결과와 공개 target을 가리키고 완료 의미가 그대로일 때만, 저장된 최초 게시 전환 범위의 남은 수동 조치가 없다고 설명합니다. 현재 npm·GitHub 상태는 다시 조회하지 않았음을 함께 표시하며 파일·network·외부 설정·runtime state를 바꾸지 않습니다.

`pnpm smoke:registry-publish`는 외부 uplink와 credential이 없는 임시 Verdaccio에 실제 tarball을 `preflight` tag로 게시합니다. Registry metadata와 SHA-512 integrity, dist-tag, package 좌표 설치와 local bin을 확인하고 같은 version의 두 번째 게시가 거부된 뒤에도 기존 integrity가 같은지 다시 읽습니다. 소비자 설정은 `@lervo` scope만 임시 registry로 보내며 외부 SDK dependency는 공개 registry나 package cache를 사용할 수 있습니다. 따라서 이 검사는 실제 npm 게시 권한·package 소유권, 완전한 offline 설치나 원격 registry 성공을 뜻하지 않습니다.

`lervo init`, `lervo migrate identity`, 한 파일 `lervo run`, run별 `lervo trace`, 로컬 증거용 `lervo doctor`와 등록 문서 대상 `lervo search`를 실행할 수 있습니다. `migrate identity`는 기본적으로 읽기 전용 계획만 보여 주며, 출력된 plan ID를 `--apply`로 다시 명시해야 적용합니다. 0.1.0의 인자 없는 trace는 최대 50개 event의 bounded page를 경고 없이 반환합니다. 전체 `TraceReport` v1에 의존하는 자동화는 `--full`을 명시해야 하며 자세한 변경 방법은 [migration 안내](./docs/migrations/0.1.0-trace-bounded-default.md)에 있습니다. 검색 query는 원문 없이 digest만 attempt에 남고 품질은 별도 `lervo search assess`를 실행한 경우에만 집계됩니다. 검토한 attempt는 `search case`로 케이스별 YAML에 승격하고 `search evaluate`로 현재 `lexical-v1`을 같은 입력에 반복 실행할 수 있습니다. 역할·작업 유형별 평가 묶음은 활성 케이스, 대체 관계와 최소 표본을 별도 `.bundle.yaml`에 두며 `bundle report`로 비교 가능한 표본인지 확인합니다. 표본이 부족한 묶음도 현재 엔진 평가 결과는 남길 수 있지만 비교 준비 완료나 임베딩 필요성으로 해석하지 않습니다. 케이스 YAML에는 검토한 검색 문장이 들어가므로 비밀정보가 없는지 커밋 전에 확인해야 하며, 묶음·실행 결과와 report에는 문장을 복제하지 않습니다. Managed run은 작업 문장을 bounded 검색어로 투영하고 등록 문서 결과를 최대 5개 추천하며, `top_ranked-v1`이 고른 최대 3개만 별도 선택 근거로 E1에 넣습니다. 실행 결과의 attempt ID로 품질을 나중에 평가할 수 있으며 자동 선택이나 실행 성공 자체는 수락 평가가 아닙니다. `lervo run`은 `.lervo/verifications/<suite-id>.yaml`에 있는 suite를 `--verification`으로 하나 이상 명시해야 합니다. 모든 필수 suite가 통과하지 않으면 `run.completed`를 기록하지 않습니다. Writing 검사는 별도 의미 평가기가 구성되지 않은 기본 실행에서 결과 원문을 숨깁니다. Doctor는 각 검사 범위를 `healthy`, `unhealthy`, `unknown`으로 나누며 모든 항목이 `healthy`일 때만 성공합니다. `knowledge`, `documents`, `skills`, `providers`, `search` 제한 범위는 필요한 저장소와 probe만 실제로 열고 출력과 JSON에 범위를 표시합니다. JSON에는 `schemaVersion: 1`이 있으며 reader는 미지원 버전과 손상된 v1을 구분하고 선택 필드 추가만 이전 consumer와 호환되는 변경으로 봅니다. 종료 코드 0은 선택한 범위 정상일 뿐 프로젝트 전체 정상을 뜻하지 않습니다. 검색은 엔진 선택, 세 종류의 정책, rollout 검토와 조치를 따로 검사하며 선행 원본을 확인할 수 없으면 뒤의 범위를 `unknown`으로 둡니다. 문제가 있으면 고정된 issue code에서 파생한 한국어 다음 확인 안내를 보여 주며, 오류 원문을 복사하거나 자동 수정·상태 변경을 실행하지 않습니다. Provider version 확인은 실행 파일 증거일 뿐 인증, 네트워크나 실제 provider session 성공을 뜻하지 않습니다. 구체적인 범위와 완료 조건은 `LERVO_V0_PLAN.md`에 정의합니다.

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

이전 실험 버전이 만든 `.roven` 경로는 자동으로 읽거나 `.lervo`와 함께 사용하지 않습니다. `lervo init`은 두 관리 경로가 공존하는 상태를 만들지 않도록 초기화를 차단합니다. `lervo migrate identity`는 원본을 변경하지 않는 계획에서 project·event chain·CAS·문서 metadata를 먼저 확인합니다. 적용은 같은 plan ID를 다시 명시한 경우에만 진행하며 기존 event hash와 CAS object를 다시 쓰지 않습니다. 이전 marker나 ownership을 쓰는 문서 metadata는 원본 그대로 hash별 archive로 옮기고 활성 document registry를 비워 사용자 문서를 자동 수정하지 않습니다.
