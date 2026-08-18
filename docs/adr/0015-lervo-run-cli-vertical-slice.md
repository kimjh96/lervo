# ADR-0015: `lervo run` 한 파일 CLI 수직 슬라이스

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Managed provider coordinator, project storage와 Codex/Claude adapter는 각각 동작했지만 사용자가 하나의 명령으로 연결할 실행 진입점이 없었습니다. CLI가 이 구성 요소의 내부 단계를 직접 복제하면 context gate와 자원 정리 의미가 다른 실행 경로가 생깁니다. 아직 project policy 파일과 verification command 계약도 없으므로 지원한다고 표시할 수 있는 범위를 좁혀야 합니다.

## 결정

### 명령과 현재 범위

첫 명령 형식은 다음과 같습니다.

```text
lervo run --provider <codex|claude> --path <relative-path> [--skill <skill-id> ...] [--root <path>] [--risk <level>] [--json] <request>
```

`provider`, 저장소 상대 `path` 하나와 비어 있지 않은 작업 문장은 필수입니다. 경로는 storage나 provider를 열기 전에 공통 repository path 규칙으로 정규화합니다. 현재 명령은 정확히 한 파일을 변경하는 `managed_write`만 실행합니다. 여러 경로, 사람 승인 대기, 읽기 전용 선택과 provider별 추가 권한은 이 명령에 노출하지 않습니다.

후속 [ADR-0016](./0016-local-skill-resolution-and-lock.md)에 따라 `--skill`을 반복해 해석할 스킬 ID를 명시할 수 있습니다. 이 옵션은 discovery와 lock만 수행하며 현재 CLI가 스킬을 호출하거나 사용했다는 뜻은 아닙니다.

Project policy schema가 생기기 전까지 CLI는 고정된 `developer` Role을 사용합니다. 이 Role은 root `AGENTS.md`의 E3를 필수로 하고 파일 읽기·쓰기와 제한된 로컬 shell만 허용하며 network, 외부 메시지, deploy와 일반 data mutation을 거부합니다. 산출물 presentation은 `machine`, writing policy는 `null`입니다. 이 기본값은 사용자 policy를 읽은 것처럼 표시하지 않으며 policy schema가 구현되면 교체합니다.

### Application service와 자원 수명

CLI argument 처리와 출력은 `run-command`가, provider-neutral 실행 조합은 `managed-run` application service가 맡습니다. `main`은 명령 라우팅만 하고 기존 init 구현도 별도 모듈로 옮깁니다. Application service는 다음 순서를 소유합니다.

1. Project storage를 열고 검증된 manifest와 document registry를 읽습니다.
2. 요청한 스킬을 해석해 lock을 기록하고 선택 결과를 고정 Role에 결속합니다.
3. 선택한 provider adapter에 같은 artifact store의 read port를 연결합니다.
4. Run/session/event/context ID와 고정 Role policy digest를 만들고 `ManagedProviderRunCoordinator`를 실행합니다.
5. Coordinator가 검증해 CAS에 저장한 결과를 같은 artifact store에서 읽습니다.
6. 성공과 실패 모두 project storage를 닫은 뒤 결과 또는 오류를 반환합니다.

실행 실패와 storage 종료 실패가 겹치면 `cleanup_failed`가 대표 CLI 오류가 되고 두 원인은 로컬 `AggregateError`에만 보존합니다. Provider 시작 실패 뒤에도 adapter와 storage가 닫혔는지 fixture에서 확인합니다. Application service의 storage, adapter와 ID factory는 좁은 dependency port로 교체할 수 있어 CLI 테스트가 실제 외부 provider process에 의존하지 않습니다.

### 출력과 증거

성공 출력은 provider, run ID, 검증된 변경 경로, provider 결과와 두 검증 상태를 표시합니다. 현재 project verification과 writing 의미 검사를 실행하지 않으므로 각각 `실행하지 않음` 또는 `not_run`으로 표시합니다. 결과를 로컬 터미널에 보여주는 것은 공개 승인이나 E4를 뜻하지 않습니다.

JSON 출력은 같은 로컬 결과와 artifact 좌표를 포함합니다. Raw request와 provider 결과는 기존 규칙대로 event에 넣지 않으며 각각 digest와 artifact ID만 남깁니다. 새 event type이나 payload field는 추가하지 않습니다. 직접 실행한 다른 provider process의 변경은 이 명령의 run으로 가져오지 않으며 계속 `unmanaged`입니다.

## 결과

- 사용자는 초기화된 저장소에서 Codex와 Claude의 동일한 한 파일 managed run을 실행할 수 있습니다.
- CLI가 context 선택, permit, snapshot과 결과 저장 규칙을 복제하지 않고 기존 coordinator를 그대로 사용합니다.
- 기능 검증과 writing 검증이 아직 없다는 상태를 성공으로 오인하지 않습니다.
- Codex/Claude fixture는 `AGENTS.md` E3, 한 파일 `file.changed`, 결과 CAS, 원문 비보존과 자원 정리를 전체 CLI 경로에서 검증합니다.
