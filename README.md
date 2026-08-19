# Lervo

Lervo(레르보)는 저장소 안에서 독립적으로 동작하면서, 필요할 때 중앙에서 여러 프로젝트와 AI 에이전트를 관리할 수 있는 로컬 우선(local-first) 에이전트 운영 체계입니다.

현재 상태: M0·M1·M2·M3·M4 완료, M5 숙의 계약 구현 전 (2026-08-19)

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

## 현재 구현

- `@lervo/schemas`: project, event, context evidence, shared context/handoff, adapter, role, skill manifest/lock, 분할 document manifest와 기존 registry, 일반·legacy 구조 migration의 승인·적용 event·receipt, managed block patch candidate, document staleness result, verification suite/result, writing policy/evaluation/publication permit JSON Schema와 파생 TypeScript 타입. Adapter 계약은 session/context, managed write와 provider 관측 event를 분리해 관리
- `@lervo/skills`: 프로젝트·사용자 스킬 패키지의 안전한 discovery와 전체 내용 hash, 보수적 호환성 판정, 결정적 우선순위와 원자적 `skills.lock` 기록
- `@lervo/event-contract`: 공급자와 저장 구현에 독립적인 payload 정리, canonical JSON과 event hash 규칙
- `@lervo/storage-contract`: event transaction, outbox와 artifact 저장소의 공통 interface
- `@lervo/core`: E0~E4 assurance, 필수 E3 쓰기 게이트, 역할 간 shared context 접근·handoff 판정, 한국어 writing 검사와 공개 게이트, 실패 처분
- `@lervo/context`: `AGENTS.md` 계층·path·Role·handoff 기반 E1 선택, 안전한 전체 파일 읽기, E2 무결성 검증과 snapshot 무효화 판정
- `@lervo/context-delivery`: 검증된 E2와 schema-valid writing policy binding을 inline/CAS envelope로 조립하고 공통 adapter receipt 판정 뒤에만 E3를 만드는 공급자 중립 경계
- `@lervo/orchestrator`: E1/E2/E3와 1회용 파일 쓰기 permit를 provider 요청에 연결하고, 실제 변경 hash·snapshot·결과 artifact를 함께 검증하는 fail-closed 상태 머신
- `@lervo/project`: 관리 경로, project 설정, 분할 document manifest/기존 registry 호환 loader와 원자적인 초기화 계획·적용
- `@lervo/documents`: 제한된 root의 안전한 read-only scan, Markdown/MDX·기존 Lervo registry adapter, CommonMark 기반 managed block byte 경계 판정과 쓰기 권한 없는 byte 보존 patch candidate, 문서별 migration candidate artifact와 source hash 기반 dry-run plan, 검토된 manifest의 metadata-only sidecar 적용, 기존 단일 registry의 항목별 보존 artifact와 승인 기반 원자적 structural migration, revision snapshot·검토 주기·연결 경로·managed input hash의 증거 기반 stale 판정.
- `@lervo/verification`: 분할 project suite loader, shell 없는 순차 명령 실행, timeout·취소·output 한도, 명령별 stdout/stderr CAS와 repository snapshot에 결속된 결과 artifact
- `@lervo/writing`: provider 결과 artifact의 결정적 검사, 분리된 의미 평가 port, CAS evaluation과 policy·evaluation·content·surface에 결속된 공개 permit. Permit 재검증을 통과한 원문만 반환하는 공개 경계
- `@lervo/project-storage`: 검증된 project 설정과 공통 경로로 SQLite event/outbox와 CAS를 함께 여는 실행 진입점
- `@lervo/event-store-sqlite`: project별 WAL event store, 원자적 outbox, versioned migration, append-only hash chain과 재시작 무결성 검사
- `@lervo/cas`: SHA-256 주소를 사용하는 로컬 원문·artifact 저장소
- `@lervo/adapter-contract`: Codex와 Claude가 같은 역할·writing 정책·turn 수락·session 유효 기능·managed write 요청/결정/완료 계약을 따르도록 강제하는 provider adapter interface와 contract suite
- `@lervo/adapter-codex`: Codex app-server thread/turn과 controlled context를 관리하고 file-change 승인을 Lervo의 1회용 permit에 연결하는 adapter
- `@lervo/adapter-claude`: Claude Agent SDK context replay를 검증하고 Write/Edit hook을 Lervo의 1회용 permit에 연결하는 adapter
- `@lervo/cli`: 안전한 `lervo init`과 project storage·context·provider adapter를 연결하는 한 파일 `lervo run` 명령 진입점. Provider 결과는 writing 공개 gate를 통과했을 때만 출력
- `pnpm check`: 타입, schema fixture, contract test, 패키지 빌드, 문서 수명주기 기본 검사

M5의 project verification artifact와 writing 공개 gate를 구현했습니다. `lervo run`의 기능 검증은 아직 suite/event와 연결되지 않아 `실행하지 않음`으로 남습니다. 반면 provider 결과는 결정적 검사와 별도 의미 평가가 모두 통과하고, 평가 artifact와 내용 hash에 묶인 permit가 있어야 출력됩니다. 기본 CLI에는 의미 평가 provider를 아직 구성하지 않았으므로 실행 변경은 유지하되 결과 원문은 공개하지 않고 종료 코드 1을 반환합니다. 다음 작업은 숙의 artifact와 policy schema입니다.

## 핵심 명제

Lervo는 모델 자체가 아니라 **에이전트가 일하는 환경과 계약**을 제품화합니다. 그래프와 RAG는 유용하지만 원본 지식이나 실행 증거를 대신하지 않습니다. 원본은 버전 관리되는 문서, 저장소 상태, 스킬 정의, 검증 결과와 변경 불가능한 실행 이벤트이며 검색 인덱스는 언제든 재생성할 수 있어야 합니다.

## 예정된 사용 모습

```sh
pnpm build
pnpm lervo init --dry-run
pnpm lervo init
pnpm lervo run --provider codex --path src/example.ts "DD 기능 개발"
lervo trace last
lervo doctor
```

`lervo init`과 한 파일 `lervo run`은 현재 저장소의 로컬 패키지 명령으로 실행할 수 있습니다. `lervo run`의 project verification은 아직 `실행하지 않음`입니다. Writing 검사는 실행하지만 별도 의미 평가기가 구성되지 않은 기본 실행은 결과 원문을 숨깁니다. `lervo trace`, `lervo doctor`는 아직 구현되지 않았습니다. 구체적인 범위와 완료 조건은 `LERVO_V0_PLAN.md`에 정의합니다.

이전 실험 버전이 만든 `.roven` 경로는 자동으로 읽거나 `.lervo`와 함께 사용하지 않습니다. `lervo init`은 두 관리 경로가 공존하는 상태를 만들지 않도록 초기화를 차단합니다. 기존 상태를 옮기는 작업은 event hash chain과 CAS 주소를 보존하는 별도 명칭 migration으로 다룹니다.
