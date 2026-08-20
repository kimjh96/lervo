# ADR-0085: 설치된 CLI 산출물 smoke 경계

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

Source 단위 테스트와 workspace build가 통과해도 CLI package version, `bin` 경로, 빌드 산출물과 runtime workspace 의존성이 실제 배포 조합에서 맞는지는 별개의 문제입니다. 특히 0.1.0 trace 기본값 전환은 source fixture만 통과하고 설치본이 오래된 `dist`나 잘못된 package 조합을 실행하면 사용자 경계에서 다시 깨질 수 있습니다.

기존 51-event fixture는 기본 page 크기 바로 다음 event, cursor 연속성과 명시적 full의 전체 경계를 정밀하게 검증합니다. 설치 smoke가 같은 fixture를 복제하면 실행 시간과 유지 지점만 늘어나므로 배포 조합 검증의 책임을 따로 정해야 합니다.

## 결정

CLI는 project storage를 열지 않는 `lervo --version`과 `-v`를 제공합니다. 출력은 `lervo <semantic-version>` 한 줄이며 version은 CLI package에 함께 배포되는 `package.json`에서 읽습니다. Package version을 읽거나 검증하지 못하면 원인을 복사하지 않고 `cli_version_unavailable`로 실패합니다. Version 인자 뒤에 다른 인자를 함께 주는 요청도 실행하지 않습니다.

`pnpm smoke:built-cli`는 전체 workspace build 뒤 임시 디렉터리에 `@lervo/cli`의 production dependency closure를 injected workspace package 기반 `pnpm deploy --prod`로 조립합니다. 이 설정은 해당 deploy process에만 주어 source workspace의 설치 상태를 바꾸지 않습니다. 검사는 저장소 안의 CLI 파일을 직접 실행하지 않고 설치 디렉터리의 `dist/bin.js`를 별도 project cwd에서 실행합니다. 다음 조건 중 하나라도 다르면 전체 검사를 실패시킵니다.

- 루트, source CLI와 설치된 CLI manifest version이 같고 `lervo` bin이 `./dist/bin.js`를 가리킴
- 설치된 CLI의 `--version`이 같은 version을 stderr 없이 출력함
- 설치된 diagnostics reader가 `trace --capabilities`를 읽고 기본 page, page의 `explicit=false`, 빈 deprecation을 확인함
- 설치된 CLI로 project를 초기화하고 설치된 project-storage로 고정 합성 event 두 개를 기록함
- 기본 trace는 status 없는 유효한 page v1이고 명시적 `--full`은 같은 event를 가진 completed full v1임

합성 project, event ID, digest와 시각만 사용하고 사용자 저장소나 payload를 읽지 않습니다. 임시 설치와 project는 성공·실패 모두 검사 종료 시 제거합니다. 새 runtime event, 저장 상태나 report schema는 추가하지 않습니다.

이 smoke는 배포된 모듈 연결과 CLI 진입점의 최소 수직 경계를 맡습니다. 50/51 page 경계와 cursor 연속성은 ADR-0083 fixture가 계속 단독으로 맡으므로 같은 대형 fixture를 두 곳에 유지하지 않습니다.

## 결과

`pnpm check`는 source test 뒤 build를 만들고 설치 smoke를 실행하므로 stale 또는 누락된 `dist`, version·bin 불일치와 배포 dependency 누락을 출시 검사에서 찾을 수 있습니다.

이 검사는 현재 lockfile과 package store에서 만드는 로컬 production deploy를 증명합니다. npm registry 게시·다운로드, 전역 shell shim, 외부 provider 인증이나 실제 managed run 성공은 증명하지 않습니다.
