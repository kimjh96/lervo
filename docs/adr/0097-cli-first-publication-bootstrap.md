# ADR-0097: CLI 최초 공개 게시 bootstrap 계약

- 상태: 승인
- 날짜: 2026-08-21

> 후속 결정: bootstrap 입력과 결과 schema는 [ADR-0111](./0111-cli-first-publication-bootstrap-v2-evidence-integration.md)에서 external evidence report 기반 v2로 교체했습니다. 이 문서는 v1의 역사적 경계를 설명합니다.

## 맥락

`@lervo/cli`은 public npm registry에서 인증 없이 조회했을 때 404입니다. 이 응답은 공개 package가 보이지 않는다는 사실만 뜻하며, 같은 이름의 비공개 package 부재나 `@lervo` scope 소유권을 증명하지 않습니다. npm staged publishing은 이미 존재하는 package에만 사용할 수 있고 Trusted Publisher도 package 설정에서 구성하므로 최초 게시에는 별도 경계가 필요합니다.

최초 게시를 일반 release workflow에 섞으면 장기 token, 반복 가능한 direct publish 권한과 bootstrap 예외가 상시 경로에 남습니다. 반대로 사람 승인을 release bytes나 package identity에 결속하지 않으면 승인 뒤 내용이 바뀌어도 구분할 수 없습니다.

## 결정

`release:bootstrap:authorize`는 실제 npm 게시 전에 사용하는 일회성 준비 계약입니다. 다음 원본을 모두 다시 검증합니다.

1. 서명 검증을 거쳐 만들어진 `ReleasePublicationAuthorization`과 exact tarball
2. Release manifest v5와 현재 `apps/cli/package.json`
3. 별도 사람이 작성한 최초 게시 approval JSON
4. 명시적 `--online` 뒤의 인증 없는 npm public registry 관측

Release manifest v5는 기존 bundle·archive·dependency 정보에 package repository, publish registry와 provenance 설정을 추가합니다. 미확정 상태는 `null`로 기록할 수 있지만 bootstrap은 exact `git+https://github.com/<owner/repo>.git`, npm public registry, 확정 license와 provenance 비활성 아님을 요구합니다. 따라서 승인 뒤 package metadata를 바꾸면 manifest, SBOM, attestation과 게시 적격성 문서를 모두 다시 만들어야 합니다.

Approval schema v1은 `approvalId`, `approvedAt`, 최대 24시간의 `expiresAt`, 사람 approver, package·repository·license·scope owner와 publication authorization digest를 가집니다. 다음 확인을 중복 없이 모두 명시해야 합니다.

- `license_approved`
- `package_name_availability_confirmed`
- `scope_control_confirmed`
- `one_time_direct_publish_approved`
- `stage_only_transition_required`

Approval의 approver 원문은 입력에만 있고 bootstrap 결과에는 approval ID와 canonical digest만 남깁니다. 이 로컬 파일은 승인 내용의 결속을 증명하지만 approver 신원 인증이나 npm 권한을 증명하지 않습니다. Scope owner 확인도 npm에서 관측한 사실로 승격하지 않습니다.

npm 관측 어댑터는 `@lervo/cli` public endpoint를 GET하고 body를 저장하지 않습니다. 404는 `not_found`, 2xx는 `existing`, network·그 밖의 응답은 controlled `unavailable`입니다. Bootstrap은 `not_found`만 받고 관측 뒤 최대 10분까지만 유효합니다. 결과는 `public_package_not_found`로 표현하여 private package 부재를 주장하지 않습니다.

결과 schema v1의 상태는 `bootstrap_authorized`입니다. Exact target, release artifact digest, approval digest, 공개 registry 관측과 다음 실행 제약을 canonical digest에 묶습니다.

- 실행 mode는 `manual_interactive_once`
- 실제 게시 직전에 package 부재를 다시 확인함
- 2FA proof-of-presence가 필요함
- 결과를 재사용하지 않음
- 최초 게시 뒤 `cli-release-matrix.yml`, `npm-release`, `createStagedPackage` 하나로 전환함
- 전환 뒤 direct publish는 금지함

이 명령은 npm credential을 읽거나 `npm publish`, Trusted Publisher 생성, GitHub environment 변경을 실행하지 않습니다. Output은 새 절대 경로에만 `wx`로 쓰며 기존 문서를 덮어쓰거나 한 파일에 누적하지 않습니다. Runtime event, project 상태와 telemetry도 추가하지 않습니다.

## 결과

현재 package manifest는 repository·license·publish registry가 미확정이고 release manifest v5도 이를 그대로 `null` 또는 `UNLICENSED`로 결속하므로 bootstrap은 실패합니다. 제품 결정 없이 예시 값으로 통과시키지 않습니다.

테스트는 exact 승인만 통과시키고 unresolved identity, 다른 release 승인, 만료, 이미 보이는 public package, online 미동의와 output 재사용을 거부합니다. npm 404 fixture는 공개 조회 결과일 뿐 실제 scope 소유권, 비공개 package 부재, 2FA와 최초 게시 성공을 증명하지 않습니다.
