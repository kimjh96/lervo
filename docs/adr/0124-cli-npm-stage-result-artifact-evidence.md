# ADR-0124: CLI npm stage 결과 artifact 증거

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0123은 exact GitHub Actions attempt와 stage job이 성공했고 run-attempt 전용 artifact metadata가 존재함을 증명합니다. 그러나 artifact 내용을 읽지 않았으므로 stage command가 남긴 immutable attempt·terminal 결과와 package 좌표는 아직 결속되지 않았습니다.

GitHub artifact download endpoint는 짧게 유효한 ZIP redirect를 반환합니다. Metadata digest만 믿거나 무제한 archive를 filesystem에 풀면 교체 race, ZIP bomb, 경로 순회, symlink와 중복 파일 위험이 생깁니다. 반대로 archive 안의 `stage_submission_accepted/npm_cli_exit_zero` 기록은 npm CLI 결과이지 registry의 별도 관측이나 2FA 승인 증명이 아닙니다.

## 결정

다음 읽기 전용 명령을 추가합니다.

```text
pnpm --silent release:bootstrap:stage-result-evidence \
  --repository <owner/repository> \
  --source-commit <40자 소문자 Git commit SHA> \
  --release-tag <vMAJOR.MINOR.PATCH> \
  --run-id <양의 정수> \
  --attempt <양의 정수> \
  --workflow-execution-report <absolute-path> \
  --online \
  --json
```

### Upstream과 artifact download

Source reader는 저장한 workflow execution evidence를 최대 128 KiB regular file로 읽고 canonical JSON과 standalone v1 계약을 검증합니다. Repository·source commit·release tag·run ID·attempt가 report target과 정확히 같아야 합니다. GitHub 관측 뒤 source bytes를 다시 읽습니다.

GitHub adapter는 report에 결속된 artifact ID의 metadata를 최대 256 KiB로 읽습니다. Exact name, run ID, source SHA, byte count, SHA-256, 비만료 상태와 시각이 upstream metadata와 같아야 합니다. Size가 1 MiB를 넘으면 download를 호출하지 않습니다.

Adapter는 exact `/actions/artifacts/<id>/zip`을 GET하고 binary stdout을 최대 1 MiB 메모리에서만 받습니다. Downloaded byte count와 SHA-256을 metadata에 대조한 다음 artifact metadata를 다시 읽습니다. 교체·만료·변경되면 결과를 만들지 않습니다. Redirect URL, actor와 GitHub 응답 원문은 보존하지 않습니다.

### Bounded ZIP과 stage record

ZIP reader는 archive digest를 먼저 검사하고 single-disk non-ZIP64만 허용합니다. Central·local header, stored·deflate method, UTF-8·data descriptor flag, CRC-32, 압축·원본 size, descriptor와 연속된 local record 범위를 검증합니다. EOCD comment와 trailing bytes를 허용하지 않습니다.

Entry는 정확히 `attempt.json`, `terminal.json` 두 regular file이어야 합니다. Duplicate, directory, symlink, slash·backslash·NUL이 있는 이름과 각 128 KiB 초과 원본을 거부합니다. 압축 해제 결과는 canonical JSON이어야 하며 filesystem에 쓰지 않습니다.

Standalone stage result validator는 attempt와 terminal 자체 digest, authorization digest, target·artifact, 예약·완료 시각과 retry 처분을 다시 계산합니다. Terminal은 다음 exact 결과만 허용합니다.

- `state=staged`
- `operation=npm_stage_publish`
- `receipt.status=stage_submission_accepted`
- `receipt.evidence=npm_cli_exit_zero`
- `review=required_with_2fa`
- `publicAvailability=not_claimed`
- `retry=forbidden`

Receipt target·artifact는 attempt와 같고 package·version은 workflow execution target과 같아야 합니다. Authorization 원문이 artifact에 없으므로 그 발급 진위를 stage record digest만으로 주장하지 않습니다.

### Evidence 의미

Report v1은 `evidence_bound`, `first_publication_npm_stage_result`입니다. Workflow target, upstream execution·reachability digest, artifact metadata·archive digest·재확인, stage attempt·terminal의 비식별 좌표와 일곱 ready check를 canonical digest에 결속합니다.

`npm_cli_reported_stage_submission_accepted`는 GitHub artifact에 보존된 npm CLI exit-zero 결과입니다. 다음은 별도 한계입니다.

- Upstream evidence와 publication authorization의 발급 진위는 검증하지 않음
- 관측 뒤 artifact 불변성을 검증하지 않음
- Registry가 staged package를 독립적으로 반환하는지 관측하지 않음
- Stage ID와 staged tarball bytes를 관측하지 않음
- 2FA 승인과 package 공개 상태를 관측하지 않음

Side effect는 files·GitHub settings unchanged, artifact download performed-read-only, workflow dispatch·rerun·publication not-attempted입니다. Report는 stdout에만 반환하며 새 파일, runtime event·project state·telemetry를 만들지 않습니다.

## 실패 의미

- `first_publication_stage_result_arguments_invalid`: online, target 좌표, 절대 report 또는 인자 조합이 올바르지 않음
- `first_publication_stage_result_online_required`: application 경계에 online 확인이 없음
- `first_publication_stage_result_input_invalid`: repository·source·tag·run 좌표가 올바르지 않음
- `first_publication_stage_result_source_invalid`: bounded execution report source나 canonical JSON 형식이 올바르지 않음
- `first_publication_stage_result_source_mismatch`: upstream target과 인자 또는 stage package·version이 다름
- `first_publication_stage_result_not_ready`: exact artifact를 관측·다운로드하지 못함
- `first_publication_stage_result_observation_invalid`: normalized artifact·archive 관측이 올바르지 않음
- `first_publication_stage_result_archive_digest_mismatch`: downloaded archive와 expected digest가 다름
- `first_publication_stage_result_archive_invalid`: ZIP 구조·범위·entry·CRC·JSON이 올바르지 않음
- `first_publication_stage_result_record_invalid`: attempt·terminal 결속이나 terminal 상태가 올바르지 않음
- `first_publication_stage_result_report_invalid`: report 구조·시각·고정 의미·digest 또는 재계산 결과가 다름
- 관측 중 local source 변경은 기존 bounded source changed 오류를 유지함

GitHub adapter unavailable reason은 `archive_size_invalid`, `response_invalid`, `artifact_mismatch`, `archive_invalid`, `artifact_changed`, `authentication_or_artifact_unavailable`입니다. 오류와 사람 출력에는 path, digest, actor·stage ID, credential, redirect URL과 GitHub/npm 응답 원문을 넣지 않습니다.

## 결과

Binary GitHub adapter, metadata race 판정, bounded ZIP reader, standalone stage record validator, 순수 evidence·report, source reader, CLI 조정기와 formatter를 분리했습니다. Fixture는 data descriptor 유무, digest mismatch, path traversal, duplicate, 크기 위조, 압축 손상, unknown terminal, 다른 package version, metadata·source race, redigest 권한 상향, 무쓰기와 민감 metadata 폐기를 검증합니다.

현재 production workflow 실행, 실제 GitHub artifact download, npm stage·list·view·download·approve, 2FA와 package 공개는 수행하지 않았습니다. 다음 단계는 인증된 npm stage 조회와 tarball 검토를 별도 evidence로 결속하는 경계입니다.
