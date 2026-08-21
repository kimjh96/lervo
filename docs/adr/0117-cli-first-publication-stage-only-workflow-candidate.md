# ADR-0117: CLI 최초 공개 게시 stage-only workflow 후보

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

Transition 완료는 public release, stage-only workflow, npm Trusted Publisher와 GitHub 보호 환경을 함께 요구합니다. 현재 release workflow에는 attestation과 publication authorization을 만드는 `attested-cli`까지만 있고 상시 게시 job은 없습니다.

Workflow 전체를 YAML로 다시 직렬화하면 기존 주석·표현·줄바꿈과 job 순서까지 불필요하게 바뀝니다. 반대로 문자열 끝에 job을 단순히 붙이면 `jobs` 뒤에 다른 최상위 block이 생겼을 때 잘못된 위치에 들어갈 수 있습니다. 실제 stage command가 없는데 이를 호출하는 job부터 제안하는 것도 실행 불가능한 변경입니다.

## 결정

`release:bootstrap:workflow-candidate`를 읽기 전용 candidate 명령으로 추가합니다. 인자 없는 출력은 자연어 설명, `--json`은 candidate metadata, `--workflow-yaml`은 exact 결과 bytes입니다. 두 기계 출력 mode는 함께 쓸 수 없습니다.

Source reader는 현재 `.github/workflows/cli-release-matrix.yml`을 최대 256 KiB, root `package.json`을 최대 1 MiB regular file로 읽고 관측 뒤 같은 bytes인지 다시 확인합니다. Workflow는 lossless UTF-8 LF YAML이어야 하고 package manifest는 공백 2칸 JSON과 마지막 LF 형식이어야 합니다.

Package manifest에는 다음 exact script가 먼저 있어야 합니다.

```text
release:publication:stage = node scripts/stage-cli-release-publication.mjs
```

없으면 `first_publication_workflow_activation_stage_command_missing`으로 실패하고 candidate bytes를 내보내지 않습니다. 이는 stage command가 없는 실행 불가능한 workflow를 검토 대상으로 만들지 않기 위한 차단입니다.

Source workflow는 아직 publish command, `npm-release` environment와 `publish-cli` job이 없어야 하며 `attested-cli` job은 존재해야 합니다. YAML AST는 최상위 `jobs` mapping의 끝 byte offset만 제공합니다. 생성기는 그 위치에 고정 `publish-cli` block 하나를 삽입하고 다른 source bytes는 복사합니다. 따라서 `jobs` 뒤의 다른 최상위 block도 그대로 남습니다.

새 job은 다음만 허용합니다.

- 수동 tag 조건과 `attested-cli` 의존성
- GitHub-hosted Ubuntu와 `npm-release` environment
- `contents:read`, `id-token:write`
- commit SHA에 고정된 checkout, Node, pnpm, artifact download·upload action
- 같은 workflow run의 exact `lervo-cli-${{ github.ref_name }}` artifact를 runner temp로 복원
- frozen install과 exact `release:publication:stage` 실행
- stage 실행 기록 directory를 `if: always()`로 run-attempt별 artifact에 보존

Download action은 공식 `actions/download-artifact` v4.3.0 commit `d3f86a106a0bac45b974a628896c90dbdf5c8093`에 고정합니다. 장기 registry credential, `npm publish`, `npm stage publish`와 다른 run·repository artifact 권한은 넣지 않습니다.

결과를 다시 parse한 뒤 `publish-cli`를 제외한 workflow 의미가 source와 같은지 확인하고 ADR-0115의 공용 stage-only 검사로 ready를 요구합니다. Candidate v1은 source package·workflow byte count와 SHA-256, 삽입 좌표, output digest, stage-only 제한과 무부작용을 canonical digest에 묶습니다. 전체 workflow bytes는 metadata에 복제하지 않고 별도 mode로만 반환합니다.

Candidate는 `review_required`, `writesAllowed=false`입니다. 명령에는 filesystem writer, online observer, npm·GitHub 설정 변경, reservation·publisher port가 없고 runtime event·project state·telemetry도 만들지 않습니다. Source 본문·경로·digest는 사람 출력과 오류에 넣지 않습니다.

## 결과

Workflow 후보는 한 job 이외의 source bytes를 바꾸지 않고, 뒤에 다른 top-level 설정이 추가되어도 올바른 mapping에 들어갑니다. 실행 명령이 없거나 source가 이미 활성화됐으면 후보가 생기지 않습니다.

Fixture는 exact 삽입과 앞뒤 bytes 보존, 뒤쪽 top-level block, 공용 stage-only ready, stage command 부재, 기존·직접 publish, attested producer 부재, stale snapshot, CRLF, write authority 재해시, output 변조, 생성 중 source 변경, bounded source와 출력 mode 분리를 검증합니다. 실제 workflow 적용, stage command 실행, npm·GitHub 설정과 package 게시는 주장하지 않습니다.

> 후속 결정: [ADR-0118](./0118-cli-stage-publication-command-boundary.md)은 exact stage command, 외부 호출 전 attempt와 terminal 기록, 불명확한 결과의 재실행 금지, workflow result artifact를 구현합니다. Candidate는 이제 현재 저장소에서도 생성되지만 자동 적용되지는 않습니다.
