# ADR-0106: CLI 최초 공개 게시 package metadata patch 후보

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0105의 preview는 바꿀 필드와 새 값은 보여 주지만 실제 `package.json` 결과 바이트를 만들지 않습니다. Preview만 보고 파일을 직접 편집하면 검토한 변경과 적용한 내용이 달라질 수 있고, 원본이 바뀐 뒤 오래된 결정을 적용할 수도 있습니다.

후보 생성과 파일 적용을 한 명령에 넣으면 결과 검토와 쓰기 권한도 섞입니다. 특히 release manifest는 package metadata에서 다시 만들어야 하는 생성 원본이므로 `package.json`과 함께 직접 patch할 수 없습니다.

## 결정

저장소 명령을 추가합니다.

```text
pnpm --silent release:bootstrap:metadata-candidate \
  --repository <owner/repository> \
  --license <license> \
  --scope-owner-kind <organization|user> \
  --scope-owner-name lervo \
  --json

pnpm --silent release:bootstrap:metadata-candidate \
  --repository <owner/repository> \
  --license <license> \
  --scope-owner-kind <organization|user> \
  --scope-owner-name lervo \
  --package-json
```

두 출력 mode는 함께 사용할 수 없습니다. 기본 사람용 출력은 변경 내용과 검토 경계를 설명합니다. `--json`은 candidate metadata만 출력하고 결과 파일 본문은 넣지 않습니다. `--package-json`은 후보가 결속한 정확한 UTF-8 결과 바이트만 stdout에 출력합니다. Package manager의 실행 안내가 stdout에 섞이지 않도록 기계가 읽을 두 mode를 `pnpm`으로 부를 때는 `--silent`가 필요합니다.

조정기는 ADR-0105와 같은 decision과 preview를 현재 package·release manifest snapshot에서 다시 만듭니다. Package source byte count·SHA-256, 두 manifest의 의미 digest, decision·preview digest를 candidate에 결속합니다. Candidate는 `status=review_required`, `writesAllowed=false`이며 다음 네 `set`만 허용합니다.

- `repository`
- `license`
- `publishConfig.registry`
- `publishConfig.provenance`

원본 `package.json`은 UTF-8 JSON, 공백 2칸 들여쓰기, 마지막 LF의 현재 저장소 형식과 정확히 같아야 합니다. 다른 포맷을 임의로 정규화하지 않습니다. 결과는 같은 형식으로 만들고 byte count·SHA-256을 candidate에 기록합니다. 허용한 네 필드를 제외한 JSON 값은 원본과 같아야 합니다. 변경이 하나도 없으면 불필요한 후보를 만들지 않습니다.

Candidate validator는 전달받은 digest나 검증 표시만 믿지 않습니다. 원본, decision, preview에서 candidate metadata와 결과 바이트를 모두 다시 만들고 exact equality로 대조합니다. 생성 중 두 source 파일의 bytes가 달라지면 출력하지 않습니다.

Candidate에는 선택한 새 repository·license와 비밀이 아닌 digest는 들어가지만 기존의 다른 값, 원본 파일 본문과 경로 원문은 복사하지 않습니다. `--package-json`은 사용자가 명시적으로 요청한 전체 package manifest이므로 별도 출력 mode에만 둡니다. 사람용 출력은 digest와 경로를 보여 주지 않습니다.

명령에는 filesystem writer, release generator, approval·online observer·reservation·publisher port가 없습니다. Package metadata를 쓰지 않고 release manifest를 재생성하거나 직접 patch하지 않으며, 승인·activation·게시도 실행하지 않습니다. 결과 파일, runtime event·project 상태·telemetry도 만들지 않습니다.

## 실패 의미

- `first_publication_package_metadata_candidate_arguments_invalid`: 인자가 누락·중복되었거나 알 수 없는 인자·`--online`·겹치는 출력 mode가 있습니다. Source를 읽기 전에 실패합니다.
- `first_publication_package_metadata_source_format_unsupported`: package source가 지원하는 정확한 저장소 JSON 포맷이 아닙니다. 자동 재포맷이나 후보 생성은 없습니다.
- `first_publication_package_metadata_patch_no_changes`: 선택과 package source가 이미 같아 만들 patch가 없습니다. 파일 변경은 없습니다.
- `first_publication_package_metadata_candidate_invalid`: source snapshot, preview, 허용 필드, candidate metadata 또는 결과 바이트가 재계산 결과와 다릅니다. 후보를 신뢰하거나 적용할 수 없습니다.
- 기존 source file·decision·preview 오류는 각 선행 계약의 제한된 code를 유지합니다. 어떤 오류도 입력값, 원본 내용이나 경로를 복사하지 않습니다.

## 결과

Fixture는 네 필드의 정확한 결과, 다른 필드 보존, 원본 bytes 불변, 비표준 포맷 거부, 불필요한 후보 거부, source metadata·쓰기 권한·결과 bytes 위조 거부, 생성 중 원본 변경과 두 출력 mode의 분리를 확인합니다.

후보는 검토할 내용을 고정할 뿐 적용 권한이 아닙니다. 다음 단계는 candidate digest·source SHA-256·output SHA-256에 결속된 명시적 적용 permit을 만들되 아직 쓰지 않는 계약입니다.
