# ADR-0123: CLI stage-only workflow 실행 증거

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0122는 stage-only workflow source commit이 현재 기본 브랜치에 포함되고 exact release tag가 같은 commit을 가리키는지 확인합니다. 그러나 실행되지 않은 workflow source는 npm stage 절차가 실제로 시작됐다는 증거가 아닙니다.

GitHub Actions run은 rerun마다 같은 run ID에 새 attempt가 생깁니다. 단순히 성공한 과거 attempt를 고르면 이후 실패하거나 진행 중인 rerun을 숨길 수 있습니다. Job list와 artifact list도 page 일부를 전체로 오해하거나 다른 attempt의 artifact를 섞으면 안 됩니다. 반대로 GitHub job 성공과 artifact 존재를 npm registry가 staged package를 접수했다는 증거로 승격해서도 안 됩니다.

## 결정

다음 읽기 전용 명령을 추가합니다.

```text
pnpm --silent release:bootstrap:workflow-execution \
  --repository <owner/repository> \
  --source-commit <40자 소문자 Git commit SHA> \
  --release-tag <vMAJOR.MINOR.PATCH> \
  --run-id <양의 정수> \
  --attempt <양의 정수> \
  --reachability-report <absolute-path> \
  --online \
  --json
```

### 입력과 선택 계약

Source reader는 저장한 reachability evidence를 최대 64 KiB regular file로 읽고 canonical JSON 형식과 standalone report v1을 다시 검증합니다. Repository·source commit·release tag가 upstream target과 정확히 같아야 합니다. GitHub 관측 뒤 같은 bytes인지 다시 읽습니다.

명령은 run을 시간순으로 자동 선택하지 않습니다. 운영자가 run ID와 attempt를 모두 명시해야 하며 둘은 양의 JavaScript safe integer여야 합니다. 이 선택은 승인이나 실행 지시가 아니라 읽을 좌표입니다.

### GitHub Actions 관측

Observer는 인증된 `gh api GET`만 사용해 다음 순서로 읽습니다.

1. 고정 workflow path의 metadata
2. Exact run ID의 current run
3. 같은 run ID의 exact attempt
4. Exact attempt의 job 한 page
5. Run의 exact-name artifact 한 page
6. Current run 재확인

응답 하나는 최대 2 MiB입니다. Job과 artifact는 `per_page=100&page=1`로 읽고 `total_count`가 100 이하이며 반환 배열 길이와 같아야 합니다. 초과·누락된 결과를 일부 성공으로 반환하지 않습니다.

Workflow ID와 고정 path·active state가 run에 맞아야 합니다. Current run의 attempt가 명시한 attempt와 같고 exact-attempt 응답의 정규화된 run이 current run과 같아야 합니다. Run은 `workflow_dispatch`, exact release tag head branch, exact source SHA여야 합니다. Job·artifact 관측 뒤 current run이 바뀌거나 새 attempt가 시작되면 `run_changed`로 닫습니다.

Observer는 `Stage CLI publication` job에서 `Stage exact CLI package`와 `Upload stage publication result` step만 보존합니다. Actor·triggering actor·runner·label과 외부 응답 원문은 버립니다. 순수 정책은 run, job과 두 step이 모두 `completed/success`인지 판정합니다.

Artifact는 `lervo-cli-stage-<release-tag>-<attempt>` 이름이 정확히 하나이고 비만료, 1 byte 이상 64 MiB 이하, SHA-256 digest 형식이며 workflow run ID·source SHA가 맞아야 합니다. 이 단계는 artifact를 다운로드하거나 내용을 읽지 않습니다.

### Evidence 의미

Report v1은 `evidence_bound`, `first_publication_stage_only_workflow_execution`입니다. Exact target·run ID·attempt, upstream reachability와 remote deployment digest·workflow digest, workflow·run·job·두 step·artifact metadata, 관측 시각과 run 재확인을 canonical digest에 결속합니다.

`exact_attempt_completed_success_with_stage_result_artifact`는 exact GitHub Actions attempt와 stage job이 성공했고 결과 artifact metadata가 관측됐다는 뜻입니다. 다음은 별도 한계입니다.

- Upstream evidence 발급 진위는 검증하지 않음
- 관측 뒤 새 rerun이 생기지 않는지 검증하지 않음
- Artifact contents를 다운로드하거나 검증하지 않음
- npm stage 접수와 2FA 승인을 관측하지 않음
- Package 공개 상태를 관측하지 않음

Side effect는 files·GitHub settings unchanged이고 workflow dispatch·rerun·artifact download·publication은 not-attempted입니다. Report는 stdout에만 반환하며 새 파일, runtime event·project state·telemetry를 만들지 않습니다.

## 실패 의미

- `first_publication_workflow_execution_arguments_invalid`: online, repository, source·tag, run ID·attempt, 절대 report 또는 인자 조합이 올바르지 않음
- `first_publication_workflow_execution_online_required`: application 경계에 online 확인이 없음
- `first_publication_workflow_execution_input_invalid`: repository·source·tag·run 좌표가 올바르지 않음
- `first_publication_workflow_execution_source_invalid`: bounded reachability source나 canonical JSON 형식이 올바르지 않음
- `first_publication_workflow_execution_source_mismatch`: upstream target과 인자 target이 다름
- `first_publication_workflow_execution_not_ready`: exact terminal success 실행을 관측하지 못함
- `first_publication_workflow_execution_observation_invalid`: normalized workflow·run·job·step·artifact 구조나 성공 의미가 올바르지 않음
- `first_publication_workflow_execution_report_invalid`: report 구조·시각·고정 의미·digest 또는 같은 입력의 재계산 결과가 다름
- 관측 중 local source 변경은 기존 bounded source changed 오류를 유지함

GitHub adapter의 제한된 unavailable reason은 `authentication_or_execution_unavailable`, `response_invalid`, `run_or_attempt_mismatch`, `result_set_invalid`, `run_changed`입니다. 오류와 사람 출력에는 path, digest, actor·runner·label, credential, GitHub 응답 원문을 넣지 않습니다.

## 결과

GitHub Actions observer, run·attempt·job·step·artifact 정규화, 순수 evidence 정책, standalone report, bounded source reader, CLI 조정기와 formatter를 분리했습니다. Fixture는 exact 성공, historical attempt, 관측 중 rerun, 실패 step, 중복 artifact, 결과 상한, source race, upstream redigest, 무쓰기와 민감 metadata 폐기를 검증합니다.

현재 production workflow 적용이나 원격 workflow 실행, artifact download, npm stage·2FA·공개는 수행하지 않았습니다. 다음 단계는 저장된 artifact bytes와 내부 terminal stage 결과를 exact 실행 좌표에 결속하는 별도 증거 경계입니다.
