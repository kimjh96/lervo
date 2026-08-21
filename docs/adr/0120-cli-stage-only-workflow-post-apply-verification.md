# ADR-0120: CLI stage-only workflow 사후 검증

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0119의 apply receipt는 local workflow 교체 결과를 canonical하게 설명하지만 서명되거나 durable authority가 발급한 문서는 아닙니다. Receipt만 읽으면 현재 workflow가 이후에도 같은지, stage job의 action SHA와 옵션이 그대로인지, npm trust와 GitHub 보호가 아직 준비됐는지 알 수 없습니다. 반대로 현재 workflow만 검사하면 어떤 적용 결과와 대조했는지 남지 않습니다.

Local repository의 workflow가 맞다는 사실도 GitHub의 default branch나 특정 commit에 같은 bytes가 배포됐다는 증거는 아닙니다. Workflow가 실행됐거나 npm stage 접수·2FA 승인·package 공개가 일어났다고 확대해서는 안 됩니다.

## 결정

다음 읽기 전용 명령을 추가합니다.

```text
pnpm --silent release:bootstrap:workflow-verify \
  --repository <owner/repository> \
  --receipt <absolute-path> \
  --online \
  --json
```

### 독립 receipt와 source 검증

Standalone receipt reader는 v1 exact key, 고정 상태·효과, workflow byte count·SHA-256, control 재확인·적용 시각 순서와 receipt digest를 검증합니다. 이는 receipt 내용의 자기 일관성만 뜻하며 발급 주체·서명·실제 transaction 실행을 증명하지 않습니다.

Source reader는 root package, CLI package를 각각 최대 1 MiB, workflow를 256 KiB, receipt를 64 KiB regular file로 읽습니다. JSON은 공백 2칸과 마지막 LF의 canonical 형식, workflow는 UTF-8 LF와 중복 key·parse warning이 없는 YAML이어야 합니다. Receipt의 workflow 결과와 current workflow byte count·SHA-256이 정확히 같아야 하며 online 관측 뒤 네 파일을 모두 다시 읽어 변경을 거부합니다.

고정 transaction directory는 source read 전과 report 생성 직전에 읽기만 합니다. 부재만 `clear`이고 directory가 남으면 내용이나 journal phase를 추정하지 않고 recovery를 요구합니다. Symlink·일반 파일·조회 실패는 신뢰할 수 없는 좌표로 거부하며 자동 정리하지 않습니다.

### 현재 구성과 fresh control

검증은 다음 일곱 검사를 모두 요구합니다.

- Transaction state가 clear임
- Current workflow bytes가 receipt 결과와 같음
- Root package에 exact stage publication command가 있음
- CLI package identity·repository·license·public registry 설정이 ready임
- `publish-cli`가 수동 tag, attestation dependency, GitHub-hosted runner, 최소 OIDC 권한과 exact step 전체를 가짐
- npm trust가 exact repository·workflow·environment와 `createStagedPackage` 하나만 허용함
- GitHub `npm-release`가 required reviewer, self-review 금지와 exact `v*`를 유지함

공용 stage-only workflow 검사는 두 run command와 result upload만 보지 않습니다. Checkout·Node·pnpm·artifact download·upload action의 commit SHA, 이름·경로·cache·credential 옵션과 step 순서 전체를 exact contract로 검사합니다. Candidate와 transition도 같은 검사를 사용합니다.

### Report 의미

Post-apply report v1은 `verified`, `local_source_and_external_controls`, target, receipt·source digest, 관측 시각, 일곱 ready check와 `stage_only_workflow_present`를 canonical digest에 묶습니다. 다음 한계를 함께 고정합니다.

- Receipt 발급 주체와 서명은 검증하지 않음
- 검토한 candidate 전체 provenance는 receipt binding으로만 연결됨
- GitHub 원격 workflow 배포는 검증하지 않음
- Workflow 실행, npm stage 접수와 public package 상태는 관측하지 않음

Side effect는 files·workflow unchanged, npm·GitHub settings observed-not-changed, publication not-attempted입니다. Report는 stdout에만 반환하며 새 파일, runtime event·project state·telemetry를 만들지 않습니다.

## 실패 의미

- `first_publication_workflow_activation_post_apply_arguments_invalid`: online, repository, absolute receipt 또는 인자 조합이 올바르지 않음
- `first_publication_workflow_activation_post_apply_online_required`: application 경계에 online 확인이 없음
- `first_publication_workflow_activation_post_apply_source_invalid`: bounded regular source나 canonical JSON·YAML 형식이 올바르지 않음
- `first_publication_workflow_activation_receipt_invalid`: receipt 구조·고정 의미·시각·digest가 올바르지 않음
- `first_publication_workflow_activation_post_apply_source_mismatch`: current workflow bytes가 receipt 결과와 다름
- `first_publication_workflow_activation_post_apply_transaction_pending`: recovery가 필요한 transaction directory가 남아 있음
- `first_publication_workflow_activation_post_apply_transaction_invalid`: transaction 좌표를 신뢰할 수 없음
- `first_publication_workflow_activation_post_apply_not_ready`: local stage 계약 또는 fresh npm·GitHub control이 하나 이상 ready가 아님
- `first_publication_workflow_activation_post_apply_report_invalid`: report가 같은 원본에서 재계산한 결과와 다름
- 관측 중 source 변경은 기존 bounded source changed 오류를 유지함

오류와 사람 출력에는 path, digest, PID, actor·reviewer·trust ID, credential, 외부 응답 원문을 넣지 않습니다.

## 결과

Fixture는 무쓰기 성공, receipt 효과·report 한계의 redigest 권한 상향, current bytes 불일치, action SHA 변경을 receipt와 함께 다시 digest한 경우, fresh control 약화, online source race, 시작 전·관측 중 pending transaction과 CLI 인자 분리를 검증합니다. 현재 production workflow에는 stage job을 적용하지 않았고 원격 배포·실행, npm stage·2FA·공개도 수행하지 않았습니다.

다음 단계는 local report와 GitHub의 exact source commit에 있는 workflow bytes를 결속하는 원격 workflow 배포 증거 경계입니다.
