# ADR-0099: CLI 최초 공개 게시 durable 저장·대화형 adapter 계약

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0098의 실행 코어는 게시 전에 durable 예약을 요구하지만 저장 구현은 port로만 남아 있었습니다. Process-local 저장은 재시작이나 응답 유실 뒤 같은 bootstrap을 다시 게시할 수 있어 일회성 경계를 지키지 못합니다.

최초 scoped package의 직접 게시는 npm CLI에서 `--access public`이 필요합니다. npm은 직접 게시에 계정 2FA 또는 bypass-2FA granular token을 허용하므로 TTY 존재만으로 실제 두 번째 인증 수단 사용을 증명할 수 없습니다. 따라서 자동화 token을 숨겨서 사용하는 adapter나 단순 성공 code를 2FA 증거로 기록하면 안 됩니다.

## 결정

파일 저장 adapter는 구성된 절대 root 아래에 예약별 directory를 만들고 다음 두 문서만 둡니다.

```text
<root>/<reservation-id>/
  reservation.json
  terminal.json
```

Directory는 mode `0700`, 문서는 `0600`이며 symlink, group·other 권한, 64 KiB 초과와 잘못된 JSON을 거부합니다. `reservation.json`은 directory와 함께 한 번만 생성합니다. Directory만 생기고 문서 쓰기 전에 중단된 경우도 재예약하지 않는 fail-closed 상태입니다.

`terminal.json`은 `published`, `aborted_before_publication`, `publication_unknown` 중 하나와 그 canonical digest를 envelope로 묶어 `wx`로 한 번만 기록합니다. 별도 상태 파일을 계속 추가하거나 기존 파일을 덮어쓰지 않습니다. 예약과 terminal의 ID·digest가 달라지거나 envelope digest가 바뀌면 전체 조회를 거부합니다. 완료 저장 뒤 호출 응답을 잃어 `markUnknown`이 뒤늦게 와도 기존 `published`를 바꾸지 않습니다. POSIX에서는 파일과 새 directory entry를 모두 동기화하며 Windows에서는 file handle 동기화를 사용합니다.

npm 대화형 adapter는 실행 준비와 실제 publisher를 분리합니다. 준비 단계는 다음을 모두 확인하며 실패하면 public registry 조회와 예약 전에 중단할 수 있습니다.

- stdin·stdout·stderr가 모두 TTY임
- CI와 GitHub Actions가 아님
- 환경 변수에 npm·pnpm token, auth 또는 OTP가 주입되지 않음
- npm 11.5.1 이상이며 public registry profile의 2FA mode가 `auth-and-writes`이고 pending이 아님
- 사용자가 exact package·version, 대화형 2FA 사용과 bypass token 미사용 문장을 그대로 확인함

실제 publish는 isolated cwd·cache·빈 global config를 사용하되 명시한 기존 user config만 인증 source로 허용합니다. Exact tarball, registry, dist-tag, public access와 lifecycle script 비실행을 CLI 인자로 고정하고 `--otp`나 credential을 인자로 전달하지 않습니다. Publish process는 현재 TTY를 상속하며 stdout·stderr를 수집하거나 영수증에 저장하지 않습니다.

명령이 끝난 뒤 사용자가 `2FA 확인을 완료했습니다`를 입력해야 registry metadata·dist-tag 검증으로 넘어갑니다. 이 값은 사람이 본 challenge에 대한 실행 중 확인일 뿐 npm이 서명한 2FA proof가 아닙니다. Bypass token 사용을 프로그램이 확실히 구분할 수 없으므로 이 확인이 없으면 게시가 이미 일어났을 가능성이 있는 `publication_unknown` 경로로 닫습니다. 성공 영수증에도 이 확인 문장, profile, 사용자명, user config, token, OTP와 npm 출력은 넣지 않습니다.

준비·게시·닫기는 process-local session이며 임시 cache와 global config는 닫을 때 제거합니다. User config를 복사하거나 수정하지 않습니다. 현재 CLI command는 이 session을 열지 않으므로 실제 외부 게시 경로는 활성화되지 않았습니다.

## 결과

Fixture는 재시작 조회, 중복 예약, 두 번째 terminal, 부분 directory, symlink·권한, published 보존, non-TTY, 환경 OTP, 잘못된 2FA mode, 두 번의 명시적 확인과 준비 실패 시 하위 호출 미실행을 검증합니다. 실제 npm 계정, 2FA challenge, package 생성과 user config 안전성은 fixture가 증명하지 않습니다.

새 runtime event나 project 상태는 없습니다. 저장 상태 이름과 필수 필드는 ADR-0098의 예약 port에만 속하며 credential·개인 식별 정보·외부 응답 원문을 포함하지 않습니다.
