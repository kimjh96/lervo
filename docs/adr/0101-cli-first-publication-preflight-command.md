# ADR-0101: CLI 최초 공개 게시 사전 점검 명령

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0100은 읽기 전용 report와 관측 port를 정의했지만 실제 release 파일, durable 예약 저장소와 npm account 관측을 연결하는 명령은 없었습니다. 각 port를 임의 스크립트로 조합하면 잘못된 경로, 오래된 입력, 환경 credential과 외부 관측 실패가 서로 다른 의미로 출력될 수 있습니다.

사전 점검은 실행 허가가 아니므로 결과 파일을 누적하거나 실제 publisher와 같은 명령에서 실행해서도 안 됩니다.

## 결정

저장소 명령 `pnpm release:bootstrap:preflight`를 추가합니다. 다음 절대 경로와 `--online`을 모두 명시해야 합니다.

```text
--release-directory <path>
--publication-authorization <path>
--bootstrap <path>
--reservation-root <path>
--user-config <path>
--online
[--json]
```

`--online`이 없거나 경로가 상대 경로이면 원본을 열거나 외부 observer를 호출하기 전에 거부합니다. Publication authorization, bootstrap과 exact tarball은 크기가 제한된 regular file로 읽고, public npm·예약·npm profile 관측이 끝난 뒤 같은 bytes인지 다시 확인합니다. 원본이 바뀌면 report를 출력하지 않습니다.

예약 adapter의 `observe`만 전달하며 `reserve`, terminal 쓰기와 publisher port는 command 조정기에 없습니다. Public package는 인증 없는 registry observer로 읽고, npm 준비 observer는 다음 경계를 사용합니다.

- 세 TTY·비CI·환경 npm auth·token·OTP 부재를 먼저 확인하며 위반하면 npm을 실행하지 않음
- npm 11.5.1 이상에서 `profile get --registry https://registry.npmjs.org --json`만 실행
- 임시 owner-only directory, cache와 빈 global config를 쓰고 명시한 기존 user config만 연결
- user config bytes를 실행 전후 대조하고 임시 상태는 성공·실패 모두 제거
- client·profile 실패를 `npm_client_unavailable`, `npm_profile_unavailable`로 제한하고 오류 원문을 버림

기본 출력은 한국어로 검사별 `준비됨`, `차단됨`, `확인 불가`와 사람이 바로 이해할 수 있는 다음 확인 내용을 보여 줍니다. `--json`은 ADR-0100 report v1만 stdout에 출력합니다. 전체 `ready`만 exit code 0이며 그 밖의 정상 report와 명령 실패는 1입니다. 어느 출력도 입력 경로, profile, 사용자명, 환경 변수 이름·값, token, OTP, npm 출력과 오류 원문을 포함하지 않습니다.

Report는 stdout에만 두고 새 결과 문서를 만들지 않습니다. 명령은 확인 prompt, 예약, package 게시, Trusted Publisher·GitHub·npm 설정 변경을 실행하지 않습니다. 임시 npm cache 생성·제거는 외부 설정 변경이나 실행 상태로 표현하지 않습니다.

## 결과

Fixture는 전체 ready 조합, reservation root 비생성, online 관측 중 tarball 변경, `--online` 선행 검사, 사람이 읽는 문장, 격리된 exact npm 명령·임시 상태 제거, 환경 credential에서 npm 미실행과 client 오류 비노출을 확인합니다.

`ready` report 뒤에도 실제 실행은 public package 재관측, durable 예약과 두 사람 확인을 생략할 수 없습니다. 새 runtime event·project 상태·telemetry는 없습니다.
