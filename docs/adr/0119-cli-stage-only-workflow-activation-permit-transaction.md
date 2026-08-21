# ADR-0119: CLI stage-only workflow 적용 허가와 transaction

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0117 후보는 exact `publish-cli` job을 검토할 수 있게 하고 ADR-0118은 그 job이 호출할 stage command를 구현합니다. 그러나 후보 digest만 보고 workflow를 바로 바꾸면 npm trust나 GitHub `npm-release` 보호가 준비되지 않은 상태에서 미래의 외부 쓰기 경로를 활성화할 수 있습니다. 후보를 본 사람의 결정, 현재 source, 외부 control의 fresh 관측과 실제 파일 교체를 서로 다른 경계로 유지해야 합니다.

Workflow는 한 파일이지만 단순 `writeFile`로 덮어쓰면 process 중단 때 빈 파일이나 검토하지 않은 source 위의 적용을 남길 수 있습니다. 적용 성공 뒤 journal 정리만 실패한 경우와 원본을 옮긴 뒤 중단된 경우도 서로 다른 복구가 필요합니다.

## 결정

### 사람 결정과 permit

Workflow activation decision v1은 최대 10분의 canonical 사람 문서입니다. `wfa_` ID, `human_operator`, exact candidate·root package source·workflow source·output digest와 다음 다섯 확인만 허용합니다.

- Candidate metadata와 exact workflow bytes를 함께 검토함
- 수동 tag의 stage-only job을 활성화함
- Direct publish를 금지함
- Stage 접수 뒤 별도 2FA 승인이 필요함
- Apply 시 외부 control이 계속 ready여야 함

`release:bootstrap:workflow-permit`는 repository, decision·새 output 절대 경로와 `--online`을 요구합니다. Root package, CLI package, 비활성 workflow와 decision을 bounded canonical snapshot으로 읽고 현재 candidate를 다시 만듭니다. 이후 public package의 npm trust와 GitHub `npm-release` environment를 읽기만 합니다. Local package identity, workflow 비활성 경계, npm package access, exact `createStagedPackage` trust, required reviewer·self-review 금지·exact `v*`가 모두 ready일 때만 permit v1을 mode `0600`, `wx`로 만듭니다.

Permit은 candidate source/output, decision digest, normalized readiness report와 관측 시각을 묶습니다. 유효기간은 관측 뒤 5분과 decision 만료 중 더 이른 시각입니다. Authority는 현재 source가 모두 같을 때 workflow 한 파일에 exact `publish-cli` job을 삽입하는 것뿐입니다. Permit 생성은 workflow, npm·GitHub 설정, package 게시와 runtime 상태를 바꾸지 않습니다.

### Apply 전 재확인

`release:bootstrap:workflow-apply`는 repository, decision·permit 절대 경로, `--online --write`를 함께 요구합니다. Apply는 current root package·CLI package·workflow·decision·permit에서 candidate와 permit을 다시 계산합니다. 그 뒤 npm과 GitHub를 다시 관측해 모든 control이 여전히 ready이고 permit에 담긴 normalized report와 같은지 확인합니다. Permit·decision 만료와 모든 source bytes를 외부 관측 뒤 다시 대조한 다음에만 transaction을 시작합니다.

Plan v1은 workflow before/after, root package·CLI package·decision·permit read-only binding, candidate·permit·decision·readiness digest, control 재확인 시각과 전략을 canonical digest에 묶습니다. 외부 설정은 관측할 뿐 바꾸지 않고 package 게시도 시도하지 않습니다.

### 단일 파일 transaction과 복구

Transaction directory는 workflow와 같은 filesystem의 `.github/.lervo-workflow-activation-transaction`입니다. 새 mode `0700` directory에 mode `0600` journal과 target mode를 보존한 `workflow.next`, rename된 `workflow.original`을 분리합니다. File과 양쪽 directory entry를 필요한 순서로 `fsync`합니다.

순서는 다음과 같습니다.

1. 모든 source compare-and-swap과 workflow regular-file·mode 확인
2. `preparing` journal과 exact next file 기록
3. `staged` journal 뒤 모든 source 재확인
4. 현재 workflow를 original로 rename하고 `original_moved` 기록
5. next를 workflow로 rename하고 `committed` 기록
6. output과 read-only source를 다시 확인한 뒤 transaction 제거

동기 실패가 `committed` 전에 발생하면 원본을 되돌리고 transaction을 제거합니다. 중단으로 분류된 checkpoint는 자동 추정하지 않고 recovery를 요구합니다. `--recover`는 journal owner process가 살아 있으면 거부합니다. `preparing|staged|original_moved`는 원본으로 rollback하고, `committed`는 current workflow가 exact after일 때 적용을 유지한 채 journal만 정리합니다. Journal 손상·경로 불일치·현재 bytes 불일치는 fail-closed입니다.

Apply receipt v1은 `applied`, plan·permit·readiness digest, control 재확인·적용 시각, exact workflow after와 `stage_only_workflow_active`를 기록합니다. `externalSettings=observed_not_changed`, `publication=not_attempted`이며 workflow가 실행됐거나 package가 stage·공개됐다는 뜻이 아닙니다.

Decision·permit·journal·receipt에는 actor identity, reviewer, trust ID, credential, OIDC 값, 외부 응답 원문과 절대 경로를 넣지 않습니다. 이 문서 상태는 runtime event, project state 또는 telemetry가 아닙니다.

## 결과

후보 생성, 사람 검토, 외부 control 확인, 쓰기 권한과 파일 교체가 한 함수나 문서에 합쳐지지 않습니다. 외부 보호가 permit 뒤 달라지거나 source가 관측 중 바뀌면 첫 workflow write 전에 멈춥니다. File 교체 중 중단돼도 원본 rollback과 committed cleanup을 명시적으로 구분합니다.

Fixture는 exact decision binding과 만료, broad npm permission·self-review 차단, permit 무쓰기, apply 전 두 번째 online 관측, source race, mode 보존, 동기 rollback, 두 pre-commit 중단 복구, committed cleanup과 CLI 인자 분리를 임시 workflow에서 검증합니다. 현재 저장소 workflow에는 후보를 적용하지 않았고 npm·GitHub 설정과 package 게시도 변경하지 않았습니다.

> 후속 결정: [ADR-0120](./0120-cli-stage-only-workflow-post-apply-verification.md)은 receipt와 current workflow를 독립적으로 대조하고 exact stage job 전체와 fresh npm·GitHub control을 읽기 전용으로 다시 검증합니다.
