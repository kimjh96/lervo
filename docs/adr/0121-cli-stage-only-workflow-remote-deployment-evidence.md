# ADR-0121: CLI stage-only workflow 원격 배포 증거

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0120의 사후 검증 보고서는 현재 로컬 workflow와 관측 시점의 npm·GitHub 보호 설정이 맞다는 데까지만 증명합니다. 로컬 파일이 GitHub 저장소에 올라갔는지, 올라갔다면 어느 commit의 어떤 경로에 있는지는 알 수 없습니다.

반대로 원격 workflow를 경로만으로 읽으면 검증한 로컬 파일과 같은 bytes인지, 사후 검증 보고서가 가리킨 repository인지 알 수 없습니다. 기본 브랜치나 tag 이름으로만 읽으면 관측 중 대상이 움직일 수도 있습니다. 원격 파일이 존재해도 기본 브랜치·release tag 포함, workflow 실행, npm stage 접수나 공개를 뜻하지 않습니다.

## 결정

다음 읽기 전용 명령을 추가합니다.

```text
pnpm --silent release:bootstrap:workflow-remote-evidence \
  --repository <owner/repository> \
  --source-commit <40자 소문자 Git commit SHA> \
  --post-apply-report <absolute-path> \
  --online \
  --json
```

### 고정된 로컬 원본

Source reader는 현재 `.github/workflows/cli-release-matrix.yml`을 최대 256 KiB, 저장한 post-apply report를 최대 64 KiB regular file로 읽습니다. Report는 공백 2칸과 마지막 LF의 canonical JSON이어야 합니다. Standalone reader가 report의 exact key, 고정 상태·한계·효과, 시각과 digest를 먼저 검증합니다.

현재 workflow SHA-256은 report의 `sources.workflowSha256`과 같아야 합니다. Workflow는 UTF-8 LF이고 중복 key·parse warning이 없는 YAML이어야 하며 공용 stage-only 정책 전체를 다시 통과해야 합니다. 관측 뒤 두 파일을 다시 읽어 바뀐 원본을 거부합니다.

Workflow activation transaction은 source read 전과 report 생성 직전에 부재해야 합니다. 남은 transaction을 읽어 적용 여부를 추정하거나 자동 복구하지 않습니다.

### 정확한 GitHub source 관측

GitHub observer는 인증된 `gh api`의 `GET`만 사용합니다. 사용자가 지정한 exact repository와 40자 소문자 commit SHA를 다음 고정 경로에 직접 결속합니다.

```text
repos/<owner/repository>/contents/.github/workflows/cli-release-matrix.yml?ref=<source-commit>
```

응답은 exact path의 base64 file, 1~256 KiB, 40자 blob SHA여야 합니다. Base64를 엄격하게 해석하고 응답 size와 다시 대조합니다. 원격 bytes·byte count·SHA-256이 현재 로컬 workflow와 모두 같아야 하며 원격 YAML도 stage-only 정책을 다시 통과해야 합니다.

Observer는 GitHub 설정 변경, workflow dispatch나 publication port를 갖지 않습니다. 인증 실패·파일 부재와 응답 형식 오류는 제한된 `unavailable` 이유만 반환하고 credential이나 원문을 보존하지 않습니다.

### Evidence 의미

Evidence report v1은 `evidence_bound`, `first_publication_stage_only_workflow_remote_source`입니다. Repository·source commit·고정 workflow path·package·environment, post-apply report digest, local workflow SHA-256, 원격 blob SHA·byte count·SHA-256과 관측 시각을 canonical digest에 묶습니다.

성공은 `exact_workflow_present_at_source_commit`만 뜻합니다. 다음 한계를 고정합니다.

- 저장한 로컬 report의 외부 발급 진위는 검증하지 않음
- Source commit 자체만 읽었으며 기본 브랜치나 release tag에서 도달 가능한지 검증하지 않음
- Workflow 실행, npm stage 접수·2FA 승인과 package 공개는 관측하지 않음

Side effect는 files·GitHub settings unchanged, workflow dispatch·publication not-attempted입니다. Evidence는 stdout에만 반환하며 새 파일, runtime event·project state·telemetry를 만들지 않습니다.

## 실패 의미

- `first_publication_workflow_remote_deployment_arguments_invalid`: online, repository, exact commit, absolute report 또는 인자 조합이 올바르지 않음
- `first_publication_workflow_remote_deployment_online_required`: application 경계에 online 확인이 없음
- `first_publication_workflow_remote_deployment_source_invalid`: bounded local source나 canonical report 형식이 올바르지 않음
- `first_publication_workflow_remote_deployment_input_invalid`: repository 또는 source commit 입력이 올바르지 않음
- `first_publication_workflow_remote_deployment_source_mismatch`: current workflow와 post-apply report target·digest가 다름
- `first_publication_workflow_remote_deployment_transaction_pending`: recovery가 필요한 activation transaction이 남아 있음
- `first_publication_workflow_remote_deployment_transaction_invalid`: transaction 좌표를 신뢰할 수 없음
- `first_publication_workflow_remote_deployment_not_ready`: local stage 계약 또는 exact remote workflow를 확인하지 못함
- `first_publication_workflow_remote_deployment_observation_invalid`: normalized 원격 관측 구조·좌표·digest가 올바르지 않음
- `first_publication_workflow_remote_deployment_bytes_mismatch`: remote와 검증된 local workflow bytes가 다름
- `first_publication_workflow_remote_deployment_report_invalid`: report 구조·시각·고정 의미·digest 또는 같은 입력의 재계산 결과가 다름
- 관측 중 source 변경은 기존 bounded source changed 오류를 유지함

오류와 사람 출력에는 경로, digest, PID, actor·reviewer·trust ID, credential, GitHub 응답 원문을 넣지 않습니다.

## 결과

GitHub API·source reader·순수 결속 정책·standalone report·CLI 조정기·formatter를 분리했습니다. Fixture는 exact GET 좌표, base64·size·path 상한, 무쓰기 성공, repository·commit·bytes 불일치, redigest 권한 상향, action SHA 변경, 관측 중 source 변경, 시작 전·관측 중 transaction과 CLI 권한 분리를 검증합니다.

현재 production workflow에는 stage job을 적용하거나 원격 배포하지 않았고 GitHub API 실제 호출, workflow 실행, npm stage·2FA·공개도 수행하지 않았습니다. 다음 단계는 이 source commit이 저장소의 기본 브랜치와 의도한 release tag에서 도달 가능한지 별도 증거로 결속하는 경계입니다.
