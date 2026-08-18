# Roven

Roven(로븐)은 저장소 안에서 독립적으로 동작하면서, 필요할 때 중앙에서 여러 프로젝트와 AI 에이전트를 관리할 수 있는 로컬 우선(local-first) 에이전트 운영 체계입니다.

현재 상태: M0·M1·M2·M3 완료, `roven run` 한 파일 수직 슬라이스 완료 (2026-08-19)

## 목표

- Codex와 Claude를 동일한 실행 계약과 증거 모델로 지원합니다.
- 개발자뿐 아니라 연구, 마케팅, 디자인 등 여러 전문 에이전트를 역할 프로필로 구성합니다.
- 에이전트가 어떤 근거와 문서를 선택하고 실제로 로드했는지 추적합니다.
- 작업 결과에서 재사용 가능한 지식을 후보로 만들고 검증 후 승격합니다.
- `AGENTS.md`, `CLAUDE.md`, `README.md`와 사용자/외부 스킬의 노후화 및 사용 여부를 관리합니다.
- 각 저장소는 오프라인에서도 동작하며, 선택적으로 Roven Hub와 동기화합니다.
- Slack, Discord 같은 채널에서 프로젝트 조회와 승인된 작업 실행을 요청할 수 있게 확장합니다.

## 설계 문서

- [제품 비전](./ROVEN_VISION.md)
- [시스템 아키텍처](./ROVEN_ARCHITECTURE.md)
- [실행 및 증거 규격](./ROVEN_EXECUTION_SPEC.md)
- [v0 구현 계획](./ROVEN_V0_PLAN.md)
- [M0 계약과 데이터 기본값 ADR](./docs/adr/0001-m0-contracts-and-data-defaults.md)
- [`roven init` 안전한 초기화 ADR](./docs/adr/0002-safe-project-initialization.md)
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
- [`roven run` 한 파일 CLI 수직 슬라이스 ADR](./docs/adr/0015-roven-run-cli-vertical-slice.md)
- [로컬 스킬 해석과 실행별 lock ADR](./docs/adr/0016-local-skill-resolution-and-lock.md)

## 현재 구현

- `@roven/schemas`: project, event, context evidence, shared context/handoff, adapter, role, skill manifest/lock, document registry, writing policy/evaluation JSON Schema와 파생 TypeScript 타입. Adapter 계약은 session/context, managed write와 provider 관측 event를 분리해 관리
- `@roven/skills`: 프로젝트·사용자 스킬 패키지의 안전한 discovery와 전체 내용 hash, 보수적 호환성 판정, 결정적 우선순위와 원자적 `skills.lock` 기록
- `@roven/event-contract`: 공급자와 저장 구현에 독립적인 payload 정리, canonical JSON과 event hash 규칙
- `@roven/storage-contract`: event transaction, outbox와 artifact 저장소의 공통 interface
- `@roven/core`: E0~E4 assurance, 필수 E3 쓰기 게이트, 역할 간 shared context 접근·handoff 판정, 한국어 writing 검사와 공개 게이트, 실패 처분
- `@roven/context`: `AGENTS.md` 계층·path·Role·handoff 기반 E1 선택, 안전한 전체 파일 읽기, E2 무결성 검증과 snapshot 무효화 판정
- `@roven/context-delivery`: 검증된 E2와 schema-valid writing policy binding을 inline/CAS envelope로 조립하고 공통 adapter receipt 판정 뒤에만 E3를 만드는 공급자 중립 경계
- `@roven/orchestrator`: E1/E2/E3와 1회용 파일 쓰기 permit를 provider 요청에 연결하고, 실제 변경 hash·snapshot·결과 artifact를 함께 검증하는 fail-closed 상태 머신
- `@roven/project`: 관리 경로, project 설정과 원자적인 초기화 계획·적용
- `@roven/project-storage`: 검증된 project 설정과 공통 경로로 SQLite event/outbox와 CAS를 함께 여는 실행 진입점
- `@roven/event-store-sqlite`: project별 WAL event store, 원자적 outbox, versioned migration, append-only hash chain과 재시작 무결성 검사
- `@roven/cas`: SHA-256 주소를 사용하는 로컬 원문·artifact 저장소
- `@roven/adapter-contract`: Codex와 Claude가 같은 역할·writing 정책·turn 수락·session 유효 기능·managed write 요청/결정/완료 계약을 따르도록 강제하는 provider adapter interface와 contract suite
- `@roven/adapter-codex`: Codex app-server thread/turn과 controlled context를 관리하고 file-change 승인을 Roven의 1회용 permit에 연결하는 adapter
- `@roven/adapter-claude`: Claude Agent SDK context replay를 검증하고 Write/Edit hook을 Roven의 1회용 permit에 연결하는 adapter
- `@roven/cli`: 안전한 `roven init`과 project storage·context·provider adapter를 연결하는 한 파일 `roven run` 명령 진입점
- `pnpm check`: 타입, schema fixture, contract test, 패키지 빌드, 문서 수명주기 기본 검사

## 핵심 명제

Roven은 모델 자체가 아니라 **에이전트가 일하는 환경과 계약**을 제품화합니다. 그래프와 RAG는 유용하지만 원본 지식이나 실행 증거를 대신하지 않습니다. 원본은 버전 관리되는 문서, 저장소 상태, 스킬 정의, 검증 결과와 변경 불가능한 실행 이벤트이며 검색 인덱스는 언제든 재생성할 수 있어야 합니다.

## 예정된 사용 모습

```sh
pnpm build
pnpm roven init --dry-run
pnpm roven init
pnpm roven run --provider codex --path src/example.ts "DD 기능 개발"
roven trace last
roven doctor
```

`roven init`과 한 파일 `roven run`은 현재 저장소의 로컬 패키지 명령으로 실행할 수 있습니다. `roven run`은 project verification과 writing 공개 검사를 아직 실행하지 않으며 출력에 `실행하지 않음`으로 표시합니다. `roven trace`, `roven doctor`는 아직 구현되지 않았습니다. 구체적인 범위와 완료 조건은 `ROVEN_V0_PLAN.md`에 정의합니다.
