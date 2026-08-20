# ADR-0091: CLI registry 게시 사전검증 계약

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

Packed consumer smoke는 실제 tarball을 설치하지만 설치 좌표가 로컬 파일입니다. Registry 게시 과정에서 metadata와 dist-tag가 달라지거나, package 이름·version으로 다시 설치하지 못하거나, 이미 존재하는 version을 덮어쓰는 문제가 있어도 이 검사만으로는 알 수 없습니다.

실제 npm registry에 게시하려면 `@lervo` scope 소유권, credential, 공개 repository와 라이선스 결정이 필요합니다. 현재 저장소에는 그 권한과 결정이 없으므로 사전검사가 외부 npm 상태를 바꾸거나 실제 게시 성공을 주장해서는 안 됩니다.

## 결정

개발 의존성으로 Verdaccio 6.10.0을 정확히 고정하고 `pnpm smoke:registry-publish`에서 programmatic server를 실행합니다. Server는 loopback의 운영체제가 고른 빈 port에만 열며 config·storage·cache를 모두 임시 root 아래에 둡니다. Registry 설정은 다음과 같습니다.

- 외부 uplink 없음
- 모든 package access와 `@lervo/*` publish만 `$all`
- 모든 unpublish와 나머지 package publish 거부
- Web UI 비활성
- Anonymous publish와 로컬 최초 publish 허용

상속된 대소문자 npm config, registry·proxy와 npm·pnpm·Node auth token 환경 변수를 제거합니다. 별도 빈 user config와 fixture cache를 사용하며 사용자 home이나 repository 설정을 수정하지 않습니다. Registry 기본 실패는 `registry_publish_preflight_failed`와 고정된 한국어 문장만 출력합니다. 개발자가 `LERVO_REGISTRY_PREFLIGHT_DEBUG=1`을 명시한 로컬 실행에서만 하위 도구 오류와 임시 경로를 출력할 수 있습니다.

Packed consumer smoke와 같은 공용 pack 함수로 `README.md`, `dist/bin.js`, `package.json` 세 파일의 tarball을 만듭니다. 이 tarball을 경로 그대로 `preflight` tag로 게시하고 다음을 확인합니다.

1. Registry metadata의 package name·version·`UNLICENSED`와 SHA-512 `dist.integrity`
2. 첫 게시 결과의 `preflight`와 `latest` dist-tag가 모두 현재 version을 가리킴
3. 새 소비자 project가 `@lervo/cli@<version>`을 exact dependency로 설치함
4. 설치된 local bin의 `lervo --version` 결과가 현재 version과 같음
5. 같은 tarball의 같은 version 재게시가 pnpm의 `[E409] 409 Conflict`로 거부됨
6. 거부 뒤 다시 읽은 registry integrity가 첫 게시 값과 같음

재게시 검사는 명령이 어떤 이유로든 실패하면 통과시키지 않습니다. 고정한 pnpm client가 명시적인 `[E409] 409 Conflict`를 반환한 경우만 version 불변성 계약을 통과합니다.

Registry는 uplink가 없지만 소비자의 `.npmrc`는 `@lervo` scope만 임시 registry로 보냅니다. Claude SDK와 다른 외부 dependency는 공개 npm registry 또는 local package cache에서 해석될 수 있습니다. 이 구분은 Lervo package가 외부 registry로 새어 나가지 않게 하면서 기존 일반 소비자 dependency 조건을 유지합니다.

사전검사를 Ubuntu·macOS·Windows release matrix의 packed smoke 다음에 실행합니다. Workflow 계약 테스트는 이 명령의 존재와 순서를 고정합니다. 로컬 성공을 아직 실행하지 않은 원격 운영체제의 성공으로 표현하지 않습니다. 새 runtime event, project 상태와 telemetry는 추가하지 않습니다.

## 결과

현재 로컬 macOS arm64에서 실제 registry publish, metadata·tag 조회, package 좌표 설치, local bin 실행과 immutable version 거부가 통과합니다. 성공·실패 뒤 server, storage, tarball, 소비자 project, npm 설정과 cache를 모두 제거합니다.

이 계약은 임시 Verdaccio의 npm 호환 동작만 검증합니다. 실제 npm registry의 scope 소유권·인증·2FA·trusted publishing·출처 증명, CDN 전파, 삭제 정책과 외부 dependency의 완전한 offline 설치는 증명하지 않습니다. Linux와 Windows 결과도 각 원격 job이 실제로 완료된 뒤에만 근거로 사용할 수 있습니다.
