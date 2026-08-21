# ADR-0122: CLI stage-only workflow ref 도달 가능성 증거

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0121은 검증된 stage-only workflow bytes가 GitHub의 exact source commit에 존재함을 증명합니다. 그러나 임의의 commit은 저장소 기본 브랜치에 포함되지 않을 수 있고, release tag가 없거나 다른 commit을 가리킬 수 있습니다. 이 상태에서는 tag 기반 workflow가 의도한 source에서 실행될 조건이 갖춰졌다고 말할 수 없습니다.

기본 브랜치와 tag는 움직이는 ref입니다. 이름만 읽거나 서로 다른 시점의 SHA를 섞으면 관측 도중 force-push·tag 이동을 놓칠 수 있습니다. Annotated tag는 ref가 commit이 아니라 tag object를 가리키므로 lightweight tag와 같은 방식으로 해석해서도 안 됩니다.

Ref 도달 가능성이 확인돼도 workflow가 실행됐거나 성공했다는 뜻은 아니며 npm stage 접수·2FA 승인과 package 공개 증거도 아닙니다.

## 결정

다음 읽기 전용 명령을 추가합니다.

```text
pnpm --silent release:bootstrap:workflow-reachability \
  --repository <owner/repository> \
  --source-commit <40자 소문자 Git commit SHA> \
  --release-tag <vMAJOR.MINOR.PATCH> \
  --remote-evidence-report <absolute-path> \
  --online \
  --json
```

### 이전 증거와 package 결속

Source reader는 저장한 remote deployment evidence를 최대 64 KiB, 현재 CLI package manifest를 최대 1 MiB regular file로 읽습니다. 두 JSON은 공백 2칸과 마지막 LF의 canonical 형식이어야 합니다. 공용 bounded JSON source가 snapshot과 SHA-256을 만들고 GitHub 관측 뒤 두 파일을 다시 읽어 source race를 거부합니다.

Standalone remote evidence reader가 exact key, target, 원격 workflow binding, 고정 한계·효과, 시각과 digest를 다시 검증합니다. 인자의 repository·source commit은 report target과 같아야 합니다. 현재 package는 exact `@lervo/cli` identity·repository·license·public registry가 ready여야 합니다. Observer가 exact source commit의 `apps/cli/package.json`도 최대 1 MiB로 읽고 현재 canonical package bytes와 정확히 같은지 확인한 뒤, release tag를 임의의 `v*`가 아니라 `v<source package version>`에 결속합니다.

이 명령은 current workflow를 다시 읽거나 workflow activation transaction을 해석하지 않습니다. Exact remote source evidence를 소비해 GitHub ref 관계만 추가로 판정하며 apply·recovery 경계와 결합하지 않습니다.

### 움직이는 GitHub ref 관측

Observer는 인증된 `gh api GET`만 사용해 다음 순서로 정규화합니다.

1. Repository metadata에서 현재 default branch 이름을 읽음
2. Exact source commit의 CLI package file을 bounded base64 file로 읽음
3. Exact default branch ref에서 head commit을 읽음
4. Exact release tag ref를 읽음
5. Annotated tag이면 tag object를 최대 5단계까지 역참조하고 lightweight tag이면 commit을 직접 사용함
6. `sourceCommit...defaultHeadCommit`의 exact commit 비교에서 base·merge-base와 ahead/behind count를 확인함
7. Repository metadata, branch ref와 tag ref를 다시 읽어 첫 관측과 같은지 확인함

Default branch 이름은 Git ref로 안전한 1~255자만 허용하고 API 경로 segment를 인코딩합니다. Commit·tag object SHA는 모두 40자 소문자 SHA여야 합니다. Annotated tag의 message·tagger·signature와 repository 응답의 사용자 정보는 버리고 tag 종류·깊이·최종 commit만 남깁니다.

성공하려면 source commit이 default head의 조상이거나 head와 같고, release tag가 역참조 뒤 exact source commit을 가리켜야 합니다. Ref가 재확인 사이에 바뀌면 결과를 추정하지 않고 `references_changed`로 닫습니다.

### Evidence 의미

Evidence report v1은 `evidence_bound`, `first_publication_stage_only_workflow_ref_reachability`입니다. Exact repository·source commit·release tag·package version·workflow path, 이전 remote evidence digest·workflow SHA-256, source package path·blob SHA·byte count·SHA-256, 관측 시각, default branch head와 조상 관계, tag 종류·역참조 깊이·commit 및 ref 재확인을 canonical digest에 묶습니다. Package 원문은 report에 넣지 않습니다.

`source_on_default_branch_and_exact_release_tag`는 관측 수명주기 안의 관계만 뜻합니다. 다음 한계를 고정합니다.

- 이전 remote evidence의 외부 발급 진위는 검증하지 않음
- 관측이 끝난 뒤 default branch가 유지되는지 검증하지 않음
- Release tag의 불변성이나 보호 정책은 검증하지 않음
- Workflow 실행, npm stage 접수·2FA 승인과 package 공개는 관측하지 않음

Side effect는 files·GitHub settings unchanged, Git references observed-not-changed, workflow dispatch·publication not-attempted입니다. Report는 stdout에만 반환하며 새 파일, runtime event·project state·telemetry를 만들지 않습니다.

## 실패 의미

- `first_publication_workflow_reachability_arguments_invalid`: online, repository, exact commit·tag, absolute report 또는 인자 조합이 올바르지 않음
- `first_publication_workflow_reachability_online_required`: application 경계에 online 확인이 없음
- `first_publication_workflow_reachability_input_invalid`: repository·commit·release tag 또는 package version 결속이 올바르지 않음
- `first_publication_workflow_reachability_source_invalid`: bounded package·report source나 canonical JSON 형식이 올바르지 않음
- `first_publication_workflow_reachability_source_mismatch`: 이전 evidence target·현재 package·source commit의 package bytes 또는 인자 target이 다름
- `first_publication_workflow_reachability_not_ready`: ref를 관측하지 못했거나 source commit이 default branch·exact tag에 함께 결속되지 않음
- `first_publication_workflow_reachability_observation_invalid`: normalized branch·tag·commit·깊이·stability 구조가 올바르지 않음
- `first_publication_workflow_reachability_report_invalid`: report 구조·시각·고정 의미·digest 또는 같은 입력의 재계산 결과가 다름
- 관측 중 local source 변경은 기존 bounded source changed 오류를 유지함

GitHub adapter의 제한된 unavailable reason은 `authentication_or_references_unavailable`, `response_invalid`, `references_changed`입니다. 오류와 사람 출력에는 경로, digest, actor·tagger·reviewer·trust ID, credential, GitHub 응답 원문을 넣지 않습니다.

## 결과

GitHub observer, 공용 base64 file normalizer, annotated tag resolver, ref·tag 입력 계약, bounded source reader, 순수 evidence 정책, standalone report, CLI 조정기와 formatter를 분리했습니다. Fixture는 exact source package, lightweight·중첩 annotated tag, default branch 조상·동일 관계, 다른 tag commit, 비조상 merge-base, ref 이동, 과도한 tag 깊이, 무쓰기, upstream redigest 권한 상향, local source race와 CLI 권한 분리를 검증합니다.

현재 production workflow 적용·원격 배포나 GitHub 실제 관측을 수행하지 않았고 workflow 실행, npm stage·2FA·공개도 수행하지 않았습니다. 다음 단계는 exact workflow·source·tag에 해당하는 GitHub Actions run의 실행 결과를 별도 증거로 결속하는 경계입니다.
