# Roven v0 구현 계획

상태: `0.1-draft`  
기준일: 2026-08-18

## v0 목표

하나의 실제 저장소에서 `roven init`과 `roven run`을 사용해 Codex 또는 Claude 작업을 실행하고, 필수 문서의 선택 이유·현재 hash·컨텍스트 주입 receipt·사용 스킬·파일 변경·검증 결과를 로컬 trace로 재구성합니다. Hub, Slack, 그래프 DB, 임베딩은 이 기반이 증명된 뒤 확장합니다.

## 범위

포함:

- TypeScript/Node.js monorepo와 CLI
- `.roven/project.yaml`, policy 및 document registry schema
- SQLite event store, CAS, outbox interface
- deterministic context router와 문서 E0~E3 receipt
- 전문 에이전트가 함께 읽는 shared context publication과 역할 간 handoff bundle
- capability gate 및 unmanaged change 탐지
- Codex/Claude adapter contract와 최소 어댑터
- 스킬 discovery/lock/usage event
- `AGENTS.md`, `CLAUDE.md`, `README.md` managed block 및 staleness 검사
- `roven trace` 텍스트/JSON 출력
- fixture 저장소 기반 contract/acceptance test
- 사람 대상 산출물의 provider 중립 writing 정책과 공개 전 평가

제외:

- 완성형 중앙 SaaS와 멀티테넌시 과금
- Slack/Discord 실제 배포 연동
- 외부 graph database
- 기본 실행에 필요한 vector database
- 모든 직군용 완성 스킬 카탈로그
- 에이전트의 의미적 “이해”를 증명한다는 주장

## 구현 단계

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

- `roven init`, project identity, 설정 로더 구현
- SQLite WAL event store와 CAS 구현
- 순서, hash chain, crash recovery, outbox 멱등성 테스트
- 기존 파일을 보존하는 dry-run/patch 출력 구현

완료 조건:

- 빈 저장소와 기존 문서가 있는 저장소 모두 idempotent init
- Hub가 없어도 모든 로컬 상태 저장 및 조회 가능
- 사용자 작성 문서 영역을 byte-level fixture로 보존

구현 현황(2026-08-18): **M1 완료.** 안전한 `roven init`, project별 SQLite event/outbox와 CAS에 이어 project storage bootstrap을 구현했습니다. Bootstrap은 검증된 manifest와 canonical 경로만 사용하며, 다른 project database와 심볼릭 링크를 거부합니다. 부분 개방 시 이미 연 자원을 정리하고 정상 handle은 멱등적으로 닫힙니다. 실제 저장소 fixture에서 event와 artifact 재시작 복구, Hub 비활성 시 outbox 미생성, manifest/layout 오류의 무부작용을 검증했습니다. 결정은 [ADR-0004](./docs/adr/0004-project-storage-bootstrap.md)에 기록했습니다.

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

구현 현황(2026-08-18): **M2 완료.** `@roven/context`가 E0/E1 선택, 안전한 전체 bytes 읽기와 E2 체인 무결성을 소유하고 `@roven/context-delivery`가 writing policy까지 결속한 provider-neutral E3를 만듭니다. `@roven/orchestrator`는 E1/E2/E3를 append-only event store에 원자적으로 기록하고, Role의 파일 쓰기 정책·현재 generation·필수 문서 E3를 경로별 1회용 permit에 연결합니다. 쓰기 직전 snapshot 변경, managed file change, compaction/restart와 telemetry transaction 실패가 capability를 닫는 전이를 실제 SQLite fixture로 검증했습니다. 실제 provider 신호 수집과 Codex/Claude 실행은 M3에 남습니다. 결정은 [ADR-0006](./docs/adr/0006-deterministic-context-preparation.md), [ADR-0007](./docs/adr/0007-provider-neutral-context-delivery.md), [ADR-0008](./docs/adr/0008-managed-context-gate-orchestration.md)에 기록했습니다.

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

구현 현황(2026-08-19): **Managed provider run의 검증된 로컬 결과 artifact까지 완료, M3 진행 중.** Codex·Claude 실제 adapter가 terminal event와 분리된 같은 `AdapterTurnResult` 계약을 구현합니다. Coordinator는 session/turn 좌표, UTF-8, 시각, 4 MiB 한도와 실제 hash·byte count를 검증하고, provider 종료와 snapshot 성공 뒤 CAS에 저장해 다시 읽은 bytes까지 대조합니다. `run.completed`에는 원문이나 URI 대신 content hash와 artifact ID만 남습니다. 결과 누락, 계약 불일치, CAS 변조는 각각 fail-closed 테스트로 검증했습니다. 읽기 전용 실행 경계와 unmanaged 변경 탐지는 유지되며, 경로별 write permit bridge가 없으므로 `roven run` CLI는 아직 공개하지 않았습니다. 결정은 [ADR-0009](./docs/adr/0009-codex-app-server-managed-adapter.md), [ADR-0010](./docs/adr/0010-claude-agent-sdk-managed-adapter.md), [ADR-0011](./docs/adr/0011-managed-provider-run-lifecycle.md), [ADR-0012](./docs/adr/0012-provider-result-artifacts.md)에 기록했습니다.

### M4: 스킬과 문서 수명주기

- 로컬/사용자/외부 스킬 discovery와 충돌 해석
- `skills.lock`, trust/compatibility 판정, invocation event
- document registry, managed block compiler, stale detector
- 자동 수정 patch/candidate 생성

완료 조건:

- 동일 id의 스킬 충돌이 결정적으로 해석되고 근거가 trace에 표시
- 실제 사용한 스킬 버전/hash를 run에서 조회 가능
- AGENTS/CLAUDE/README의 노후화 fixture를 검출
- managed block 밖 사용자 내용 무변경

### M5: 검증과 지식 후보

- 프로젝트별 verification command와 결과 artifact
- 사람 대상 산출물의 결정적 writing 검사와 생성 후 별도 의미 평가 실행
- observation/candidate 생성 및 paths/evidence 연결
- 검증 revision 기반 stale 전이
- `roven doctor`, `roven trace` 완성

완료 조건:

- 기능 작업과 버그 수정 acceptance scenario 통과
- 실패한 검증을 성공으로 표시할 수 없음
- 실행되지 않거나 실패한 필수 writing 검사가 있는 산출물은 공개할 수 없음
- candidate에서 verified로의 전이가 정책과 evidence 없이는 거부됨

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
  -> roven init --dry-run / apply
  -> roven run --provider codex "작은 기능 변경"
  -> AGENTS.md + path 문서 E3 확인
  -> 한 파일 변경
  -> 지정 테스트 실행
  -> roven trace last
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

## 선행 결정이 필요한 항목

구현을 시작하며 ADR로 확정할 항목입니다.

- Codex/Claude 각각에서 E3 receipt를 만드는 가장 안정적인 통제 지점
- provider context compaction 탐지 가능 범위와 보수적 fallback
- Git worktree별 Node/state 격리 규칙
- event payload 기본 보존 기간과 원문 artifact 암호화
- 사용자 전역 스킬과 프로젝트 고정 스킬의 최종 우선순위
- managed block 문법과 Markdown parser 선택

## v0 이후 순서

1. Hub trace UI와 정책 배포
2. Slack/Discord command gateway와 승인 UX
3. 연구자·마케터·디자이너 RoleProfile/평가 묶음
4. 명시적 관계 기반 지식 그래프 시각화
5. 실제 검색 실패 데이터를 바탕으로 임베딩/RAG 도입
6. 조직 단위 비용·품질·가드레일 분석

## 다음 실행 작업

다음 구현 작업은 **M3 managed write bridge**입니다. Provider의 파일 변경 요청을 orchestrator의 경로별 1회용 permit와 실제 before/after bytes 확인에 연결합니다. 그 뒤에만 `roven run`을 공개해 같은 작은 작업을 Codex와 Claude 경로에서 실행하고, 검증된 결과 artifact를 사용자에게 보여주며 `file.changed`와 trace 좌표를 재구성합니다. Permit bridge를 우회한 변경은 계속 `unmanaged`로 실패해야 합니다.
