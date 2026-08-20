# ADR-0096: CLI Trusted Publisher 준비 상태 계약

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

게시 적격성 문서가 올바르더라도 package identity, npm namespace와 Trusted Publisher, GitHub 보호 환경이 준비되지 않으면 실제 게시 job을 안전하게 켤 수 없습니다. 외부 설정을 읽지 않았는데 준비됐다고 추정하거나, 상태 확인 명령이 설정을 만들고 고치는 것도 허용할 수 없습니다.

npm은 `npm trust list <package> --json`으로 Trusted Publisher를 읽을 수 있지만 npm 11.15.0 이상, 이미 존재하는 package, 쓰기 권한과 인증이 필요합니다. GitHub environment와 deployment branch policy는 별도 GET API입니다. 두 공급자의 응답 원문에는 readiness에 필요하지 않은 trust ID와 reviewer identity가 포함될 수 있습니다.

2026-08-21에 public npm registry에서 `@lervo/cli` 조회는 404입니다. npm은 새 package에 Trusted Publisher를 미리 만들거나 staged publishing을 사용할 수 없으므로 최초 게시와 이후 상시 게시 경로를 구분해야 합니다.

## 결정

`release:publisher:readiness --repository <owner/repo>`는 기본적으로 로컬 원본만 읽습니다. `--online`을 명시한 경우에만 npm과 GitHub의 읽기 전용 어댑터를 추가로 실행합니다. Report schema v1은 다음 다섯 검사를 고정된 순서로 반환합니다.

1. Package identity
2. 게시 job 비활성 경계
3. npm package 쓰기 권한
4. npm Trusted Publisher
5. GitHub `npm-release` environment

각 검사는 `ready`, `blocked`, `unknown` 중 하나입니다. 전체는 다섯 검사 모두 `ready`인 경우에만 `ready`이고, `unknown`도 준비 완료로 올리지 않습니다. 실행 시각과 외부 원문 없이 target, 검사 상태와 controlled reason code만 canonical digest에 결속합니다. Report는 stdout에만 반환하고 저장소나 한 파일에 누적하지 않습니다.

로컬 package는 `@lervo/cli`, public access, 확정된 라이선스, `git+https://github.com/<owner/repo>.git`의 exact repository와 npm public registry 고정이 필요합니다. `UNLICENSED`, repository 누락·불일치, registry 미고정과 provenance 비활성은 모두 blocker입니다. Workflow는 readiness 동안 실제 `npm publish`, `npm stage publish` 또는 `npm-release` environment job이 없는 비활성 상태여야 합니다. Readiness는 게시 job을 만들거나 활성화하지 않습니다.

npm 어댑터는 먼저 인증 없는 public registry GET으로 공개 package가 보이는지 확인합니다. 404이면 npm client나 credential을 호출하지 않고 `public_package_not_found`를 반환합니다. 이 상태는 private package 부재를 증명하지 않으며 npm access는 blocked, trust는 관측하지 않은 `unknown`으로 둡니다. Package가 공개적으로 보일 때만 npm 11.15.0 이상에서 exact public registry의 `npm trust list @lervo/cli --json`을 실행합니다. 성공은 package 존재와 호출자의 쓰기 권한을 확인한 것으로 판정합니다. Trust ID와 응답의 다른 필드는 버리고 GitHub provider, repository, workflow filename, environment와 permission만 보존합니다.

상시 publisher는 `cli-release-matrix.yml`, `npm-release`와 `createStagedPackage` 하나에 정확히 결속되어야 합니다. Direct `createPackage` 또는 두 권한을 함께 가진 설정은 최소 권한 기준을 통과하지 않습니다. Staged package는 npm maintainer가 별도 2FA로 검토·승인하기 전에는 공개되지 않습니다. 기존 direct npm 어댑터는 공급자 capability로 남지만 readiness 기본 정책의 workflow activation 대상으로 사용할 수 없습니다.

GitHub 어댑터는 environment와 deployment branch policy GET만 호출합니다. `npm-release`에는 한 명 이상의 required reviewer, self-review 금지와 exact `v*` tag policy 하나가 필요합니다. Reviewer login·team, environment·policy ID와 API 응답 원문은 report에 넣지 않습니다. 응답이 100개 상한을 넘거나 구조가 불명확하면 일부만으로 판정하지 않습니다.

외부 인증 실패, 지원하지 않는 client, 응답 손상과 미실행은 `unknown`입니다. 오류에는 token, npm·GitHub 응답, reviewer identity와 경로를 복사하지 않습니다. 이 작업은 npm package·trust, GitHub environment·policy, workflow, runtime event, project 상태와 telemetry를 변경하지 않습니다.

## 결과

현재 저장소는 repository·라이선스·publish registry가 미확정이라 로컬 검사만으로 `blocked`입니다. 온라인 검사를 실행하지 않으면 세 외부 검사는 `unknown`입니다. Public registry에서 package가 보이지 않으면 공개 상태를 blocker로, 실행하지 않은 Trusted Publisher 확인을 `unknown`으로 표시합니다.

테스트는 완전히 준비된 합성 상태만 `ready`로 만들고, 넓은 npm 권한, self-review, 잘못된 tag policy, 이미 활성화된 게시 job, 관측 누락·실패와 public package 부재를 닫힌 상태로 확인합니다. 실제 npm·GitHub 인증 상태, scope 소유권, environment 설정과 원격 게시 성공은 테스트가 증명하지 않습니다.
