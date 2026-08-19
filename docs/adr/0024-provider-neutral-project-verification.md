# ADR-0024: 공급자 중립 프로젝트 검증과 결과 artifact

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Provider가 작업 중 명령을 실행했다는 telemetry만으로는 프로젝트 검증을 통과했다고 볼 수 없습니다. 어떤 명령이 필수인지, 어느 저장소 snapshot을 검사했는지, 실패 뒤 다른 명령이 실제로 실행됐는지와 결과 원문이 보존됐는지를 별도 계약으로 증명해야 합니다.

검증 명령을 하나의 project manifest나 계속 커지는 로그 문서에 모으면 독립적인 suite가 같은 파일을 자주 수정합니다. Shell 문자열을 그대로 실행하면 인자 경계와 실제 실행 내용을 안정적으로 재구성하기도 어렵습니다.

## 결정

### Suite는 프로젝트별 파일로 분리한다

검증 suite는 `.lervo/verifications/<suiteId>.yaml`에 하나씩 둡니다. `lervo init`은 빈 `verifications/` 디렉터리만 만들고 기본 명령이나 통과 결과를 만들지 않습니다. Loader는 요청받은 최대 64 KiB 파일 하나만 안정적으로 읽으며 파일명과 suite ID, schema와 의미 계약을 확인합니다. Symbolic link, 읽는 중 변경, 잘못된 ID와 계약 밖의 파일은 실행 입력으로 사용하지 않습니다.

Suite는 순서가 고정된 최대 32개 명령을 가집니다. 각 명령은 command ID, executable, arguments, 저장소 상대 cwd, timeout, stdout·stderr 합산 byte 한도와 전달할 환경 변수 이름만 선언합니다. 실행 파일을 찾기 위한 `PATH`/`Path`와 명시한 변수만 자식 process에 전달합니다. Shell을 열지 않고 executable과 arguments를 직접 실행합니다. v0의 `stopOnFailure`는 항상 `true`이며 첫 실패 뒤 명령은 실행하지 않고 `not_run`으로 기록합니다.

### 실행 결과와 원문을 분리한다

`@lervo/verification-contract`는 suite/result canonical hash와 실행 없는 의미 검증을 소유합니다. `@lervo/verification`은 provider adapter 밖에서 같은 명령 계약을 실행합니다. 실행 전에 저장소 root와 모든 cwd가 실제 디렉터리이며 저장소 내부 symlink로 우회되지 않았는지 확인합니다. 같은 repository snapshot port로 요청 revision을 실행 직전 다시 확인하고, 모든 명령 뒤 revision도 같을 때만 결과를 만듭니다. Timeout, 취소와 output 한도 초과 시 process를 종료하고 성공으로 올리지 않습니다.

stdout와 stderr는 명령별 독립 CAS artifact로 저장합니다. `VerificationResult`에는 원문 대신 artifact ID·URI·content hash·byte count만 넣습니다. 결과는 suite ID/hash, 실행 대상 repository snapshot hash, 전체 시간과 상태, 순서별 command digest·상태·exit code·시간·실패 사유에 결속합니다. 전체 result JSON도 CAS에 저장하고 다시 읽어 bytes를 확인합니다. Verification ID는 ID를 제외한 canonical 결과 내용에서 계산합니다.

전체 상태는 다음과 같습니다.

- `passed`: 모든 명령이 실행되어 exit code 0으로 끝났습니다.
- `failed`: 하나라도 nonzero exit, timeout, output 한도 초과 또는 실행 오류이고 취소는 아닙니다.
- `cancelled`: 실행 전이나 실행 중 취소됐습니다.

명령 상태는 `passed`, `failed`, `timed_out`, `output_limit_exceeded`, `execution_error`, `cancelled`, `not_run`을 구분합니다. 의미 검증기는 전체 상태를 명령 상태에서 다시 계산하고 suite hash·명령 순서·digest, exit code, 시간, artifact 좌표와 Verification ID가 맞는지 검사합니다. 따라서 실패한 결과의 최상위 상태만 `passed`로 바꾼 artifact는 거부됩니다.

### 당시 실행 경계

이 ADR을 채택한 단계는 suite loader, 실행기와 결과 artifact까지만 제공했습니다. 당시에는 `verification.started`·`verification.completed` event와 `lervo run`에 연결하지 않았습니다. Result artifact가 존재한다는 사실만으로 run 완료, writing 공개 또는 지식 검증을 주장하지 않는 원칙은 그대로 유지합니다. 이후 orchestrator 결합과 event 순서는 [ADR-0032](./0032-managed-run-project-verification.md)에서 결정했습니다.

## 개인정보와 실패 의미

명령 정의는 프로젝트 로컬 suite 원본에만 있고 결과 metadata와 event에는 command text와 argument를 복제하지 않습니다. 명령 output은 로컬 CAS 원문이며 result에는 hash 좌표만 둡니다. 허용한 환경 변수의 이름과 값도 result에 저장하지 않습니다. 명령이 출력한 비밀정보는 로컬 CAS 보존 정책의 적용을 받으며 Hub 전송은 별도 허용 정책 없이는 하지 않습니다.

- `invalid_verification_suite`: Suite schema, command ID, executable, argument 또는 상대 cwd 계약이 유효하지 않습니다. 명령을 시작하지 않습니다.
- `verification_suite_not_found`: 요청한 suite 파일이 없습니다. 다른 suite로 대체하거나 검증을 통과로 표시하지 않습니다.
- `verification_layout_invalid`: Suite 디렉터리나 파일을 안전하고 안정적으로 읽지 못했습니다. 명령을 시작하지 않습니다.
- `invalid_verification_request`: Repository snapshot hash나 clock 등 실행 좌표가 유효하지 않습니다.
- `command_working_directory_invalid`: 저장소 root 또는 command cwd의 안전성을 증명하지 못했습니다. 전체 suite를 시작하지 않습니다.
- `repository_snapshot_failed` / `repository_snapshot_mismatch`: Snapshot을 안전하게 수집하지 못했거나 요청 revision과 실행 직전 상태가 다릅니다. 명령을 시작하지 않습니다.
- `repository_changed_during_verification`: 명령 실행 중 repository snapshot이 바뀌었습니다. Output artifact가 남더라도 정상 result artifact를 만들지 않습니다.
- `artifact_storage_failed`: Output 또는 result를 CAS에 저장하고 다시 확인하지 못했습니다. 정상 결과를 반환하지 않습니다.
- `result_contract_invalid`: 결과의 구조나 의미가 suite·명령 증거와 다릅니다. `passed`, `failed`, `cancelled` 어느 상태로도 공개하지 않습니다.

명령 자체의 nonzero exit, timeout, output 한도 초과, 실행 오류와 취소는 예외 원문이 아니라 `VerificationResult`의 명시적 상태입니다.

## 결과

Codex와 Claude가 어떤 명령을 실행했는지와 무관하게 같은 프로젝트 검증기를 사용할 수 있습니다. 실패·미실행·취소를 성공과 구분하고, 원문 로그를 event에 복제하지 않은 채 결과를 repository snapshot과 suite에 결속할 수 있습니다. Writing 공개 gate는 [ADR-0025](./0025-writing-publication-gate.md)에서 구현했으며, 다음 숙의 단계는 두 결과 계약을 공통 검증 근거로 사용합니다.
