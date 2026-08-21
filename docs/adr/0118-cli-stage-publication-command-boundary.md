# ADR-0118: CLI stage 게시 명령 경계

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0117의 workflow 후보는 `release:publication:stage`가 실제로 있을 때만 만들 수 있습니다. 이 명령은 검증된 release artifact를 npm staging 영역에 쓰는 첫 상시 외부 쓰기 경계입니다. 따라서 일반적인 성공·실패 boolean이나 npm 출력 원문만 남기면 응답을 잃은 실행을 안전한 실패로 오해하고 같은 version을 다시 보낼 수 있습니다.

npm의 stage-only Trusted Publisher는 direct `npm publish`와 다른 권한입니다. 상시 자동화는 `npm stage publish`만 호출해야 하며, 접수 성공 뒤에도 maintainer의 별도 2FA 검토·승인 전에는 package가 공개됐다고 말할 수 없습니다.

## 결정

Root에 `release:publication:stage = node scripts/stage-cli-release-publication.mjs`를 추가합니다. 명령은 다음 세 절대 경로만 받습니다.

- `--release-directory`: 같은 workflow run에서 검증된 release directory
- `--publication-authorization`: exact npm 좌표와 subject digest를 가진 eligibility 문서
- `--result-directory`: 새 실행 기록 directory

Source reader는 authorization을 64 KiB 이하 regular file로 읽습니다. Release directory는 tarball, manifest, SBOM, 두 attestation bundle만 허용하고 각각 기존 release 검증 상한을 적용합니다. Manifest와 SBOM 계약, authorization의 세 subject SHA-256, tarball의 SHA-256·registry integrity·shasum을 실제 bytes에 다시 대조합니다. Bundle은 이 명령에서 서명을 다시 검증하지 않지만 bounded snapshot에 포함해 실행 전후 변경을 거부합니다. 서명 검증 사실은 authorization을 만든 앞선 `attested-cli` 경계가 소유합니다.

npm adapter는 GitHub-hosted Actions, OIDC request 환경, Node 22.14 이상과 장기 registry write credential 부재를 먼저 확인합니다. Stage 전용 client는 npm 11.15 이상을 요구하며 저장소에는 npm 11.18.0을 exact dev dependency로 둡니다. 빈 user/global config와 격리 cache에서 다음 호출 하나만 실행합니다.

```text
npm stage publish <exact-tarball> --registry <authorized-registry> --tag <authorized-tag> --access public --ignore-scripts
```

Direct publish adapter와 stage adapter는 공통 격리 client 준비만 공유합니다. Stage adapter는 one-shot이며 npm stdout·stderr, OIDC request token, credential, absolute path와 stage ID를 receipt에 넣지 않습니다. Exit code 0이면 receipt는 exact target·artifact와 `evidence=npm_cli_exit_zero`만 기록합니다. 이는 stage 접수 완료이지 registry 공개나 stage 목록 재관측 증거가 아닙니다. OIDC trust token으로 `stage list|view|approve|reject`를 호출하지 않습니다.

외부 호출 전 파일 store는 새 mode `0700` result directory와 mode `0600` `attempt.json`을 `O_EXCL`로 내구성 있게 만듭니다. Attempt v1은 `reserved`, `npm_stage_publish`, authorization digest, exact target·artifact, 예약 시각과 `retry=forbidden_without_reconciliation`을 canonical digest에 묶습니다. 결과 directory가 이미 있으면 새 호출 전에 거부합니다. Attempt만으로 실제 npm process 시작 여부를 주장하지 않습니다.

Terminal은 같은 directory의 새 `terminal.json` 하나뿐입니다.

- `staged`: npm CLI가 0으로 끝나고 receipt·source 재검증과 terminal 저장이 완료됨. `review=required_with_2fa`, `publicAvailability=not_claimed`, `retry=forbidden`
- `aborted_before_stage`: 예약 뒤 source가 달라졌지만 npm 호출은 시작하지 않음. `retry=new_authorization_required`
- `stage_outcome_unknown`: npm 호출이 시작된 뒤 오류, receipt 불일치, source 변경 또는 성공 terminal 저장 실패. `retry=forbidden`, `reconciliation=authenticated_npm_stage_review_required`

Terminal 저장마저 실패해 `attempt.json`만 남아도 blind retry는 금지합니다. 이 경우 사람이 npm의 인증된 Staged Packages 화면이나 interactive CLI로 exact package/version/tag를 확인해야 합니다. 명령은 자동 retry, stage approve·reject, public registry 성공 추정과 direct publish fallback을 제공하지 않습니다.

Workflow 후보는 Node 22.14, frozen install 뒤 이 명령을 호출합니다. `if: always()`인 SHA-pinned upload step이 result directory를 run-attempt별 artifact로 보존합니다. Preflight나 client 검증이 예약 전에 실패해 directory가 없을 수 있으므로 누락은 경고이고, stage job 자체 실패는 그대로 유지됩니다. Workflow 후보는 여전히 적용되지 않았으며 npm trust·GitHub environment 설정도 이 변경에서 만들지 않습니다.

새 기록은 release 운영 문서이지 runtime event, project state 또는 telemetry가 아닙니다. Target·artifact digest·authorization digest·시각·제한된 상태만 저장하고 actor, reviewer, credential, OIDC 값, 외부 응답 원문과 입력 경로는 저장하지 않습니다.

## 결과

Stage-only 자동화가 기존 direct `npm publish` adapter를 잘못 재사용하지 않습니다. 외부 쓰기 전후의 local 기록 순서와 불명확한 결과의 재실행 금지가 파일로 남고, 성공도 2FA 승인 전 공개 완료로 과장되지 않습니다.

Fixture는 exact `npm stage publish` 인자, npm·Node·OIDC·credential gate, one-shot adapter, 격리 파일 제거, bounded release subject 대조, 외부 호출 전 attempt 존재, 세 terminal 상태, owner-only 권한, 결과 directory 재사용 차단, CLI 인자와 workflow result upload를 검증합니다. 실제 npm stage, 2FA 승인, package 공개, workflow 적용이나 외부 설정 변경은 테스트가 주장하지 않습니다.

> 후속 결정: [ADR-0119](./0119-cli-stage-only-workflow-activation-permit-transaction.md)는 stage command가 있는 exact workflow 후보를 사람 결정과 fresh npm·GitHub control에 결속하고, apply 직전 재확인과 복구 journal을 통과한 경우에만 source workflow 한 파일에 적용합니다.
