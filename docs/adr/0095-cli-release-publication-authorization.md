# ADR-0095: CLI release 게시 적격성과 권한 경계

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

서명된 release 파일을 검증했다는 사실만으로 npm 게시 대상이 정해지지는 않습니다. Package version, dist-tag와 registry가 실행 인자에서 달라지거나 검증 뒤 tarball이 바뀌면 검토하지 않은 결과가 공개될 수 있습니다. 반대로 게시 준비 검사에 npm 쓰기 credential을 주면 읽기 전용 단계의 실패가 외부 상태 변경으로 이어질 수 있습니다.

현재 저장소에는 확정된 Git repository URL이 없고 npm의 `@lervo` scope 소유권과 Trusted Publisher 설정도 확인되지 않았습니다. npm Trusted Publishing에 필요한 package repository 일치와 외부 계정 설정을 추정해서 채우거나 공개 게시를 활성화할 수 없습니다.

## 결정

`release:publication:authorize`는 기존 attestation 소비자 검증을 다시 실행한 뒤 실행별 JSON 하나를 새 절대 경로에만 기록합니다. 기존 파일을 덮어쓰지 않으며 저장소에는 누적하지 않습니다. Schema v1은 다음 값을 결속합니다.

- `status=eligible`
- npm public registry와 public access
- `@lervo/cli`의 exact version과 명시적인 `latest` 또는 `next` dist-tag
- tarball basename, signed subject와 같은 SHA-256
- npm metadata에서 확인할 SHA-512 `dist.integrity`와 SHA-1 `dist.shasum`
- 검증된 repository, workflow, tag, source commit과 세 subject
- 위 필드 전체의 canonical authorization digest

`eligible`은 전달받은 서명 release와 게시 좌표가 현재 정책에 맞는다는 뜻입니다. 사람의 배포 승인, npm namespace 소유권, Trusted Publisher 등록, registry 도달성이나 게시 성공을 뜻하지 않습니다. 명령에는 npm token을 주지 않으며 GitHub attestation 검증에 필요한 인증은 registry 쓰기 권한과 구분합니다.

게시 실행 코어는 적격성 reader, tarball 재검증과 좁은 `publish` port만 소유합니다. Port를 호출하기 직전 SHA-256·SHA-512·SHA-1을 모두 다시 계산하고, 반환 receipt의 registry·package·version·dist-tag·두 registry digest가 정확히 같은 경우만 `published`를 반환합니다. 호출 뒤 tarball bytes도 다시 확인합니다. 이 코어는 npm이나 GitHub 환경 변수를 알지 않습니다.

npm Trusted Publishing 어댑터는 별도 권한 경계입니다. GitHub-hosted Actions와 OIDC request 환경, Node 22.14.0 이상, npm 11.5.1 이상을 요구하고 `NODE_AUTH_TOKEN`, `NPM_TOKEN`과 npm auth config 환경 변수가 있으면 실행 전에 거부합니다. 저장소와 사용자 설정을 읽지 않도록 임시 빈 user·global npm config, cache와 작업 디렉터리를 만들고 성공·실패 뒤 제거합니다. Exact tarball에 registry·tag·public access와 lifecycle script 비실행을 명시해 `npm publish`하고, 공개 metadata의 integrity·shasum·dist-tag를 다시 읽어 receipt를 만듭니다. 오류 출력에는 token, OIDC request token, registry 응답이나 경로를 복사하지 않습니다.

Tag attestation job은 서명 검증 뒤 임시 적격성 JSON을 만들고 release 파일과 함께 30일 workflow artifact로 보존합니다. 실제 `npm publish` 단계와 npm용 environment는 추가하지 않습니다. 후속 readiness 정책은 일상적인 workflow를 staged publishing 전용으로 제한하므로 이 direct adapter는 현재 activation 대상이 아닙니다. 확정 repository URL, package namespace 소유권과 npm Trusted Publisher 설정을 확인하고 별도 게시 정책이 direct 방식을 명시한 경우에만 이 port를 조합할 수 있습니다.

새 runtime event, project 상태와 telemetry는 추가하지 않습니다.

## 결과

서명 파일 검증, 게시 좌표 결정과 외부 쓰기 권한이 서로 다른 단계가 되었습니다. 적격성 문서나 fixture 성공을 실제 npm 게시 또는 사람 승인으로 표현할 수 없습니다.

현재 테스트는 digest와 dist-tag 변조, 검증되지 않은 release, 게시 전 tarball 변경, 장기 token, 낮은 Node·npm version과 registry 응답 불일치를 거부합니다. 임시 Verdaccio의 실제 게시·재게시 거부 검사는 기존 ADR-0091이 계속 담당합니다. 실제 GitHub tag job과 npm 공개 게시 성공은 아직 실행되지 않았습니다.
