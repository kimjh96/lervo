# ADR-0032: `lervo run` 프로젝트 검증 연결

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

`@lervo/verification`은 안전한 suite 실행과 결과 artifact를 이미 제공하지만, `lervo run`은 이를 실행하지 않아 항상 `not_run`을 표시했습니다. Provider가 작업 중 실행한 명령은 작업 과정의 관측 정보일 뿐, 프로젝트가 정한 검증을 통과했다는 증거가 아닙니다.

검증을 CLI에서 run 완료 뒤에 따로 실행하면 append-only event의 `run.completed`가 실제 최종 상태와 달라집니다. 반대로 명령 실행 구현을 orchestrator에 넣으면 공급자 중립 실행 순서와 운영체제 process 제어가 한 모듈에 섞입니다.

## 결정

### Suite 선택은 명시적으로 받는다

공개 `lervo run`은 `--verification <suite-id>`를 한 번 이상 요구합니다. 최대 16개이며 중복은 거부합니다. Suite는 ID 순서로 실행해 같은 입력의 순서를 고정합니다. `lervo init`은 빈 `.lervo/verifications/`만 만들기 때문에 기본 검증을 실행했다고 추정하지 않습니다.

CLI application service는 project storage를 연 직후, provider를 시작하기 전에 요청한 suite 원본을 모두 읽습니다. 파일이 없거나 layout·schema가 유효하지 않으면 provider를 시작하지 않습니다. 현재 고정 developer Role의 `verification.suiteIds`도 이 목록과 정확히 같아야 합니다.

### 실행 방법과 순서를 분리한다

CLI의 작은 검증 어댑터가 suite loader, shell 없는 command runner, repository snapshot과 같은 artifact store를 조합합니다. Orchestrator는 `ManagedProjectVerifier` port만 알며 Node process나 suite 파일 형식을 알지 않습니다. `@lervo/verification`도 CLI, provider adapter와 event store를 알지 않습니다.

Managed run의 순서는 provider 종료, 실행 후 repository snapshot, provider 결과 CAS 저장·재검증, project verification, run 완료입니다. 검증기는 실행 후 snapshot revision을 받아 suite 실행 직전과 직후에 같은 저장소 상태인지 다시 확인합니다. 검증 결과가 돌아오면 orchestrator가 result 의미 계약, suite ID/hash, repository revision, artifact media type·hash·ID·URI·크기와 canonical JSON bytes를 다시 검증합니다. Result가 가리키는 stdout·stderr CAS도 모두 다시 읽어 hash, ID, URI와 크기를 확인합니다.

### Event는 원본 대신 검증 좌표를 남긴다

각 suite를 호출하기 직전에 `verification.started`를 기록합니다. 필수 payload는 다음과 같습니다.

- `suiteId`, `suiteHash`
- `repositoryRevision`

정상적인 `VerificationResult`와 CAS 원본을 다시 확인한 뒤 `verification.completed`를 기록합니다. 필수 payload는 다음과 같습니다.

- `verificationId`, `suiteId`, `suiteHash`, `repositoryRevision`
- `status`: `passed`, `failed`, `cancelled`
- `resultArtifactId`, `resultContentHash`
- `nonPassedCommandIds`

`resultArtifactId`는 content hash에서 다시 계산한 값과 같아야 합니다. Command text와 arguments, stdout·stderr, 환경 변수 이름과 값, 절대 경로, provider 결과와 raw task는 두 event에 넣지 않습니다. 상세 output은 로컬 CAS 원본에만 있습니다.

`run.completed`는 provider 결과 hash, provider·verification result artifact ID와 `verificationStatus`를 필수로 가집니다. 공개 CLI에서 모든 suite가 통과한 경우에만 `verificationStatus=passed`로 완료됩니다. 내부 coordinator를 suite 없이 호출하는 기존 호환 경로만 `not_run`을 유지합니다.

### 실패를 완료로 바꾸지 않는다

Developer Role의 `failureDisposition=fail_run`에서 suite 하나라도 실패하면 해당 `verification.completed`를 기록한 다음 `run.failed.failureCode=verification_failed`로 끝냅니다. `run.completed`는 기록하지 않습니다. 실패 오류에는 검증된 suite ID만 넣고 command나 output은 넣지 않습니다.

취소 결과는 `cancelled`로 run을 끝냅니다. Verifier 예외, 일부 suite 누락, result schema·suite·revision 불일치와 CAS 위조는 `verification_failed`이며 정상 완료 event를 만들지 않습니다. `verification.started` 뒤 result 원본을 확인하지 못하면 `verification.completed`를 추정해서 만들지 않습니다. 이미 저장된 CAS object는 주소 기반 고아로 남을 수 있지만 완료 증거로 사용하지 않습니다.

## 개인정보와 비밀정보

Suite 파일과 command output은 로컬 원본입니다. Event와 일반 CLI 오류에는 ID, 상태와 hash만 남깁니다. 환경 변수 값은 result에도 저장하지 않습니다. Output CAS를 Hub에 보내는 정책은 이 ADR의 범위가 아니며, 별도 허용이 없으면 로컬에 둡니다.

## 결과

Codex와 Claude는 같은 provider-neutral 검증 경계를 거칩니다. `run.completed`는 실제 project verification보다 먼저 기록될 수 없고, 실패 결과의 상태나 CAS 좌표를 바꿔 성공으로 만들 수 없습니다. 검증 실행, orchestration, event 정리와 CLI 출력의 관심사는 각각 별도 모듈에 남습니다.
