# Lervo

Lervo(레르보)는 저장소 안에서 독립적으로 동작하면서, 필요할 때 중앙에서 여러 프로젝트와 AI 에이전트를 관리할 수 있는 로컬 우선(local-first) 에이전트 운영 체계입니다.

현재 상태: M0·M1·M2·M3·M4·M5 완료 (2026-08-19)

## 목표

- Codex와 Claude를 동일한 실행 계약과 증거 모델로 지원합니다.
- 개발자뿐 아니라 연구, 마케팅, 디자인 등 여러 전문 에이전트를 역할 프로필로 구성합니다.
- 에이전트가 어떤 근거와 문서를 선택하고 실제로 로드했는지 추적합니다.
- 작업 결과에서 재사용 가능한 지식을 후보로 만들고 검증 후 승격합니다.
- `AGENTS.md`, `CLAUDE.md`, `README.md`와 사용자/외부 스킬의 노후화 및 사용 여부를 관리합니다.
- 각 저장소는 오프라인에서도 동작하며, 선택적으로 Lervo Hub와 동기화합니다.
- Slack, Discord 같은 채널에서 프로젝트 조회와 승인된 작업 실행을 요청할 수 있게 확장합니다.

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

## 현재 구현

- `@lervo/schemas`: project, event, Hub project registration·event batch·ack, context evidence, shared context/handoff, adapter, role, skill manifest/lock, 분할 document manifest와 기존 registry, 일반·legacy 구조 migration의 승인·적용 event·receipt, managed block patch candidate, document staleness result, verification suite/result, writing policy/evaluation/publication permit, 숙의 policy/artifact/outcome, 지식 promotion policy/review/verified/staleness JSON Schema와 파생 TypeScript 타입. Adapter 계약은 session/context, managed write와 provider 관측 event를 분리해 관리
- `@lervo/skills`: 프로젝트·사용자 스킬 패키지의 안전한 discovery와 전체 내용 hash, 보수적 호환성 판정, 결정적 우선순위와 원자적 `skills.lock` 기록
- `@lervo/event-contract`: 공급자와 저장 구현에 독립적인 payload 정리, 실행 완료·프로젝트 검증·숙의·지식 수명주기 event의 allowlist 후 schema·artifact 좌표 검증, canonical JSON과 event hash 규칙
- `@lervo/storage-contract`: event transaction, outbox와 artifact 저장소의 공통 interface
- `@lervo/sync-contract`: 전체 project manifest에 결속된 Hub 등록, allowlist event의 연속 batch, 역순 수락·중복 제거와 연속 cursor, durable ack 후보를 계산하는 저장·transport 독립 계약
- `@lervo/sync`: project 등록을 먼저 확인하고 현재 worker의 local outbox lease만 연속 batch로 보내는 Node runtime. 인증된 destination·peer와 durable ack 전체가 맞을 때 batch 단위로 local ack하고, 응답 유실·인증 실패·잘못된 ack는 안전한 code와 시각으로 재예약
- `@lervo/hub-sync`: registration과 event batch reducer를 동기 store transaction에 연결해 commit 뒤에만 응답을 반환하는 Hub application 경계
- `@lervo/hub-sync-sqlite`: destination·project별 registration 원본, append-only event inbox와 연속 cursor를 한 SQLite transaction에 저장하고 재시작 때 전체 state를 재검증하는 durable adapter
- `@lervo/hub-trace`: 한 read snapshot에서 project 요약과 run timeline을 만드는 파생 projection. Cursor 이하 `continuous`와 gap 뒤 `buffered` event를 구분하며 project 목록에는 event payload를 포함하지 않음
- `@lervo/core`: E0~E4 assurance, 필수 E3 쓰기 게이트, 역할 간 shared context 접근·handoff 판정, 한국어 writing 검사와 공개 게이트, 실패 처분
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
- `@lervo/diagnostics`: append-only event의 run별 trace와 candidate·review·verified·stale CAS 및 근거 연결을 읽기 전용으로 점검하고 항목별 `healthy`·`unhealthy`·`unknown` 결과를 조합하는 로컬 진단 경계
- `@lervo/cli`: 안전한 `lervo init`과 project storage·context·provider adapter·명시적으로 고른 verification suite를 연결하는 한 파일 `lervo run` 명령 진입점. 문서·스킬·provider 실행 환경을 분리해 점검하는 `doctor` application service 포함
- `pnpm check`: 타입, schema fixture, contract test, 패키지 빌드, 문서 수명주기 기본 검사

M5의 project verification artifact, writing 공개 gate, 구조화 숙의 runtime과 지식 수명주기 경계를 구현했습니다. M6에서는 project manifest에 결속된 Hub 등록·event batch 계약, Node outbox worker, Hub durable SQLite 저장소와 project/run trace projection을 연결했습니다. Gap 뒤 event는 `buffered`로 분리되고 선택 reason부터 검증 결과까지 run timeline에서 읽을 수 있습니다. 다음 작업은 read-only HTTP API와 최소 trace web view입니다.

## 핵심 명제

Lervo는 모델 자체가 아니라 **에이전트가 일하는 환경과 계약**을 제품화합니다. 그래프와 RAG는 유용하지만 원본 지식이나 실행 증거를 대신하지 않습니다. 원본은 버전 관리되는 문서, 저장소 상태, 스킬 정의, 검증 결과와 변경 불가능한 실행 이벤트이며 검색 인덱스는 언제든 재생성할 수 있어야 합니다.

## 예정된 사용 모습

```sh
pnpm build
pnpm lervo init --dry-run
pnpm lervo init
pnpm lervo run --provider codex --path src/example.ts --verification project.default "DD 기능 개발"
lervo trace last
lervo doctor
```

`lervo init`, 한 파일 `lervo run`, run별 `lervo trace`와 로컬 증거용 `lervo doctor`를 실행할 수 있습니다. `lervo run`은 `.lervo/verifications/<suite-id>.yaml`에 있는 suite를 `--verification`으로 하나 이상 명시해야 합니다. 모든 필수 suite가 통과하지 않으면 `run.completed`를 기록하지 않습니다. Writing 검사는 별도 의미 평가기가 구성되지 않은 기본 실행에서 결과 원문을 숨깁니다. Doctor는 각 검사 범위를 `healthy`, `unhealthy`, `unknown`으로 나누며 모든 항목이 `healthy`일 때만 성공합니다. Provider version 확인은 실행 파일 증거일 뿐 인증, 네트워크나 실제 session 성공을 뜻하지 않습니다. 구체적인 범위와 완료 조건은 `LERVO_V0_PLAN.md`에 정의합니다.

이전 실험 버전이 만든 `.roven` 경로는 자동으로 읽거나 `.lervo`와 함께 사용하지 않습니다. `lervo init`은 두 관리 경로가 공존하는 상태를 만들지 않도록 초기화를 차단합니다. 기존 상태를 옮기는 작업은 event hash chain과 CAS 주소를 보존하는 별도 명칭 migration으로 다룹니다.
