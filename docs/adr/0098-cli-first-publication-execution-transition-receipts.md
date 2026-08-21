# ADR-0098: CLI 최초 공개 게시 실행·전환 영수증 계약

- 상태: 승인
- 날짜: 2026-08-21

> 후속 결정: [ADR-0112](./0112-cli-first-publication-arming-authorization.md)는 실행 전에 arming authorization을 필수화하고 reservation·execution receipt를 v2로 올렸습니다.

> 후속 결정: [ADR-0113](./0113-cli-first-publication-unknown-outcome-reconciliation.md)은 `publication_unknown` terminal을 바꾸지 않고 public npm에서 결과를 다시 읽는 보고서를 추가했습니다.

> 후속 결정: [ADR-0115](./0115-cli-first-publication-transition-evidence-union.md)는 execution receipt와 reconciliation resolution을 구분한 evidence union, public release 검사와 transition receipt v2를 추가했습니다.

## 맥락

Bootstrap authorization만으로는 실제 게시가 한 번만 시도됐는지, npm 응답을 잃은 뒤 안전하게 재시도할 수 있는지, 게시 뒤 상시 경로가 stage-only로 좁아졌는지 알 수 없습니다. 외부 게시 호출은 로컬 저장과 원자적으로 묶을 수 없으므로 단순한 성공·실패 boolean은 중복 게시 위험을 숨깁니다.

또한 최초 게시 성공과 상시 publisher 전환은 서로 다른 사실입니다. Package가 생겼더라도 npm trust가 direct publish 권한을 갖거나 GitHub 보호 환경이 self-review를 허용하면 bootstrap 예외를 닫았다고 볼 수 없습니다.

## 결정

실행 코어를 예약, 실행 영수증, 외부 호출 조정의 세 경계로 분리합니다. 외부 상태 저장과 npm 호출은 port 뒤에 두며 코어는 특정 credential이나 SDK를 알지 않습니다.

실행 순서는 다음과 같습니다.

1. Bootstrap과 exact publication authorization을 다시 검증합니다.
2. 인증 없는 public registry에서 package가 여전히 보이지 않는지 다시 관측합니다.
3. Bootstrap digest에서 결정적으로 만든 예약 ID로 durable reservation을 먼저 확보합니다.
4. Tarball bytes를 다시 확인한 뒤 publisher port를 한 번 호출합니다.
5. Exact registry 좌표·integrity·shasum과 일치하는 응답만 `published_transition_pending` 영수증으로 만듭니다.
6. 예약 저장소가 exact 영수증 digest를 `published`로 기록한 경우에만 호출자에게 성공을 반환합니다.

게시 port 호출 전에 tarball 변경을 발견하면 `aborted_before_publication`과 `new_bootstrap_required`를 기록합니다. 게시 port를 호출한 뒤 오류가 나거나 영수증·완료 저장을 확인하지 못하면 `publication_unknown`과 `retry=forbidden`을 기록하고 성공을 반환하지 않습니다. `unknown` 저장 자체가 실패해도 최초 예약이 남으므로 같은 bootstrap의 자동 재시도는 안전하다고 간주하지 않습니다.

게시 성공은 전환 완료가 아닙니다. 별도 전환 정책은 다음 세 독립 증거를 모두 요구합니다.

- `publish-cli` job이 수동 tag, `attested-cli` 의존성, GitHub-hosted Ubuntu, `npm-release`, `contents:read`와 `id-token:write`만 사용함
- 게시 명령이 Lervo의 exact `release:publication:stage` 하나이며 `npm publish`, `npm stage publish`, 장기 registry credential이 없음
- npm trust가 exact repository·`cli-release-matrix.yml`·`npm-release`와 `createStagedPackage` 하나만 가짐
- GitHub environment가 reviewer 한 명 이상, self-review 금지와 exact `v*` tag policy를 가짐

완료 영수증 생성기는 전달된 ready report만 믿지 않고 workflow·npm·GitHub 관측 원본에서 세 검사를 다시 계산합니다. 모두 `ready`인 canonical report만 `completed` 전환 영수증을 만들 수 있습니다. 이때 bootstrap 상태를 `consumed`, 상시 mode를 `trusted_publisher_stage_only`, direct publish를 `forbidden`으로 기록합니다. Reader도 같은 원본으로 영수증을 재생성하므로 필드를 바꾸고 digest만 다시 계산한 문서는 거부합니다.

예약과 영수증은 실행별 문서이며 한 파일에 계속 누적하지 않습니다. 승인자, npm trust ID, reviewer identity, OIDC·2FA·registry credential과 외부 응답 원문은 넣지 않습니다. 새 runtime event나 project 상태는 만들지 않습니다. 이 ADR의 상태 이름은 최초 게시 저장 port와 영수증에만 속합니다.

## 결과

현재 구현은 provider-neutral 코어, 저장 port 계약과 합성 실패 fixture입니다. Durable 저장 adapter, 수동 2FA npm adapter, CLI 명령, 실제 npm 게시, trust·GitHub 설정 변경과 workflow 활성화는 구현하거나 실행하지 않았습니다. 따라서 테스트 성공은 실제 package 생성이나 전환 완료를 뜻하지 않습니다.

구현은 실행 전 중단과 호출 후 결과 불명을 구분하고, 공개 package 출현·중복 예약·publisher 오류·불완전한 완료 저장·넓은 npm 권한·direct publish·self-review·재해시된 report 위조를 거부합니다.
